/**
 * Robotics batch runner — the generate loop behind the Robot panel's
 * Run button. Pure TS (no DOM / engine / store imports): everything
 * environment-shaped (clock, sleep, cancellation, image capture, EI
 * probe confirmation, zip building) is injected, so the whole loop is
 * unit-testable and the UI layer only wires callbacks.
 *
 * Loop contract (ported from the original RobotPanel):
 *   - N iterations; each iteration builds a fresh sim (rover event path
 *     or arm trajectory), runs the recording window at 20 Hz, then
 *     routes the recorded sensors: upload to Edge Impulse when an API
 *     key is present, else accumulate pretty-printed data-acquisition
 *     JSON zip entries + an `info.labels` sidecar.
 *   - Rover modality routing: 'fused' → uploadRoverSample (6 IMU + N
 *     lidar channels), 'imu' → uploadSample, 'lidar' → uploadLidarSample;
 *     label = the event; sample rate declared 20 Hz (interval_ms is
 *     inferred from actual timestamps by the payload builders).
 *   - Arm uploads via uploadSample with label = the trajectory and
 *     pick_place outcome metadata attached.
 *   - Object detection: optional async `captureImage` callback (the UI
 *     wires it to the engine POV camera). capture-at-rest → exactly one
 *     image before motion; in-motion → N images spaced by
 *     floor(duration/(N+1)) so none land at t=0 or t=duration. Images
 *     upload with x-bounding-boxes or land in the zip beside a
 *     bounding_boxes.labels sidecar.
 *   - When uploading with object detection on, the target EI project is
 *     probed first and mismatched streams are diverted to the local zip
 *     (confirm callback decides; declining aborts the run).
 *   - rosExport adds one rosbag.jsonl per iteration to the zip in ALL
 *     cases (there is no upload endpoint for ROS bundles).
 *   - Cancellation polls at ≤ 50 ms; a cancelled run still finalizes
 *     and returns the partial zip.
 *
 * The runner returns tallies plus the assembled zip blob (the caller
 * saves it — anchor downloads are DOM territory).
 */

import type {
  AccelSample,
  BoundingBox,
  Capture,
  IngestionMetadataExtras,
  LidarSample,
  RoverEvent,
} from '../lib/types';
import {
  buildDataAcquisitionPayload,
  buildFileName,
  buildInfoLabelsEntry,
  buildInfoLabelsFile,
  buildLidarDataAcquisitionPayload,
  buildRoverDataAcquisitionPayload,
  getEiProjectDataKinds,
  listEiProjects,
  uploadImage,
  uploadLidarSample,
  uploadRoverSample,
  uploadSample,
  type EdgeImpulseConfig,
  type EdgeImpulseInfoLabelsEntry,
} from '../lib/edgeImpulse';
import { buildBoundingBoxLabelsFile } from '../lib/captureFormats';
import { buildZipOffThread } from '../lib/zipWorkerClient';
import type { ZipEntry } from '../lib/zip';
import {
  buildArmRosJsonl,
  buildRoverRosJsonl,
  type ArmJointSample,
} from '../lib/rosMessages';
import type { ArmTrajectory } from '../lib/armTrajectories';
import type { BraccioJointVector } from '../lib/braccioIk';
import type { ImuNoiseConfig } from '../lib/imuNoise';
import {
  createRoverSim,
  ROBOT_RECORD_HZ,
  ROBOT_TICK_MS,
  type RoverTick,
  type WorldAabb,
} from './roverSim';
import {
  createArmSim,
  type ArmPickupTarget,
  type ArmSimOutcome,
  type ArmTick,
} from './armSim';

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export type UploadModality = 'fused' | 'imu' | 'lidar';

/** The robot-settings slice the runner consumes — structurally
 * compatible with the store's `RobotSettings`, redeclared here so the
 * runner stays store-free. */
