/**
 * Environment preset model — pure data + logic, renderer-agnostic.
 *
 * The Scene card exposes a single "Environment" select mixing two
 * families:
 *
 *   - **Scene presets** (studio/warehouse/whitebox/outdoor, ported from
 *     the original app) drive the sky panorama AND the ground material
 *     together.
 *   - **Sky-only presets** (day/sunset/overcast/night, native to this
 *     rebuild) change just the panorama; the ground stays theme-driven.
 *
 * `'none'` keeps today's default: no sky, theme-colored ground. The
 * engine-side canvas painting lives in SkyboxManager / sceneEnvironment;
 * this module only says *what* each preset means so it can be unit
 * tested without a GPU.
 */

import type { EnvPreset } from './urlParams';

/** Sky-only panoramas (no ground opinion). */
export type SkyPreset = 'day' | 'sunset' | 'overcast' | 'night';

/** Everything the Environment select can hold. */
export type EnvironmentPreset = 'none' | SkyPreset | EnvPreset;

/** Metadata for a user-uploaded floor/wall texture; bytes live in IndexedDB. */
export interface CustomTextureMeta {
  name: string;
}

/** Tile count for a custom floor image across the ground (original: 4×). */
export const CUSTOM_FLOOR_TILE = 4;

/**
 * What a preset wants the ground to look like. `null` = no opinion
 * (theme/user color stays in charge). Procedural texture kinds are
 * painted engine-side; `repeat` is the tile count across the ground.
 */
export type FloorStyle =
  | { kind: 'flat'; color: string; roughness: number }
  | { kind: 'concrete'; repeat: number }
  | { kind: 'grass'; repeat: number };

const SCENE_PRESETS: ReadonlySet<EnvironmentPreset> = new Set<EnvironmentPreset>([
  'studio',
  'warehouse',
  'whitebox',
  'outdoor',
]);

/** True for presets that drive ground + sky together. */
export function isScenePreset(preset: EnvironmentPreset): preset is EnvPreset {
  return SCENE_PRESETS.has(preset);
}

/** Ground material for a preset; `null` = keep the theme-driven color. */
export function floorStyleFor(preset: EnvironmentPreset): FloorStyle | null {
  switch (preset) {
    // Flat colors/roughness match the original's presetFlatFloorColor /
    // presetFlatFloorRoughness; repeats match its procedural floors.
    case 'studio':
      return { kind: 'flat', color: '#1c2128', roughness: 0.95 };
    case 'whitebox':
      return { kind: 'flat', color: '#f1f1ee', roughness: 0.6 };
    case 'warehouse':
      return { kind: 'concrete', repeat: 12 };
    case 'outdoor':
      return { kind: 'grass', repeat: 20 };
    default:
      return null;
  }
}

/** Grouped options for the Scene card's Environment select. */
export const ENVIRONMENT_OPTION_GROUPS: {
  group: string;
  options: { value: EnvironmentPreset; label: string }[];
}[] = [
  {
    group: 'Scene presets',
    options: [
      { value: 'studio', label: 'Studio (dark backdrop)' },
      { value: 'warehouse', label: 'Warehouse (concrete + walls)' },
      { value: 'whitebox', label: 'White box (cyclorama)' },
      { value: 'outdoor', label: 'Outdoor (grass + sky)' },
    ],
  },
  {
    group: 'Sky only',
    options: [
      { value: 'day', label: 'Day (blue sky)' },
      { value: 'sunset', label: 'Sunset' },
      { value: 'overcast', label: 'Overcast' },
      { value: 'night', label: 'Night' },
    ],
  },
];

/**
 * One-time migration for stores persisted before `envPreset` existed:
 * those saved the sky under a separate `skybox` field. Returns the
 * preset to adopt, or `null` when nothing needs migrating (envPreset
 * already chosen, or the legacy field was 'none' anyway).
 */
export function migrateLegacySkybox(
  envPreset: EnvironmentPreset,
  legacySkybox: string
): EnvironmentPreset | null {
  if (envPreset !== 'none') return null;
  if (legacySkybox === 'none') return null;
  const sky: ReadonlySet<string> = new Set(['day', 'sunset', 'overcast', 'night']);
  return sky.has(legacySkybox) ? (legacySkybox as SkyPreset) : null;
}
