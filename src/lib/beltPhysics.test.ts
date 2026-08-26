import { describe, expect, it } from 'vitest';
import {
  BELT_LENGTH,
  BELT_TOP_Y,
  BELT_WIDTH,
  beltTextureOffsetDelta,
  isOnBelt,
  visualScrollDistance,
} from './beltPhysics';

describe('isOnBelt', () => {
  it('returns true for a body sitting on the belt centre', () => {
    expect(isOnBelt({ x: 0, y: BELT_TOP_Y + 0.1, z: 0 })).toBe(true);
  });

  it('returns true for a body resting just above the belt surface', () => {
    expect(isOnBelt({ x: 0.5, y: BELT_TOP_Y + 0.01, z: 1 })).toBe(true);
  });

  it('returns false for a body below the belt surface', () => {
    // Slightly below the lower bound of the on-belt band.
    expect(isOnBelt({ x: 0, y: BELT_TOP_Y - 0.5, z: 0 })).toBe(false);
  });

  it('returns false for a body high above the belt', () => {
    expect(isOnBelt({ x: 0, y: BELT_TOP_Y + 5, z: 0 })).toBe(false);
  });

  it('returns false for a body outside the belt X footprint', () => {
    expect(isOnBelt({ x: BELT_WIDTH / 2 + 0.5, y: BELT_TOP_Y + 0.1, z: 0 })).toBe(
      false
    );
  });

  it('returns false for a body past the belt Z extent', () => {
    expect(isOnBelt({ x: 0, y: BELT_TOP_Y + 0.1, z: BELT_LENGTH / 2 + 0.5 })).toBe(
      false
    );
  });
});

/**
 * Regression coverage for the original's "stripes scroll faster than the
 * bodies" bug. The fix scales the per-frame UV-offset advance by
 * `repeat / length` so the visible texture motion (m/s of world) matches
 * whatever the rigid bodies on top are doing.
 */
describe('beltTextureOffsetDelta / visualScrollDistance', () => {
  /** Defaults that match the live conveyor (BELT_TEXTURE_REPEAT / BELT_LENGTH). */
  const REPEAT = 6;
  const LENGTH = BELT_LENGTH; // 8m

  it('round-trips: stripes travel exactly `speed * dt` in world space', () => {
    for (const speed of [-2, -0.5, 0, 0.5, 1, 1.5, 2]) {
      for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1, 1.0]) {
        const offset = beltTextureOffsetDelta(speed, dt, REPEAT, LENGTH);
        const scrolled = visualScrollDistance(offset, REPEAT, LENGTH);
        expect(scrolled).toBeCloseTo(speed * dt, 9);
      }
    }
  });

  it('does not regress to the unscaled formula', () => {
    // Pre-fix code did `offset += speed * dt`, which overshot the actual
    // body distance by `length / repeat` (≈1.33 for the live config).
    const speed = 1;
    const dt = 1 / 60;
    expect(beltTextureOffsetDelta(speed, dt, REPEAT, LENGTH)).not.toBeCloseTo(
      speed * dt,
      6
    );
    // Exact value at the live config so a refactor can't shift the ratio.
    expect(beltTextureOffsetDelta(1, 1, REPEAT, LENGTH)).toBeCloseTo(
      REPEAT / LENGTH,
      9
    );
  });

  it('flips sign with belt speed', () => {
    expect(beltTextureOffsetDelta(-1, 0.1, REPEAT, LENGTH)).toBeLessThan(0);
    expect(beltTextureOffsetDelta(0, 0.1, REPEAT, LENGTH)).toBe(0);
  });

  it('handles arbitrary repeat / length without breaking the invariant', () => {
    for (const repeat of [1, 3, 6, 12]) {
      for (const length of [2, 8, 20]) {
        const offset = beltTextureOffsetDelta(1.5, 0.05, repeat, length);
        const scrolled = visualScrollDistance(offset, repeat, length);
        expect(scrolled).toBeCloseTo(1.5 * 0.05, 9);
      }
    }
  });
});