export interface RobotRunSettings {
  kind: 'rover' | 'arm';
  roverEvent: RoverEvent;
  armTrajectory: ArmTrajectory;
  count: number;
  durationMs: number;
  lidarBins: number;
  lidarMaxRange: number;
  uploadModality: UploadModality;
  rosExport: boolean;
  objectDetection: boolean;
  captureAtRest: boolean;
  objectDetectionImagesPerIteration: number;
}

/** One POV frame handed back by the UI layer's capture callback. The
 * callback applies the realism pass itself and reports the realism_*
 * metadata keys via `metadata`. */
export type RobotImageCapture = {
  blob: Blob;
  boxes: BoundingBox[];
  width: number;
  height: number;
  /** Extra image metadata (realism_* keys etc.) merged into the EI
   * x-metadata / sidecars. */
  metadata?: IngestionMetadataExtras;
};

export type ObjectDetectionRouting = {
  imageDest: 'upload' | 'download';
  sensorDest: 'upload' | 'download';
  /** Human-readable rationale surfaced before the run starts. */
  rationale: string;
};

/**
 * Probe the EI project and decide how the image + sensor streams route.
 * Mutually-exclusive project types (image-only / time-series-only) ask
 * the injected `confirm` before diverting one stream to the local zip.
 * Returns null when the user declines (run aborts).
 */
export async function decideObjectDetectionRouting(opts: {
  apiKey: string;
  confirm?: (message: string) => boolean;
  listProjects?: typeof listEiProjects;
  getDataKinds?: typeof getEiProjectDataKinds;
}): Promise<ObjectDetectionRouting | null> {
  const confirm = opts.confirm ?? (() => true);
  const list = opts.listProjects ?? listEiProjects;
  const kindsOf = opts.getDataKinds ?? getEiProjectDataKinds;

  let project: { id: number; name: string } | null = null;
  try {
    const projects = await list(opts.apiKey);
    if (projects.length > 0) {
      project = { id: projects[0].id, name: projects[0].name };
    }
  } catch {
    project = null;
  }
  if (!project) {
    return {
      imageDest: 'upload',
      sensorDest: 'upload',
      rationale: 'Could not resolve EI project — uploading both streams blindly.',
    };
  }
  let kinds: { hasImages: boolean; hasTimeSeries: boolean; totalChecked: number };
  try {
    kinds = await kindsOf(opts.apiKey, project.id);
  } catch (e) {
    return {
      imageDest: 'upload',
      sensorDest: 'upload',
      rationale: `Could not probe ${project.name}: ${(e as Error).message}. Uploading both.`,
    };
  }
  if (kinds.totalChecked === 0) {
    return {
      imageDest: 'upload',
      sensorDest: 'upload',
      rationale: `${project.name} is empty — uploading both streams.`,
    };
  }
  if (kinds.hasImages && !kinds.hasTimeSeries) {
    const ok = confirm(
      `Edge Impulse project "${project.name}" contains image data, not time-series.\n\n` +
        `• Images (with bounding boxes) will be uploaded to the project.\n` +
        `• Sensor data (IMU/lidar) will be saved as a local zip.\n\n` +
        `Continue?`,
    );
    if (!ok) return null;
    return {
      imageDest: 'upload',
      sensorDest: 'download',
      rationale: `${project.name} accepts images only — sensor data → local zip.`,
    };
  }
  if (kinds.hasTimeSeries && !kinds.hasImages) {
    const ok = confirm(
      `Edge Impulse project "${project.name}" contains time-series sensor data, not images.\n\n` +
        `• Sensor data will be uploaded to the project.\n` +
        `• Images (with bounding boxes) will be saved as a local zip.\n\n` +
        `Continue?`,
    );
    if (!ok) return null;
    return {
      imageDest: 'download',
      sensorDest: 'upload',
      rationale: `${project.name} accepts time-series only — images → local zip.`,
    };
  }
  return {
    imageDest: 'upload',
    sensorDest: 'upload',
    rationale: `${project.name} contains both image and sensor data — uploading both.`,
  };
}

