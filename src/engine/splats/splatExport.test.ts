import { describe, expect, it } from 'vitest';
import { gsplatDataToPly, pointsToPly } from './splatExport';
import type { SplatPoint } from './splatCreate';
import type { GsplatData } from '../../lib/gsplatData';

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

    // First point: written Y-down (−x, −y, z) per the 3DGS convention so
    // the importer's 180° Z flip round-trips.
    expect(view.getFloat32(0, true)).toBeCloseTo(-1);
    expect(view.getFloat32(4, true)).toBeCloseTo(-2);
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

describe('gsplatDataToPly', () => {
  const data: GsplatData = {
    count: 2,
    positions: new Float32Array([1, 2, 3, -1, 0, 0.5]),
    scales: new Float32Array([-5, -4, -3, -2, -1, 0]),
    rotations: new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0.5, 0.5]),
    opacities: new Float32Array([2, -2]),
    colors: new Float32Array([0.1, 0.2, 0.3, -0.1, -0.2, -0.3]),
    shDegree: 1,
    sh: new Float32Array(Array.from({ length: 18 }, (_, i) => i / 100)),
  };

  async function parse(blob: Blob) {
    const buf = await blob.arrayBuffer();
    const text = new TextDecoder().decode(new Uint8Array(buf));
    const headerEnd = text.indexOf('end_header\n') + 'end_header\n'.length;
    const header = text.slice(0, headerEnd);
    const props = [...header.matchAll(/property float (\S+)/g)].map((m) => m[1]);
    const body = new DataView(buf, headerEnd);
    const read = (vertex: number, prop: string) =>
      body.getFloat32((vertex * props.length + props.indexOf(prop)) * 4, true);
    return { header, props, read };
  }

  it('serializes attributes verbatim (no coordinate flip)', async () => {
    const { header, read } = await parse(gsplatDataToPly(data));
    expect(header).toContain('element vertex 2');
    expect(read(0, 'x')).toBeCloseTo(1, 6);
    expect(read(0, 'y')).toBeCloseTo(2, 6);
    expect(read(0, 'z')).toBeCloseTo(3, 6);
    expect(read(1, 'x')).toBeCloseTo(-1, 6);
    expect(read(0, 'f_dc_1')).toBeCloseTo(0.2, 6);
    expect(read(1, 'opacity')).toBeCloseTo(-2, 6);
    expect(read(1, 'scale_2')).toBeCloseTo(0, 6);
    expect(read(1, 'rot_0')).toBeCloseTo(0.5, 6);
    expect(read(1, 'rot_3')).toBeCloseTo(0.5, 6);
  });

  it('writes f_rest_* channel-major when SH is present', async () => {
    const { props, read } = await parse(gsplatDataToPly(data));
    expect(props.filter((p) => p.startsWith('f_rest_')).length).toBe(9);
    expect(read(0, 'f_rest_0')).toBeCloseTo(0, 6);
    expect(read(0, 'f_rest_8')).toBeCloseTo(0.08, 6);
    expect(read(1, 'f_rest_0')).toBeCloseTo(0.09, 6);
  });

  it('omits f_rest_* when SH is absent', async () => {
    const { props } = await parse(gsplatDataToPly({ ...data, sh: undefined, shDegree: 0 }));
    expect(props.some((p) => p.startsWith('f_rest_'))).toBe(false);
    expect(props.length).toBe(14);
  });
});
