import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATERIAL_OVERRIDE,
  mergeMaterialOverride,
  roughnessToGloss,
} from './materialOverride';

describe('DEFAULT_MATERIAL_OVERRIDE', () => {
  it('matches the original card defaults', () => {
    expect(DEFAULT_MATERIAL_OVERRIDE).toEqual({
      enabled: false,
      color: '#a78bfa',
      roughness: 0.5,
      metalness: 0.1,
    });
  });
});

describe('mergeMaterialOverride', () => {
  it('merges partial patches over the previous value', () => {
    const next = mergeMaterialOverride(DEFAULT_MATERIAL_OVERRIDE, {
      enabled: true,
      color: '#FF8800',
    });
    expect(next.enabled).toBe(true);
    expect(next.color).toBe('#ff8800');
    expect(next.roughness).toBe(0.5);
    expect(next.metalness).toBe(0.1);
  });

  it('clamps roughness and metalness into [0, 1]', () => {
    const next = mergeMaterialOverride(DEFAULT_MATERIAL_OVERRIDE, {
      roughness: 1.7,
      metalness: -0.3,
    });
    expect(next.roughness).toBe(1);
    expect(next.metalness).toBe(0);
  });

  it('rejects malformed colors and keeps the previous one', () => {
    for (const bad of ['a78bfa', '#a78bf', '#gggggg', '', 'red']) {
      const next = mergeMaterialOverride(DEFAULT_MATERIAL_OVERRIDE, {
        color: bad,
      });
      expect(next.color).toBe('#a78bfa');
    }
  });

  it('does not mutate the previous value', () => {
    const prev = { ...DEFAULT_MATERIAL_OVERRIDE };
    mergeMaterialOverride(prev, { enabled: true, roughness: 0.9 });
    expect(prev).toEqual(DEFAULT_MATERIAL_OVERRIDE);
  });
});

describe('roughnessToGloss', () => {
  it('inverts roughness', () => {
    expect(roughnessToGloss(0)).toBe(1);
    expect(roughnessToGloss(0.3)).toBeCloseTo(0.7, 10);
    expect(roughnessToGloss(1)).toBe(0);
  });

  it('clamps out-of-range inputs', () => {
    expect(roughnessToGloss(-1)).toBe(1);
    expect(roughnessToGloss(2)).toBe(0);
  });
});
