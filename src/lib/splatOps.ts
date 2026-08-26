import {
  fdcToLinear,
  linearToFdc,
  shBandsForDegree,
  type GsplatData,
} from './gsplatData';

/**
 * CPU-side edit-op log for gaussian splats. The GPU brush (SplatEditor)
 * edits splats non-destructively via instance streams; every applied op is
 * ALSO recorded here — in the splat's LOCAL space so it is independent of
 * the entity transform — which makes edits (1) replayable after a reload
 * and (2) bakeable into a destructive .ply export.
 *
 * Semantics mirror the GPU exactly:
 * - erase ops set a splat's visibility to 0 (crop erases OUTSIDE the box);
 *   once erased a splat stays erased (only a full reset restores it).
 * - tint ops OVERWRITE a per-splat (color, strength) tint state; the final
 *   color is a single `mix(base, color, strength)` — repeated strokes of
 *   the same brush do not compound.
 */

type V3 = [number, number, number];

export type SplatEditOp =
  | { kind: 'eraseSphere'; center: V3; radius: number }
  | { kind: 'eraseBox'; min: V3; max: V3 }
  | { kind: 'crop'; min: V3; max: V3 }
  | {
      kind: 'tintSphere';
      center: V3;
      radius: number;
      /** Tint color, linear 0..1. */
      color: V3;
      /** Blend factor 0..1 toward `color`. */
      strength: number;
    };

/** Per-splat edit state produced by replaying an op log on the CPU. */
export interface SplatEditState {
  /** 1 = visible, 0 = erased. */
  visible: Uint8Array; // N
  /** Last tint color written per splat (linear 0..1). */
  tintColor: Float32Array; // 3N
  /** Last tint strength written per splat (0 = untouched). */
  tintStrength: Float32Array; // N
}

/**
 * Replays `ops` over splat center positions (local space, xyz-packed).
 * Pure and renderer-agnostic; positions are read only.
 */
export function computeEditState(
  positions: ArrayLike<number>,
  count: number,
  ops: readonly SplatEditOp[]
): SplatEditState {
  const visible = new Uint8Array(count).fill(1);
  const tintColor = new Float32Array(count * 3);
  const tintStrength = new Float32Array(count);

  for (const op of ops) {
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      switch (op.kind) {
        case 'eraseSphere': {
          if (distSq(x, y, z, op.center) < op.radius * op.radius) visible[i] = 0;
          break;
        }
        case 'eraseBox': {
          if (insideBox(x, y, z, op.min, op.max)) visible[i] = 0;
          break;
        }
        case 'crop': {
          if (!insideBox(x, y, z, op.min, op.max)) visible[i] = 0;
          break;
        }
        case 'tintSphere': {
          if (distSq(x, y, z, op.center) < op.radius * op.radius) {
            tintColor[i * 3] = op.color[0];
            tintColor[i * 3 + 1] = op.color[1];
            tintColor[i * 3 + 2] = op.color[2];
            tintStrength[i] = op.strength;
          }
          break;
        }
      }
    }
  }
  return { visible, tintColor, tintStrength };
}

function distSq(x: number, y: number, z: number, c: V3): number {
  const dx = x - c[0];
  const dy = y - c[1];
  const dz = z - c[2];
  return dx * dx + dy * dy + dz * dz;
}

function insideBox(x: number, y: number, z: number, min: V3, max: V3): boolean {
  return (
    x >= min[0] && x <= max[0] &&
    y >= min[1] && y <= max[1] &&
    z >= min[2] && z <= max[2]
  );
}

/**
 * Bakes an op log into full splat data: erased splats are dropped and
 * tints are composited into the DC color. Returns the input unchanged
 * when the log is empty.
 */
export function applyOpsToGsplatData(
  data: GsplatData,
  ops: readonly SplatEditOp[]
): GsplatData {
  if (ops.length === 0) return data;
  const { visible, tintColor, tintStrength } = computeEditState(
    data.positions,
    data.count,
    ops
  );

  let kept = 0;
  for (let i = 0; i < data.count; i++) if (visible[i]) kept++;

  const bands = shBandsForDegree(data.shDegree);
  const positions = new Float32Array(kept * 3);
  const scales = new Float32Array(kept * 3);
  const rotations = new Float32Array(kept * 4);
  const opacities = new Float32Array(kept);
  const colors = new Float32Array(kept * 3);
  const sh = data.sh ? new Float32Array(kept * bands * 3) : undefined;

  let o = 0;
  for (let i = 0; i < data.count; i++) {
    if (!visible[i]) continue;
    positions.set(data.positions.subarray(i * 3, i * 3 + 3), o * 3);
    scales.set(data.scales.subarray(i * 3, i * 3 + 3), o * 3);
    rotations.set(data.rotations.subarray(i * 4, i * 4 + 4), o * 4);
    opacities[o] = data.opacities[i];
    const t = tintStrength[i];
    for (let c = 0; c < 3; c++) {
      const base = fdcToLinear(data.colors[i * 3 + c]);
      const mixed = base + (tintColor[i * 3 + c] - base) * t;
      colors[o * 3 + c] = linearToFdc(mixed);
    }
    if (sh && data.sh) {
      sh.set(data.sh.subarray(i * bands * 3, (i + 1) * bands * 3), o * bands * 3);
    }
    o++;
  }

  return {
    count: kept,
    positions,
    scales,
    rotations,
    opacities,
    colors,
    shDegree: data.shDegree,
    sh,
  };
}

