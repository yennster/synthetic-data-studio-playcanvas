import {
  logit,
  shBandsForDegree,
  type GsplatData,
} from './gsplatData';

/**
 * Parser for Niantic's .spz gaussian-splat format (version 2): a gzip
 * stream wrapping a packed little-endian layout of quantized splat
 * attributes. Layout after decompression:
 *
 *   header {magic u32, version u32, numPoints u32,
 *           shDegree u8, fractionalBits u8, flags u8, reserved u8}
 *   positions  N × 3 × int24  (fixed point, `fractionalBits`)
 *   alphas     N × u8         (sigmoid-encoded opacity)
 *   colors     N × 3 × u8     (scaled f_dc: byte = (fdc·0.15 + 0.5)·255)
 *   scales     N × 3 × u8     (log-encoded: byte/16 − 10)
 *   rotations  N × 3 × u8     (quat xyz in [−1,1]; w = √(1−x²−y²−z²))
 *   sh         N × bands × 3 × u8  ((byte − 128)/128, coeff-major)
 *
 * SPZ stores data in a right-up-back (RUB) coordinate system while 3DGS
 * .ply files are right-down-front (RDF); `spzToGsplatData` applies the
 * y/z flip to positions, rotations, and SH coefficients.
 */

export const SPZ_MAGIC = 0x5053474e; // "NGSP" little-endian

const HEADER_BYTES = 16;
const MAX_POINTS = 10_000_000;

/** Decoded .spz contents in SPZ's own conventions (RUB space). */
export interface SpzGaussians {
  numPoints: number;
  shDegree: number;
  antialiased: boolean;
  positions: Float32Array; // 3N, RUB space
  /** LINEAR opacity 0..1 (sigmoid already applied by the encoder). */
  alphas: Float32Array; // N
  colors: Float32Array; // 3N, f_dc coefficients
  scales: Float32Array; // 3N, log-encoded
  /** Quaternions x, y, z, w (w ≥ 0 by construction). */
  rotations: Float32Array; // 4N
  /** Higher-order SH, per point coeff-major: `[(i·bands + j)·3 + c]`. */
  sh: Float32Array; // N * bands * 3
}

/**
 * Decompresses a gzip stream (the outer layer of every .spz file) with
 * bare DecompressionStream — no Blob/Response so it behaves the same in
 * browsers and in the node/happy-dom test environment.
 */
