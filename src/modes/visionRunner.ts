/**
 * Vision capture orchestration for detection/anomaly modes: single frame
 * and batch runs with domain randomization, deterministic trajectories,
 * the realism pixel pass, ZIP packaging, and store bookkeeping.
 *
 * Jitter magnitudes and the trajectory/randomize interplay follow the
 * original app's contract exactly (see docs/ORIGINAL-FEATURES.md).
 */

import { Vec3 } from 'playcanvas';
import type { StudioEngine } from '../engine/StudioEngine';
import { useStore } from '../store/useStore';
import { sampleCameraTrajectory } from '../lib/cameraTrajectory';
import { applyRealismToBlob, resetDiffusionBudget } from '../lib/realism';
import { buildBoundingBoxLabelsFile, makeFilename, saveBlob } from '../lib/captureFormats';
import { buildZipOffThread } from '../lib/zipWorkerClient';
import type { ZipEntry } from '../lib/zip';
import { getRng } from '../lib/rng';
import {
  jitterDropPosition,
  sampleBeltDropPosition,
  sampleDropRotation,
} from '../lib/physicsSpec';
import type { Capture } from '../lib/types';

/** Snapshot of settings a batch run must restore afterwards. */
interface BaseSnapshot {
  camPos: [number, number, number];
  camTarget: [number, number, number];
  fov: number;
  lightIntensity: number;
}

function poseForIteration(
  base: BaseSnapshot,
  index: number,
  total: number
): { pos: [number, number, number]; target: [number, number, number]; fov: number } {
  const s = useStore.getState();
  const { cameraTrajectory, trajectoryRadius, trajectoryHeight, randomizeCamera } =
    s.capture;
  const rng = getRng();

  if (cameraTrajectory !== 'random') {
    // Deterministic path — skips jitter even when randomizeCamera is on.
    const pos = sampleCameraTrajectory({
      trajectory: cameraTrajectory,
      index,
      total,
      target: base.camTarget,
      radius: trajectoryRadius,
      height: trajectoryHeight,
    });
    return { pos, target: base.camTarget, fov: base.fov };
  }

  if (!randomizeCamera) {
    return { pos: base.camPos, target: base.camTarget, fov: base.fov };
  }

  const pos: [number, number, number] = [
    base.camPos[0] + (rng() - 0.5) * 1.2,
    Math.max(0.5, base.camPos[1] + (rng() - 0.5) * 0.6),
    base.camPos[2] + (rng() - 0.5) * 1.2,
  ];
  const target: [number, number, number] = [
    base.camTarget[0] + (rng() - 0.5) * 0.4,
    base.camTarget[1] + (rng() - 0.5) * 0.2,
    base.camTarget[2] + (rng() - 0.5) * 0.4,
  ];
  const fov = base.fov + (rng() - 0.5) * 10;
  return { pos, target, fov };
}

function applyLighting(engine: StudioEngine, base: BaseSnapshot): number {
  const s = useStore.getState();
  const rng = getRng();
  if (!s.capture.randomizeLighting) return base.lightIntensity;
  const intensity = Math.max(0.2, base.lightIntensity + (rng() - 0.5) * 0.8);
  engine.environment.setLightIntensity(intensity);
  return intensity;
}

/**
 * Per-shot object randomization (original §4.3). Two paths:
 *
 * - Physics objects (physics=true, Rapier world ready): teleport into the
 *   drop volume — above the belt when the conveyor is on, else a jitter
 *   around the BASE (batch-start) placement — give them a full-sphere
 *   drop orientation, then step the physics world synchronously until
 *   every body settles (speed < 0.15 m/s; belt mode also requires
 *   on-belt-or-fallen) or 2500 ms of *simulated* time passes. Sim-time
 *   stepping keeps batches deterministic under `?seed=` and working in
 *   hidden tabs where rAF/timers are throttled.
 * - Physics-off objects (or Rapier unavailable): kinematic re-scatter —
 *   the same base jitter, yaw only, no settling.
 *
 * Jittering around the base rather than current positions avoids
 * compounding into a random walk out of frame over the batch.
 */
function randomizeObjectPositions(
  engine: StudioEngine,
  baseObjects: { id: string; position: [number, number, number]; rotation: number }[]
): void {
  const s = useStore.getState();
  if (!s.capture.randomizeObjects) return;
  const rng = getRng();
  const belt = s.showConveyor;
  let dropped = false;
  for (const base of baseObjects) {
    const obj = s.sceneObjects.find((o) => o.id === base.id);
    if (!obj || obj.owner) continue;
    if (obj.physics && engine.physics.isReady()) {
      const position = belt
        ? sampleBeltDropPosition(rng)
        : jitterDropPosition(rng, base.position);
      const euler = sampleDropRotation(rng);
      // The store keeps yaw only; the body gets the full drop orientation.
      s.updateObject(base.id, { position, rotation: euler[1] });
      engine.physics.applyDropRotation(base.id, euler);
      dropped = true;
    } else {
      s.updateObject(base.id, {
        position: jitterDropPosition(rng, base.position),
        rotation: rng() * Math.PI * 2,
      });
    }
  }
  if (dropped) engine.physics.settleSync({ belt });
}

/** Object kinds present in the scene at capture time (deduped). */
function currentShapes(): string[] | undefined {
  const s = useStore.getState();
  const kinds = [...new Set(s.sceneObjects.filter((o) => !o.owner).map((o) => o.kind))];
  return kinds.length > 0 ? kinds : undefined;
}

function currentAssetSnapshot(): { name: string; label: string }[] | undefined {
  const s = useStore.getState();
  const entries = [
    ...s.models.map((m) => ({ name: m.name, label: m.label })),
    ...s.splats
      .filter((sp) => sp.role === 'object')
      .map((sp) => ({ name: sp.name, label: sp.label })),
  ];
  return entries.length > 0 ? entries : undefined;
}

