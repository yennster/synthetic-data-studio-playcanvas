/**
 * Shared data types used across lib modules, the store, and the engine.
 * Kept dependency-free so pure-logic libs stay renderer-agnostic.
 */

/** One 6-axis IMU sample. `t` is a performance.now() timestamp in ms. */
export interface AccelSample {
  t: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

/** One lidar ring sample: `ranges[i]` is the distance (m) for bin i. */
export interface LidarSample {
  t: number;
  ranges: number[];
}

/** Rover behaviour events used as labels for robotics recordings. */
export type RoverEvent = 'cruise' | 'collision' | 'stuck';

/** 2D bounding box in output-image pixel space, top-left origin. */
export interface BoundingBox {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Camera path shapes for deterministic batch trajectories. */
export type CameraTrajectory =
  | 'random'
  | 'circle'
  | 'figure8'
  | 'arc'
  | 'spiral'
  | 'orbit_dome';

/** Extra key/values attached to EI ingestion x-metadata; String()-coerced,
 * undefined/null/'' entries dropped. */
export type IngestionMetadataExtras = Record<
  string,
  string | number | boolean | undefined | null
>;

/** EI dataset bucket selection ('split' rolls 80:20 per sample). */
export type EiCategory = 'training' | 'testing' | 'split';

/** One captured synthetic image plus its labels. */
export interface Capture {
  id: string;
  filename: string;
  blob: Blob;
  boxes: BoundingBox[];
  /** '' in detection mode (per-upload default applies); anomaly label otherwise. */
  label: string;
  width: number;
  height: number;
  ts: number;
  /** Object kinds present in the scene at capture time (deduped). */
  shapes?: string[];
  /** Imported asset names/labels present at capture time. */
  assetSnapshot?: { name: string; label: string }[];
}