export async function gunzip(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  // Write and read concurrently — awaiting the write first would deadlock
  // on backpressure for inputs larger than the stream's buffer.
  const writing = writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writing;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Parses DECOMPRESSED .spz bytes (see `gunzip` for the outer layer). */
export function parseSpz(bytes: Uint8Array): SpzGaussians {
  if (bytes.length < HEADER_BYTES) {
    throw new Error('.spz truncated: missing header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== SPZ_MAGIC) {
    throw new Error('Not an .spz file (bad magic)');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`Unsupported .spz version ${version} (only v2 is supported)`);
  }
  const numPoints = view.getUint32(8, true);
  if (numPoints > MAX_POINTS) {
    throw new Error(`.spz header claims ${numPoints} points — refusing`);
  }
  const shDegree = view.getUint8(12);
  if (shDegree > 3) {
    throw new Error(`Unsupported .spz SH degree ${shDegree}`);
  }
  const fractionalBits = view.getUint8(13);
  const flags = view.getUint8(14);
  const bands = shBandsForDegree(shDegree);

  const expected =
    HEADER_BYTES +
    numPoints * 9 + // positions
    numPoints + // alphas
    numPoints * 3 + // colors
    numPoints * 3 + // scales
    numPoints * 3 + // rotations
    numPoints * bands * 3; // sh
  if (bytes.length < expected) {
    throw new Error(
      `.spz truncated: expected ${expected} bytes, got ${bytes.length}`
    );
  }

  const positions = new Float32Array(numPoints * 3);
  const alphas = new Float32Array(numPoints);
  const colors = new Float32Array(numPoints * 3);
  const scales = new Float32Array(numPoints * 3);
  const rotations = new Float32Array(numPoints * 4);
  const sh = new Float32Array(numPoints * bands * 3);

  let o = HEADER_BYTES;
  const posScale = 1 / (1 << fractionalBits);
  for (let i = 0; i < numPoints * 3; i++) {
    // 24-bit little-endian signed fixed point.
    let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    if (v & 0x800000) v -= 0x1000000;
    positions[i] = v * posScale;
    o += 3;
  }
  for (let i = 0; i < numPoints; i++) {
    alphas[i] = bytes[o++] / 255;
  }
  for (let i = 0; i < numPoints * 3; i++) {
    colors[i] = (bytes[o++] / 255 - 0.5) / 0.15;
  }
  for (let i = 0; i < numPoints * 3; i++) {
    scales[i] = bytes[o++] / 16 - 10;
  }
  for (let i = 0; i < numPoints; i++) {
    const x = bytes[o++] / 127.5 - 1;
    const y = bytes[o++] / 127.5 - 1;
    const z = bytes[o++] / 127.5 - 1;
    const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    rotations[i * 4 + 0] = x;
    rotations[i * 4 + 1] = y;
    rotations[i * 4 + 2] = z;
    rotations[i * 4 + 3] = w;
  }
  for (let i = 0; i < numPoints * bands * 3; i++) {
    sh[i] = (bytes[o++] - 128) / 128;
  }

  return {
    numPoints,
    shDegree,
    antialiased: (flags & 1) !== 0,
    positions,
    alphas,
    colors,
    scales,
    rotations,
    sh,
  };
}

/**
 * Per-coefficient sign flips for higher-order SH under the RUB→RDF
 * change of basis (y → −y, z → −z, a rotation by π about X). Derived
 * from the 3DGS basis ordering — degree 1: (y, z, x); degree 2:
 * (xy, yz, 3z²−1, xz, x²−y²); degree 3: (y(3x²−y²), xyz, y(4z²−…),
 * z(2z²−…), x(4z²−…), z(x²−y²), x(x²−3y²)) — by counting odd powers
 * of y and z in each basis function.
 */
const SH_FLIP_YZ = [
  -1, -1, 1, // degree 1
  -1, 1, 1, -1, 1, // degree 2
  -1, 1, -1, -1, 1, -1, 1, // degree 3
];

/**
 * Transcodes parsed SPZ gaussians (RUB space, linear alphas) into the
 * 3DGS .ply conventions used across the app (RDF space, logit opacity,
 * w-first quaternions, channel-major f_rest SH).
 */
export function spzToGsplatData(g: SpzGaussians): GsplatData {
  const n = g.numPoints;
  const bands = shBandsForDegree(g.shDegree);
  const positions = new Float32Array(n * 3);
  const rotations = new Float32Array(n * 4);
  const opacities = new Float32Array(n);
  const sh = bands > 0 ? new Float32Array(n * bands * 3) : undefined;

  for (let i = 0; i < n; i++) {
    // RUB → RDF: negate y and z.
    positions[i * 3 + 0] = g.positions[i * 3 + 0];
    positions[i * 3 + 1] = -g.positions[i * 3 + 1];
    positions[i * 3 + 2] = -g.positions[i * 3 + 2];
    // Conjugating by the π-about-X rotation: (w, x, y, z) → (w, x, −y, −z).
    rotations[i * 4 + 0] = g.rotations[i * 4 + 3]; // w first for .ply
    rotations[i * 4 + 1] = g.rotations[i * 4 + 0];
    rotations[i * 4 + 2] = -g.rotations[i * 4 + 1];
    rotations[i * 4 + 3] = -g.rotations[i * 4 + 2];
    opacities[i] = logit(g.alphas[i]);
    if (sh) {
      // SPZ is coeff-major ([j][c]); .ply f_rest is channel-major ([c][j]).
      for (let j = 0; j < bands; j++) {
        const flip = SH_FLIP_YZ[j];
        for (let c = 0; c < 3; c++) {
          sh[i * bands * 3 + c * bands + j] =
            flip * g.sh[(i * bands + j) * 3 + c];
        }
      }
    }
  }

  return {
    count: n,
    positions,
    scales: g.scales.slice(),
    rotations,
    opacities,
    colors: g.colors.slice(),
    shDegree: g.shDegree,
    sh,
  };
}
