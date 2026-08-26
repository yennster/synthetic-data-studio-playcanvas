import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';
import { BELT_TOP_Y } from './beltPhysics';
import {
  SETTLE_SPEED_THRESHOLD,
  bodySettled,
  colliderSpecForKind,
  jitterDropPosition,
  restHalfHeight,
  sampleBeltDropPosition,
  sampleDropRotation,
} from './physicsSpec';
import type { ObjectKind } from '../store/useStore';

describe('colliderSpecForKind', () => {
  it('maps cube and phone to cuboids matching the render dims', () => {
    expect(colliderSpecForKind('cube', 1)).toEqual({
      shape: 'cuboid',
      halfExtents: [0.3, 0.3, 0.3],
    });
    expect(colliderSpecForKind('phone', 1)).toEqual({
      shape: 'cuboid',
      halfExtents: [0.25, 0.5, 0.04],
    });
  });

  it('maps sphere to a ball of the render radius', () => {
    expect(colliderSpecForKind('sphere', 1)).toEqual({ shape: 'ball', radius: 0.4 });
  });

  it('maps cylinder and soda_can to cylinders', () => {
    expect(colliderSpecForKind('cylinder', 1)).toEqual({
      shape: 'cylinder',
      halfHeight: 0.35,
      radius: 0.35,
    });
    expect(colliderSpecForKind('soda_can', 1)).toEqual({
      shape: 'cylinder',
      halfHeight: 0.31,
      radius: 0.22,
    });
  });

  it('maps capsule with halfHeight covering the cylindrical part only', () => {
    // Total height 1.2 = 2×0.3 cylinder half + 2×0.3 radius caps.
    expect(colliderSpecForKind('capsule', 1)).toEqual({
      shape: 'capsule',
      halfHeight: 0.3,
      radius: 0.3,
    });
  });

  it('approximates torus with a flat cylinder of the outer radius', () => {
    expect(colliderSpecForKind('torus', 1)).toEqual({
      shape: 'cylinder',
      halfHeight: 0.188,
      radius: 0.47,
    });
  });

  it('scales every dimension linearly', () => {
    const spec = colliderSpecForKind('cube', 2.5);
    expect(spec).toEqual({ shape: 'cuboid', halfExtents: [0.75, 0.75, 0.75] });
    const can = colliderSpecForKind('soda_can', 0.5);
    expect(can).toEqual({ shape: 'cylinder', halfHeight: 0.155, radius: 0.11 });
  });

  it('restHalfHeight matches the collider top for every kind', () => {
    // A settled upright body rests at y = restHalfHeight; the collider's
    // vertical half-extent must agree or objects would float / sink.
    const kinds: ObjectKind[] = [
      'cube',
      'sphere',
      'cylinder',
      'torus',
      'capsule',
      'phone',
      'soda_can',
    ];
    for (const kind of kinds) {
      const spec = colliderSpecForKind(kind, 1);
      const half =
        spec.shape === 'cuboid'
          ? spec.halfExtents[1]
          : spec.shape === 'ball'
            ? spec.radius
            : spec.shape === 'capsule'
              ? spec.halfHeight + spec.radius
              : spec.halfHeight;
      expect(half).toBeCloseTo(restHalfHeight(kind, 1), 9);
    }
  });
});

describe('sampleBeltDropPosition', () => {
  it('stays inside the original drop volume: x ±0.6, y 1.6–2.0, z ±3', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = sampleBeltDropPosition(rng);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.6);
      expect(y).toBeGreaterThanOrEqual(1.6);
      expect(y).toBeLessThanOrEqual(2.0);
      expect(Math.abs(z)).toBeLessThanOrEqual(3);
      // Always above the belt so the drop lands on it.
      expect(y).toBeGreaterThan(BELT_TOP_Y);
    }
  });

  it('is deterministic for a given seed and consumes exactly 3 rng values', () => {
    const a = sampleBeltDropPosition(mulberry32(7));
    const b = sampleBeltDropPosition(mulberry32(7));
    expect(a).toEqual(b);
    let calls = 0;
    const counting = () => {
      calls++;
      return 0.5;
    };
    sampleBeltDropPosition(counting);
    expect(calls).toBe(3);
  });
});

describe('jitterDropPosition', () => {
  it('jitters ±0.3 x/z and ±0.1 y around the base', () => {
    const rng = mulberry32(1);
    const base: [number, number, number] = [1, 1, -2];
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = jitterDropPosition(rng, base);
      expect(Math.abs(x - base[0])).toBeLessThanOrEqual(0.3);
      expect(Math.abs(y - base[1])).toBeLessThanOrEqual(0.1);
      expect(Math.abs(z - base[2])).toBeLessThanOrEqual(0.3);
    }
  });

  it('floors y at 0.2', () => {
    const low = jitterDropPosition(() => 0, [0, 0, 0]);
    expect(low[1]).toBe(0.2);
  });
});

describe('sampleDropRotation', () => {
  it('produces three full-turn euler angles, deterministically', () => {
    const rot = sampleDropRotation(mulberry32(3));
    expect(rot).toHaveLength(3);
    for (const a of rot) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
    expect(sampleDropRotation(mulberry32(3))).toEqual(rot);
  });
});

describe('bodySettled', () => {
  const onBelt = { x: 0, y: BELT_TOP_Y + 0.1, z: 0 };
  const onFloor = { x: 3, y: 0.3, z: 3 };
  const midAir = { x: 0, y: 1.5, z: 0 };

  it('slow body on the belt settles in belt mode', () => {
    expect(bodySettled({ speed: 0.1, position: onBelt }, true)).toBe(true);
  });

  it('fast body never settles', () => {
    expect(bodySettled({ speed: SETTLE_SPEED_THRESHOLD + 0.01, position: onBelt }, true)).toBe(
      false
    );
    expect(bodySettled({ speed: 5, position: onFloor }, false)).toBe(false);
  });

  it('slow body that fell off the belt (low y) counts as settled', () => {
    expect(bodySettled({ speed: 0.05, position: onFloor }, true)).toBe(true);
  });

  it('slow mid-air body blocks settling only in belt mode', () => {
    expect(bodySettled({ speed: 0.05, position: midAir }, true)).toBe(false);
    expect(bodySettled({ speed: 0.05, position: midAir }, false)).toBe(true);
  });
});