/** Live counters, mirrored into every progress callback and the final
 * result. */
export interface RobotRunTally {
  sensorUploaded: number;
  sensorZipped: number;
  imagesUploaded: number;
  imagesZipped: number;
  failed: number;
}

export interface RobotRunProgress extends RobotRunTally {
  /** 1-based iteration currently recording. */
  iteration: number;
  total: number;
  message: string;
}

export interface RobotRunOptions {
  robot: RobotRunSettings;
  ei: EdgeImpulseConfig;
  imuNoise?: ImuNoiseConfig;

  // ---- environment hooks (all optional; defaults are production) ----
  /** Rover obstacle field (world AABBs). */
  obstacles?: readonly WorldAabb[];
  /** Per-iteration pick_place target selection (the UI randomizes /
   * picks scene objects). Return null for the placeholder fallback. */
  armTarget?: (iteration: number) => ArmPickupTarget | null;
  /** Arm home pose (defaults to the Braccio rest pose). */
  armHome?: BraccioJointVector;
  /** Alias of `armHome` for callers that name it after the store field;
   * `armHome` wins when both are set. */
  armHomePose?: BraccioJointVector;
  /** POV-camera capture; when absent, image capture is skipped even if
   * objectDetection is enabled. Return null on capture failure. */
  captureImage?: (phase: 'rest' | 'motion') => Promise<RobotImageCapture | null>;
  /** Live per-tick mirror for the engine visual / store. */
  onRoverTick?: (tick: RoverTick, iteration: number) => void;
  onArmTick?: (tick: ArmTick, iteration: number) => void;
  /** Narrow per-channel conveniences for UI rigs that don't want the
   * full tick payloads. */
  onRoverPose?: (pose: { x: number; z: number; heading: number }) => void;
  onRoverContact?: (inContact: boolean) => void;
  onArmJoints?: (joints: readonly number[]) => void;
  /** Called when a new iteration's sim exists (epoch-bump analogue). */
  onIterationStart?: (iteration: number) => void;
  onProgress?: (p: RobotRunProgress) => void;
  /** Cancellation flag, polled at ≤ 50 ms. */
  isCancelled?: () => boolean;
  /** Confirm hook for the routing probe (window.confirm in the UI). */
  confirmRouting?: (message: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  rng?: () => number;
  /** Zip assembly override (tests); default builds off-thread. */
  buildZip?: (entries: ZipEntry[]) => Promise<Blob>;
  /** Routing probe overrides (tests). */
  listProjects?: typeof listEiProjects;
  getDataKinds?: typeof getEiProjectDataKinds;
}

export interface RobotRunResult extends RobotRunTally {
  cancelled: boolean;
  /** True when the user declined the routing confirm — nothing ran. */
  aborted: boolean;
  routingRationale: string;
  /** Assembled zip (null when nothing needed packaging). */
  zip: { blob: Blob; name: string; entryNames: string[] } | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** `${stem}_${phase}.${ts}.${idx 4-padded}.png` — matches the original
 * robot image naming so bounding_boxes.labels keys stay stable. */
function imageFileName(stem: string, idx: number, phase: 'rest' | 'motion'): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const safe = (stem || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}_${phase}.${ts}.${String(idx).padStart(4, '0')}.png`;
}

/**
 * Run one robotics batch. Never throws for cancellation — a cancelled
 * run resolves with `cancelled: true` and whatever partial zip exists.
 */
export async function runRobotBatch(
  options: RobotRunOptions,
): Promise<RobotRunResult> {
  const { robot } = options;
  const runEi: EdgeImpulseConfig = { ...options.ei, apiKey: options.ei.apiKey.trim() };
  const shouldUpload = runEi.apiKey.length > 0;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? defaultNow;
  const rng = options.rng ?? Math.random;
  const assembleZip = options.buildZip ?? buildZipOffThread;
  const isCancelled = options.isCancelled ?? (() => false);
  const canCaptureImages = robot.objectDetection && !!options.captureImage;

  const result: RobotRunResult = {
    sensorUploaded: 0,
    sensorZipped: 0,
    imagesUploaded: 0,
    imagesZipped: 0,
    failed: 0,
    cancelled: false,
    aborted: false,
    routingRationale: '',
    zip: null,
  };

  // ---- Routing probe (upload mode + object detection only) ----
  let routing: ObjectDetectionRouting = {
    imageDest: shouldUpload ? 'upload' : 'download',
    sensorDest: shouldUpload ? 'upload' : 'download',
    rationale: '',
  };
  if (canCaptureImages && shouldUpload) {
    const decided = await decideObjectDetectionRouting({
      apiKey: runEi.apiKey,
      confirm: options.confirmRouting,
      listProjects: options.listProjects,
      getDataKinds: options.getDataKinds,
    });
    if (!decided) {
      result.aborted = true;
      return result;
    }
    routing = decided;
  }
  result.routingRationale = routing.rationale;

  const label =
    robot.kind === 'rover' ? robot.roverEvent : robot.armTrajectory;
  const zipEntries: ZipEntry[] = [];
  const infoLabelsEntries: EdgeImpulseInfoLabelsEntry[] = [];
  const imageCaptures: {
    filename: string;
    blob: Blob;
    boxes: BoundingBox[];
    width: number;
    height: number;
  }[] = [];

  /** Sleep that polls the cancel flag at ≤ 50 ms. */
  const sleepCancellable = async (ms: number): Promise<void> => {
    let remaining = ms;
    while (remaining > 0) {
      if (isCancelled()) throw new CancelledError();
      const step = Math.min(50, remaining);
      await sleep(step);
      remaining -= step;
    }
    if (isCancelled()) throw new CancelledError();
  };

  const captureAndRouteImage = async (
    iterIdx: number,
    phase: 'rest' | 'motion',
  ): Promise<void> => {
    if (!options.captureImage) return;
    const cap = await options.captureImage(phase);
    if (!cap) {
      result.failed += 1;
      return;
    }
    const stem =
      robot.kind === 'rover'
        ? `rover_${robot.roverEvent}`
        : `arm_${robot.armTrajectory}`;
    const filename = imageFileName(stem, iterIdx + 1, phase);
    const imageMeta: IngestionMetadataExtras = {
      mode: 'robot',
      robot_kind: robot.kind,
      ...(robot.kind === 'rover'
        ? {
            event: robot.roverEvent,
            event_index: iterIdx + 1,
            event_total: robot.count,
          }
        : {
            trajectory: robot.armTrajectory,
            trajectory_index: iterIdx + 1,
            trajectory_total: robot.count,
          }),
      capture_phase: phase,
      capture_width: cap.width,
      capture_height: cap.height,
      ...cap.metadata,
    };
    if (routing.imageDest === 'upload') {
      try {
        const res = await uploadImage(
          { ...runEi, label },
          cap.blob,
          filename,
          label,
          cap.boxes,
          imageMeta,
        );
        if (res.ok) result.imagesUploaded += 1;
        else result.failed += 1;
      } catch {
        result.failed += 1;
      }
    } else {
      imageCaptures.push({
        filename,
        blob: cap.blob,
        boxes: cap.boxes,
        width: cap.width,
        height: cap.height,
      });
      result.imagesZipped += 1;
    }
  };

  /**
   * Run one recording window: create the sim, tick it at the record
   * rate (pacing via the injected sleep), fire scheduled in-motion
   * captures, and return the recorded sample streams.
   */
  const runWindow = async (
    iterIdx: number,
    // Invoked after the fresh sim's start pose has been pushed to the
    // engine visuals but before recording begins — the 'capture at rest'
    // shot must show THIS iteration's launch pose, not the previous
    // iteration's end pose (e.g. the rover still parked on an obstacle).
    beforeTicks?: () => Promise<void>,
  ): Promise<{
    imu: AccelSample[];
    lidar: LidarSample[];
    joints: ArmJointSample[];
    armOutcome: ArmSimOutcome | null;
  }> => {
    const imu: AccelSample[] = [];
    const lidar: LidarSample[] = [];
    const joints: ArmJointSample[] = [];

    const inMotionImages =
      canCaptureImages && !robot.captureAtRest
        ? Math.max(1, robot.objectDetectionImagesPerIteration)
        : 0;
    const slice =
      inMotionImages > 0
        ? Math.max(1, Math.floor(robot.durationMs / (inMotionImages + 1)))
        : 0;
    let nextCaptureAt = inMotionImages > 0 ? slice : Infinity;
    let capturesFired = 0;

    const ticks = Math.max(1, Math.floor(robot.durationMs / ROBOT_TICK_MS));

    if (robot.kind === 'rover') {
      const sim = createRoverSim({
        event: robot.roverEvent,
        obstacles: options.obstacles ?? [],
        durationMs: robot.durationMs,
        lidarBins: robot.lidarBins,
        lidarMaxRange: robot.lidarMaxRange,
        imuNoise: options.imuNoise,
        rng,
        timeOriginMs: now(),
      });
      options.onIterationStart?.(iterIdx);
      options.onRoverPose?.(sim.startPose);
      options.onRoverContact?.(false);
      await beforeTicks?.();
      for (let k = 0; k <= ticks; k++) {
        if (isCancelled()) throw new CancelledError();
        const elapsed = Math.min(k * ROBOT_TICK_MS, robot.durationMs);
        const tick = sim.tick(elapsed);
        imu.push(tick.imu);
        lidar.push(tick.lidar);
        options.onRoverTick?.(tick, iterIdx);
        options.onRoverPose?.(tick.pose);
        options.onRoverContact?.(tick.inContact);
        while (capturesFired < inMotionImages && elapsed >= nextCaptureAt) {
          capturesFired += 1;
          nextCaptureAt += slice;
          await captureAndRouteImage(iterIdx, 'motion');
        }
        if (k < ticks) await sleepCancellable(ROBOT_TICK_MS);
      }
      return { imu, lidar, joints, armOutcome: null };
    }

    const sim = createArmSim({
      trajectory: robot.armTrajectory,
      durationMs: robot.durationMs,
      home: options.armHome ?? options.armHomePose,
      target:
        robot.armTrajectory === 'pick_place'
          ? options.armTarget?.(iterIdx) ?? null
          : null,
      imuNoise: options.imuNoise,
      rng,
      timeOriginMs: now(),
    });
    options.onIterationStart?.(iterIdx);
    options.onArmJoints?.(sim.startJoints);
    await beforeTicks?.();
    for (let k = 0; k <= ticks; k++) {
      if (isCancelled()) throw new CancelledError();
      const elapsed = Math.min(k * ROBOT_TICK_MS, robot.durationMs);
      const tick = sim.tick(elapsed);
      imu.push(tick.imu);
      joints.push(tick.jointSample);
      options.onArmTick?.(tick, iterIdx);
      options.onArmJoints?.(tick.joints);
      while (capturesFired < inMotionImages && elapsed >= nextCaptureAt) {
        capturesFired += 1;
        nextCaptureAt += slice;
        await captureAndRouteImage(iterIdx, 'motion');
      }
      if (k < ticks) await sleepCancellable(ROBOT_TICK_MS);
    }
    return { imu, lidar, joints, armOutcome: sim.getOutcome() };
  };

  const routeRoverSensors = async (
    iterIdx: number,
    imu: AccelSample[],
    lidar: LidarSample[],
  ): Promise<void> => {
    const modality = robot.uploadModality;
    if (modality === 'fused' && (imu.length === 0 || lidar.length === 0)) {
      result.failed += 1;
      return;
    }
    if (modality === 'imu' && imu.length === 0) {
      result.failed += 1;
      return;
    }
    if (modality === 'lidar' && lidar.length === 0) {
      result.failed += 1;
      return;
    }
    const event = robot.roverEvent;
    const fileName = buildFileName(`${event}_${modality}_${iterIdx + 1}`);
    const meta: IngestionMetadataExtras = {
      mode: 'robot',
      robot_kind: 'rover',
      event,
      event_index: iterIdx + 1,
      event_total: robot.count,
      modality,
      lidar_bins: robot.lidarBins,
      lidar_max_range_m: robot.lidarMaxRange,
      duration_ms: robot.durationMs,
    };
    if (routing.sensorDest === 'upload') {
      try {
        let res;
        if (modality === 'fused') {
          res = await uploadRoverSample(
            { ...runEi, label: event },
            imu,
            lidar,
            ROBOT_RECORD_HZ,
            robot.lidarMaxRange,
            fileName,
            meta,
          );
        } else if (modality === 'imu') {
          res = await uploadSample(
            { ...runEi, label: event },
            imu,
            ROBOT_RECORD_HZ,
            fileName,
            meta,
          );
        } else {
          res = await uploadLidarSample(
            { ...runEi, label: event },
            lidar,
            ROBOT_RECORD_HZ,
            robot.lidarMaxRange,
            fileName,
            meta,
          );
        }
        if (res.ok) result.sensorUploaded += 1;
        else result.failed += 1;
      } catch {
        result.failed += 1;
      }
    } else {
      let body: unknown;
      if (modality === 'fused') {
        body = await buildRoverDataAcquisitionPayload(
          runEi,
          imu,
          lidar,
          ROBOT_RECORD_HZ,
          robot.lidarMaxRange,
        );
      } else if (modality === 'imu') {
        body = await buildDataAcquisitionPayload(runEi, imu, ROBOT_RECORD_HZ);
      } else {
        body = await buildLidarDataAcquisitionPayload(
          runEi,
          lidar,
          ROBOT_RECORD_HZ,
          robot.lidarMaxRange,
        );
      }
      zipEntries.push({ name: fileName, data: JSON.stringify(body, null, 2) });
      infoLabelsEntries.push(
        buildInfoLabelsEntry({
          path: fileName,
          category: runEi.category,
          label: event,
          metadataExtras: meta,
        }),
      );
      result.sensorZipped += 1;
    }
    if (robot.rosExport) {
      // No ROS upload endpoint exists — the JSONL always lands in the
      // zip, even when the EI streams upload. Odometry is omitted (the
      // runner keeps no pose log), matching the original export.
      const jsonl = buildRoverRosJsonl({
        imu,
        lidar,
        lidarMaxRange: robot.lidarMaxRange,
      });
      zipEntries.push({
        name: fileName.replace(/\.json$/, '.rosbag.jsonl'),
        data: jsonl,
      });
    }
  };

  const routeArmSensors = async (
    iterIdx: number,
    imu: AccelSample[],
    joints: ArmJointSample[],
    armOutcome: ArmSimOutcome | null,
  ): Promise<void> => {
    if (imu.length === 0) {
      result.failed += 1;
      return;
    }
    const trajectory = robot.armTrajectory;
    const fileName = buildFileName(`${trajectory}_${iterIdx + 1}`);
    const meta: IngestionMetadataExtras = {
      mode: 'robot',
      robot_kind: 'arm',
      trajectory,
      trajectory_index: iterIdx + 1,
      trajectory_total: robot.count,
      duration_ms: robot.durationMs,
      arm_target_id: armOutcome?.target.id ?? '',
      ...(armOutcome?.metadata ?? {}),
    };
    if (routing.sensorDest === 'upload') {
      try {
        const res = await uploadSample(
          { ...runEi, label: trajectory },
          imu,
          ROBOT_RECORD_HZ,
          fileName,
          meta,
        );
        if (res.ok) result.sensorUploaded += 1;
        else result.failed += 1;
      } catch {
        result.failed += 1;
      }
    } else {
      const body = await buildDataAcquisitionPayload(runEi, imu, ROBOT_RECORD_HZ);
      zipEntries.push({ name: fileName, data: JSON.stringify(body, null, 2) });
      infoLabelsEntries.push(
        buildInfoLabelsEntry({
          path: fileName,
          category: runEi.category,
          label: trajectory,
          metadataExtras: meta,
        }),
      );
      result.sensorZipped += 1;
    }
    if (robot.rosExport) {
      const jsonl = buildArmRosJsonl({ imu, joints });
      zipEntries.push({
        name: fileName.replace(/\.json$/, '.rosbag.jsonl'),
        data: jsonl,
      });
    }
  };

  const finalize = async (): Promise<void> => {
    const entries: ZipEntry[] = [...zipEntries];
    if (infoLabelsEntries.length > 0) {
      entries.push({
        name: 'info.labels',
        data: buildInfoLabelsFile(infoLabelsEntries),
      });
    }
    for (const c of imageCaptures) {
      entries.push({ name: c.filename, data: c.blob });
    }
    if (imageCaptures.length > 0) {
      const sidecarCaptures: Capture[] = imageCaptures.map((c) => ({
        id: c.filename,
        filename: c.filename,
        blob: c.blob,
        boxes: c.boxes,
        label: '',
        width: c.width,
        height: c.height,
        ts: Date.now(),
      }));
      entries.push({
        name: 'bounding_boxes.labels',
        data: buildBoundingBoxLabelsFile(sidecarCaptures),
      });
    }
    if (entries.length === 0) return;
    // Zip stem counts recorded samples, not zip entries (info.labels and
    // rosbag files would inflate the number) — matches the original's
    // `rover_{event}_{n}` / `arm_{trajectory}_{n}` naming.
    const sampleCount = result.sensorZipped + result.sensorUploaded;
    const stem =
      robot.kind === 'rover'
        ? `rover_${robot.roverEvent}_${sampleCount}`
        : `arm_${robot.armTrajectory}_${sampleCount}`;
    const zipName = buildFileName(stem).replace(/\.json$/, '.zip');
    const blob = await assembleZip(entries);
    result.zip = {
      blob,
      name: zipName,
      entryNames: entries.map((e) => e.name),
    };
  };

  try {
    // Short settle window so the engine visual can pick up the reset
    // pose before the first recording starts (cancellable).
    await sleepCancellable(60);
    for (let i = 0; i < robot.count; i++) {
      options.onProgress?.({
        iteration: i + 1,
        total: robot.count,
        message: `${i + 1}/${robot.count} ${label}: recording…`,
        sensorUploaded: result.sensorUploaded,
        sensorZipped: result.sensorZipped,
        imagesUploaded: result.imagesUploaded,
        imagesZipped: result.imagesZipped,
        failed: result.failed,
      });
      const window = await runWindow(
        i,
        canCaptureImages && robot.captureAtRest
          ? // At rest the robot is stationary — pin to exactly one shot,
            // taken after the fresh sim's start pose reaches the visuals.
            () => captureAndRouteImage(i, 'rest')
          : undefined
      );
      if (robot.kind === 'rover') {
        await routeRoverSensors(i, window.imu, window.lidar);
      } else {
        await routeArmSensors(i, window.imu, window.joints, window.armOutcome);
      }
    }
  } catch (e) {
    if (e instanceof CancelledError) {
      result.cancelled = true;
    } else {
      throw e;
    }
  }
  // Finalize in ALL exit paths (complete or cancelled): a cancelled
  // run still packages the partial zip.
  await finalize();
  return result;
}
