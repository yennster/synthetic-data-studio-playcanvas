/**
 * Cast `bins` evenly-spaced rays in the horizontal plane around `origin`,
 * each capped at `maxRange`, and return the hit distance per bin.
 *
 * Bin 0 points along the rover's forward axis (+Z in the rover's local
 * frame, rotated by `heading` into world space) and bins sweep CCW about
 * +Y. Bins that don't hit anything within `maxRange` are clamped to that
 * value — same semantics as a real ToF sensor reporting "no return."
 *
 * ENGINE HOOK POINT: the original leaned on THREE.Raycaster against an
 * obstacles group; here the actual ray intersection is injected as the
 * `castRay` callback so this module stays pure math. The engine-side
 * caster (e.g. a PlayCanvas rigid-body raycast or a mesh/BVH picker over
 * the obstacles subtree) must return the nearest hit distance in meters,
 * or null on a miss, and must honor the near/far clip window: ignore
 * hits closer than `LIDAR_RAY_NEAR` (self-hit guard) and beyond
 * `maxRange`. The rover's own meshes must NOT be part of the cast set,
 * or every beam reports a near-zero hit on the chassis.
 */

/** Near-clip distance the engine caster must apply — mirrors the
 * original `ray.near = 0.01`. */
export const LIDAR_RAY_NEAR = 0.01;

/** Injected intersection test: world-space `origin` and unit `dir`,
 * returns nearest hit distance (m) or null when nothing is hit inside
 * the caster's clip window. */
export type LidarRayCaster = (
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
) => number | null;

type LidarOptions = {
  origin: { x: number; y: number; z: number };
  /** Forward yaw in radians; bin 0 is along this direction. */
  heading: number;
  bins: number;
  maxRange: number;
  /** Engine-supplied ray intersection (see header). Called once per
   * bin; implementations should keep allocation off this hot path. */
  castRay: LidarRayCaster;
};

export function scanLidar({
  origin,
  heading,
  bins,
  maxRange,
  castRay,
}: LidarOptions): number[] {
  const o: [number, number, number] = [origin.x, origin.y, origin.z];
  const out: number[] = new Array(bins);
  for (let i = 0; i < bins; i++) {
    const theta = heading + (i / bins) * Math.PI * 2;
    const d = castRay(o, [Math.sin(theta), 0, Math.cos(theta)]);
    out[i] = d !== null && d <= maxRange ? d : maxRange;
  }
  return out;
}
