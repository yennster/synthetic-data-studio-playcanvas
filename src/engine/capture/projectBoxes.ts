import { BoundingBox as PcBoundingBox, Mat4, Vec3 } from 'playcanvas';
import type { BoundingBox } from '../../lib/types';

/** A labelled capture target: one label covering one or more world AABBs.
 * When `worldPoints` (xyz triplets) is provided, the box comes from
 * percentile bounds of the PROJECTED points instead of AABB corners —
 * projecting a 3D box's corners systematically overshoots the object's
 * screen footprint (its depth extent inflates the 2D box at oblique
 * angles), while projected surface points hug the silhouette. */
export interface LabelTarget {
  label: string;
  aabbs: PcBoundingBox[];
  worldPoints?: Float32Array;
}

const corner = new Vec3();

/** Writes the 8 corners of a world-space AABB into `out` (length 24). */
function aabbCorners(aabb: PcBoundingBox, out: number[]): void {
  const c = aabb.center;
  const h = aabb.halfExtents;
  let k = 0;
  for (let ix = -1; ix <= 1; ix += 2) {
    for (let iy = -1; iy <= 1; iy += 2) {
      for (let iz = -1; iz <= 1; iz += 2) {
        out[k++] = c.x + ix * h.x;
        out[k++] = c.y + iy * h.y;
        out[k++] = c.z + iz * h.z;
      }
    }
  }
}

/**
 * Projects labelled world AABBs through a camera and returns one clamped
 * pixel-space box per label (top-left origin, integer coords, matching the
 * original app's contract):
 * - corners behind the camera are skipped; a box with no corner in front
 *   is dropped entirely
 * - boxes are clamped to the image rect and rounded
 * - boxes smaller than 4x4 px are dropped
 *
 * `viewProj` = projectionMatrix * viewMatrix of the capture camera. Boxes
 * are computed at OUTPUT resolution — never at a supersampled size.
 */
export function projectBoundingBoxes(
  viewProj: Mat4,
  width: number,
  height: number,
  targets: LabelTarget[]
): BoundingBox[] {
  const boxes: BoundingBox[] = [];
  const corners: number[] = new Array(24);
  const m = viewProj.data;

  for (const target of targets) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let anyInFront = false;

    if (target.worldPoints && target.worldPoints.length >= 30) {
      // Point-projection path: percentile-trimmed screen bounds.
      const pts = target.worldPoints;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i];
        const y = pts[i + 1];
        const z = pts[i + 2];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0) continue;
        const cz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / cw;
        if (cz > 1) continue;
        xs.push(((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * width);
        ys.push((1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5 + 0.5)) * height);
      }
      if (xs.length < 10) continue;
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      const lo = Math.floor(xs.length * 0.005);
      const hi = Math.min(xs.length - 1, Math.ceil(xs.length * 0.995));
      minX = xs[lo];
      maxX = xs[hi];
      minY = ys[lo];
      maxY = ys[hi];
      anyInFront = true;
    } else {
    for (const aabb of target.aabbs) {
      aabbCorners(aabb, corners);
      for (let i = 0; i < 8; i++) {
        corner.set(corners[i * 3], corners[i * 3 + 1], corners[i * 3 + 2]);
        const x = corner.x;
        const y = corner.y;
        const z = corner.z;
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0) continue; // behind the camera plane
        const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
        const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
        const cz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / cw;
        if (cz > 1) continue; // beyond the far plane
        anyInFront = true;
        const sx = (cx * 0.5 + 0.5) * width;
        const sy = (1 - (cy * 0.5 + 0.5)) * height;
        if (sx < minX) minX = sx;
        if (sy < minY) minY = sy;
        if (sx > maxX) maxX = sx;
        if (sy > maxY) maxY = sy;
      }
    }
    }

    if (!anyInFront) continue;

    const x0 = Math.min(Math.max(minX, 0), width);
    const y0 = Math.min(Math.max(minY, 0), height);
    const x1 = Math.min(Math.max(maxX, 0), width);
    const y1 = Math.min(Math.max(maxY, 0), height);
    const w = Math.round(x1 - x0);
    const h = Math.round(y1 - y0);
    if (w < 4 || h < 4) continue;

    boxes.push({
      label: target.label,
      x: Math.round(x0),
      y: Math.round(y0),
      width: w,
      height: h,
    });
  }
  return boxes;
}
