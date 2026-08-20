/**
 * Kinematic Braccio arm simulation — joint-space playback of one of the
 * five ported trajectory classes for a single recording window, with an
 * end-effector IMU derived from forward kinematics and a kinematic
 * pick-and-place outcome model.
 *
 * The original app stepped a MuJoCo model (position-actuated servos +
 * friction-grasp finger pads) and observed the physical target body;
 * this port keeps the same recorded surface without physics:
 *
 *   - joints come straight from the ported `buildArmTrajectory`
 *     generators (identical keyframe schedules and IK), so the joint /
 *     IMU signatures line up with the original dataset classes,
 *   - the end-effector IMU is finite-differenced from the FK tip pose:
 *     proper acceleration (dv/dt + gravity) rotated into the gripper
 *     body frame, angular rate from the yaw / cumulative-pitch / roll
 *     derivatives — then run through `applyImuNoise`,
 *   - the pick_place outcome is evaluated geometrically: the grasp
 *     window (t ∈ [0.38, 0.62]) checks how far the commanded gripper
 *     tip is from the target when the fingers close. A tip that closes
 *     off-center beyond the drift tolerance would shove the target in
 *     the real world, so the grasp is rejected ('target_drifted'), the
 *     gripper is held open for the rest of the window (never pretend a
 *     grasp worked), and success is forced false. An aligned, touching
 *     close attaches the target to the tip; lift is measured from the
 *     target's bottom-Y delta and success latches at ≥ 0.02 m via the
 *     ported `armPickupOutcome` reducers.
 *
 * Kinematic limitation (documented deviation): without rigid-body
 * dynamics targets cannot tip over, so the 'target_tipped' failure
 * reason never fires here — misgrasps surface as 'target_drifted'.
 *
 * Pure TS, renderer-free, deterministic under an injected RNG.
 */

import type { AccelSample } from '../lib/types';
import {
  BRACCIO_LINKS,
  BRACCIO_REST_RAD,
} from '../lib/braccio';
import type { BraccioJointVector } from '../lib/braccioIk';
import {
  buildArmTrajectory,
  type ArmParametricPath,
  type ArmTrajectory,
} from '../lib/armTrajectories';
import { floorSafePickupTipY } from '../lib/armPickupGeometry';
import {
  assessArmPickupGrasp,
  armPickupDriftTolerance,
  buildArmPickupMetadata,
  createArmPickupObservation,
  updateArmPickupGraspAssessment,
  updateArmPickupObservation,
  type ArmPickupObservation,
  type ArmPickupTargetMetadata,
} from '../lib/armPickupOutcome';
import type { ArmJointSample } from '../lib/rosMessages';
import type { IngestionMetadataExtras } from '../lib/types';
import {
  applyImuNoise,
  makeImuNoiseState,
  DEFAULT_IMU_NOISE,
  type ImuNoiseConfig,
} from '../lib/imuNoise';
import { clamp01, wrapAngle } from '../lib/math';
import { ROBOT_TICK_MS } from './roverSim';

const GRAVITY = 9.81;

/** Grasp assessment window (normalized time) — same as the original. */
const GRASP_WINDOW_START = 0.38;
const GRASP_WINDOW_END = 0.62;

/** Normalized time of the grasp (gripper fully closed) keyframe. */
const GRASP_T = 0.5;

/** Normalized time of the release keyframe. */
const RELEASE_T = 0.95;

/** Vertical slack for "the closing gripper actually touches the
 * target": tip must be at or below target top + this margin. */
const GRASP_TOUCH_MARGIN_M = 0.01;

type Vec3 = [number, number, number];

export type ArmFkPose = {
  /** Gripper tip position (world, meters). */
  tip: Vec3;
  /** Wrist-pitch joint position (world). */
  wrist: Vec3;
  /** End-effector body axes in world space (right, up-ish, approach). */
  bx: Vec3;
  by: Vec3;
  bz: Vec3;
  /** Base yaw (rad). */
  yaw: number;
  /** Cumulative pitch from vertical at the gripper (rad). */
  pitch: number;
  /** Wrist roll offset from neutral (rad). */
  roll: number;
};

/**
 * Forward kinematics for the Braccio joint vector (servo radians ×5 +
 * normalized aperture), matching the IK conventions in braccioIk.ts:
 * pitch angles accumulate from vertical (+Y), yaw about +Y with the
 * arm plane direction (sin yaw, 0, cos yaw).
 */
