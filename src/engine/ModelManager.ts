import { Asset, BoundingBox, Entity, Vec3, type AppBase } from 'playcanvas';
import { deleteAssetBlob, putAssetBlob, MODEL_STORE } from '../lib/assetStore';

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
      this.app.assets.remove(entry.asset);
      entry.asset.unload();
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
