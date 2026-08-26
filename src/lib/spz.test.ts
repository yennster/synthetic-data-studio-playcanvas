import { describe, expect, it } from 'vitest';
import { gunzip, parseSpz, spzToGsplatData, SPZ_MAGIC, type SpzGaussians } from './spz';
import { shBandsForDegree, sigmoid } from './gsplatData';

// node:fs is loaded dynamically (and only used by the optional real-sample
// smoke test) because the app tsconfig deliberately has no node types.
const nodeFs = (await import(/* @vite-ignore */ `${'node:fs'}`)) as {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
};

/** Test-side gzip (CompressionStream is available in Node ≥ 18 and browsers). */
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const writing = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writing;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Minimal SPZ v2 ENCODER (test-only): packs gaussians into the Niantic
 * layout so the parser can be validated by round-trip.
 */
interface EncodeInput {
  positions: number[]; // 3N
  alphas: number[]; // N linear 0..1
  colors: number[]; // 3N f_dc
  scales: number[]; // 3N log-encoded
  rotations: number[]; // 4N quat xyzw, w >= 0
  sh?: number[]; // N * bands * 3, coeff-major
  shDegree?: number;
  fractionalBits?: number;
  flags?: number;
}

function encodeSpz(input: EncodeInput): Uint8Array {
  const n = input.alphas.length;
  const shDegree = input.shDegree ?? 0;
  const fractionalBits = input.fractionalBits ?? 12;
  const bands = shBandsForDegree(shDegree);
  const bytes = new Uint8Array(16 + n * (9 + 1 + 3 + 3 + 3 + bands * 3));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, SPZ_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, n, true);
  view.setUint8(12, shDegree);
  view.setUint8(13, fractionalBits);
  view.setUint8(14, input.flags ?? 0);

  let o = 16;
  const clampByte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  for (let i = 0; i < n * 3; i++) {
    let fixed = Math.round(input.positions[i] * (1 << fractionalBits));
    if (fixed < 0) fixed += 0x1000000;
    bytes[o++] = fixed & 0xff;
    bytes[o++] = (fixed >> 8) & 0xff;
    bytes[o++] = (fixed >> 16) & 0xff;
  }
  for (let i = 0; i < n; i++) bytes[o++] = clampByte(input.alphas[i] * 255);
  for (let i = 0; i < n * 3; i++) {
    bytes[o++] = clampByte((input.colors[i] * 0.15 + 0.5) * 255);
  }
  for (let i = 0; i < n * 3; i++) bytes[o++] = clampByte((input.scales[i] + 10) * 16);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      bytes[o++] = clampByte((input.rotations[i * 4 + c] + 1) * 127.5);
    }
  }
  for (let i = 0; i < n * bands * 3; i++) {
    bytes[o++] = clampByte((input.sh?.[i] ?? 0) * 128 + 128);
  }
  return bytes;
}

const sample: EncodeInput = {
  positions: [1.5, -2.25, 0.125, -10, 0.03125, 42],
  alphas: [1, 0.25],
  colors: [1.2, -0.6, 0, 0.4, 0.9, -2],
  scales: [-5, -4.5, -6, -9.9375, 0, -2],
  rotations: [0, 0, 0, 1, 0.5, -0.5, 0.5, 0.5],
  shDegree: 1,
  sh: [0.5, -0.25, 0, 0.125, 0.25, -0.5, -1, 0.9921875, 0, 0.5, 0.25, -0.125,
       0, 0, 0, 0, 0, 0],
};

describe('parseSpz', () => {
  it('round-trips positions/alphas/colors/scales/rotations within quantization tolerance', () => {
    const g = parseSpz(encodeSpz(sample));
    expect(g.numPoints).toBe(2);
    expect(g.shDegree).toBe(1);
    const posTol = 0.5 / (1 << 12);
    for (let i = 0; i < 6; i++) {
      expect(g.positions[i]).toBeCloseTo(sample.positions[i], 10);
      expect(Math.abs(g.positions[i] - sample.positions[i])).toBeLessThanOrEqual(posTol);
    }
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(g.alphas[i] - sample.alphas[i])).toBeLessThanOrEqual(0.5 / 255);
    }
    for (let i = 0; i < 6; i++) {
      // Color byte quantization step is (1/255)/0.15 (epsilon for float
      // rounding right at the half-step boundary).
      expect(Math.abs(g.colors[i] - sample.colors[i])).toBeLessThanOrEqual(0.5 / 255 / 0.15 + 1e-9);
      expect(Math.abs(g.scales[i] - sample.scales[i])).toBeLessThanOrEqual(0.5 / 16);
    }
    for (let i = 0; i < 8; i++) {
      expect(Math.abs(g.rotations[i] - sample.rotations[i])).toBeLessThanOrEqual(1 / 127.5);
    }
    // w reconstructed from xyz, always non-negative.
    expect(g.rotations[3]).toBeCloseTo(1, 2);
    // w is reconstructed from the three quantized components, so its
    // error can slightly exceed one quantization step.
    expect(g.rotations[7]).toBeCloseTo(0.5, 1);
  });

  it('round-trips SH coefficients within quantization tolerance', () => {
    const g = parseSpz(encodeSpz(sample));
    const bands = shBandsForDegree(1);
    expect(g.sh.length).toBe(2 * bands * 3);
    for (let i = 0; i < g.sh.length; i++) {
      expect(Math.abs(g.sh[i] - sample.sh![i])).toBeLessThanOrEqual(0.5 / 128);
    }
  });

  it('reads the antialiased flag', () => {
    expect(parseSpz(encodeSpz({ ...sample, flags: 1 })).antialiased).toBe(true);
    expect(parseSpz(encodeSpz(sample)).antialiased).toBe(false);
  });

  it('rejects a bad magic', () => {
    const bytes = encodeSpz(sample);
    bytes[0] ^= 0xff;
    expect(() => parseSpz(bytes)).toThrow(/magic/);
  });

  it('rejects unsupported versions', () => {
    const bytes = encodeSpz(sample);
    new DataView(bytes.buffer).setUint32(4, 3, true);
    expect(() => parseSpz(bytes)).toThrow(/version 3/);
  });

  it('rejects truncated data', () => {
    const bytes = encodeSpz(sample);
    expect(() => parseSpz(bytes.subarray(0, 8))).toThrow(/header/);
    expect(() => parseSpz(bytes.subarray(0, bytes.length - 4))).toThrow(/truncated/);
  });

  it('rejects an absurd point count', () => {
    const bytes = encodeSpz(sample);
    new DataView(bytes.buffer).setUint32(8, 500_000_000, true);
    expect(() => parseSpz(bytes)).toThrow(/refusing/);
  });
});

