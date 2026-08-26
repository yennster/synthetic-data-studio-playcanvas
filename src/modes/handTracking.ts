/**
 * Webcam + MediaPipe HandLandmarker plumbing for motion mode — the
 * browser-only half of hand tracking (the math lives in
 * lib/handKinematics + lib/handMath, both Node-testable).
 *
 * This module is ONLY ever loaded via dynamic `import()` from
 * MotionPanel when the webcam toggle turns on, and it dynamic-imports
 * `@mediapipe/tasks-vision` itself — neither reaches the initial
 * bundle. The WASM fileset is version-pinned to the installed npm
 * package (jsdelivr) and the .task model comes from Google's model
 * storage, the same CDN pair the original app used.
 *
 * Privacy contract (§7.11): webcam frames NEVER leave the browser.
 * The stream feeds a local <video> element and `detectForVideo` only;
 * nothing is drawn into a transferable canvas, uploaded, or stored —
 * the overlay canvas receives skeleton strokes, not video pixels.
 */

import type { HandLandmarker } from '@mediapipe/tasks-vision';
import {
  computePinchStrength,
  pinchCentroid,
  type Landmark,
  type Quat,
} from '../lib/handMath';
import {
  PINCH_LERP,
  PINCH_ON,
  cameraYawAngle,
  composeYawRotation,
  createDrivenImuSampler,
  createFreeBody,
  createHandStateTracker,
  handMappingScale,
  pinchTargetToWorld,
  quatDeltaOmega,
  type FreeBody,
  type HandState,
} from '../lib/handKinematics';
import type { ImuNoiseConfig } from '../lib/imuNoise';
import type { Rng } from '../lib/rng';
import type { ObjectKind } from '../store/useStore';
import type { StudioEngine } from '../engine/StudioEngine';
import { MotionBody } from '../engine/MotionBody';

/** Keep in sync with package.json's @mediapipe/tasks-vision version —
 * the wasm runtime must match the JS API we import from node_modules. */
const TASKS_VISION_VERSION = '1.0.1';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** 21-landmark skeleton edges for the overlay. */
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export interface HandTrackingOptions {
  /** Local preview element the camera stream plays into. */
  video: HTMLVideoElement;
  /** Overlay canvas for the skeleton/pinch drawing (CSS-mirrored
   * together with the video). */
  canvas: HTMLCanvasElement;
  /** Called once per video frame with the detected landmarks (null
   * when no hand is visible) and the frame timestamp (ms). */
  onFrame(landmarks: readonly Landmark[] | null, timeMs: number): void;
}

export interface HandTrackingHandle {
  /** Stop everything: rAF loop, landmarker, camera tracks. Idempotent. */
  stop(): void;
}

/**
 * Open the user-facing camera and run HandLandmarker in VIDEO mode,
 * one `detectForVideo` per animation frame. Rejects with a
 * `Camera: …` or `Hand model: …` prefixed Error (tracks already
 * stopped) so the caller can surface a clear status and revert its
 * toggle.
 */
export async function startHandTracking(
  opts: HandTrackingOptions
): Promise<HandTrackingHandle> {
  const { video, canvas, onFrame } = opts;
  let stream: MediaStream | null = null;
  let landmarker: HandLandmarker | null = null;
  let raf: number | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (raf !== null) cancelAnimationFrame(raf);
    landmarker?.close();
    landmarker = null;
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    video.srcObject = null;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    stop();
    throw new Error(`Camera: ${(e as Error).message}`);
  }

  try {
    const { FilesetResolver, HandLandmarker } = await import(
      '@mediapipe/tasks-vision'
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (e) {
    stop();
    throw new Error(`Hand model: ${(e as Error).message}`);
  }

  if (stopped) {
    // stop() raced the async setup; make sure the landmarker dies too.
    landmarker.close();
    return { stop };
  }

  // detectForVideo requires strictly increasing timestamps.
  let lastTs = 0;

  const tick = () => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (!landmarker || video.readyState < 2 || video.videoWidth === 0) return;
    const now = performance.now();
    if (now <= lastTs) return;
    lastTs = now;

    const result = landmarker.detectForVideo(video, now);
    const hand = result.landmarks.length > 0 ? result.landmarks[0] : null;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (hand) drawOverlay(ctx, canvas, hand);
    }
    onFrame(hand, now);
  };
  raf = requestAnimationFrame(tick);

  return { stop };
}

// ---------- Full hand-driven session (tracking + body + IMU) ----------

export interface HandSessionOptions {
  engine: StudioEngine;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  /** Initial manipulated-body shape. */
  kind: ObjectKind;
  rng?: Rng;
  /** Coarse status callback for the panel's status line — fired only on
   * transitions (hand found/lost), not per frame. */
  onHandState?(state: { detected: boolean; grabbed: boolean }): void;
}

export interface HandSession {
  /** Hot-swap the manipulated body's shape (resets it to rest). */
  setKind(kind: ObjectKind): void;
  /**
   * `createIdleSampler`-compatible recording source that reads the
   * hand-driven body's differentiated pose through the IMU-noise
   * pipeline. Call once per recording tick with the elapsed seconds.
   */
  makeSampler(
    cfg: ImuNoiseConfig
  ): (dtSec: number) => { accel: readonly number[]; gyro: readonly number[] };
  /** Tear everything down: camera, landmarker, body, update hook. */
  stop(): void;
}

/**
 * Start webcam hand tracking AND wire it to a manipulated body in the
 * scene (the §6.1 ManipulatedObject loop, on the analytic free-body
 * instead of MuJoCo): pinch grabs the body onto the yaw-mapped hand
 * target with PINCH_LERP follow smoothing; release hands the tracked
 * per-frame velocity + spin to a ballistic `createFreeBody`; every
 * render tick feeds the driven pose to the IMU sampler so manual
 * recordings capture the hand's actual motion.
 */