export function braccioFk(joints: BraccioJointVector): ArmFkPose {
  const L = BRACCIO_LINKS;
  const yaw = joints[0];
  const t1 = joints[1];
  const t12 = t1 + joints[2];
  const t123 = t12 + joints[3];
  const roll = joints[4] - Math.PI / 2; // neutral roll is 90°

  const ux = Math.sin(yaw);
  const uz = Math.cos(yaw);

  const baseY = L.plateThickness + L.base;
  // Shoulder joint sits atop the base column.
  let x = 0;
  let y = baseY;
  let z = 0;
  // Upper arm.
  x += L.shoulder * Math.sin(t1) * ux;
  y += L.shoulder * Math.cos(t1);
  z += L.shoulder * Math.sin(t1) * uz;
  // Forearm → wrist-pitch joint.
  x += L.elbow * Math.sin(t12) * ux;
  y += L.elbow * Math.cos(t12);
  z += L.elbow * Math.sin(t12) * uz;
  const wrist: Vec3 = [x, y, z];
  // Wrist-pitch + wrist-roll + finger stack along the approach axis.
  const reach = L.wristPitch + L.wristRoll + L.fingerLength;
  const dirX = Math.sin(t123) * ux;
  const dirY = Math.cos(t123);
  const dirZ = Math.sin(t123) * uz;
  const tip: Vec3 = [x + reach * dirX, y + reach * dirY, z + reach * dirZ];

  // Body frame: bz = approach axis (wrist → tip); bx0 = horizontal
  // perpendicular to the arm plane; roll rotates bx/by about bz.
  const bz: Vec3 = [dirX, dirY, dirZ];
  const bx0: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const by0: Vec3 = [
    bz[1] * bx0[2] - bz[2] * bx0[1],
    bz[2] * bx0[0] - bz[0] * bx0[2],
    bz[0] * bx0[1] - bz[1] * bx0[0],
  ];
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const bx: Vec3 = [
    bx0[0] * c + by0[0] * s,
    bx0[1] * c + by0[1] * s,
    bx0[2] * c + by0[2] * s,
  ];
  const by: Vec3 = [
    by0[0] * c - bx0[0] * s,
    by0[1] * c - bx0[1] * s,
    by0[2] * c - bx0[2] * s,
  ];

  return { tip, wrist, bx, by, bz, yaw, pitch: t123, roll };
}

/** Pick-and-place target handed to the sim by the runner / UI layer. */
export type ArmPickupTarget = {
  id: string;
  /** Target center position (world, meters). */
  position: Vec3;
  /** Half extents of the target's AABB (meters). */
  halfExtents: Vec3;
  /** Descriptor forwarded into the EI pickup metadata. */
  meta: ArmPickupTargetMetadata;
};

export type ArmSimOptions = {
  trajectory: ArmTrajectory;
  durationMs: number;
  /** Home / rest pose consumed by pick_place, sweep, wave. */
  home?: BraccioJointVector;
  /** pick_place target; null/omitted falls back to the stock
   * placeholder pickup point (no outcome observation). */
  target?: ArmPickupTarget | null;
  imuNoise?: ImuNoiseConfig;
  rng?: () => number;
  timeOriginMs?: number;
};

export type ArmTick = {
  t: number;
  /** Commanded joints this tick (aperture forced open after a grasp
   * rejection) — drive the visual with this. */
  joints: BraccioJointVector;
  imu: AccelSample;
  /** Joint snapshot from the same tick, for ROS JointState export. */
  jointSample: ArmJointSample;
  /** Modeled target center (world) — null when there is no target.
   * The engine layer can move the target mesh with this. */
  targetPos: Vec3 | null;
};

export type ArmSimOutcome = {
  observation: ArmPickupObservation | null;
  /** EI metadata extras (empty object for non-pick_place). */
  metadata: IngestionMetadataExtras;
  target: ArmPickupTargetMetadata;
};

export type ArmSim = {
  readonly path: ArmParametricPath;
  /** Joints at t = 0 — for pre-roll setup of the visual. */
  readonly startJoints: BraccioJointVector;
  tick(elapsedMs: number): ArmTick;
  /** Final pickup outcome + EI metadata. Callable any time; reflects
   * everything observed so far. */
  getOutcome(): ArmSimOutcome;
};

const FALLBACK_TARGET_META: ArmPickupTargetMetadata = {
  id: null,
  type: 'fallback',
};

