import { describe, expect, it } from 'vitest';
import { imagePixelsToSplatPoints, type ImagePixels } from './splatCreate';

/** 3×2 RGBA test image; pixel (1,0) fully transparent. */
function makeImage(): ImagePixels {
  // row 0: red, TRANSPARENT, blue; row 1: white, black, half-alpha green
  const px = [
    [255, 0, 0, 255], [0, 255, 0, 0], [0, 0, 255, 255],
    [255, 255, 255, 255], [0, 0, 0, 255], [0, 255, 0, 128],
  ].flat();
  return { width: 3, height: 2, data: new Uint8ClampedArray(px) };
}

describe('imagePixelsToSplatPoints', () => {
  it('emits one splat per non-transparent pixel', () => {
    const points = imagePixelsToSplatPoints(makeImage());
    expect(points.length).toBe(5); // 6 pixels − 1 fully transparent
  });

  it('spans 1.5 m on the larger dimension, centered, resting on y=0', () => {
    const points = imagePixelsToSplatPoints(makeImage());
    const pitch = 1.5 / 3; // larger dim is width=3
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    // Horizontal centers at ±pitch and 0.
    expect(Math.min(...xs)).toBeCloseTo(-pitch, 6);
    expect(Math.max(...xs)).toBeCloseTo(pitch, 6);
    // Bottom row centers half a pitch above the floor, top row below height.
    expect(Math.min(...ys)).toBeCloseTo(pitch / 2, 6);
    expect(Math.max(...ys)).toBeCloseTo(1.5 * (2 / 3) - pitch / 2, 6);
    // Upright plane: all splats at z = 0.
    expect(points.every((p) => p.z === 0)).toBe(true);
  });

  it('takes color and opacity from the pixel', () => {
    const points = imagePixelsToSplatPoints(makeImage());
    const red = points[0];
    expect([red.r, red.g, red.b, red.a]).toEqual([1, 0, 0, 1]);
    const halfGreen = points[points.length - 1];
    expect(halfGreen.g).toBe(1);
    expect(halfGreen.a).toBeCloseTo(128 / 255, 6);
  });

  it('uses an isotropic size of 1.4× the pixel pitch (sigma ≈ 0.7× pitch)', () => {
    const points = imagePixelsToSplatPoints(makeImage());
    const pitch = 1.5 / 3;
    expect(points.every((p) => Math.abs(p.size - pitch * 1.4) < 1e-9)).toBe(true);
  });

  it('keeps row 0 at the top of the plane', () => {
    const points = imagePixelsToSplatPoints(makeImage());
    // First emitted point is row 0 (red) — highest y.
    expect(points[0].y).toBeCloseTo(Math.max(...points.map((p) => p.y)), 6);
  });

  it('honors a custom world size and empty images', () => {
    const points = imagePixelsToSplatPoints(makeImage(), { worldMaxDim: 3 });
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(1, 6);
    expect(imagePixelsToSplatPoints({ width: 0, height: 0, data: new Uint8ClampedArray() })).toEqual([]);
  });
});
