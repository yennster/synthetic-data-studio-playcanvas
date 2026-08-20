import { describe, expect, it } from 'vitest';
import { pointsToPly } from './splatExport';
import type { SplatPoint } from './splatCreate';

const SH_C0 = 0.28209479177387814;

describe('pointsToPly', () => {
  const points: SplatPoint[] = [
    { x: 1, y: 2, z: 3, size: 0.1, r: 1, g: 0.5, b: 0, a: 1 },
    { x: -1, y: 0, z: 0.5, size: 0.02, r: 0, g: 0, b: 0, a: 0.5 },
  ];

  it('writes a binary_little_endian 3DGS header', async () => {
    const blob = pointsToPly(points);
    const text = await blob.text();
    expect(text.startsWith('ply\nformat binary_little_endian 1.0\n')).toBe(true);
    expect(text).toContain('element vertex 2');
    for (const p of ['f_dc_0', 'opacity', 'scale_0', 'rot_3']) {
      expect(text).toContain(`property float ${p}`);
    }
  });

  it('encodes positions and colors per the 3DGS conventions', async () => {
    const blob = pointsToPly(points);
    const buf = await blob.arrayBuffer();
    const headerLen = new TextDecoder()
      .decode(new Uint8Array(buf))
      .indexOf('end_header\n') + 'end_header\n'.length;
    const view = new DataView(buf, headerLen);

    // First point: x, y, z
    expect(view.getFloat32(0, true)).toBeCloseTo(1);
    expect(view.getFloat32(4, true)).toBeCloseTo(2);
    expect(view.getFloat32(8, true)).toBeCloseTo(3);
    // f_dc_0 for r=1: (1 - 0.5) / SH_C0
    expect(view.getFloat32(12, true)).toBeCloseTo(0.5 / SH_C0, 4);
    // scale_0 = ln(size/2)
    expect(view.getFloat32(28, true)).toBeCloseTo(Math.log(0.05), 4);
    // rot = identity (w=1 first)
    expect(view.getFloat32(40, true)).toBeCloseTo(1);
    expect(view.getFloat32(44, true)).toBeCloseTo(0);
  });

  it('sizes the body as 14 floats per point', async () => {
    const blob = pointsToPly(points);
    const buf = await blob.arrayBuffer();
    const text = new TextDecoder().decode(new Uint8Array(buf));
    const headerLen = text.indexOf('end_header\n') + 'end_header\n'.length;
    expect(buf.byteLength - headerLen).toBe(2 * 14 * 4);
  });
});
