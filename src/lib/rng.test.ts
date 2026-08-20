import { afterEach, describe, expect, it } from 'vitest';
import { _resetRngForTest, getRng, isSeeded, mulberry32, rng } from './rng';

afterEach(() => _resetRngForTest());

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('produces uniform values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('locks the reference sequence for seed 1', () => {
    // Regression pin: same constants as the original app's mulberry32.
    const r = mulberry32(1);
    expect(r()).toBeCloseTo(0.6270739405881613, 12);
  });
});

describe('rng singleton', () => {
  it('falls back to Math.random when unseeded', () => {
    _resetRngForTest();
    expect(isSeeded()).toBe(false);
    const v = rng();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('can be pinned for tests', () => {
    _resetRngForTest(mulberry32(42));
    expect(getRng()()).toBe(mulberry32(42)());
  });
});