describe('gunzip', () => {
  it('decompresses a gzip stream (the full .spz outer layer)', async () => {
    const raw = encodeSpz(sample);
    const unzipped = await gunzip(await gzip(raw));
    expect(unzipped).toEqual(raw);
    expect(parseSpz(unzipped).numPoints).toBe(2);
  });
});

describe('spzToGsplatData', () => {
  it('flips RUB positions/rotations to the .ply RDF convention', () => {
    const g = parseSpz(encodeSpz(sample));
    const data = spzToGsplatData(g);
    expect(data.count).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(data.positions[i * 3 + 0]).toBe(g.positions[i * 3 + 0]);
      expect(data.positions[i * 3 + 1]).toBe(-g.positions[i * 3 + 1]);
      expect(data.positions[i * 3 + 2]).toBe(-g.positions[i * 3 + 2]);
      // (x, y, z, w) → w-first with y/z negated.
      expect(data.rotations[i * 4 + 0]).toBe(g.rotations[i * 4 + 3]);
      expect(data.rotations[i * 4 + 1]).toBe(g.rotations[i * 4 + 0]);
      expect(data.rotations[i * 4 + 2]).toBe(-g.rotations[i * 4 + 1]);
      expect(data.rotations[i * 4 + 3]).toBe(-g.rotations[i * 4 + 2]);
    }
  });

  it('converts linear alpha to logit opacity', () => {
    const g = parseSpz(encodeSpz(sample));
    const data = spzToGsplatData(g);
    for (let i = 0; i < 2; i++) {
      expect(sigmoid(data.opacities[i])).toBeCloseTo(Math.min(0.9999, g.alphas[i]), 3);
    }
  });

  it('reorders SH from coeff-major to the channel-major f_rest layout', () => {
    const g: SpzGaussians = {
      numPoints: 1,
      shDegree: 1,
      antialiased: false,
      positions: new Float32Array(3),
      alphas: new Float32Array([0.5]),
      colors: new Float32Array(3),
      scales: new Float32Array(3),
      rotations: new Float32Array([0, 0, 0, 1]),
      // Coeff-major: coeff j in [0..2], channels rgb: value = j + c/10.
      sh: new Float32Array([0, 0.1, 0.2, 1, 1.1, 1.2, 2, 2.1, 2.2]),
    };
    const data = spzToGsplatData(g);
    // Channel-major with the RUB→RDF sign flips (-1, -1, +1 for degree 1).
    const flip = [-1, -1, 1];
    for (let c = 0; c < 3; c++) {
      for (let j = 0; j < 3; j++) {
        expect(data.sh![c * 3 + j]).toBeCloseTo(flip[j] * (j + c / 10), 6);
      }
    }
  });
});

// Optional smoke check against a real Niantic-exported scan; skipped when
// the sample isn't on this machine (it is not committed to the repo).
const REAL_SAMPLE =
  '/private/tmp/claude-501/-Users-jenny-Work-synthetic-playcanvas/3e5c1d49-be5a-4054-a1a8-adc5d6109d0f/scratchpad/hornedlizard.spz';

describe.skipIf(!nodeFs.existsSync(REAL_SAMPLE))('real .spz sample', () => {
  it('parses the header and yields plausible splats', async () => {
    const bytes = await gunzip(new Uint8Array(nodeFs.readFileSync(REAL_SAMPLE)));
    const g = parseSpz(bytes);
    expect(g.numPoints).toBeGreaterThan(100_000);
    expect(g.shDegree).toBeGreaterThanOrEqual(0);
    expect(g.shDegree).toBeLessThanOrEqual(3);
    // Plausibility: finite positions within a scan-sized envelope,
    // alphas in range, scales in the log-encoded envelope.
    const n = Math.min(g.numPoints, 5000);
    for (let i = 0; i < n * 3; i++) {
      expect(Number.isFinite(g.positions[i])).toBe(true);
      expect(Math.abs(g.positions[i])).toBeLessThan(2048);
    }
    for (let i = 0; i < n; i++) {
      expect(g.alphas[i]).toBeGreaterThanOrEqual(0);
      expect(g.alphas[i]).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < n * 3; i++) {
      expect(g.scales[i]).toBeGreaterThanOrEqual(-10);
      expect(g.scales[i]).toBeLessThanOrEqual(6);
    }
    for (let i = 0; i < n; i++) {
      const x = g.rotations[i * 4];
      const y = g.rotations[i * 4 + 1];
      const z = g.rotations[i * 4 + 2];
      const w = g.rotations[i * 4 + 3];
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 1);
    }
  });
});
