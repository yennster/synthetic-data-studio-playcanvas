/**
 * Kinematic rover simulation — drives one recording window of a labelled
 * rover event (`cruise` / `collision` / `stuck`) through an obstacle
 * field WITHOUT a physics engine.
 *
 * The original app stepped a MuJoCo model (3-DOF planar chassis with
 * position actuators) and read a simulated IMU site; this port keeps the
 * same observable behavior with pure math:
 *
 *   - path choreography comes from the ported `buildEventPath`
 *     generators in src/lib/rover.ts (identical spawn / launch / pin
 *     parameters, so the labelled scenarios look the same),
 *   - obstacles are world-space AABBs supplied by the caller (the engine
 *     layer collects them from the scene). Contact and lidar both test
 *     against these boxes,
 *   - penetration is resolved by projecting the chassis disc out of the
 *     obstacle each tick, so a `collision` run actually stops at the
 *     obstacle face (the finite-difference IMU then shows the real
 *     deceleration spike) and a `stuck` run stays pressed in contact
 *     while it vibrates,
 *   - the 6-axis IMU is derived from the motion itself: proper
 *     acceleration = dv/dt + gravity, rotated into the chassis body
 *     frame, plus a short suspension-jolt transient on contact onset;
 *     gyro is the yaw rate. Both run through `applyImuNoise`,
 *   - lidar uses the ported `scanLidar` fan with an analytic
 *     ray-vs-AABB (slab method) caster over the same obstacle boxes.
 *
 * Everything here is renderer-free and deterministic under an injected
 * RNG, so the whole event window is unit-testable. The runner calls
 * `tick(elapsedMs)` at ~20 Hz; each tick returns the pose (for the
 * engine visual), one `AccelSample`, and one `LidarSample`.
 */

import type { AccelSample, LidarSample, RoverEvent } from '../lib/types';
import {
  buildEventPath,
  type ObstacleDisc,
  type ParametricPath,
  type RoverPose,
} from '../lib/rover';
import {
  LIDAR_RAY_NEAR,
  scanLidar,
  type LidarRayCaster,
} from '../lib/lidar';
import {
  applyImuNoise,
  makeImuNoiseState,
  DEFAULT_IMU_NOISE,
  type ImuNoiseConfig,
  type ImuNoiseState,
} from '../lib/imuNoise';
import { clamp01, wrapAngle } from '../lib/math';

export type { RoverPose } from '../lib/rover';

/** Axis-aligned world-space box, min/max corners in meters. The engine
 * layer produces these from the live obstacle set (spawned primitives,
 * imported models). */
export type WorldAabb = {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
};

/**
 * Rover dimensions shared with the original app's visual rig and MJCF
 * (meters). The engine-side rover visual should build from the same
 * numbers so the recorded lidar origin and the rendered head line up.
 */
export const ROVER_DIMS = {
  chassis: { w: 0.5, h: 0.18, d: 0.7 },
  wheelR: 0.12,
  wheelT: 0.07,
  rideHeight: 0.05,
  headSize: 0.18,
} as const;

/** Planning/contact disc radius of the chassis (half-diagonal-ish),
 * matching the legacy disc-circle contact math. */
export const ROVER_CHASSIS_RADIUS = 0.36;

/** Chassis center height: wheel radius + ride height. */
export const ROVER_CHASSIS_Y = ROVER_DIMS.wheelR + ROVER_DIMS.rideHeight;

/** Lidar scan origin height — the rover head:
 * wheelR + rideHeight + 0.18 (mast) + headSize/2 = 0.44 m. */
export const ROVER_LIDAR_HEIGHT =
  ROVER_DIMS.wheelR + ROVER_DIMS.rideHeight + 0.18 + ROVER_DIMS.headSize / 2;

/** Robotics sensor record rate — everything sensor-side is 20 Hz. */
export const ROBOT_RECORD_HZ = 20;

/** Nominal tick period at the record rate (50 ms). */
export const ROBOT_TICK_MS = 1000 / ROBOT_RECORD_HZ;

const GRAVITY = 9.81;

/** How much of the contact-onset impulse survives each subsequent tick
 * (exponential ring-down of the suspension jolt). */
const IMPULSE_DECAY = 0.35;

/** Jolt magnitude per m/s of impact speed (m/s² per m/s). Models the
 * suspension transient a rigid-body integrator would produce on top of
 * the one-tick dv/dt deceleration. */
const IMPULSE_PER_SPEED = 6;

/**
 * Convert a world AABB to the planner's ground disc: XZ center +
 * bounding radius (half the XZ diagonal, floored at 5 cm) — the same
 * convention the original used for imported assets.
 */
