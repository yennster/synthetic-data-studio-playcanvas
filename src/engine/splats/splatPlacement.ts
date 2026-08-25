import { BoundingBox, Vec3 } from 'playcanvas';
import type { SplatEntry } from './SplatManager';

/**
 * Outlier-robust placement for splat scans. Scan AABBs are skewed by
 * stray floater splats (an apartment scan's box can span 30+ m), so
 * anything AABB-based drops the studio into empty space. Instead we
 * sample the actual splat centers in WORLD space and work with medians
 * and percentiles.
 */

interface SplatWorldStats {
  /** Median world-space point of the scan (inside the reconstruction). */
  center: Vec3;
  /** Estimated floor height: 5th percentile of world Y among points near
   * the horizontal center. */
  floorY: number;
}

export function computeSplatWorldStats(entry: SplatEntry): SplatWorldStats | null {
  const resource = entry.entity.gsplat?.resource as
    | { centers?: Float32Array }
    | null
    | undefined;
  const centers = resource?.centers;
  if (!centers || centers.length < 3) return null;

  const count = centers.length / 3;
  const step = Math.max(1, Math.floor(count / 20000));
  const world = entry.entity.getWorldTransform();
  const local = new Vec3();
  const out = new Vec3();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < count; i += step) {
    local.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
    world.transformPoint(local, out);
    xs.push(out.x);
    ys.push(out.y);
    zs.push(out.z);
  }

  const sortedCopy = (a: number[]) => [...a].sort((p, q) => p - q);
  const percentile = (sorted: number[], p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
  const median = (a: number[]) => percentile(sortedCopy(a), 0.5);

  const cx = median(xs);
  const cy = median(ys);
  const cz = median(zs);

  // Keep only points horizontally near the center (inside the room /
  // scene body) so distant floaters don't drag the floor estimate.
  const dists = xs.map((x, i) => Math.hypot(x - cx, zs[i] - cz));
  const radius = Math.max(1, percentile(sortedCopy(dists), 0.5));
  const nearYs: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (dists[i] <= radius) nearYs.push(ys[i]);
  }
  const floorY = nearYs.length > 10 ? percentile(sortedCopy(nearYs), 0.05) : cy - 1.2;

  return { center: new Vec3(cx, cy, cz), floorY };
}

/**
 * Repositions a backdrop scan so its horizontal center sits over the
 * origin and its estimated FLOOR sits at y = 0 — the app's world
 * convention. Props, spawned primitives, and robot rigs all rest at
 * y = 0, so they land on the scan's floor instead of floating or being
 * buried.
 */
export function centerSplatBackdrop(entry: SplatEntry): boolean {
  const stats = computeSplatWorldStats(entry);
  if (!stats) return false;
  const pos = entry.entity.getLocalPosition();
  entry.entity.setLocalPosition(
    pos.x - stats.center.x,
    pos.y - stats.floorY,
    pos.z - stats.center.z
  );
  return true;
}

/**
 * Outlier-trimmed LOCAL-space AABB of a splat: per-axis 0.2/99.8
 * percentile bounds over the splat centers. Scan `resource.aabb`s are
 * inflated by stray floater splats — bounding boxes, selection, and
 * click-hit-testing all want the bounds of the VISIBLE reconstruction.
 */
export function computeTightLocalAabb(
  resource: { centers?: Float32Array } | null | undefined
): BoundingBox | null {
  const centers = resource?.centers;
  if (!centers || centers.length < 30) return null;
  const count = centers.length / 3;
  const step = Math.max(1, Math.floor(count / 30000));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < count; i += step) {
    xs.push(centers[i * 3]);
    ys.push(centers[i * 3 + 1]);
    zs.push(centers[i * 3 + 2]);
  }
  const bounds = (a: number[]): [number, number] => {
    a.sort((p, q) => p - q);
    const lo = a[Math.floor(a.length * 0.002)];
    const hi = a[Math.min(a.length - 1, Math.floor(a.length * 0.998))];
    return [lo, hi];
  };
  const [x0, x1] = bounds(xs);
  const [y0, y1] = bounds(ys);
  const [z0, z1] = bounds(zs);
  return new BoundingBox(
    new Vec3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    new Vec3(
      Math.max((x1 - x0) / 2, 0.001),
      Math.max((y1 - y0) / 2, 0.001),
      Math.max((z1 - z0) / 2, 0.001)
    )
  );
}

/**
 * Grounds a splat OBJECT (a scanned prop): its estimated bottom rests at
 * y = 0 with its center over `(offsetX, 0, offsetZ)`, so scans line up
 * beside mesh props on whatever floor is active.
 */
export function groundSplatObject(
  entry: SplatEntry,
  offsetX = 0,
  offsetZ = 0
): boolean {
  const stats = computeSplatWorldStats(entry);
  if (!stats) return false;
  const pos = entry.entity.getLocalPosition();
  entry.entity.setLocalPosition(
    pos.x - stats.center.x + offsetX,
    pos.y - stats.floorY,
    pos.z - stats.center.z + offsetZ
  );
  return true;
}
