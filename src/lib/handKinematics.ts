/**
 * Pure kinematics behind webcam hand tracking in motion mode — the
 * renderer-agnostic half of the original CameraFeed + ManipulatedObject
 * pair (§6.1/§6.3). No MediaPipe or PlayCanvas imports, so everything
 * here runs under Node for tests:
 *
 * - `createHandStateTracker` — per-frame landmark consumption: pinch
 *   hysteresis (0.65/0.45), the 350 ms hand-lost grace window, the
 *   screen→scene target mapping (hand-size depth proxy), exponential
 *   position smoothing and slerp rotation smoothing.
 * - `pinchTargetToWorld` / `cameraYawAngle` / `composeYawRotation` —
 *   the yaw-only camera basis that keeps hand-low-in-frame ⇒
 *   object-at-ground while orbiting re-maps hand axes.
 * - `createFreeBody` — analytic ballistic release for our kinematic
 *   stack (the original handed release velocities to MuJoCo): gravity,
 *   floor bounce with the same restitution/friction/spin-decay
 *   constants as motionRunner's closed-form traces.
 * - `createDrivenImuSampler` — differentiates the driven body pose
 *   into a body-frame specific-force + gyro reading and feeds it
 *   through the shared IMU-noise pipeline, replacing MuJoCo's
 *   accelerometer sensor for hand-driven recordings.
 */

import { clamp, lerp } from './math';
import {
  computePinchStrength,
  handOrientation,
  handSize,
  pinchCentroid,
  cameraRelativeToWorld,
  type Landmark,
  type Quat,
  type Vec3,
} from './handMath';
import {
  applyImuNoise,
  makeImuNoiseState,
  type ImuNoiseConfig,
  type ImuNoiseState,
} from './imuNoise';
import type { Rng } from './rng';

const G = 9.81;

// ---------- Contract constants (§6.3, §6.1) ----------

/** Pinch-grab hysteresis thresholds. */
export const PINCH_ON = 0.65;
export const PINCH_OFF = 0.45;
/** Tracking-dropout grace: within this window the grab + target stay
 * frozen so a one-frame MediaPipe blip doesn't drop the held body. */
export const HAND_LOST_GRACE_MS = 350;
/** Wrist→middle-MCP separation at a comfortable arm distance, and the
 * range covering full reach — the hand-size depth proxy. */
export const H_NEUTRAL = 0.13;
export const H_RANGE = 0.06;
/** Exponential smoothing factors for the pinch target (z is the
 * hand-size proxy, slightly slower). */
export const A_XY = 0.35;
export const A_Z = 0.3;
/** Slerp rate for hand-orientation smoothing. */
export const ROT_SLERP = 0.25;
/** Held-body follow lerp — matches the original FOLLOW_LERP so the
 * recorded shake signature is unchanged. */
export const PINCH_LERP = 0.35;

// Release-physics constants shared with motionRunner's analytic traces.
const RESTITUTION = 0.35;
const FRICTION_MU = 0.45;
const SPIN_TAU = 0.08;
/** Vertical bounce speed below which the body stops bouncing (m/s). */
const BOUNCE_STOP = 0.3;
/** Linear/angular speed below which a grounded body settles. */
const SETTLE_LIN = 0.02;
const SETTLE_ANG = 0.05;

type V3 = [number, number, number];

// ---------- Small quaternion helpers ([x, y, z, w]) ----------

export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** Rotate vector `v` by quaternion `q` (body → world). */
export function rotateVecByQuat(q: Quat, v: Vec3): V3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Express world vector `v` in the body frame of orientation `q`. */
export function rotateVecIntoBody(q: Quat, v: Vec3): V3 {
  return rotateVecByQuat([-q[0], -q[1], -q[2], q[3]], v);
}

function quatNormalize(q: Quat): Quat {
  const L = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / L, q[1] / L, q[2] / L, q[3] / L];
}