export function aabbToObstacleDisc(box: WorldAabb): ObstacleDisc {
  const cx = (box.min[0] + box.max[0]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  const hx = Math.max(0, (box.max[0] - box.min[0]) / 2);
  const hz = Math.max(0, (box.max[2] - box.min[2]) / 2);
  return { x: cx, z: cz, r: Math.max(0.05, Math.hypot(hx, hz)) };
}

/**
 * Analytic ray-vs-AABB caster (slab method) over an obstacle list —
 * the injected `castRay` backend for `scanLidar`. Honors the near-clip
 * contract (`LIDAR_RAY_NEAR`): hits closer than the near plane are
 * ignored, and only front-face entries count (a ray starting inside a
 * box misses it, matching the original front-side raycaster).
 */
export function makeAabbLidarCaster(
  obstacles: readonly WorldAabb[],
): LidarRayCaster {
  return (origin, dir) => {
    let nearest: number | null = null;
    for (const box of obstacles) {
      let tMin = -Infinity;
      let tMax = Infinity;
      let miss = false;
      for (let axis = 0; axis < 3; axis++) {
        const o = origin[axis];
        const d = dir[axis];
        const lo = box.min[axis];
        const hi = box.max[axis];
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) {
            miss = true;
            break;
          }
        } else {
          const t1 = (lo - o) / d;
          const t2 = (hi - o) / d;
          const tNear = Math.min(t1, t2);
          const tFar = Math.max(t1, t2);
          if (tNear > tMin) tMin = tNear;
          if (tFar < tMax) tMax = tFar;
          if (tMin > tMax) {
            miss = true;
            break;
          }
        }
      }
      if (miss) continue;
      // Front-face entry only, past the near clip.
      if (tMin >= LIDAR_RAY_NEAR && tMin <= tMax) {
        if (nearest === null || tMin < nearest) nearest = tMin;
      }
    }
    return nearest;
  };
}

export type RoverSimOptions = {
  event: RoverEvent;
  /** World obstacle boxes; used for path planning (as discs), contact
   * detection, and lidar raycasting. */
  obstacles: readonly WorldAabb[];
  durationMs: number;
  lidarBins: number;
  lidarMaxRange: number;
  imuNoise?: ImuNoiseConfig;
  /** Deterministic RNG hook (path choice + sensor noise). */
  rng?: () => number;
  /** Timestamp of `elapsedMs = 0`, in performance.now() ms. Sample
   * timestamps are `timeOriginMs + elapsedMs`. */
  timeOriginMs?: number;
};

export type RoverTick = {
  /** Sample timestamp (performance.now() clock), ms. */
  t: number;
  /** Chassis pose after contact resolution — drive the visual with this. */
  pose: RoverPose;
  /** True while the commanded chassis disc overlaps any obstacle. */
  inContact: boolean;
  imu: AccelSample;
  lidar: LidarSample;
};

export type RoverSim = {
  /** The labelled parametric path driving this window. */
  readonly path: ParametricPath;
  /** Pose at normalized time 0 (contact-resolved) — for pre-roll setup. */
  readonly startPose: RoverPose;
  /**
   * Advance to `elapsedMs` since window start and emit one sensor tick.
   * Callers advance monotonically (the runner steps at ~50 ms).
   */
  tick(elapsedMs: number): RoverTick;
};

/**
 * Resolve chassis penetration against the obstacle field.
 *
 * Contact is disc-vs-circle — the chassis disc against each obstacle's
 * bounding circle (the same discs the path planner uses). This matches
 * the original app, where the MuJoCo obstacles were CYLINDERS with the
 * planner's bounding radius: the `stuck` pin distance (r + 0.26) only
 * keeps the chassis permanently overlapping under this convention.
 * (Lidar, by contrast, raycasts the actual boxes — same split as the
 * original, which lidar-raycast the visual meshes.)
 *
 * Returns the corrected position and whether the commanded position
 * penetrated anything.
 */
function resolveContact(
  x: number,
  z: number,
  discs: readonly ObstacleDisc[],
): { x: number; z: number; contact: boolean } {
  let px = x;
  let pz = z;
  let contact = false;
  // Two passes keep multi-obstacle corner cases stable.
  for (let pass = 0; pass < 2; pass++) {
    for (const o of discs) {
      const minDist = ROVER_CHASSIS_RADIUS + o.r;
      let dx = px - o.x;
      let dz = pz - o.z;
      let d = Math.hypot(dx, dz);
      if (d >= minDist) continue;
      contact = true;
      if (d < 1e-9) {
        // Dead-center: push out along +X arbitrarily but stably.
        dx = 1;
        dz = 0;
        d = 1;
      }
      px = o.x + (dx / d) * minDist;
      pz = o.z + (dz / d) * minDist;
    }
  }
  return { x: px, z: pz, contact };
}