/** Minimal structural point type shared with in-app-created splats. */
interface EditablePoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Bakes an op log into in-app-created splat points (same semantics as
 * {@link applyOpsToGsplatData}; colors here are linear 0..1 directly).
 */
export function applyOpsToPoints<T extends EditablePoint>(
  points: readonly T[],
  ops: readonly SplatEditOp[]
): T[] {
  if (ops.length === 0) return [...points];
  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    positions[i * 3] = points[i].x;
    positions[i * 3 + 1] = points[i].y;
    positions[i * 3 + 2] = points[i].z;
  }
  const { visible, tintColor, tintStrength } = computeEditState(
    positions,
    points.length,
    ops
  );
  const out: T[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!visible[i]) continue;
    const p = points[i];
    const t = tintStrength[i];
    out.push(
      t > 0
        ? {
            ...p,
            r: p.r + (tintColor[i * 3] - p.r) * t,
            g: p.g + (tintColor[i * 3 + 1] - p.g) * t,
            b: p.b + (tintColor[i * 3 + 2] - p.b) * t,
          }
        : p
    );
  }
  return out;
}

/**
 * Whether `next` is redundant next to the just-recorded `prev` (same brush,
 * barely moved). Keeps drag strokes from flooding the persisted op log —
 * the GPU still applies every stroke, so coverage is unaffected.
 */
export function shouldCoalesceOps(prev: SplatEditOp, next: SplatEditOp): boolean {
  if (prev.kind !== next.kind) return false;
  if (
    (prev.kind === 'eraseSphere' && next.kind === 'eraseSphere') ||
    (prev.kind === 'tintSphere' && next.kind === 'tintSphere')
  ) {
    if (prev.radius !== next.radius) return false;
    if (prev.kind === 'tintSphere' && next.kind === 'tintSphere') {
      if (
        prev.strength !== next.strength ||
        prev.color[0] !== next.color[0] ||
        prev.color[1] !== next.color[1] ||
        prev.color[2] !== next.color[2]
      ) {
        return false;
      }
    }
    const moved = Math.sqrt(distSq(...prev.center, next.center));
    return moved < next.radius * 0.25;
  }
  return false;
}

/**
 * Euler angles to persist for an in-app-created splat so it reloads with
 * the orientation the user saw. Created splats persist as a Y-down .ply
 * (the exporter bakes an Rz(180°) flip into the data); rehydration
 * re-imports through the .ply path and then SETS the persisted euler, so
 * the persisted value must equal R_live ∘ Rz(180°). In PlayCanvas euler
 * order that is (x, −y, z + 180°) — created splats only ever carry yaw,
 * for which this identity is exact.
 */
export function plyReimportEuler(live: V3): V3 {
  return [live[0], -live[1] + 0, live[2] + 180]; // +0 normalizes -0
}

/**
 * Maps a LOCAL-space op log through the same Rz(180°) flip the .ply
 * exporter bakes into created-splat data ((x, y, z) → (−x, −y, z)), so
 * ops recorded against the creation-space data replay correctly on the
 * re-imported (flipped) data. Involution: applying it twice is identity.
 */
export function flipEditOpsZ180(ops: readonly SplatEditOp[]): SplatEditOp[] {
  const flipPoint = (p: V3): V3 => [-p[0], -p[1], p[2]];
  return ops.map((op) => {
    switch (op.kind) {
      case 'eraseSphere':
        return { ...op, center: flipPoint(op.center) };
      case 'tintSphere':
        return { ...op, center: flipPoint(op.center) };
      case 'eraseBox':
      case 'crop':
        // Negating x/y swaps each axis's min/max.
        return {
          ...op,
          min: [-op.max[0], -op.max[1], op.min[2]],
          max: [-op.min[0], -op.min[1], op.max[2]],
        };
    }
  });
}

const isV3 = (v: unknown): v is V3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));

/**
 * Validates a persisted (JSON-parsed) op log. Unknown or malformed
 * entries are dropped so a corrupt localStorage snapshot can't poison
 * replay.
 */
export function sanitizeEditOps(raw: unknown): SplatEditOp[] {
  if (!Array.isArray(raw)) return [];
  const out: SplatEditOp[] = [];
  for (const op of raw as Array<Record<string, unknown>>) {
    if (!op || typeof op !== 'object') continue;
    switch (op.kind) {
      case 'eraseSphere':
        if (isV3(op.center) && Number.isFinite(op.radius) && (op.radius as number) > 0) {
          out.push({ kind: 'eraseSphere', center: op.center, radius: op.radius as number });
        }
        break;
      case 'eraseBox':
      case 'crop':
        if (isV3(op.min) && isV3(op.max)) {
          out.push({ kind: op.kind, min: op.min, max: op.max });
        }
        break;
      case 'tintSphere':
        if (
          isV3(op.center) &&
          Number.isFinite(op.radius) &&
          (op.radius as number) > 0 &&
          isV3(op.color) &&
          Number.isFinite(op.strength)
        ) {
          out.push({
            kind: 'tintSphere',
            center: op.center,
            radius: op.radius as number,
            color: op.color,
            strength: Math.min(1, Math.max(0, op.strength as number)),
          });
        }
        break;
    }
  }
  return out;
}