/**
 * Shortest-arc slerp with hemisphere flip (dot<0 → negate target), the
 * smoothing the original applied to the hand orientation.
 */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    // Nearly parallel — nlerp to dodge the sin(0) division.
    return quatNormalize([
      lerp(a[0], bx, t),
      lerp(a[1], by, t),
      lerp(a[2], bz, t),
      lerp(a[3], bw, t),
    ]);
  }
  const theta = Math.acos(clamp(dot, -1, 1));
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return quatNormalize([
    a[0] * wa + bx * wb,
    a[1] * wa + by * wb,
    a[2] * wa + bz * wb,
    a[3] * wa + bw * wb,
  ]);
}

/**
 * World angular velocity that carries `prev` to `next` over `dtSec`
 * (from the delta quaternion's axis-angle). Used both for the driven
 * IMU's gyro channel and to hand a release its spin.
 */
export function quatDeltaOmega(prev: Quat, next: Quat, dtSec: number): V3 {
  const dq = quatMul(next, [-prev[0], -prev[1], -prev[2], prev[3]]);
  // Hemisphere: pick the short way round.
  const sign = dq[3] < 0 ? -1 : 1;
  const w = clamp(dq[3] * sign, -1, 1);
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-9 || dtSec <= 0) return [0, 0, 0];
  const k = (sign * angle) / (s * dtSec);
  return [dq[0] * k, dq[1] * k, dq[2] * k];
}

// ---------- Screen → scene mapping (§6.3) ----------

/**
 * `handMappingScale` — zooming the orbit camera out widens the
 * hand-controlled volume: `clamp(camDistance / hypot(4,3,6), 1, 3)`.
 */
export function handMappingScale(cameraDistance: number): number {
  return clamp(cameraDistance / Math.hypot(4, 3, 6), 1, 3);
}

/**
 * Raw camera-space pinch target from the normalized centroid + the
 * hand-size depth proxy: x mirrored ±3·scale across the frame, y from
 * ground near cy=0.85 up to ~4·scale, z ±2.5·scale from hand size.
 */
export function mapHandToTarget(
  cx: number,
  cy: number,
  size: number,
  mapScale: number
): V3 {
  return [
    (1 - cx - 0.5) * 6 * mapScale,
    (0.85 - cy) * 5 * mapScale,
    clamp(((size - H_NEUTRAL) / H_RANGE) * 2.5, -2.5, 2.5) * mapScale,
  ];
}

// ---------- Yaw-only camera basis (§6.1 hand-target mapping) ----------

const HAND_ANCHOR: V3 = [0, 0, 0];

/**
 * Map a camera-space pinch target into world space through a yaw-only
 * basis around the origin: `back` is the camera's ground-plane
 * direction (fallback +Z when the camera is directly overhead), up is
 * world +Y so hand height maps to world height unchanged.
 */
export function pinchTargetToWorld(
  target: Vec3,
  camPos: Vec3
): V3 {
  const bx = camPos[0] - HAND_ANCHOR[0];
  const bz = camPos[2] - HAND_ANCHOR[2];
  const L = Math.hypot(bx, bz);
  const back: Vec3 = L < 1e-3 ? [0, 0, 1] : [bx / L, 0, bz / L];
  // right = up × back with up = +Y.
  const right: Vec3 = [back[2], 0, -back[0]];
  return cameraRelativeToWorld(target, HAND_ANCHOR, right, [0, 1, 0], back);
}

/** Camera yaw around +Y, measured from world +Z (0 when the camera
 * looks down −Z at the anchor). */
