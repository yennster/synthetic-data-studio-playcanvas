/**
 * Renderer-agnostic struct-of-arrays for full 3D Gaussian Splatting data,
 * in the standard 3DGS .ply conventions (positions in the file's own
 * coordinate space, log scales, logit opacities, f_dc SH colors). Shared
 * by the .spz transcoder, the .ply attribute parser, and the destructive
 * edit applier.
 */

/** Zeroth-order spherical-harmonic basis constant used by 3DGS colors. */
export const SH_C0 = 0.28209479177387814;

/** Number of higher-order SH coefficients (per channel) for a degree. */
export function shBandsForDegree(degree: number): number {
  switch (degree) {
    case 0: return 0;
    case 1: return 3;
    case 2: return 8;
    case 3: return 15;
    default: throw new Error(`Unsupported SH degree ${degree}`);
  }
}

/** Inverse of shBandsForDegree; -1 when the count matches no degree. */
export function shDegreeForBands(bands: number): number {
  switch (bands) {
    case 0: return 0;
    case 3: return 1;
    case 8: return 2;
    case 15: return 3;
    default: return -1;
  }
}

export interface GsplatData {
  count: number;
  /** xyz per splat, in the 3DGS .ply coordinate space (Y-down). */
  positions: Float32Array; // 3N
  /** Log-encoded per-axis scales (scale_0..2). */
  scales: Float32Array; // 3N
  /** Quaternions, w-first (rot_0..3 = w, x, y, z). */
  rotations: Float32Array; // 4N
  /** Logit-encoded opacities. */
  opacities: Float32Array; // N
  /** DC SH color coefficients (f_dc_0..2). */
  colors: Float32Array; // 3N
  /** SH degree of `sh` (0 when absent). */
  shDegree: number;
  /** Higher-order SH in the .ply f_rest layout: per splat, channel-major
   * `[c * bands + j]` — matching f_rest_0..(3*bands-1). */
  sh?: Float32Array; // 3 * bands * N
}

/** Convenience: linear 0..1 color from an f_dc coefficient. */
export function fdcToLinear(fdc: number): number {
  return 0.5 + SH_C0 * fdc;
}

/** Convenience: f_dc coefficient from a linear 0..1 color. */
export function linearToFdc(color: number): number {
  return (color - 0.5) / SH_C0;
}

/** Logit with the same clamping the 3DGS exporters use. */
export function logit(a: number): number {
  const clamped = Math.min(0.9999, Math.max(0.0001, a));
  return Math.log(clamped / (1 - clamped));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
