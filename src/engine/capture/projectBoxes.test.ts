import { describe, expect, it } from 'vitest';
import { BoundingBox, Mat4, Vec3 } from 'playcanvas';
import { projectBoundingBoxes } from './projectBoxes';

/** Simple perspective view-proj looking down -Z from the origin. */
function makeViewProj(): Mat4 {
  const proj = new Mat4();
  proj.setPerspective(90, 1, 0.1, 100);
  // Camera at origin looking down -Z: view matrix is identity.
  return proj;
}

function box(cx: number, cy: number, cz: number, h: number): BoundingBox {
  return new BoundingBox(new Vec3(cx, cy, cz), new Vec3(h, h, h));
}

describe('projectBoundingBoxes', () => {
  it('projects a centered box in front of the camera', () => {
    const boxes = projectBoundingBoxes(makeViewProj(), 640, 480, [
      { label: 'cube', aabbs: [box(0, 0, -5, 0.5)] },
    ]);
    expect(boxes).toHaveLength(1);
    const b = boxes[0];
    expect(b.label).toBe('cube');
    // Centered: box should straddle the image center.
    expect(b.x).toBeLessThan(320);
    expect(b.x + b.width).toBeGreaterThan(320);
    expect(b.y).toBeLessThan(240);
    expect(b.y + b.height).toBeGreaterThan(240);
  });

  it('drops targets entirely behind the camera', () => {
    const boxes = projectBoundingBoxes(makeViewProj(), 640, 480, [
      { label: 'behind', aabbs: [box(0, 0, 5, 0.5)] },
    ]);
    expect(boxes).toHaveLength(0);
  });

  it('drops boxes smaller than 4px', () => {
    const boxes = projectBoundingBoxes(makeViewProj(), 640, 480, [
      { label: 'tiny', aabbs: [box(0, 0, -90, 0.05)] },
    ]);
    expect(boxes).toHaveLength(0);
  });

  it('clamps boxes to the image rect', () => {
    const boxes = projectBoundingBoxes(makeViewProj(), 640, 480, [
      { label: 'offside', aabbs: [box(-6, 0, -5, 2)] },
    ]);
    expect(boxes).toHaveLength(1);
    const b = boxes[0];
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(640);
  });

  it('merges multiple AABBs under one label into one box', () => {
    const boxes = projectBoundingBoxes(makeViewProj(), 640, 480, [
      { label: 'pair', aabbs: [box(-1, 0, -5, 0.3), box(1, 0, -5, 0.3)] },
    ]);
    expect(boxes).toHaveLength(1);
    // The merged box spans both parts, so it is wider than tall.
    expect(boxes[0].width).toBeGreaterThan(boxes[0].height);
  });

  it('rounds and returns integer coordinates', () => {
    const boxes = projectBoundingBoxes(makeViewProj(), 640, 480, [
      { label: 'cube', aabbs: [box(0.123, 0.456, -3.21, 0.4)] },
    ]);
    expect(boxes).toHaveLength(1);
    for (const v of [boxes[0].x, boxes[0].y, boxes[0].width, boxes[0].height]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
