import {
  Asset,
  BoundingBox,
  Color,
  Entity,
  StandardMaterial,
  Vec3,
  type AppBase,
} from 'playcanvas';
import {
  deleteAssetBlob,
  getAssetBlob,
  putAssetBlob,
  MODEL_STORE,
} from '../lib/assetStore';
import {
  DEFAULT_MATERIAL_OVERRIDE,
  mergeMaterialOverride,
  roughnessToGloss,
  type MaterialOverride,
} from '../lib/materialOverride';

export type ModelSource =
  | { kind: 'file'; filename: string }
  | { kind: 'url'; url: string };

export interface ModelEntry {
  id: string;
  name: string;
  entity: Entity;
  asset: Asset;
  source: ModelSource;
  /** Label used for bounding boxes in detection captures. */
  label: string;
  /** World-space AABB captured at import (before user transforms). */
  bounds: BoundingBox;
  /** Material/color override state (the original's "use if it's pink"
   * rescue) — applied via `setMaterialOverride`, persisted per model. */
  override: MaterialOverride;
  /** Cached per-mesh vertex samples for tight screen-space label boxes. */
  meshSamples?: { node: { getWorldTransform(): { transformPoint(v: Vec3, o: Vec3): Vec3 } }; positions: Float32Array }[];
}

export const MODEL_EXTENSIONS = ['.glb', '.gltf'];

export function isModelFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return MODEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type Listener = (entries: ModelEntry[]) => void;

/**
 * Owns imported mesh models (GLB props for detection/anomaly scenes).
 * USDZ support arrives later via a converter (see TODO.md Phase 6).
 */
export class ModelManager {
  private app: AppBase;
  private parent: Entity;
  private listeners = new Set<Listener>();
  entries: ModelEntry[] = [];
  /** Per-entry override material (one each so per-copy colors diverge). */
  private overrideMats = new Map<string, StandardMaterial>();
  /** Per-entry cache of the mesh instances' original materials, so
   * toggling the override off restores what the GLB shipped with. */
  private originalMats = new Map<string, Map<unknown, unknown>>();

  constructor(app: AppBase, parent: Entity) {
    this.app = app;
    this.parent = parent;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snapshot = [...this.entries];
    for (const fn of this.listeners) fn(snapshot);
  }

