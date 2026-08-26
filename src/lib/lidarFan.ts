/**
 * Geometry for the live lidar beam-fan visualization: one segment per
 * bin from the ring center out to the measured range. Pure math so the
 * fan layout (bin 0 forward, CCW about +Y — the exact convention
 * `scanLidar` records with) is unit-testable without a renderer.
 *
 * The engine-side renderer (LidarFanRenderer) maps each segment to an
 * immediate-mode line; `hit` selects the hit color vs the dimmer
 * max-range "no return" color.
 */

/** Ranges within this many meters of maxRange count as "no return" —
 * the clamp in `scanLidar` writes maxRange exactly, the epsilon just
 * absorbs float noise. */
const MISS_EPSILON = 1e-6;

export type LidarFanSegment = {
  /** Unit beam direction in the world XZ plane. */
  dirX: number;
  dirZ: number;
  /** Beam length in meters, clamped to [0, maxRange]. */
  range: number;
  /** True when the beam hit something inside maxRange. */
  hit: boolean;
};

/**
 * Lay out one fan: bin i points at `heading + (i / bins) * 2π` (bin 0
 * along the rover's forward axis, sweeping CCW about +Y), with length
 * `ranges[i]` clamped to `maxRange`.
 */
export function buildLidarFan(
  heading: number,
  ranges: readonly number[],
  maxRange: number,
): LidarFanSegment[] {
  const bins = ranges.length;
  const out: LidarFanSegment[] = new Array(bins);
  for (let i = 0; i < bins; i++) {
    const theta = heading + (i / bins) * Math.PI * 2;
    const range = Math.min(Math.max(ranges[i], 0), maxRange);
    out[i] = {
      dirX: Math.sin(theta),
      dirZ: Math.cos(theta),
      range,
      hit: range < maxRange - MISS_EPSILON,
    };
  }
  return out;
}
