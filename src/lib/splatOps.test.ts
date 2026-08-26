import { describe, expect, it } from 'vitest';
import {
  applyOpsToGsplatData,
  applyOpsToPoints,
  computeEditState,
  flipEditOpsZ180,
  plyReimportEuler,
  sanitizeEditOps,
  shouldCoalesceOps,
  type SplatEditOp,
} from './splatOps';
import { fdcToLinear, linearToFdc, type GsplatData } from './gsplatData';

// Three splats on the x axis at x = 0, 1, 2.
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);

describe('computeEditState', () => {
  it('eraseSphere hides only splats inside the sphere', () => {
    const state = computeEditState(positions, 3, [
      { kind: 'eraseSphere', center: [1, 0, 0], radius: 0.5 },
    ]);
    expect([...state.visible]).toEqual([1, 0, 1]);
  });

  it('eraseBox hides splats inside, crop hides splats outside', () => {
    const box: SplatEditOp = { kind: 'eraseBox', min: [0.5, -1, -1], max: [2.5, 1, 1] };
    expect([...computeEditState(positions, 3, [box]).visible]).toEqual([1, 0, 0]);
    const crop: SplatEditOp = { kind: 'crop', min: [0.5, -1, -1], max: [2.5, 1, 1] };
    expect([...computeEditState(positions, 3, [crop]).visible]).toEqual([0, 1, 1]);
  });

  it('erasure accumulates across ops; tint overwrites (GPU semantics)', () => {
    const state = computeEditState(positions, 3, [
      { kind: 'eraseSphere', center: [0, 0, 0], radius: 0.1 },
      { kind: 'eraseSphere', center: [2, 0, 0], radius: 0.1 },
      { kind: 'tintSphere', center: [1, 0, 0], radius: 0.2, color: [1, 0, 0], strength: 0.5 },
      { kind: 'tintSphere', center: [1, 0, 0], radius: 0.2, color: [0, 1, 0], strength: 0.25 },
    ]);
    expect([...state.visible]).toEqual([0, 1, 0]);
    // Second tint replaced the first — no compounding.
    expect([...state.tintColor.slice(3, 6)]).toEqual([0, 1, 0]);
    expect(state.tintStrength[1]).toBe(0.25);
    expect(state.tintStrength[0]).toBe(0);
    expect(state.tintStrength[2]).toBe(0);
  });
});

function makeData(): GsplatData {
  return {
    count: 3,
    positions: positions.slice(),
    scales: new Float32Array([-5, -5, -5, -4, -4, -4, -3, -3, -3]),
    rotations: new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0, 1, 0, 0]),
    opacities: new Float32Array([2, 0, -2]),
    colors: new Float32Array([
      linearToFdc(0.2), linearToFdc(0.4), linearToFdc(0.6),
      linearToFdc(0.5), linearToFdc(0.5), linearToFdc(0.5),
      linearToFdc(0.8), linearToFdc(0.1), linearToFdc(0.3),
    ]),
    shDegree: 1,
    sh: new Float32Array(Array.from({ length: 27 }, (_, i) => i / 27)),
  };
}

describe('applyOpsToGsplatData', () => {
  it('returns the input unchanged for an empty log', () => {
    const data = makeData();
    expect(applyOpsToGsplatData(data, [])).toBe(data);
  });

  it('drops erased splats and keeps the rest with their sh rows', () => {
    const data = makeData();
    const out = applyOpsToGsplatData(data, [
      { kind: 'eraseSphere', center: [1, 0, 0], radius: 0.5 },
    ]);
    expect(out.count).toBe(2);
    expect([...out.positions]).toEqual([0, 0, 0, 2, 0, 0]);
    expect([...out.scales]).toEqual([-5, -5, -5, -3, -3, -3]);
    expect([...out.rotations]).toEqual([1, 0, 0, 0, 0, 1, 0, 0]);
    expect([...out.opacities]).toEqual([2, -2]);
    // sh rows 0 and 2 survive.
    expect([...out.sh!]).toEqual([
      ...[...data.sh!.slice(0, 9)],
      ...[...data.sh!.slice(18, 27)],
    ]);
  });

  it('composites tints into the DC color as a single mix', () => {
    const data = makeData();
    const out = applyOpsToGsplatData(data, [
      { kind: 'tintSphere', center: [1, 0, 0], radius: 0.2, color: [1, 0, 0], strength: 0.5 },
    ]);
    expect(out.count).toBe(3);
    // Splat 1 (base 0.5 gray) tinted halfway to red.
    expect(fdcToLinear(out.colors[3])).toBeCloseTo(0.75, 6);
    expect(fdcToLinear(out.colors[4])).toBeCloseTo(0.25, 6);
    expect(fdcToLinear(out.colors[5])).toBeCloseTo(0.25, 6);
    // Others untouched.
    expect(fdcToLinear(out.colors[0])).toBeCloseTo(0.2, 6);
    expect(fdcToLinear(out.colors[8])).toBeCloseTo(0.3, 6);
  });
});