export function cameraYawAngle(camPos: Vec3): number {
  const dx = camPos[0] - HAND_ANCHOR[0];
  const dz = camPos[2] - HAND_ANCHOR[2];
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/** Camera yaw ∘ hand rotation — keeps the held body's rotation synced
 * to the user's hand pose while the view camera orbits. */
export function composeYawRotation(yaw: number, handQ: Quat): Quat {
  return quatMul(quatFromAxisAngle([0, 1, 0], yaw), handQ);
}

// ---------- Hand-state tracker (per-video-frame) ----------

export interface HandState {
  /** A hand is visible this frame. */
  detected: boolean;
  /** Pinch strength 0..1 (frozen during the dropout grace window). */
  pinch: number;
  /** Hysteresis-latched grab state. */
  grabbed: boolean;
  /** Smoothed camera-space target, or null when tracking is lost. */
  target: V3 | null;
  /** Slerp-smoothed hand orientation, or null before first estimate. */
  rotation: Quat | null;
}

export interface HandStateTracker {
  /**
   * Consume one video frame's landmarks (null = no hand detected).
   * `mapScale` is `handMappingScale(cameraDistance)` at call time.
   */
  update(
    landmarks: readonly Landmark[] | null,
    nowMs: number,
    mapScale: number
  ): HandState;
}

export function createHandStateTracker(): HandStateTracker {
  let grabbed = false;
  let pinch = 0;
  let target: V3 | null = null;
  let rotation: Quat | null = null;
  let lastSeenMs = -Infinity;

  const snapshot = (detected: boolean): HandState => ({
    detected,
    pinch,
    grabbed,
    target: target ? [...target] : null,
    rotation: rotation ? [...rotation] : null,
  });

  return {
    update(landmarks, nowMs, mapScale) {
      if (!landmarks) {
        // Within the grace window everything stays frozen; beyond it
        // release the grab and null the target (body goes ballistic).
        if (nowMs - lastSeenMs > HAND_LOST_GRACE_MS) {
          pinch = 0;
          grabbed = false;
          target = null;
          rotation = null;
        }
        return snapshot(false);
      }

      lastSeenMs = nowMs;
      pinch = computePinchStrength(landmarks);
      if (!grabbed && pinch > PINCH_ON) grabbed = true;
      else if (grabbed && pinch < PINCH_OFF) grabbed = false;

      const c = pinchCentroid(landmarks);
      const raw = mapHandToTarget(c.x, c.y, handSize(landmarks), mapScale);
      target = target
        ? [
            target[0] + (raw[0] - target[0]) * A_XY,
            target[1] + (raw[1] - target[1]) * A_XY,
            target[2] + (raw[2] - target[2]) * A_Z,
          ]
        : raw;

      // Keep the previous rotation when the landmarks are degenerate.
      const handQ = handOrientation(landmarks);
      if (handQ) {
        rotation = rotation ? quatSlerp(rotation, handQ, ROT_SLERP) : handQ;
      }
      return snapshot(true);
    },
  };
}

// ---------- Analytic free body (release → fall → settle) ----------

export interface FreeBodyPose {
  pos: V3;
  quat: Quat;
  /** True once the body has come to rest — pose stops changing. */
  settled: boolean;
}

export interface FreeBody {
  /** Advance by `dtSec` and return the new pose. */
  step(dtSec: number): FreeBodyPose;
}

/**
 * Ballistic release for the kinematic body: gravity, floor bounce with
 * restitution, sliding friction, and exponential spin decay once
 * grounded. `restY` is the body's resting center height (splat floor
 * convention y=0). The same constants shape motionRunner's closed-form
 * impact/slide/settle, so hand-thrown and procedural traces agree.
 */
export function createFreeBody(init: {
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  angvel: Vec3;
  restY: number;
}): FreeBody {
  const pos: V3 = [...init.pos] as V3;
  let quat: Quat = [...init.quat];
  const vel: V3 = [...init.linvel] as V3;
  const ang: V3 = [...init.angvel] as V3;
  const restY = init.restY;
  let settled = false;

  return {
    step(dtSec) {
      const dt = Math.min(Math.max(dtSec, 0), 0.1); // clamp tab-jank dts
      if (settled || dt === 0) {
        return { pos: [...pos] as V3, quat: [...quat], settled };
      }

      vel[1] -= G * dt;
      pos[0] += vel[0] * dt;
      pos[1] += vel[1] * dt;
      pos[2] += vel[2] * dt;

      const grounded = pos[1] <= restY;
      if (grounded) {
        pos[1] = restY;
        if (vel[1] < 0) {
          const bounce = -vel[1] * RESTITUTION;
          vel[1] = bounce < BOUNCE_STOP ? 0 : bounce;
        }
        // Sliding friction on carried horizontal speed.
        const speed = Math.hypot(vel[0], vel[2]);
        if (speed > 0) {
          const next = Math.max(0, speed - FRICTION_MU * G * dt);
          const k = next / speed;
          vel[0] *= k;
          vel[2] *= k;
        }
        // Contact spins down the tumble.
        const decay = Math.exp(-dt / SPIN_TAU);
        ang[0] *= decay;
        ang[1] *= decay;
        ang[2] *= decay;
      }

      const angMag = Math.hypot(ang[0], ang[1], ang[2]);
      if (angMag > 1e-9) {
        const dq = quatFromAxisAngle(
          [ang[0] / angMag, ang[1] / angMag, ang[2] / angMag],
          angMag * dt
        );
        quat = quatNormalize(quatMul(dq, quat));
      }

      if (
        grounded &&
        vel[1] === 0 &&
        Math.hypot(vel[0], vel[2]) < SETTLE_LIN &&
        angMag < SETTLE_ANG
      ) {
        settled = true;
      }
      return { pos: [...pos] as V3, quat: [...quat], settled };
    },
  };
}

// ---------- Driven-pose IMU sampler ----------

export interface DrivenImuSampler {
  /**
   * Feed the driven body's pose once per render tick. Differentiates
   * position twice (velocity, then coordinate acceleration) and the
   * orientation once (gyro) — the smoothing the original applied
   * upstream (target smoothing + PINCH_LERP follow) is what keeps the
   * double-differenced channel from exploding, exactly as it kept the
   * MuJoCo weld-follow trace clean.
   */
  tick(pos: Vec3, quat: Quat, dtSec: number): void;
  /**
   * Emit a noisy 6-axis reading of the latest kinematic state for one
   * accumulated sample period. Body-frame specific force (a − g: at
   * rest reads +9.81 up, ~0 in free fall) + body-frame gyro, through
   * `applyImuNoise` (no-op when cfg.enabled is false).
   */
  sample(
    sampleDtSec: number,
    cfg: ImuNoiseConfig
  ): { accel: readonly number[]; gyro: readonly number[] };
  /** Forget differentiation history (teleports must not read as
   * metres-per-frame velocity spikes). Noise bias state is kept. */
  reset(): void;
}

export function createDrivenImuSampler(rng: Rng = Math.random): DrivenImuSampler {
  let prevPos: V3 | null = null;
  let prevVel: V3 | null = null;
  let prevQuat: Quat | null = null;
  // Latest clean body-frame reading; a body at rest reads +1 g up.
  let cleanAccel: V3 = [0, G, 0];
  let cleanGyro: V3 = [0, 0, 0];
  let lastQuat: Quat = [0, 0, 0, 1];
  let noise: ImuNoiseState | null = null;

  return {
    tick(pos, quat, dtSec) {
      const dt = Math.max(dtSec, 1e-3);
      const p: V3 = [pos[0], pos[1], pos[2]];
      const vel: V3 = prevPos
        ? [(p[0] - prevPos[0]) / dt, (p[1] - prevPos[1]) / dt, (p[2] - prevPos[2]) / dt]
        : [0, 0, 0];
      const accWorld: V3 =
        prevPos && prevVel
          ? [
              (vel[0] - prevVel[0]) / dt,
              (vel[1] - prevVel[1]) / dt,
              (vel[2] - prevVel[2]) / dt,
            ]
          : [0, 0, 0];
      // Specific force f = a − g with g = (0, −G, 0) ⇒ a + (0, G, 0).
      const specificWorld: V3 = [accWorld[0], accWorld[1] + G, accWorld[2]];
      cleanAccel = rotateVecIntoBody(quat, specificWorld);
      cleanGyro = prevQuat
        ? rotateVecIntoBody(quat, quatDeltaOmega(prevQuat, quat, dt))
        : [0, 0, 0];
      lastQuat = [...quat];
      prevPos = p;
      prevVel = vel;
      prevQuat = [...quat];
    },
    sample(sampleDtSec, cfg) {
      // Lazy noise state — created with the config in force at the
      // first sample, like the original's noiseStateRef.
      if (!noise) noise = makeImuNoiseState(cfg, rng);
      return applyImuNoise(cleanAccel, cleanGyro, noise, cfg, sampleDtSec, rng);
    },
    reset() {
      prevPos = null;
      prevVel = null;
      prevQuat = null;
      cleanAccel = rotateVecIntoBody(lastQuat, [0, G, 0]);
      cleanGyro = [0, 0, 0];
    },
  };
}
