/**
 * Motion-mode procedural IMU synthesis + batch orchestration.
 *
 * The original app scripted a MuJoCo-held body through drop / throw /
 * push / shake motions and recorded its simulated IMU. This rebuild has
 * no physics engine, so `generateMotionTrace` synthesizes the 6-axis
 * trace directly from a closed-form kinematic model per motion class,
 * keeping the original's parameter semantics (heights, speeds,
 * frequencies, the 0.85+rng·0.3 per-iteration jitter, the
 * `randomPreReleaseMs` baseline window, and the per-class release spin
 * magnitudes drop=3 / throw=5 / push=2 rad/s).
 *
 * Sensor convention: the clean accelerometer channel is the body's
 * kinematic acceleration expressed in the body frame — ~0 while held or
 * settled, −1 g (rotated through the tumbling orientation) during free
 * fall, and a large decaying spike at impact. The gyroscope channel is
 * the world angular velocity rotated into the body frame. Both then run
 * through `applyImuNoise` (bias walk, white noise, scale error, range
 * clipping, quantization) when the store's IMU-noise toggle is on, so
 * saturating impacts clip exactly like a real LSM6DSO would.
 *
 * `runProceduralBatch` implements the upload-or-zip flow from the
 * original MotionPanel: per-iteration label = motion class, filenames
 * `buildFileName('{motion}_{i+1}')`, contract metadata, and — when no
 * API key is set — a zip of pretty-printed data-acquisition JSONs plus
 * an `info.labels` sidecar, named `motions_{count}`. Cancellation is
 * polled between iterations; a cancelled run still packages and saves
 * the partial zip.
 */

import type { AccelSample } from '../lib/types';
import type { DropSettings, MotionClass } from '../store/useStore';
import {
  applyImuNoise,
  makeImuNoiseState,
  type ImuNoiseConfig,
} from '../lib/imuNoise';
import { randomPreReleaseMs } from '../lib/proceduralMotion';
import {
  buildDataAcquisitionPayload,
  buildFileName,
  buildInfoLabelsEntry,
  buildInfoLabelsFile,
  uploadSample,
  type EdgeImpulseConfig,
  type EdgeImpulseInfoLabelsEntry,
  type IngestionMetadataExtras,
} from '../lib/edgeImpulse';
import { buildZipOffThread } from '../lib/zipWorkerClient';
import type { ZipEntry } from '../lib/zip';
import { saveBlob } from '../lib/captureFormats';
import type { Rng } from '../lib/rng';

const G = 9.81;

/** Launch window for throw/push — matches the original's
 * `accelerateAndRelease` of 8 × 16 ms kinematic steps. */
const LAUNCH_S = 0.128;
/** Impulse spread of the ground impact (s). The spike amplitude is
 * `v_impact·(1+e)/IMPACT_TAU` so the integrated impulse cancels the
 * incoming momentum plus a restitution bounce. */
const IMPACT_TAU = 0.012;
const RESTITUTION = 0.35;
/** Post-impact ringing (bounce chatter) — amplitude in g, decay, freq. */
const RING_AMP_G = 1.2;
const RING_TAU = 0.06;
const RING_HZ = 24;
/** Tumble spin decays with this time constant once the body is down. */
const SPIN_TAU = 0.08;
/** Sliding friction coefficient for the post-impact horizontal decay. */
const FRICTION_MU = 0.45;
/** Lateral scatter of the impact spike, as a fraction of the vertical. */
const IMPACT_JITTER = 0.12;
/** Per-class release spin magnitude (rad/s) — from the original runner. */
const ANG_VEL_MAG: Record<MotionClass, number> = {
  drop: 3,
  throw: 5,
  push: 2,
  shake: 0,
};
/** First-order lag of the kinematic hold (FOLLOW_LERP 0.35 @ 60 fps ≈
 * 48 ms time constant) — attenuates the commanded shake sinusoid the
 * same way the original's lerped body did. */
const HOLD_LAG_TAU = 0.048;

type V3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
type Quat = [number, number, number, number];

