import {
  BoundingBox,
  Entity,
  FloatPacking,
  GSplatContainer,
  GSplatFormat,
  Vec3,
  type AppBase,
  type GraphicsDevice,
} from 'playcanvas';

/** One gaussian splat point in local space. Colors are 0..1. */
export interface SplatPoint {
  x: number;
  y: number;
  z: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Builds a renderable GSplatContainer from raw splat points using the
 * engine's simple format (dataCenter RGBA32F: xyz+size, dataColor RGBA16F).
 */
export function buildSplatContainer(
  device: GraphicsDevice,
  points: SplatPoint[]
): GSplatContainer {
  const count = points.length;
  const format = GSplatFormat.createSimpleFormat(device);
  const container = new GSplatContainer(device, count, format);

  const centerTex = container.getTexture('dataCenter');
  const colorTex = container.getTexture('dataColor');
  if (!centerTex || !colorTex) {
    throw new Error('GSplatContainer simple format missing expected data textures');
  }
  const centerData = centerTex.lock() as Float32Array;
  const colorData = colorTex.lock() as Uint16Array;
  const centers = container.centers;

  const min = new Vec3(Infinity, Infinity, Infinity);
  const max = new Vec3(-Infinity, -Infinity, -Infinity);

  for (let i = 0; i < count; i++) {
    const p = points[i];
    centerData[i * 4 + 0] = p.x;
    centerData[i * 4 + 1] = p.y;
    centerData[i * 4 + 2] = p.z;
    centerData[i * 4 + 3] = p.size;

    colorData[i * 4 + 0] = FloatPacking.float2Half(p.r);
    colorData[i * 4 + 1] = FloatPacking.float2Half(p.g);
    colorData[i * 4 + 2] = FloatPacking.float2Half(p.b);
    colorData[i * 4 + 3] = FloatPacking.float2Half(p.a);

    centers[i * 3 + 0] = p.x;
    centers[i * 3 + 1] = p.y;
    centers[i * 3 + 2] = p.z;

    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  }

  centerTex.unlock();
  colorTex.unlock();

  const aabb = new BoundingBox();
  if (count > 0) {
    aabb.center.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    aabb.halfExtents.set(
      Math.max((max.x - min.x) / 2, 0.001),
      Math.max((max.y - min.y) / 2, 0.001),
      Math.max((max.z - min.z) / 2, 0.001)
    );
  }
  container.aabb = aabb;
  container.update(count);
  return container;
}

/** Wraps a container in an entity with a unified gsplat component. */
export function splatEntityFromContainer(
  app: AppBase,
  name: string,
  container: GSplatContainer
): Entity {
  const entity = new Entity(name, app);
  entity.addComponent('gsplat', { unified: true });
  entity.gsplat!.resource = container;
  return entity;
}

export type SplatPrimitiveKind = 'plane' | 'box' | 'sphere';

export interface PrimitiveOptions {
  kind: SplatPrimitiveKind;
  /** Overall size (edge length / diameter) in meters. Default 1. */
  size?: number;
  /** Approximate splat count. Default 20000. */
  count?: number;
  /** Base color, 0..1. Default light gray. */
  color?: { r: number; g: number; b: number };
  /** Per-splat color jitter amount 0..1. Default 0.05. */
  jitter?: number;
  /** Seeded random function, defaults to Math.random. */
  random?: () => number;
}

/**
 * Generates a solid-looking splat primitive by sampling the surface of a
 * plane (XZ), box, or sphere with size-matched gaussians.
 */
export function primitiveSplatPoints(opts: PrimitiveOptions): SplatPoint[] {
  const size = opts.size ?? 1;
  const count = Math.max(1, Math.floor(opts.count ?? 20000));
  const color = opts.color ?? { r: 0.7, g: 0.7, b: 0.72 };
  const jitter = opts.jitter ?? 0.05;
  const rand = opts.random ?? Math.random;
  const half = size / 2;

  // Surface area determines the splat footprint needed for full coverage.
  let area: number;
  switch (opts.kind) {
    case 'plane':
      area = size * size;
      break;
    case 'box':
      area = 6 * size * size;
      break;
    case 'sphere':
      area = Math.PI * size * size; // pi * d^2/4 * 4
      break;
  }
  const splatSize = Math.sqrt(area / count) * 1.6;

  const points: SplatPoint[] = [];
  const pushPoint = (x: number, y: number, z: number) => {
    const j = (rand() - 0.5) * 2 * jitter;
    points.push({
      x,
      y,
      z,
      size: splatSize,
      r: Math.min(1, Math.max(0, color.r + j)),
      g: Math.min(1, Math.max(0, color.g + j)),
      b: Math.min(1, Math.max(0, color.b + j)),
      a: 1,
    });
  };

  for (let i = 0; i < count; i++) {
    if (opts.kind === 'plane') {
      pushPoint((rand() - 0.5) * size, 0, (rand() - 0.5) * size);
    } else if (opts.kind === 'box') {
      // Pick a face uniformly by area (all equal), then a point on it.
      const face = Math.floor(rand() * 6);
      const u = (rand() - 0.5) * size;
      const v = (rand() - 0.5) * size;
      switch (face) {
        case 0: pushPoint(half, u, v); break;
        case 1: pushPoint(-half, u, v); break;
        case 2: pushPoint(u, half, v); break;
        case 3: pushPoint(u, -half, v); break;
        case 4: pushPoint(u, v, half); break;
        default: pushPoint(u, v, -half); break;
      }
    } else {
      // Uniform point on sphere surface.
      const theta = rand() * Math.PI * 2;
      const cosPhi = rand() * 2 - 1;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      pushPoint(
        half * sinPhi * Math.cos(theta),
        half * cosPhi,
        half * sinPhi * Math.sin(theta)
      );
    }
  }
  return points;
}