  async importFile(file: File, persistedId?: string): Promise<ModelEntry> {
    if (!isModelFilename(file.name)) {
      throw new Error(
        `Unsupported model format: ${file.name}. Supported: ${MODEL_EXTENSIONS.join(', ')}`
      );
    }
    const url = URL.createObjectURL(file);
    try {
      const asset = new Asset(file.name, 'container', {
        url,
        filename: file.name,
      });
      const entry = await this.loadAsset(
        asset,
        file.name,
        { kind: 'file', filename: file.name },
        persistedId
      );
      if (!persistedId) {
        void putAssetBlob(MODEL_STORE, entry.id, file).catch((err) =>
          console.warn('model blob persist failed', err)
        );
      }
      return entry;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async importUrl(url: string, name: string): Promise<ModelEntry> {
    const asset = new Asset(name, 'container', { url });
    return this.loadAsset(asset, name, { kind: 'url', url });
  }

  private loadAsset(
    asset: Asset,
    name: string,
    source: ModelSource,
    persistedId?: string
  ): Promise<ModelEntry> {
    return new Promise((resolve, reject) => {
      asset.on('load', () => {
        const resource = asset.resource as { instantiateRenderEntity(): Entity };
        const entity = resource.instantiateRenderEntity();
        entity.name = name;
        this.parent.addChild(entity);

        const bounds = computeWorldBounds(entity);
        // Rest imports on the ground plane, centered at origin.
        entity.setLocalPosition(
          -bounds.center.x,
          bounds.halfExtents.y - bounds.center.y,
          -bounds.center.z
        );

        const entry: ModelEntry = {
          id: persistedId ?? crypto.randomUUID(),
          name,
          entity,
          asset,
          source,
          label: defaultLabel(name),
          bounds: computeWorldBounds(entity),
          override: { ...DEFAULT_MATERIAL_OVERRIDE },
        };
        this.entries.push(entry);
        this.emit();
        resolve(entry);
      });
      asset.on('error', (err: string) => reject(new Error(err)));
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  setLabel(id: string, label: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.label = label;
      this.emit();
    }
  }

  /**
   * Applies / edits / removes the per-model material override: when
   * enabled, every mesh instance under the entry swaps to one plain
   * StandardMaterial of the override color (rescues imports whose
   * materials didn't translate — the flat-pink case); when disabled,
   * the cached original materials come back. Emits so persistence
   * snapshots capture the override.
   */
  setMaterialOverride(id: string, patch: Partial<MaterialOverride>): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.override = mergeMaterialOverride(entry.override, patch);
    this.applyMaterialOverride(entry);
    this.emit();
  }

  private meshInstances(entry: ModelEntry): { material: unknown }[] {
    const out: { material: unknown }[] = [];
    for (const render of entry.entity.findComponents('render') as any[]) {
      for (const mi of render.meshInstances ?? []) out.push(mi);
    }
    return out;
  }

  private applyMaterialOverride(entry: ModelEntry): void {
    const mis = this.meshInstances(entry);
    if (entry.override.enabled) {
      let mat = this.overrideMats.get(entry.id);
      if (!mat) {
        mat = new StandardMaterial();
        this.overrideMats.set(entry.id, mat);
      }
      mat.diffuse = new Color().fromString(entry.override.color);
      mat.useMetalness = true;
      mat.metalness = entry.override.metalness;
      mat.gloss = roughnessToGloss(entry.override.roughness);
      mat.update();
      let originals = this.originalMats.get(entry.id);
      if (!originals) {
        originals = new Map();
        this.originalMats.set(entry.id, originals);
      }
      for (const mi of mis) {
        if (!originals.has(mi)) originals.set(mi, mi.material);
        mi.material = mat;
      }
    } else {
      const originals = this.originalMats.get(entry.id);
      if (!originals) return;
      for (const mi of mis) {
        const orig = originals.get(mi);
        if (orig) mi.material = orig;
      }
    }
  }

  private disposeOverride(id: string): void {
    this.originalMats.delete(id);
    const mat = this.overrideMats.get(id);
    if (mat) {
      mat.destroy();
      this.overrideMats.delete(id);
    }
  }

  /**
   * Scales the model so its largest dimension is `targetSize` meters and
   * re-rests it on the ground centered at the origin — sample props ship
   * at wildly different authored scales (a 2 m helmet, a 6 cm avocado).
   */
  normalizeSize(id: string, targetSize: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    const bounds = computeWorldBounds(entry.entity);
    const maxDim = 2 * Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z);
    if (maxDim <= 0) return;
    const k = targetSize / maxDim;
    const s = entry.entity.getLocalScale();
    entry.entity.setLocalScale(s.x * k, s.y * k, s.z * k);
    const scaled = computeWorldBounds(entry.entity);
    const pos = entry.entity.getLocalPosition();
    entry.entity.setLocalPosition(
      pos.x - scaled.center.x,
      pos.y - scaled.center.y + scaled.halfExtents.y,
      pos.z - scaled.center.z
    );
    entry.bounds = computeWorldBounds(entry.entity);
    this.emit();
  }

  /**
   * Moves/rotates/scales a model from the UI. Emits so persistence
   * snapshots capture the new transform.
   */
  setTransform(
    id: string,
    patch: { position?: [number, number, number]; yawDeg?: number; scale?: number }
  ): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (patch.position) {
      entry.entity.setLocalPosition(...patch.position);
    }
    if (patch.yawDeg !== undefined) {
      const e = entry.entity.getLocalEulerAngles();
      entry.entity.setLocalEulerAngles(e.x, patch.yawDeg, e.z);
    }
    if (patch.scale !== undefined && patch.scale > 0) {
      entry.entity.setLocalScale(patch.scale, patch.scale, patch.scale);
    }
    entry.bounds = computeWorldBounds(entry.entity);
    this.emit();
  }

  /**
   * Adds another copy of an imported model: a fresh render instance of
   * the same asset, offset beside the source, sharing the label. The
   * source blob is copied in IndexedDB under the new id so both copies
   * survive reloads independently.
   */
  duplicate(id: string): ModelEntry | null {
    const source = this.entries.find((e) => e.id === id);
    if (!source) return null;
    const resource = source.asset.resource as {
      instantiateRenderEntity(): Entity;
    } | null;
    if (!resource) return null;

    const copies = this.entries.filter(
      (e) => e.name === source.name || e.name.startsWith(`${source.name} (`)
    ).length;
    const entity = resource.instantiateRenderEntity();
    entity.name = `${source.name} (${copies + 1})`;
    this.parent.addChild(entity);

    // Match the source's scale/rotation; step position on a small grid so
    // copies land beside each other instead of z-fighting.
    const s = source.entity.getLocalScale();
    entity.setLocalScale(s.x, s.y, s.z);
    const e = source.entity.getLocalEulerAngles();
    entity.setLocalEulerAngles(e.x, e.y, e.z);
    const p = source.entity.getLocalPosition();
    entity.setLocalPosition(
      p.x + 0.5 * (copies % 3 === 0 ? 1 : copies % 3 === 1 ? -1 : 0),
      p.y,
      p.z + (copies % 2 === 0 ? 0.5 : -0.5)
    );

    const entry: ModelEntry = {
      id: crypto.randomUUID(),
      name: entity.name,
      entity,
      asset: source.asset,
      source: source.source,
      label: source.label,
      bounds: computeWorldBounds(entity),
      // Copies inherit the override values but get their own override
      // material instance, so later per-copy color edits diverge.
      override: { ...source.override },
    };
    this.entries.push(entry);
    if (entry.override.enabled) this.applyMaterialOverride(entry);
    void getAssetBlob(MODEL_STORE, source.id)
      .then((blob) => (blob ? putAssetBlob(MODEL_STORE, entry.id, blob) : undefined))
      .catch((err) => console.warn('model copy persist failed', err));
    this.emit();
    return entry;
  }

  /**
   * WORLD-space vertex sample for tight screen-space label boxes (AABB
   * corner projection overshoots the silhouette). Local vertex samples
   * are cached per mesh; world transforms are applied per call so the
   * sample tracks user moves/scales.
   */
  labelSamplePoints(entry: ModelEntry): Float32Array | null {
    if (!entry.meshSamples) {
      const samples: NonNullable<ModelEntry['meshSamples']> = [];
      const meshInstances: { mesh: { getPositions(a: number[]): number }; node: never }[] = [];
      for (const render of entry.entity.findComponents('render') as any[]) {
        for (const mi of render.meshInstances ?? []) meshInstances.push(mi);
      }
      const perMesh = Math.max(200, Math.ceil(4000 / Math.max(1, meshInstances.length)));
      for (const mi of meshInstances as any[]) {
        const positions: number[] = [];
        mi.mesh?.getPositions?.(positions);
        const count = positions.length / 3;
        if (count === 0) continue;
        const step = Math.max(1, Math.floor(count / perMesh));
        const out: number[] = [];
        for (let i = 0; i < count; i += step) {
          out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        }
        samples.push({ node: mi.node, positions: new Float32Array(out) });
      }
      entry.meshSamples = samples;
    }
    if (entry.meshSamples.length === 0) return null;
    let total = 0;
    for (const s of entry.meshSamples) total += s.positions.length;
    const world = new Float32Array(total);
    const v = new Vec3();
    const o = new Vec3();
    let k = 0;
    for (const s of entry.meshSamples) {
      const wt = s.node.getWorldTransform();
      for (let i = 0; i < s.positions.length; i += 3) {
        v.set(s.positions[i], s.positions[i + 1], s.positions[i + 2]);
        wt.transformPoint(v, o);
        world[k++] = o.x;
        world[k++] = o.y;
        world[k++] = o.z;
      }
    }
    return world;
  }

  /** Shows/hides a model (e.g. hidden behind its splat conversion). Emits
   * so persistence snapshots capture the visibility change. */
  setEnabled(id: string, enabled: boolean): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.entity.enabled = enabled;
      this.emit();
    }
  }

  remove(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index >= 0) {
      const [entry] = this.entries.splice(index, 1);
      entry.entity.destroy();
      this.disposeOverride(entry.id);
      // Duplicates share the source's container asset — unloading it
      // while a sibling still uses it would strip that copy's meshes.
      if (!this.entries.some((e) => e.asset === entry.asset)) {
        this.app.assets.remove(entry.asset);
        entry.asset.unload();
      }
      void deleteAssetBlob(MODEL_STORE, entry.id).catch(() => {});
      this.emit();
    }
  }

  get(id: string): ModelEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  destroy(): void {
    for (const entry of this.entries) {
      entry.entity.destroy();
      this.disposeOverride(entry.id);
      this.app.assets.remove(entry.asset);
      entry.asset.unload();
    }
    this.entries = [];
    this.listeners.clear();
  }
}

/** Computes the world-space AABB across all mesh instances under an entity. */
export function computeWorldBounds(entity: Entity): BoundingBox {
  const result = new BoundingBox(new Vec3(), new Vec3());
  let first = true;
  for (const render of entity.findComponents('render') as any[]) {
    for (const mi of render.meshInstances ?? []) {
      if (first) {
        result.copy(mi.aabb);
        first = false;
      } else {
        result.add(mi.aabb);
      }
    }
  }
  return result;
}

function defaultLabel(name: string): string {
  return (
    name
      .replace(/\.(glb|gltf)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .toLowerCase() || 'object'
  );
}