export function createRoverSim(opts: RoverSimOptions): RoverSim {
  const rng = opts.rng ?? Math.random;
  const noiseCfg = opts.imuNoise ?? DEFAULT_IMU_NOISE;
  const durationMs = Math.max(1, opts.durationMs);
  const discs = opts.obstacles.map(aabbToObstacleDisc);
  const path = buildEventPath(opts.event, discs, rng);
  const castRay = makeAabbLidarCaster(opts.obstacles);
  const noiseState: ImuNoiseState = makeImuNoiseState(noiseCfg, rng);
  const timeOrigin =
    opts.timeOriginMs ??
    (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const resolvedAt = (u: number): RoverPose => {
    const p = path.sample(clamp01(u));
    const r = resolveContact(p.x, p.z, discs);
    return { x: r.x, z: r.z, heading: p.heading };
  };

  // Seed the finite-difference history so the first tick doesn't carry
  // a spurious startup spike (the kinematic analogue of the original's
  // snapToPose + zeroed qvel contract): estimate the initial velocity
  // from a forward difference along the path and extrapolate one tick
  // backwards.
  const tickSec = ROBOT_TICK_MS / 1000;
  const u0 = 0;
  const uStep = ROBOT_TICK_MS / durationMs;
  const p0 = resolvedAt(u0);
  const pNext = resolvedAt(uStep);
  const v0x = (pNext.x - p0.x) / tickSec;
  const v0z = (pNext.z - p0.z) / tickSec;
  const w0 = wrapAngle(pNext.heading - p0.heading) / tickSec;

  const startPose: RoverPose = { ...p0 };

  let prevElapsed = -ROBOT_TICK_MS;
  let prevX = p0.x - v0x * tickSec;
  let prevZ = p0.z - v0z * tickSec;
  let prevHeading = p0.heading - w0 * tickSec;
  let prevVx = v0x;
  let prevVz = v0z;
  // Seeded from the start state: a 'stuck' run BEGINS pinned against its
  // obstacle, and treating that as a fresh contact would stamp a
  // collision-onset jolt onto the first ~200 ms — precisely the feature
  // that separates the 'collision' and 'stuck' classes.
  let prevContact = resolveContact(
    path.sample(0).x,
    path.sample(0).z,
    discs
  ).contact;
  // Ringing contact-jolt accumulator (world-frame m/s²).
  let impulseX = 0;
  let impulseY = 0;
  let impulseZ = 0;

  const tick = (elapsedMs: number): RoverTick => {
    const dt = Math.max(1e-3, (elapsedMs - prevElapsed) / 1000);
    const u = clamp01(elapsedMs / durationMs);
    const commanded = path.sample(u);
    const resolved = resolveContact(commanded.x, commanded.z, discs);
    const pose: RoverPose = {
      x: resolved.x,
      z: resolved.z,
      heading: commanded.heading,
    };

    // Finite-difference velocity / acceleration in the world frame.
    const vx = (pose.x - prevX) / dt;
    const vz = (pose.z - prevZ) / dt;
    let ax = (vx - prevVx) / dt;
    let az = (vz - prevVz) / dt;
    let ay = 0;

    // Contact-onset jolt: on the tick the chassis first touches, kick a
    // decaying impulse opposite the incoming velocity plus a vertical
    // component (suspension compression). Subsequent ticks ring down.
    if (resolved.contact && !prevContact) {
      const impactSpeed = Math.hypot(prevVx, prevVz);
      if (impactSpeed > 1e-3) {
        const jolt = impactSpeed * IMPULSE_PER_SPEED;
        impulseX = (-prevVx / impactSpeed) * jolt;
        impulseZ = (-prevVz / impactSpeed) * jolt;
        impulseY = jolt * 0.5;
      }
    }
    ax += impulseX;
    ay += impulseY;
    az += impulseZ;
    impulseX *= IMPULSE_DECAY;
    impulseY *= IMPULSE_DECAY;
    impulseZ *= IMPULSE_DECAY;

    // Proper acceleration: subtracting gravity (pointing down) adds +g
    // on the world up axis — a stationary accelerometer reads +9.81 up,
    // matching the original MuJoCo accelerometer convention.
    const fx = ax;
    const fy = ay + GRAVITY;
    const fz = az;

    // Body frame: bx = right, by = up, bz = forward (heading 0 → +Z).
    const sin = Math.sin(pose.heading);
    const cos = Math.cos(pose.heading);
    const bodyAccel: [number, number, number] = [
      fx * cos - fz * sin, // right
      fy, // up
      fx * sin + fz * cos, // forward
    ];
    const yawRate = wrapAngle(pose.heading - prevHeading) / dt;
    const bodyGyro: [number, number, number] = [0, yawRate, 0];

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

    const lidar: LidarSample = {
      t,
      ranges: scanLidar({
        origin: { x: pose.x, y: ROVER_LIDAR_HEIGHT, z: pose.z },
        heading: pose.heading,
        bins: opts.lidarBins,
        maxRange: opts.lidarMaxRange,
        castRay,
      }),
    };

    prevElapsed = elapsedMs;
    prevX = pose.x;
    prevZ = pose.z;
    prevHeading = pose.heading;
    prevVx = vx;
    prevVz = vz;
    prevContact = resolved.contact;

    return { t, pose, inContact: resolved.contact, imu, lidar };
  };

  return { path, startPose, tick };
}