async function captureOne(
  engine: StudioEngine,
  filenamePrefix: string,
  pose: {
    pos: [number, number, number];
    target: [number, number, number];
    fov: number;
  }
): Promise<Capture> {
  const s = useStore.getState();
  const { width, height } = s.capture;
  const anomaly = s.mode === 'anomaly';

  // Pose rides along with the capture request — the rig is shared with
  // the live-inference loop, which must not repose it mid-queue.
  const result = await engine.capture.captureFrame(
    width,
    height,
    engine.getLabelTargets('vision'),
    {
      position: new Vec3(pose.pos[0], pose.pos[1], pose.pos[2]),
      target: new Vec3(pose.target[0], pose.target[1], pose.target[2]),
      fov: pose.fov,
    }
  );
  const realismBlob = await applyRealismToBlob(result.blob, {
    mode: s.realism.mode,
    intensities: {
      grain: s.realism.grain,
      chromatic: s.realism.chromatic,
      vignette: s.realism.vignette,
      jitter: s.realism.jitter,
      jpeg: s.realism.jpeg,
    },
    randomize: s.realism.randomize,
    rng: getRng(),
  });

  return {
    id: crypto.randomUUID(),
    filename: makeFilename(filenamePrefix, useStore.getState().captures.length),
    blob: realismBlob,
    boxes: anomaly ? [] : result.boxes,
    label: anomaly ? s.anomalyLabel : '',
    width,
    height,
    ts: Date.now(),
    shapes: currentShapes(),
    assetSnapshot: currentAssetSnapshot(),
  };
}

/**
 * Single capture: renders one frame, stores it, and downloads it —
 * detection: a zip of PNG + bounding_boxes.labels; anomaly: the bare PNG.
 */
export async function captureSingle(engine: StudioEngine): Promise<Capture> {
  const s = useStore.getState();
  resetDiffusionBudget();
  engine.setCaptureCameraPose(s.capture.camPos, s.capture.camTarget, s.capture.fov);

  const anomaly = s.mode === 'anomaly';
  const prefix = anomaly ? s.anomalyLabel || 'sample' : 'frame';
  const capture = await captureOne(engine, prefix, {
    pos: s.capture.camPos,
    target: s.capture.camTarget,
    fov: s.capture.fov,
  });
  s.addCapture(capture);

  if (anomaly) {
    saveBlob(capture.blob, capture.filename);
  } else {
    const entries: ZipEntry[] = [
      { name: capture.filename, data: capture.blob },
      { name: 'bounding_boxes.labels', data: buildBoundingBoxLabelsFile([capture]) },
    ];
    const zip = await buildZipOffThread(entries);
    saveBlob(zip, capture.filename.replace(/\.png$/, '.zip'));
  }
  return capture;
}

export interface BatchProgress {
  done: number;
  total: number;
}

/**
 * Batch run: batchCount captures with trajectory/jitter application,
 * base-pose restore, and one zip containing all PNGs (+ a shared
 * bounding_boxes.labels in detection mode).
 */
export async function runBatch(
  engine: StudioEngine,
  onProgress?: (p: BatchProgress) => void,
  isCancelled?: () => boolean
): Promise<Capture[]> {
  const s = useStore.getState();
  const total = s.capture.batchCount;
  const anomaly = s.mode === 'anomaly';
  const prefix = anomaly ? s.anomalyLabel || 'sample' : 'frame';
  resetDiffusionBudget();

  const base: BaseSnapshot = {
    camPos: [...s.capture.camPos],
    camTarget: [...s.capture.camTarget],
    fov: s.capture.fov,
    lightIntensity: s.capture.lightIntensity,
  };
  const baseObjects = s.sceneObjects.map((o) => ({
    id: o.id,
    position: [...o.position] as [number, number, number],
    rotation: o.rotation,
  }));

  // Real physics settling needs the Rapier world; load it up front so the
  // first iterations don't silently fall back to the kinematic path. If
  // loading failed, isReady() stays false and the fallback applies.
  if (
    s.capture.randomizeObjects &&
    s.sceneObjects.some((o) => !o.owner && o.physics)
  ) {
    await engine.physics.ensureLoaded();
  }

  const captured: Capture[] = [];
  try {
    for (let i = 0; i < total; i++) {
      if (isCancelled?.()) break;
      const pose = poseForIteration(base, i, total);
      // Preview camera follows so the PiP shows the shot being framed.
      engine.setCaptureCameraPose(pose.pos, pose.target, pose.fov);
      applyLighting(engine, base);
      randomizeObjectPositions(engine, baseObjects);
      const capture = await captureOne(engine, prefix, pose);
      useStore.getState().addCapture(capture);
      captured.push(capture);
      onProgress?.({ done: i + 1, total });
    }
  } finally {
    // Restore base pose, lighting, and object placement.
    engine.setCaptureCameraPose(base.camPos, base.camTarget, base.fov);
    engine.environment.setLightIntensity(base.lightIntensity);
    const store = useStore.getState();
    for (const o of baseObjects) {
      store.updateObject(o.id, { position: o.position, rotation: o.rotation });
    }
  }

  if (captured.length > 0) {
    const entries: ZipEntry[] = captured.map((c) => ({ name: c.filename, data: c.blob }));
    if (!anomaly) {
      entries.push({
        name: 'bounding_boxes.labels',
        data: buildBoundingBoxLabelsFile(captured),
      });
    }
    const zip = await buildZipOffThread(entries);
    const zipName = makeFilename(anomaly ? prefix : 'batch', captured.length, 'zip');
    saveBlob(zip, zipName);
  }
  return captured;
}
