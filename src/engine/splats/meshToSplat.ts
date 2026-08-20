import {
  Color,
  Entity,
  Mat4,
  StandardMaterial,
  Texture,
  Vec3,
  type MeshInstance,
} from 'playcanvas';
import type { SplatPoint } from './splatCreate';

export interface MeshToSplatOptions {
  /** Approximate number of splats to distribute over the mesh surface. Default 60000. */
  count?: number;
  /** Splat size multiplier. Default 1.6 (slight overlap for solid coverage). */
  overlap?: number;
  /** Seeded random function, defaults to Math.random. */
  random?: () => number;
  /** Sample diffuse textures via UVs where available. Default true. */
  sampleTextures?: boolean;
}

interface TriSource {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  uv0?: [number, number];
  uv1?: [number, number];
  uv2?: [number, number];
  area: number;
  color: Color;
  sampler: TextureSampler | null;
}

interface TextureSampler {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const samplerCache = new WeakMap<Texture, TextureSampler | null>();

/** Reads back a texture's source image into a CPU-side pixel array for UV sampling. */
function getTextureSampler(texture: Texture): TextureSampler | null {
  if (samplerCache.has(texture)) return samplerCache.get(texture)!;
  let sampler: TextureSampler | null = null;
  try {
    const source = (texture as any).getSource?.();
    if (source && typeof source.width === 'number' && source.width > 0) {
      const w = Math.min(source.width, 512);
      const h = Math.min(source.height, 512);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(source, 0, 0, w, h);
        sampler = { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
      }
    }
  } catch {
    // Compressed / GPU-only textures cannot be read back; fall back to material color.
    sampler = null;
  }
  samplerCache.set(texture, sampler);
  return sampler;
}

function collectTriangles(entity: Entity): { tris: TriSource[]; totalArea: number } {
  const tris: TriSource[] = [];
  let totalArea = 0;

  const meshInstances: MeshInstance[] = [];
  for (const render of entity.findComponents('render') as any[]) {
    if (render.meshInstances) meshInstances.push(...render.meshInstances);
  }

  const edge1 = new Vec3();
  const edge2 = new Vec3();
  const cross = new Vec3();

  for (const mi of meshInstances) {
    const mesh = mi.mesh;
    if (!mesh) continue;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    mesh.getPositions(positions);
    mesh.getUvs(0, uvs);
    mesh.getIndices(indices);
    if (positions.length === 0) continue;

    const world: Mat4 = mi.node.getWorldTransform();

    const material = mi.material as StandardMaterial;
    const color = material?.diffuse
      ? new Color(material.diffuse.r, material.diffuse.g, material.diffuse.b)
      : new Color(0.7, 0.7, 0.7);
    const diffuseMap = (material as any)?.diffuseMap as Texture | undefined;
    const sampler = diffuseMap ? getTextureSampler(diffuseMap) : null;

    const triCount = indices.length > 0 ? indices.length / 3 : positions.length / 9;
    const idx = (t: number, k: number) =>
      indices.length > 0 ? indices[t * 3 + k] : t * 3 + k;

    for (let t = 0; t < triCount; t++) {
      const i0 = idx(t, 0);
      const i1 = idx(t, 1);
      const i2 = idx(t, 2);

      const v0 = world.transformPoint(
        new Vec3(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2])
      );
      const v1 = world.transformPoint(
        new Vec3(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2])
      );
      const v2 = world.transformPoint(
        new Vec3(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2])
      );

      edge1.sub2(v1, v0);
      edge2.sub2(v2, v0);
      cross.cross(edge1, edge2);
      const area = cross.length() / 2;
      if (area < 1e-10) continue;

      const tri: TriSource = { v0, v1, v2, area, color, sampler };
      if (uvs.length > 0 && sampler) {
        tri.uv0 = [uvs[i0 * 2], uvs[i0 * 2 + 1]];
        tri.uv1 = [uvs[i1 * 2], uvs[i1 * 2 + 1]];
        tri.uv2 = [uvs[i2 * 2], uvs[i2 * 2 + 1]];
      }
      tris.push(tri);
      totalArea += area;
    }
  }
  return { tris, totalArea };
}

/**
 * Converts an entity's render meshes into gaussian splat points via
 * area-weighted surface sampling. Points are in the entity's world space —
 * parent the resulting splat entity at the origin, or bake the transform out.
 */
export function meshEntityToSplatPoints(
  entity: Entity,
  opts: MeshToSplatOptions = {}
): SplatPoint[] {
  const count = Math.max(1, Math.floor(opts.count ?? 60000));
  const overlap = opts.overlap ?? 1.6;
  const rand = opts.random ?? Math.random;
  const sampleTextures = opts.sampleTextures ?? true;

  const { tris, totalArea } = collectTriangles(entity);
  if (tris.length === 0 || totalArea === 0) return [];

  // Cumulative area table for O(log n) weighted triangle selection.
  const cumulative = new Float64Array(tris.length);
  let acc = 0;
  for (let i = 0; i < tris.length; i++) {
    acc += tris[i].area;
    cumulative[i] = acc;
  }

  const splatSize = Math.sqrt(totalArea / count) * overlap;
  const points: SplatPoint[] = [];

  for (let i = 0; i < count; i++) {
    const target = rand() * totalArea;
    let lo = 0;
    let hi = tris.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const tri = tris[lo];

    // Uniform barycentric sample.
    let u = rand();
    let v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    const x = tri.v0.x * w + tri.v1.x * u + tri.v2.x * v;
    const y = tri.v0.y * w + tri.v1.y * u + tri.v2.y * v;
    const z = tri.v0.z * w + tri.v1.z * u + tri.v2.z * v;

    let r = tri.color.r;
    let g = tri.color.g;
    let b = tri.color.b;

    if (sampleTextures && tri.sampler && tri.uv0 && tri.uv1 && tri.uv2) {
      const tu = tri.uv0[0] * w + tri.uv1[0] * u + tri.uv2[0] * v;
      const tv = tri.uv0[1] * w + tri.uv1[1] * u + tri.uv2[1] * v;
      const { data, width, height } = tri.sampler;
      // Wrap UVs; PlayCanvas texture V is flipped relative to image rows.
      const px = Math.min(width - 1, Math.max(0, Math.floor((tu - Math.floor(tu)) * width)));
      const py = Math.min(
        height - 1,
        Math.max(0, Math.floor((1 - (tv - Math.floor(tv))) * height))
      );
      const o = (py * width + px) * 4;
      r *= data[o] / 255;
      g *= data[o + 1] / 255;
      b *= data[o + 2] / 255;
    }

    points.push({ x, y, z, size: splatSize, r, g, b, a: 1 });
  }
  return points;
}
