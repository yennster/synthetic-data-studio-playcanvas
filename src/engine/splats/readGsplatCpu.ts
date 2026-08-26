import { Quat, Vec3, Vec4 } from 'playcanvas';
import { linearToFdc, logit, type GsplatData } from '../../lib/gsplatData';

/**
 * Reads decoded per-splat attributes back from a loaded gsplat resource's
 * CPU-side data (`resource.gsplatData`) into the app's renderer-agnostic
 * GsplatData struct. Works for every import format the engine parses —
 * plain .ply, .compressed.ply, and .sog — via the shared SplatIterator
 * interface each data class implements.
 *
 * Convention note: the plain-.ply iterator returns LINEAR (exp'd) scales
 * while the compressed/sog iterators return the stored LOG scales (their
 * GPU paths apply exp() in the shader). Plain data is identified by its
 * `elements` PLY table and re-logged so the output is uniformly
 * log-encoded, matching the .ply conventions of GsplatData.
 *
 * Higher-order SH is not read back — a destructively exported .ply keeps
 * DC color only (callers should surface that).
 */
export function readGsplatCpu(gsplatData: unknown): GsplatData | null {
  const src = gsplatData as
    | {
        numSplats?: number;
        elements?: unknown;
        createIter?: (p: Vec3, r: Quat, s: Vec3, c: Vec4) => { read(i: number): void };
      }
    | null
    | undefined;
  if (!src || typeof src.createIter !== 'function' || !src.numSplats) return null;

  const n = src.numSplats;
  const isPlainPly = Array.isArray(src.elements);
  const p = new Vec3();
  const r = new Quat();
  const s = new Vec3();
  const c = new Vec4();

  const positions = new Float32Array(n * 3);
  const scales = new Float32Array(n * 3);
  const rotations = new Float32Array(n * 4);
  const opacities = new Float32Array(n);
  const colors = new Float32Array(n * 3);

  const logScale = (v: number) => (isPlainPly ? Math.log(Math.max(1e-12, v)) : v);

  try {
    const iter = src.createIter(p, r, s, c);
    for (let i = 0; i < n; i++) {
      iter.read(i);
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      scales[i * 3] = logScale(s.x);
      scales[i * 3 + 1] = logScale(s.y);
      scales[i * 3 + 2] = logScale(s.z);
      rotations[i * 4] = r.w; // .ply rot_0 is w
      rotations[i * 4 + 1] = r.x;
      rotations[i * 4 + 2] = r.y;
      rotations[i * 4 + 3] = r.z;
      colors[i * 3] = linearToFdc(c.x);
      colors[i * 3 + 1] = linearToFdc(c.y);
      colors[i * 3 + 2] = linearToFdc(c.z);
      opacities[i] = logit(c.w);
    }
  } catch (err) {
    console.warn('gsplat CPU readback failed', err);
    return null;
  }

  return { count: n, positions, scales, rotations, opacities, colors, shDegree: 0 };
}