export async function startHandSession(
  opts: HandSessionOptions
): Promise<HandSession> {
  const { engine } = opts;
  const rng: Rng = opts.rng ?? Math.random;
  const tracker = createHandStateTracker();

  let latest: HandState | null = null;
  let lastDetected: boolean | null = null;
  let lastGrabbed = false;

  const handle = await startHandTracking({
    video: opts.video,
    canvas: opts.canvas,
    onFrame(landmarks, timeMs) {
      // Zooming the orbit camera out widens the hand-controlled volume.
      const camPos = engine.viewCamera.getPosition();
      const mapScale = handMappingScale(
        Math.hypot(camPos.x, camPos.y, camPos.z)
      );
      latest = tracker.update(landmarks, timeMs, mapScale);
      if (
        latest.detected !== lastDetected ||
        latest.grabbed !== lastGrabbed
      ) {
        lastDetected = latest.detected;
        lastGrabbed = latest.grabbed;
        opts.onHandState?.({ detected: latest.detected, grabbed: latest.grabbed });
      }
    },
  });

  // The body only exists while the session is live.
  const body = new MotionBody(engine.app, engine.content, opts.kind);
  let sampler = createDrivenImuSampler(rng);
  let free: FreeBody | null = null;
  let wasGrabbed = false;
  // Driven pose state (the differentiation + release-velocity source).
  let pos: [number, number, number] = [0, body.restY(), 0];
  let quat: Quat = [0, 0, 0, 1];
  let vel: [number, number, number] = [0, 0, 0];
  let omega: [number, number, number] = [0, 0, 0];
  let stopped = false;

  const onUpdate = (dtRaw: number) => {
    if (stopped) return;
    const dt = Math.max(dtRaw, 1e-3);
    const s = latest;

    if (s?.grabbed && s.target) {
      const cam = engine.viewCamera.getPosition();
      const camPos = [cam.x, cam.y, cam.z] as const;
      const world = pinchTargetToWorld(s.target, camPos);
      const q: Quat = s.rotation
        ? composeYawRotation(cameraYawAngle(camPos), s.rotation)
        : quat;
      if (!wasGrabbed) {
        // First grab frame: snap to the hand target with zero velocity
        // (matches the original's prevHandPos seeding) and forget the
        // sampler's differentiation history so the teleport doesn't
        // read as a metres-per-frame acceleration spike.
        pos = world;
        vel = [0, 0, 0];
        omega = [0, 0, 0];
        sampler.reset();
        free = null;
        wasGrabbed = true;
        body.setGrabbed(true);
      } else {
        const next: [number, number, number] = [
          pos[0] + (world[0] - pos[0]) * PINCH_LERP,
          pos[1] + (world[1] - pos[1]) * PINCH_LERP,
          pos[2] + (world[2] - pos[2]) * PINCH_LERP,
        ];
        vel = [
          (next[0] - pos[0]) / dt,
          (next[1] - pos[1]) / dt,
          (next[2] - pos[2]) / dt,
        ];
        omega = quatDeltaOmega(quat, q, dt);
        pos = next;
      }
      quat = q;
      body.setPose(pos, quat);
    } else {
      if (wasGrabbed) {
        // Pinch released (or tracking lost past the grace window):
        // go ballistic with the velocity + spin tracked while held.
        free = createFreeBody({
          pos,
          quat,
          linvel: vel,
          angvel: omega,
          restY: body.restY(),
        });
        wasGrabbed = false;
        body.setGrabbed(false);
      }
      if (free) {
        const p = free.step(dt);
        pos = p.pos;
        quat = p.quat;
        body.setPose(pos, quat);
        if (p.settled) free = null;
      }
    }

    // Always tick the sampler — like the original's always-drained
    // accumulator, a recording started mid-session begins phase-clean.
    sampler.tick(pos, quat, dt);
  };
  engine.app.on('update', onUpdate);

  return {
    setKind(kind) {
      body.setKind(kind);
      pos = [0, body.restY(), 0];
      quat = [0, 0, 0, 1];
      vel = [0, 0, 0];
      omega = [0, 0, 0];
      free = null;
      // Fresh differentiation history AND a fresh noise-bias trajectory
      // per shape — mirrors the original's noise reset on loadShape.
      sampler = createDrivenImuSampler(rng);
    },
    makeSampler(cfg) {
      return (dtSec) => sampler.sample(dtSec, cfg);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      engine.app.off('update', onUpdate);
      handle.stop();
      body.destroy();
      latest = null;
    },
  };
}

/** Skeleton + landmark dots + pinch circle, in raw video pixel coords
 * (the canvas is CSS-mirrored alongside the video). Colors and radii
 * match the original CameraFeed presentation. */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  hand: readonly Landmark[]
): void {
  const pinch = computePinchStrength(hand);
  const c = pinchCentroid(hand);

  ctx.lineWidth = 2;
  ctx.strokeStyle = pinch > PINCH_ON ? '#5eead4' : '#38bdf8';
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(hand[a].x * canvas.width, hand[a].y * canvas.height);
    ctx.lineTo(hand[b].x * canvas.width, hand[b].y * canvas.height);
  }
  ctx.stroke();

  ctx.fillStyle = pinch > PINCH_ON ? '#5eead4' : '#f0f6fc';
  for (const p of hand) {
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pinch indicator at the thumb/index centroid.
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(
    c.x * canvas.width,
    c.y * canvas.height,
    10 + pinch * 14,
    0,
    Math.PI * 2
  );
  ctx.stroke();
}