function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatFromAxisAngle(axis: V3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** Rotate world vector `v` by quaternion `q` (body → world). */
function rotateByQuat(q: Quat, v: V3): V3 {
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
function rotateIntoBody(q: Quat, v: V3): V3 {
  return rotateByQuat([-q[0], -q[1], -q[2], q[3]], v);
}

/** Uniformly-random unit quaternion (Shoemake 1992), as [x, y, z, w]. */
function randomQuaternion(rng: Rng): Quat {
  const u1 = rng();
  const u2 = rng();
  const u3 = rng();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return [
    s1 * Math.sin(2 * Math.PI * u2),
    s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3),
    s2 * Math.cos(2 * Math.PI * u3),
  ];
}

/** Uniform per-axis angular velocity in [−mag, +mag] rad/s. */
function randomAngVel(mag: number, rng: Rng): V3 {
  return [
    (rng() * 2 - 1) * mag,
    (rng() * 2 - 1) * mag,
    (rng() * 2 - 1) * mag,
  ];
}

/** Everything `generateMotionTrace` needs; mirrors the store's
 * `DropSettings` fields plus the recording rate and noise config. */
export interface MotionTraceSettings {
  durationMs: number;
  sampleRateHz: number;
  heightMin: number;
  heightMax: number;
  throwSpeed: number;
  pushSpeed: number;
  shakeFreq: number;
  shakeAmp: number;
  /** The store's `imuNoise` slice is structurally identical. */
  imuNoise: ImuNoiseConfig;
  /** Timestamp (ms) of the first sample; defaults to performance.now()
   * so uploads carry real wall-clock spacing. */
  startTimeMs?: number;
}

/** Clean (pre-noise) world-frame state at one instant of a trace. */
interface InstantState {
  /** Kinematic acceleration of the body, world frame, m/s². */
  accelWorld: V3;
  /** Angular velocity, world frame, rad/s. */
  omegaWorld: V3;
  /** Body orientation. */
  q: Quat;
}

/** Shared timeline for drop / throw / push: hold → (launch) → release
 * with tumble → free fall → impact spike → friction slide + settle. */
interface ReleasePlan {
  kind: 'release';
  preS: number;
  launchS: number;
  launchAccel: V3;
  /** Free-fall time from release to floor contact. */
  fallS: number;
  /** Downward speed at floor contact (m/s). */
  impactSpeed: number;
  /** Horizontal speed carried into the slide (m/s). */
  horizSpeed: number;
  /** Unit horizontal direction of travel (x, z). */
  horizDir: [number, number];
  q0: Quat;
  spinAxis: V3;
  spinMag: number;
  /** Fixed per-trace lateral scatter of the impact spike, in [−1, 1]. */
  impactJitter: [number, number];
}

/** Shake: the body stays held; the hand oscillates it sinusoidally. */
interface ShakePlan {
  kind: 'shake';
  q0: Quat;
  /** Unit horizontal shake axis (x, z). */
  axis: [number, number];
  freqHz: number;
  /** Effective acceleration amplitude after the hold's low-pass, m/s². */
  accelAmp: number;
  /** Phase lag of the held body behind the commanded sinusoid. */
  phase: number;
}

type MotionPlan = ReleasePlan | ShakePlan;

function planRelease(
  cls: 'drop' | 'throw' | 'push',
  s: MotionTraceSettings,
  rng: Rng
): ReleasePlan {
  const preS = randomPreReleaseMs(s.durationMs, rng) / 1000;
  const q0 = randomQuaternion(rng);
  const spin = randomAngVel(ANG_VEL_MAG[cls], rng);
  const spinMag = Math.hypot(spin[0], spin[1], spin[2]);
  const spinAxis: V3 =
    spinMag > 1e-9
      ? [spin[0] / spinMag, spin[1] / spinMag, spin[2] / spinMag]
      : [0, 1, 0];
  const impactJitter: [number, number] = [rng() * 2 - 1, rng() * 2 - 1];

  if (cls === 'drop') {
    const h = Math.max(
      0.05,
      s.heightMin + rng() * Math.max(0, s.heightMax - s.heightMin)
    );
    const fallS = Math.sqrt((2 * h) / G);
    return {
      kind: 'release',
      preS,
      launchS: 0,
      launchAccel: [0, 0, 0],
      fallS,
      impactSpeed: G * fallS,
      horizSpeed: 0,
      horizDir: [1, 0],
      q0,
      spinAxis,
      spinMag,
      impactJitter,
    };
  }

  // Throw and push share the accelerate-then-release shape; they differ
  // in speed source, vertical kick, and release height.
  const angle = rng() * 2 * Math.PI;
  const baseSpeed = cls === 'throw' ? s.throwSpeed : s.pushSpeed;
  const speed = baseSpeed * (0.85 + rng() * 0.3);
  const upKick = cls === 'throw' ? 0.4 + rng() * 0.8 : 0;
  const h =
    cls === 'throw'
      ? Math.max(0.05, s.heightMin + rng() * Math.max(0, s.heightMax - s.heightMin))
      : 0.25 + rng() * 0.15; // original push holds at y ∈ [0.25, 0.4]
  const vx = Math.cos(angle) * speed;
  const vz = Math.sin(angle) * speed;
  const fallS = (upKick + Math.sqrt(upKick * upKick + 2 * G * h)) / G;
  return {
    kind: 'release',
    preS,
    launchS: LAUNCH_S,
    launchAccel: [vx / LAUNCH_S, upKick / LAUNCH_S, vz / LAUNCH_S],
    fallS,
    impactSpeed: Math.sqrt(upKick * upKick + 2 * G * h),
    horizSpeed: speed,
    horizDir: [Math.cos(angle), Math.sin(angle)],
    q0,
    spinAxis,
    spinMag,
    impactJitter,
  };
}

function planShake(s: MotionTraceSettings, rng: Rng): ShakePlan {
  const q0 = randomQuaternion(rng);
  const axisAngle = rng() * 2 * Math.PI;
  const freqHz = s.shakeFreq * (0.85 + rng() * 0.3);
  const amp = s.shakeAmp * (0.85 + rng() * 0.3);
  // The held body follows the commanded sinusoid through a first-order
  // lag, which attenuates and phase-shifts the resulting acceleration.
  const w = 2 * Math.PI * freqHz;
  const gain = 1 / Math.sqrt(1 + w * w * HOLD_LAG_TAU * HOLD_LAG_TAU);
  return {
    kind: 'shake',
    q0,
    axis: [Math.cos(axisAngle), Math.sin(axisAngle)],
    freqHz,
    accelAmp: w * w * amp * gain,
    phase: Math.atan(w * HOLD_LAG_TAU),
  };
}

function evalRelease(plan: ReleasePlan, t: number): InstantState {
  const tRel = plan.preS + plan.launchS;
  const tImp = tRel + plan.fallS;

  if (t < plan.preS) {
    // Kinematic hold: no motion, no spin.
    return { accelWorld: [0, 0, 0], omegaWorld: [0, 0, 0], q: plan.q0 };
  }
  if (t < tRel) {
    // Launch window: the hand accelerates the still-held body.
    return { accelWorld: plan.launchAccel, omegaWorld: [0, 0, 0], q: plan.q0 };
  }
  if (t < tImp) {
    // Ballistic flight with constant tumble.
    const theta = plan.spinMag * (t - tRel);
    const q = quatMul(quatFromAxisAngle(plan.spinAxis, theta), plan.q0);
    const omega: V3 = [
      plan.spinAxis[0] * plan.spinMag,
      plan.spinAxis[1] * plan.spinMag,
      plan.spinAxis[2] * plan.spinMag,
    ];
    return { accelWorld: [0, -G, 0], omegaWorld: omega, q };
  }

  // Impact + settle: exponential spike scaled to cancel the incoming
  // momentum (plus restitution), bounce ringing, a friction slide for
  // any carried horizontal speed, and exponentially-decaying spin.
  const sImp = t - tImp;
  const spike =
    (plan.impactSpeed * (1 + RESTITUTION)) / IMPACT_TAU;
  const spikeEnv = Math.exp(-sImp / IMPACT_TAU);
  const ring =
    RING_AMP_G *
    G *
    Math.exp(-sImp / RING_TAU) *
    Math.sin(2 * Math.PI * RING_HZ * sImp);
  const slideS = plan.horizSpeed / (FRICTION_MU * G);
  const sliding = plan.horizSpeed > 1e-6 && sImp < slideS;
  const frictionX = sliding ? -FRICTION_MU * G * plan.horizDir[0] : 0;
  const frictionZ = sliding ? -FRICTION_MU * G * plan.horizDir[1] : 0;

  const accelWorld: V3 = [
    plan.impactJitter[0] * IMPACT_JITTER * spike * spikeEnv + frictionX,
    spike * spikeEnv + ring,
    plan.impactJitter[1] * IMPACT_JITTER * spike * spikeEnv + frictionZ,
  ];

  const spinScale = Math.exp(-sImp / SPIN_TAU);
  const omegaWorld: V3 = [
    plan.spinAxis[0] * plan.spinMag * spinScale,
    plan.spinAxis[1] * plan.spinMag * spinScale,
    plan.spinAxis[2] * plan.spinMag * spinScale,
  ];
  // Integrated tumble angle: flight rotation plus the analytically
  // integrated decaying spin after touchdown.
  const theta =
    plan.spinMag * plan.fallS +
    plan.spinMag * SPIN_TAU * (1 - Math.exp(-sImp / SPIN_TAU));
  const q = quatMul(quatFromAxisAngle(plan.spinAxis, theta), plan.q0);
  return { accelWorld, omegaWorld, q };
}

function evalShake(plan: ShakePlan, t: number): InstantState {
  // x(t) = amp·sin(wt − φ)·gain → a(t) = −w²·amp·gain·sin(wt − φ).
  const w = 2 * Math.PI * plan.freqHz;
  const a = -plan.accelAmp * Math.sin(w * t - plan.phase);
  return {
    accelWorld: [plan.axis[0] * a, 0, plan.axis[1] * a],
    omegaWorld: [0, 0, 0],
    q: plan.q0,
  };
}

/**
 * Synthesize one labelled 6-axis IMU trace for a motion class.
 *
 * Emits `round(durationMs/1000 · sampleRateHz)` samples (min 2) spaced
 * exactly `1000/sampleRateHz` ms apart, timestamped from
 * `performance.now()` at call time (override with `startTimeMs` for
 * deterministic tests). The clean kinematic readings are passed through
 * `applyImuNoise` with the trace's own noise state — a no-op when
 * `imuNoise.enabled` is false.
 */
export function generateMotionTrace(
  cls: MotionClass,
  settings: MotionTraceSettings,
  rng: Rng = Math.random
): AccelSample[] {
  const plan: MotionPlan =
    cls === 'shake' ? planShake(settings, rng) : planRelease(cls, settings, rng);

  const dtMs = 1000 / settings.sampleRateHz;
  const dtS = dtMs / 1000;
  const n = Math.max(
    2,
    Math.round((settings.durationMs / 1000) * settings.sampleRateHz)
  );
  const t0 =
    settings.startTimeMs ??
    (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Fresh noise state per trace so each recording gets its own bias
  // drift trajectory (mirrors the original's remount-reset semantics).
  const noise = makeImuNoiseState(settings.imuNoise, rng);

  const samples: AccelSample[] = [];
  for (let k = 0; k < n; k++) {
    const t = k * dtS;
    const state =
      plan.kind === 'shake' ? evalShake(plan, t) : evalRelease(plan, t);
    const accBody = rotateIntoBody(state.q, state.accelWorld);
    const gyrBody = rotateIntoBody(state.q, state.omegaWorld);
    const { accel, gyro } = applyImuNoise(
      accBody,
      gyrBody,
      noise,
      settings.imuNoise,
      dtS,
      rng
    );
    samples.push({
      t: t0 + k * dtMs,
      ax: accel[0],
      ay: accel[1],
      az: accel[2],
      gx: gyro[0],
      gy: gyro[1],
      gz: gyro[2],
    });
  }
  return samples;
}

/**
 * Near-still sample source for the manual Recording card: a faint hand
 * tremor (so the trace isn't a dead-flat line) fed through the same
 * IMU-noise pipeline as every other recording. Call the returned
 * function once per tick with the elapsed seconds since the last tick.
 */
export function createIdleSampler(
  cfg: ImuNoiseConfig,
  rng: Rng = Math.random
): (dtSec: number) => { accel: readonly number[]; gyro: readonly number[] } {
  const state = makeImuNoiseState(cfg, rng);
  const phases: V3 = [rng() * 2 * Math.PI, rng() * 2 * Math.PI, rng() * 2 * Math.PI];
  const TREMOR_ACC = 0.02; // m/s²
  const TREMOR_GYR = 0.002; // rad/s
  const FREQS: V3 = [8.4, 9.7, 11.3]; // Hz — physiological tremor band
  let t = 0;
  return (dtSec: number) => {
    t += dtSec;
    const accel: V3 = [0, 0, 0];
    const gyro: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const s = Math.sin(2 * Math.PI * FREQS[i] * t + phases[i]);
      accel[i] = TREMOR_ACC * s;
      gyro[i] = TREMOR_GYR * s;
    }
    return applyImuNoise(accel, gyro, state, cfg, dtSec, rng);
  };
}

/** Per-sample metadata for procedural motion uploads/zips (contract:
 * always mode/shape/rate/generator/motion/index/total + the params of
 * the selected class + duration_ms). */
export function buildMotionMetadata(
  drops: DropSettings,
  sampleRateHz: number,
  shape: string,
  index1: number
): IngestionMetadataExtras {
  const motion = drops.motion;
  const meta: IngestionMetadataExtras = {
    mode: 'motion',
    shape,
    sample_rate_hz: sampleRateHz,
    generator: 'procedural',
    motion,
    motion_index: index1,
    motion_total: drops.count,
  };
  if (motion === 'drop' || motion === 'throw' || motion === 'shake') {
    meta.height_min_m = drops.heightMin;
    meta.height_max_m = drops.heightMax;
  }
  if (motion === 'throw') meta.throw_speed_mps = drops.throwSpeed;
  if (motion === 'push') meta.push_speed_mps = drops.pushSpeed;
  if (motion === 'shake') {
    meta.shake_freq_hz = drops.shakeFreq;
    meta.shake_amp_m = drops.shakeAmp;
  }
  meta.duration_ms = drops.durationMs;
  return meta;
}

export interface ProceduralBatchProgress {
  done: number;
  total: number;
  uploaded: number;
  captured: number;
  failed: number;
}

export interface ProceduralBatchOptions {
  ei: EdgeImpulseConfig;
  drops: DropSettings;
  sampleRateHz: number;
  imuNoise: ImuNoiseConfig;
  /** Selected object kind — recorded as `shape` metadata. */
  shape: string;
  rng?: Rng;
  /** Polled between iterations; return true to stop the run. A stopped
   * run still zips + saves whatever was captured. */
  isCancelled?: () => boolean;
  onProgress?: (p: ProceduralBatchProgress) => void;
}

export interface ProceduralBatchResult {
  uploaded: number;
  captured: number;
  failed: number;
  total: number;
  cancelled: boolean;
  /** True when the run went through the upload path (API key present). */
  uploadedMode: boolean;
  /** Number of files written into the downloaded zip (incl. info.labels);
   * 0 when nothing was zipped. */
  zipFileCount: number;
}

/**
 * Generate `drops.count` procedural motion traces and either upload
 * each to Edge Impulse (API key set) or package them all into a local
 * zip with an `info.labels` sidecar. Empty-trace iterations count as
 * failed without aborting the batch.
 */
export async function runProceduralBatch(
  opts: ProceduralBatchOptions
): Promise<ProceduralBatchResult> {
  const rng = opts.rng ?? Math.random;
  const { drops } = opts;
  const ei: EdgeImpulseConfig = { ...opts.ei, apiKey: opts.ei.apiKey.trim() };
  const shouldUpload = ei.apiKey.length > 0;
  const motion = drops.motion;

  let uploaded = 0;
  let captured = 0;
  let failed = 0;
  let cancelled = false;
  const zipEntries: ZipEntry[] = [];
  const infoEntries: EdgeImpulseInfoLabelsEntry[] = [];

  for (let i = 0; i < drops.count; i++) {
    if (opts.isCancelled?.()) {
      cancelled = true;
      break;
    }
    // Yield to the event loop so progress renders and Stop stays live.
    await new Promise<void>((r) => setTimeout(r, 0));

    const samples = generateMotionTrace(
      motion,
      {
        durationMs: drops.durationMs,
        sampleRateHz: opts.sampleRateHz,
        heightMin: drops.heightMin,
        heightMax: drops.heightMax,
        throwSpeed: drops.throwSpeed,
        pushSpeed: drops.pushSpeed,
        shakeFreq: drops.shakeFreq,
        shakeAmp: drops.shakeAmp,
        imuNoise: opts.imuNoise,
      },
      rng
    );
    if (samples.length === 0) {
      failed += 1;
      continue;
    }

    const meta = buildMotionMetadata(drops, opts.sampleRateHz, opts.shape, i + 1);
    const fileName = buildFileName(`${motion}_${i + 1}`);

    if (shouldUpload) {
      try {
        const res = await uploadSample(
          { ...ei, label: motion },
          samples,
          opts.sampleRateHz,
          fileName,
          meta
        );
        if (res.ok) uploaded += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    } else {
      const body = await buildDataAcquisitionPayload(
        ei,
        samples,
        opts.sampleRateHz
      );
      zipEntries.push({ name: fileName, data: JSON.stringify(body, null, 2) });
      infoEntries.push(
        buildInfoLabelsEntry({
          path: fileName,
          category: ei.category,
          label: motion,
          metadataExtras: meta,
        })
      );
      captured += 1;
    }
    opts.onProgress?.({
      done: i + 1,
      total: drops.count,
      uploaded,
      captured,
      failed,
    });
  }

  // Zip path finalization — also runs after a cancel so partial data
  // still lands on disk.
  let zipFileCount = 0;
  if (!shouldUpload && zipEntries.length > 0) {
    const entries: ZipEntry[] = [
      ...zipEntries,
      { name: 'info.labels', data: buildInfoLabelsFile(infoEntries) },
    ];
    const zip = await buildZipOffThread(entries);
    const zipName = buildFileName(`motions_${captured}`).replace(
      /\.json$/,
      '.zip'
    );
    saveBlob(zip, zipName);
    zipFileCount = entries.length;
  }

  return {
    uploaded,
    captured,
    failed,
    total: drops.count,
    cancelled,
    uploadedMode: shouldUpload,
    zipFileCount,
  };
}
