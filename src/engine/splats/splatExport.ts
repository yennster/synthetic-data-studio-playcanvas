import type { SplatPoint } from './splatCreate';

/** Zeroth-order spherical-harmonic basis constant used by 3DGS colors. */
const SH_C0 = 0.28209479177387814;

/**
 * Serializes in-app-created splat points to a standard 3D Gaussian
 * Splatting PLY (binary little-endian) that SuperSplat, the PlayCanvas
 * engine, and other 3DGS tools load directly.
 *
 * Mapping from our simple isotropic format: f_dc = (color - 0.5) / SH_C0,
 * opacity = logit(alpha), scale_* = ln(size / 2) (isotropic sigma),
 * rot = identity quaternion (w, x, y, z).
 */
export function pointsToPly(points: SplatPoint[]): Blob {
  const props = [
    'x',
    'y',
    'z',
    'f_dc_0',
    'f_dc_1',
    'f_dc_2',
    'opacity',
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
  ];
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    `element vertex ${points.length}\n` +
    props.map((p) => `property float ${p}`).join('\n') +
    '\nend_header\n';

  const headerBytes = new TextEncoder().encode(header);
  const body = new ArrayBuffer(points.length * props.length * 4);
  const view = new DataView(body);

  const logit = (a: number) => {
    const clamped = Math.min(0.9999, Math.max(0.0001, a));
    return Math.log(clamped / (1 - clamped));
  };

  let offset = 0;
  const write = (v: number) => {
    view.setFloat32(offset, v, true);
    offset += 4;
  };

  for (const p of points) {
    write(p.x);
    write(p.y);
    write(p.z);
    write((p.r - 0.5) / SH_C0);
    write((p.g - 0.5) / SH_C0);
    write((p.b - 0.5) / SH_C0);
    write(logit(p.a));
    const sigma = Math.log(Math.max(1e-6, p.size / 2));
    write(sigma);
    write(sigma);
    write(sigma);
    write(1); // rot w
    write(0);
    write(0);
    write(0);
  }

  return new Blob([headerBytes, body], { type: 'application/octet-stream' });
}
