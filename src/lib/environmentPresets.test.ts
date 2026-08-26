import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FLOOR_TILE,
  ENVIRONMENT_OPTION_GROUPS,
  floorStyleFor,
  isScenePreset,
  migrateLegacySkybox,
  type EnvironmentPreset,
} from './environmentPresets';

describe('isScenePreset', () => {
  it('is true for the four ported scene presets only', () => {
    for (const p of ['studio', 'warehouse', 'whitebox', 'outdoor'] as const) {
      expect(isScenePreset(p)).toBe(true);
    }
    for (const p of ['none', 'day', 'sunset', 'overcast', 'night'] as const) {
      expect(isScenePreset(p)).toBe(false);
    }
  });
});

describe('floorStyleFor', () => {
  it('matches the original flat floor colors/roughness', () => {
    expect(floorStyleFor('studio')).toEqual({
      kind: 'flat',
      color: '#1c2128',
      roughness: 0.95,
    });
    expect(floorStyleFor('whitebox')).toEqual({
      kind: 'flat',
      color: '#f1f1ee',
      roughness: 0.6,
    });
  });

  it('matches the original procedural floor repeats', () => {
    expect(floorStyleFor('warehouse')).toEqual({ kind: 'concrete', repeat: 12 });
    expect(floorStyleFor('outdoor')).toEqual({ kind: 'grass', repeat: 20 });
  });

  it('has no ground opinion for none / sky-only presets', () => {
    for (const p of ['none', 'day', 'sunset', 'overcast', 'night'] as const) {
      expect(floorStyleFor(p)).toBeNull();
    }
  });
});

describe('ENVIRONMENT_OPTION_GROUPS', () => {
  it('covers every preset exactly once, grouped scene-first', () => {
    expect(ENVIRONMENT_OPTION_GROUPS.map((g) => g.group)).toEqual([
      'Scene presets',
      'Sky only',
    ]);
    const values = ENVIRONMENT_OPTION_GROUPS.flatMap((g) =>
      g.options.map((o) => o.value)
    );
    expect(values).toEqual([
      'studio',
      'warehouse',
      'whitebox',
      'outdoor',
      'day',
      'sunset',
      'overcast',
      'night',
    ]);
    expect(new Set(values).size).toBe(values.length);
    // 'none' is the select's standalone first option, not a group member.
    expect(values).not.toContain('none');
  });

  it('agrees with floorStyleFor about which group drives the ground', () => {
    for (const g of ENVIRONMENT_OPTION_GROUPS) {
      for (const o of g.options) {
        const drivesGround = floorStyleFor(o.value) !== null;
        expect(drivesGround).toBe(g.group === 'Scene presets');
      }
    }
  });
});

describe('migrateLegacySkybox', () => {
  it('adopts a legacy sky value when envPreset is still default', () => {
    expect(migrateLegacySkybox('none', 'day')).toBe('day');
    expect(migrateLegacySkybox('none', 'night')).toBe('night');
  });

  it('does nothing when envPreset was already chosen', () => {
    const chosen: EnvironmentPreset[] = ['studio', 'day', 'outdoor'];
    for (const p of chosen) expect(migrateLegacySkybox(p, 'sunset')).toBeNull();
  });

  it('does nothing for legacy none or junk values', () => {
    expect(migrateLegacySkybox('none', 'none')).toBeNull();
    expect(migrateLegacySkybox('none', 'purple-haze')).toBeNull();
    expect(migrateLegacySkybox('none', '')).toBeNull();
  });
});

describe('CUSTOM_FLOOR_TILE', () => {
  it('tiles custom floors 4x like the original', () => {
    expect(CUSTOM_FLOOR_TILE).toBe(4);
  });
});
