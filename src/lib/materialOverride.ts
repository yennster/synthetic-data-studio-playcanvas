/**
 * Pure settings model for the per-asset material override — the
 * original's "Override material (use if it's pink)" rescue for imports
 * whose materials don't translate (Omniverse MDL USDZs rendered flat
 * magenta; GLBs with broken/extensioned materials do the same here).
 *
 * The engine side (ModelManager.setMaterialOverride) swaps every mesh
 * instance's material for one StandardMaterial built from these values
 * and restores the cached originals when disabled; this module owns the
 * defaults, clamping, and the roughness→gloss mapping so that logic is
 * unit-testable without PlayCanvas.
 */

export interface MaterialOverride {
  enabled: boolean;
  /** #rrggbb hex. */
  color: string;
  roughness: number;
  metalness: number;
}

/** Original defaults: violet rescue color, roughness 0.5, metalness 0.1. */
export const DEFAULT_MATERIAL_OVERRIDE: MaterialOverride = {
  enabled: false,
  color: '#a78bfa',
  roughness: 0.5,
  metalness: 0.1,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Merge a patch over the previous override, clamping sliders to [0, 1]
 * and rejecting malformed colors (keeps the previous color — a color
 * input should never be able to wedge an invalid value into
 * persistence).
 */
export function mergeMaterialOverride(
  prev: MaterialOverride,
  patch: Partial<MaterialOverride>,
): MaterialOverride {
  return {
    enabled: patch.enabled ?? prev.enabled,
    color:
      patch.color !== undefined && HEX_COLOR.test(patch.color)
        ? patch.color.toLowerCase()
        : prev.color,
    roughness:
      patch.roughness !== undefined ? clamp01(patch.roughness) : prev.roughness,
    metalness:
      patch.metalness !== undefined ? clamp01(patch.metalness) : prev.metalness,
  };
}

/** PlayCanvas StandardMaterial gloss is inverse roughness. */
export function roughnessToGloss(roughness: number): number {
  return clamp01(1 - roughness);
}
