import { Vec3 } from 'playcanvas';
import type { SplatEntry } from './SplatManager';

/**
 * Outlier-robust world-space center of a splat scan: per-axis median over
 * a sample of splat centers. Scan AABBs are skewed by stray floater
 * splats (an apartment scan's box can span 30+ m), so centering on the
 * AABB drops the camera into empty space — the median lands inside the
 * actual reconstructed room.
 */
export function robustSplatCenterWorld(entry: SplatEntry): Vec3 | null {
  const resource = entry.entity.gsplat?.resource as
    | { centers?: Float32Array }
    | null
    | undefined;
  const centers = resource?.centers;
  if (!centers || centers.length < 3) return null;

  const count = centers.length / 3;
  const step = Math.max(1, Math.floor(count / 20000));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < count; i += step) {
    xs.push(centers[i * 3]);
    ys.push(centers[i * 3 + 1]);
    zs.push(centers[i * 3 + 2]);
  }
  const median = (a: number[]) => {
    a.sort((p, q) => p - q);
    return a[a.length >> 1];
  };

  const local = new Vec3(median(xs), median(ys), median(zs));
  const world = new Vec3();
  entry.entity.getWorldTransform().transformPoint(local, world);
  return world;
}

/**
 * Repositions a backdrop scan so its robust center sits at the origin at
 * `height` meters — the studio camera starts inside the environment.
 */
export function centerSplatBackdrop(entry: SplatEntry, height = 1.2): boolean {
  const world = robustSplatCenterWorld(entry);
  if (!world) return false;
  const pos = entry.entity.getLocalPosition();
  entry.entity.setLocalPosition(
    pos.x - world.x,
    pos.y - world.y + height,
    pos.z - world.z
  );
  return true;
}