describe('applyOpsToPoints', () => {
  const points = [
    { x: 0, y: 0, z: 0, size: 0.1, r: 0.2, g: 0.4, b: 0.6, a: 1 },
    { x: 1, y: 0, z: 0, size: 0.1, r: 0.5, g: 0.5, b: 0.5, a: 1 },
    { x: 2, y: 0, z: 0, size: 0.1, r: 0.8, g: 0.1, b: 0.3, a: 1 },
  ];

  it('drops erased points and tints the rest', () => {
    const out = applyOpsToPoints(points, [
      { kind: 'eraseSphere', center: [0, 0, 0], radius: 0.5 },
      { kind: 'tintSphere', center: [1, 0, 0], radius: 0.2, color: [1, 0, 0], strength: 0.5 },
    ]);
    expect(out.length).toBe(2);
    expect(out[0].r).toBeCloseTo(0.75, 6);
    expect(out[0].g).toBeCloseTo(0.25, 6);
    expect(out[1]).toEqual(points[2]);
  });
});

describe('shouldCoalesceOps', () => {
  it('coalesces near-identical sphere strokes only', () => {
    const a: SplatEditOp = { kind: 'eraseSphere', center: [0, 0, 0], radius: 0.2 };
    expect(shouldCoalesceOps(a, { kind: 'eraseSphere', center: [0.01, 0, 0], radius: 0.2 })).toBe(true);
    expect(shouldCoalesceOps(a, { kind: 'eraseSphere', center: [0.1, 0, 0], radius: 0.2 })).toBe(false);
    expect(shouldCoalesceOps(a, { kind: 'eraseSphere', center: [0.01, 0, 0], radius: 0.3 })).toBe(false);
    expect(shouldCoalesceOps(a, { kind: 'tintSphere', center: [0.01, 0, 0], radius: 0.2, color: [1, 0, 0], strength: 1 })).toBe(false);
  });

  it('never coalesces tints with different color or strength', () => {
    const a: SplatEditOp = { kind: 'tintSphere', center: [0, 0, 0], radius: 0.2, color: [1, 0, 0], strength: 0.5 };
    expect(shouldCoalesceOps(a, { ...a, center: [0.01, 0, 0] })).toBe(true);
    expect(shouldCoalesceOps(a, { ...a, center: [0.01, 0, 0], strength: 0.6 })).toBe(false);
    expect(shouldCoalesceOps(a, { ...a, center: [0.01, 0, 0], color: [0, 1, 0] })).toBe(false);
  });
});

describe('sanitizeEditOps', () => {
  it('keeps well-formed ops and drops malformed ones', () => {
    const ops = sanitizeEditOps([
      { kind: 'eraseSphere', center: [0, 1, 2], radius: 0.5 },
      { kind: 'eraseSphere', center: [0, 1], radius: 0.5 }, // bad center
      { kind: 'eraseSphere', center: [0, 1, 2], radius: -1 }, // bad radius
      { kind: 'crop', min: [0, 0, 0], max: [1, 1, 1] },
      { kind: 'tintSphere', center: [0, 0, 0], radius: 0.1, color: [1, 0, 0], strength: 2 },
      { kind: 'meltdown', center: [0, 0, 0] }, // unknown kind
      null,
      'nope',
    ]);
    expect(ops).toEqual([
      { kind: 'eraseSphere', center: [0, 1, 2], radius: 0.5 },
      { kind: 'crop', min: [0, 0, 0], max: [1, 1, 1] },
      // strength clamped into 0..1
      { kind: 'tintSphere', center: [0, 0, 0], radius: 0.1, color: [1, 0, 0], strength: 1 },
    ]);
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizeEditOps(undefined)).toEqual([]);
    expect(sanitizeEditOps({})).toEqual([]);
  });
});

describe('plyReimportEuler', () => {
  it('composes the live rotation with the exporter Z-flip', () => {
    expect(plyReimportEuler([0, 0, 0])).toEqual([0, 0, 180]);
    // Yaw sign inverts under conjugation by Rz(180°).
    expect(plyReimportEuler([0, 37, 0])).toEqual([0, -37, 180]);
  });
});

describe('flipEditOpsZ180', () => {
  const ops: SplatEditOp[] = [
    { kind: 'eraseSphere', center: [1, 2, 3], radius: 0.5 },
    { kind: 'tintSphere', center: [-1, 0.5, 2], radius: 0.2, color: [1, 0, 0], strength: 0.5 },
    { kind: 'eraseBox', min: [-1, -2, -3], max: [4, 5, 6] },
  ];

  it('negates x/y and keeps boxes well-ordered', () => {
    const flipped = flipEditOpsZ180(ops);
    expect(flipped[0]).toEqual({ kind: 'eraseSphere', center: [-1, -2, 3], radius: 0.5 });
    expect(flipped[1]).toMatchObject({ center: [1, -0.5, 2] });
    expect(flipped[2]).toEqual({ kind: 'eraseBox', min: [-4, -5, -3], max: [1, 2, 6] });
  });

  it('is an involution', () => {
    expect(flipEditOpsZ180(flipEditOpsZ180(ops))).toEqual(ops);
  });

  it('erases the same splats after data and ops are both flipped', () => {
    // Data flipped like the exporter does: (x, y, z) → (−x, −y, z).
    const flippedPositions = new Float32Array([0, 0, 0, -1, 0, 0, -2, 0, 0]);
    const op: SplatEditOp = { kind: 'eraseSphere', center: [1, 0, 0], radius: 0.5 };
    const before = computeEditState(positions, 3, [op]);
    const after = computeEditState(flippedPositions, 3, flipEditOpsZ180([op]));
    expect([...after.visible]).toEqual([...before.visible]);
  });
});
