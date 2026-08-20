import { describe, expect, it } from 'vitest';
import { LIDAR_RAY_NEAR, scanLidar, type LidarRayCaster } from './lidar';

/**
 * Mock engine caster: analytic ray-vs-AABB (slab method) over a list of
 * axis-aligned boxes, honoring the near-clip contract the engine caster
 * must implement. The original test used three.js BoxGeometry meshes so
 * the raycaster behaved exactly like the live scene; the assertions are
 * unchanged — only the intersection backend is swapped for pure math.
 */
function boxCaster(
  boxes: { cx: number; cy: number; cz: number; half: number }[],
): LidarRayCaster {
  return (origin, dir) => {
    let nearest: number | null = null;
    for (const b of boxes) {
      const min = [b.cx - b.half, b.cy - b.half, b.cz - b.half];
      const max = [b.cx + b.half, b.cy + b.half, b.cz + b.half];
      let tMin = -Infinity;
      let tMax = Infinity;
      let miss = false;
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(dir[axis]) < 1e-12) {
          // Ray parallel to this slab — must start inside it.
          if (origin[axis] < min[axis] || origin[axis] > max[axis]) {
            miss = true;
            break;
          }
        } else {
          const t1 = (min[axis] - origin[axis]) / dir[axis];
          const t2 = (max[axis] - origin[axis]) / dir[axis];
          tMin = Math.max(tMin, Math.min(t1, t2));
          tMax = Math.min(tMax, Math.max(t1, t2));
          if (tMin > tMax) {
            miss = true;
            break;
          }
        }
      }
      if (miss) continue;
      const t = tMin >= LIDAR_RAY_NEAR ? tMin : tMax >= LIDAR_RAY_NEAR ? tMax : null;
      if (t !== null && (nearest === null || t < nearest)) nearest = t;
    }
    return nearest;
  };
}

/**
 * Build a caster with one box obstacle in front of the rover — same
 * 0.3 m cube resting on the floor (center y = 0.15) as the original
 * three.js fixture.
 */
function singleBoxAt(x: number, z: number): LidarRayCaster {
  return boxCaster([{ cx: x, cy: 0.15, cz: z, half: 0.15 }]);
}

describe('scanLidar', () => {
  it('reports max-range for every beam when there are no obstacles', () => {
    const ranges = scanLidar({
      origin: { x: 0, y: 0.3, z: 0 },
      heading: 0,
      bins: 16,
      maxRange: 5,
      castRay: boxCaster([]),
    });
    expect(ranges.length).toBe(16);
    for (const r of ranges) expect(r).toBeCloseTo(5, 5);
  });

  it('detects an obstacle directly ahead', () => {
    // Heading=0 → bin 0 points along +Z. Place a box at z=2.
    const castRay = singleBoxAt(0, 2);
    const ranges = scanLidar({
      origin: { x: 0, y: 0.3, z: 0 },
      heading: 0,
      bins: 16,
      maxRange: 5,
      castRay,
    });
    // Bin 0 should report ~2m (front face of the box).
    expect(ranges[0]).toBeGreaterThan(1.5);
    expect(ranges[0]).toBeLessThan(2.1);
    // Bin 8 (opposite direction) should still report max.
    expect(ranges[8]).toBeCloseTo(5, 5);
  });

  it('rotates the bin layout with the rover heading', () => {
    // Same box, but with a heading rotated 90° (faces +X). Now bin 0
    // should hit nothing (no box on +X axis), and the bin pointing at
    // the box (in world +Z) should fire instead.
    const castRay = singleBoxAt(0, 2);
    const ranges = scanLidar({
      origin: { x: 0, y: 0.3, z: 0 },
      heading: Math.PI / 2,
      bins: 16,
      maxRange: 5,
      castRay,
    });
    expect(ranges[0]).toBeCloseTo(5, 5);
    // Some bin should have detected the box.
    const minRange = Math.min(...ranges);
    expect(minRange).toBeLessThan(2.1);
  });

  it('clamps reads past maxRange', () => {
    const castRay = singleBoxAt(0, 8);
    const ranges = scanLidar({
      origin: { x: 0, y: 0.3, z: 0 },
      heading: 0,
      bins: 8,
      maxRange: 5,
      castRay,
    });
    for (const r of ranges) expect(r).toBeLessThanOrEqual(5);
  });
});
