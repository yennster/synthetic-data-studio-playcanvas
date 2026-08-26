import type { SplatPoint } from './splatCreate';
import { shBandsForDegree, type GsplatData } from '../../lib/gsplatData';

/** Zeroth-order spherical-harmonic basis constant used by 3DGS colors. */
const SH_C0 = 0.28209479177387814;

/**
 * Serializes full GsplatData (already in the 3DGS .ply conventions — see
 * lib/gsplatData.ts) to a binary little-endian .ply VERBATIM: no
 * coordinate flips, so data read from an imported file round-trips into
 * an identical file. Used by the .spz transcoder and the destructive
 * "export edited" path. Higher-order SH is written as f_rest_* when
 * present.
 */
export function gsplatDataToPly(data: GsplatData): Blob {
  const bands = data.sh ? shBandsForDegree(data.shDegree) : 0;
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  for (let i = 0; i < bands * 3; i++) props.push(`f_rest_${i}`);
  props.push(
    'opacity',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3'
  );
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    `element vertex ${data.count}\n` +
    props.map((p) => `property float ${p}`).join('\n') +
    '\nend_header\n';

  const headerBytes = new TextEncoder().encode(header);
  const stride = props.length;
  const body = new Float32Array(data.count * stride);
  for (let i = 0; i < data.count; i++) {
    let o = i * stride;
    body[o++] = data.positions[i * 3];
    body[o++] = data.positions[i * 3 + 1];
    body[o++] = data.positions[i * 3 + 2];
    body[o++] = data.colors[i * 3];
    body[o++] = data.colors[i * 3 + 1];
    body[o++] = data.colors[i * 3 + 2];
    if (data.sh) {
      for (let j = 0; j < bands * 3; j++) body[o++] = data.sh[i * bands * 3 + j];
    }
    body[o++] = data.opacities[i];
    body[o++] = data.scales[i * 3];
    body[o++] = data.scales[i * 3 + 1];
    body[o++] = data.scales[i * 3 + 2];
    body[o++] = data.rotations[i * 4];
    body[o++] = data.rotations[i * 4 + 1];
    body[o++] = data.rotations[i * 4 + 2];
    body[o++] = data.rotations[i * 4 + 3];
  }
  // Float32Array is little-endian on every platform this app targets.
  return new Blob([headerBytes, body], { type: 'application/octet-stream' });
}

/**
 * Serializes in-app-created splat points to a standard 3D Gaussian
 * Splatting PLY (binary little-endian) that SuperSplat, the PlayCanvas
 * engine, and other 3DGS tools load directly.
 *
 * Mapping from our simple isotropic format: f_dc = (color - 0.5) / SH_C0,
 * opacity = logit(alpha), scale_* = ln(size / 2) (isotropic sigma),
 * rot = identity quaternion (w, x, y, z).
 *
 * Orientation: 3DGS PLYs are conventionally Y-down; importers (ours
 * included) apply a 180° Z rotation on load. Positions are therefore
 * written as (−x, −y, z) — the same involution — so exports round-trip
 * through our importer and open upright in SuperSplat and friends.
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
    write(-p.x);
    write(-p.y);
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