export function createArmSim(opts: ArmSimOptions): ArmSim {
  const rng = opts.rng ?? Math.random;
  const noiseCfg = opts.imuNoise ?? DEFAULT_IMU_NOISE;
  const durationMs = Math.max(1, opts.durationMs);
  const home: BraccioJointVector = opts.home ?? [...BRACCIO_REST_RAD];
  const target = opts.trajectory === 'pick_place' ? opts.target ?? null : null;

  // Floor-safe pickup point: tip aims at the target's bottom, clamped
  // so the finger pads can't be commanded through the floor. Drop
  // mirrors the pickup across x, same height.
  let pickup: { x: number; y: number; z: number } | undefined;
  let drop: { x: number; y: number; z: number } | undefined;
  if (target) {
    const tipY = floorSafePickupTipY(target.position[1], target.halfExtents[1]);
    pickup = { x: target.position[0], y: tipY, z: target.position[2] };
    drop = { x: -target.position[0], y: tipY, z: target.position[2] };
  }

  const path = buildArmTrajectory(opts.trajectory, {
    pickup,
    drop,
    home,
    rng,
  });

  const noiseState = makeImuNoiseState(noiseCfg, rng);
  const timeOrigin =
    opts.timeOriginMs ??
    (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ---- Pickup outcome model (pick_place with a real target only) ----
  let observation: ArmPickupObservation | null = createArmPickupObservation(
    target?.id ?? null,
  );
  let rejected = false;
  let attached = false;
  // Where the target currently sits in the model (starts at its spawn).
  let targetPos: Vec3 | null = target ? [...target.position] : null;
  // Tip offset captured at attach time so the target follows rigidly.
  let attachTipY = 0;

  const graspJoints = path.sample(GRASP_T);
  const graspTip = braccioFk(graspJoints).tip;
  const driftTolerance = target
    ? armPickupDriftTolerance(target.halfExtents)
    : 0;
  const graspReachXZ = target
    ? Math.hypot(
        graspTip[0] - target.position[0],
        graspTip[2] - target.position[2],
      )
    : 0;
  const graspTouches = target
    ? graspTip[1] <=
      target.position[1] + target.halfExtents[1] + GRASP_TOUCH_MARGIN_M
    : false;

  const startJoints = path.sample(0);

  // Finite-difference history, seeded from the path so the first tick
  // carries no startup spike (kinematic analogue of snapToPose).
  const tickSec = ROBOT_TICK_MS / 1000;
  const fk0 = braccioFk(startJoints);
  const fkNext = braccioFk(path.sample(ROBOT_TICK_MS / durationMs));
  const v0: Vec3 = [
    (fkNext.tip[0] - fk0.tip[0]) / tickSec,
    (fkNext.tip[1] - fk0.tip[1]) / tickSec,
    (fkNext.tip[2] - fk0.tip[2]) / tickSec,
  ];
  let prevElapsed = -ROBOT_TICK_MS;
  let prevTip: Vec3 = [
    fk0.tip[0] - v0[0] * tickSec,
    fk0.tip[1] - v0[1] * tickSec,
    fk0.tip[2] - v0[2] * tickSec,
  ];
  let prevVel: Vec3 = [...v0];
  let prevYaw = fk0.yaw - (wrapAngle(fkNext.yaw - fk0.yaw) / tickSec) * tickSec;
  let prevPitch =
    fk0.pitch - (wrapAngle(fkNext.pitch - fk0.pitch) / tickSec) * tickSec;
  let prevRoll =
    fk0.roll - (wrapAngle(fkNext.roll - fk0.roll) / tickSec) * tickSec;

  const tick = (elapsedMs: number): ArmTick => {
    const dt = Math.max(1e-3, (elapsedMs - prevElapsed) / 1000);
    const u = clamp01(elapsedMs / durationMs);
    const joints: BraccioJointVector = [...path.sample(u)];
    // A rejected grasp keeps the gripper open for the rest of the
    // window — never pretend the grasp worked.
    if (rejected) joints[5] = 1;

    const fk = braccioFk(joints);

    // ---- Pickup outcome bookkeeping ----
    if (target && targetPos) {
      if (u >= GRASP_WINDOW_START && u <= GRASP_WINDOW_END && !attached) {
        // Model the shove: when the closing gripper touches the target
        // but is misaligned beyond the drift tolerance, the fingers
        // would push it across the floor — reflect that displacement in
        // the modeled pose so the ported assessment sees the drift.
        let modeled: Vec3 = [...target.position];
        if (
          !rejected &&
          graspTouches &&
          graspReachXZ > driftTolerance &&
          u >= GRASP_T
        ) {
          modeled = [graspTip[0], target.position[1], graspTip[2]];
          targetPos = [...modeled];
        }
        const assessment = assessArmPickupGrasp(
          {
            pos: modeled,
            quat: [1, 0, 0, 0], // kinematic targets never tip
          },
          target.position,
          target.halfExtents,
        );
        observation = updateArmPickupGraspAssessment(
          observation,
          target.id,
          assessment,
        );
        if (assessment.reason) rejected = true;
      }
      if (!rejected && !attached && u >= GRASP_T && graspTouches &&
          graspReachXZ <= driftTolerance) {
        attached = true;
        attachTipY = graspTip[1];
      }
      if (attached) {
        if (u <= RELEASE_T) {
          // Target follows the gripper rigidly between grasp + release.
          targetPos = [
            fk.tip[0],
            target.position[1] + Math.max(0, fk.tip[1] - attachTipY),
            fk.tip[2],
          ];
          const lift = Math.max(0, fk.tip[1] - attachTipY);
          observation = updateArmPickupObservation(observation, target.id, lift);
        } else {
          // Released: target rests where it was dropped.
          attached = false;
          targetPos = [targetPos[0], target.position[1], targetPos[2]];
        }
      }
    }

    // ---- FK-derived end-effector IMU ----
    const vel: Vec3 = [
      (fk.tip[0] - prevTip[0]) / dt,
      (fk.tip[1] - prevTip[1]) / dt,
      (fk.tip[2] - prevTip[2]) / dt,
    ];
    const acc: Vec3 = [
      (vel[0] - prevVel[0]) / dt,
      (vel[1] - prevVel[1]) / dt,
      (vel[2] - prevVel[2]) / dt,
    ];
    // Proper acceleration (stationary reads +g up).
    const f: Vec3 = [acc[0], acc[1] + GRAVITY, acc[2]];
    const bodyAccel: Vec3 = [
      f[0] * fk.bx[0] + f[1] * fk.bx[1] + f[2] * fk.bx[2],
      f[0] * fk.by[0] + f[1] * fk.by[1] + f[2] * fk.by[2],
      f[0] * fk.bz[0] + f[1] * fk.bz[1] + f[2] * fk.bz[2],
    ];

    // Angular velocity: yaw about world +Y, pitch about the (yawed)
    // horizontal axis, roll about the approach axis.
    const yawRate = wrapAngle(fk.yaw - prevYaw) / dt;
    const pitchRate = wrapAngle(fk.pitch - prevPitch) / dt;
    const rollRate = wrapAngle(fk.roll - prevRoll) / dt;
    const wAxis: Vec3 = [Math.cos(fk.yaw), 0, -Math.sin(fk.yaw)];
    const omega: Vec3 = [
      yawRate * 0 + pitchRate * wAxis[0] + rollRate * fk.bz[0],
      yawRate * 1 + pitchRate * wAxis[1] + rollRate * fk.bz[1],
      yawRate * 0 + pitchRate * wAxis[2] + rollRate * fk.bz[2],
    ];
    const bodyGyro: Vec3 = [
      omega[0] * fk.bx[0] + omega[1] * fk.bx[1] + omega[2] * fk.bx[2],
      omega[0] * fk.by[0] + omega[1] * fk.by[1] + omega[2] * fk.by[2],
      omega[0] * fk.bz[0] + omega[1] * fk.bz[1] + omega[2] * fk.bz[2],
    ];

    const noisy = applyImuNoise(bodyAccel, bodyGyro, noiseState, noiseCfg, dt, rng);

    const t = timeOrigin + elapsedMs;
    const imu: AccelSample = {
      t,
      ax: noisy.accel[0],
      ay: noisy.accel[1],
      az: noisy.accel[2],
      gx: noisy.gyro[0],
      gy: noisy.gyro[1],
      gz: noisy.gyro[2],
    };
    // Joint samples pair 1:1 with IMU ticks (ROS Imu + JointState lockstep).
    const jointSample: ArmJointSample = { t, joints: [...joints] };

    prevElapsed = elapsedMs;
    prevTip = [...fk.tip];
    prevVel = vel;
    prevYaw = fk.yaw;
    prevPitch = fk.pitch;
    prevRoll = fk.roll;

    return {
      t,
      joints,
      imu,
      jointSample,
      targetPos: targetPos ? [...targetPos] : null,
    };
  };

  const getOutcome = (): ArmSimOutcome => {
    const meta = target?.meta ?? FALLBACK_TARGET_META;
    return {
      observation,
      metadata: buildArmPickupMetadata(opts.trajectory, meta, observation),
      target: meta,
    };
  };

  return { path, startJoints, tick, getOutcome };
}
