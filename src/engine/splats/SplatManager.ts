import { Asset, Entity, type AppBase } from 'playcanvas';
import {
  buildSplatContainer,
  primitiveSplatPoints,
  splatEntityFromContainer,
  type PrimitiveOptions,
  type SplatPoint,
} from './splatCreate';
import { meshEntityToSplatPoints, type MeshToSplatOptions } from './meshToSplat';
import { pointsToPly } from './splatExport';
import { deleteAssetBlob, putAssetBlob, SPLAT_STORE } from '../../lib/assetStore';

/** How a splat participates in synthetic data generation. */
export type SplatRole = 'backdrop' | 'object';

export type SplatSource =
  | { kind: 'file'; filename: string }
  | { kind: 'url'; url: string }
  | { kind: 'primitive'; primitive: PrimitiveOptions['kind'] }
  | { kind: 'mesh'; meshName: string };

export interface SplatEntry {
  id: string;
  name: string;
  entity: Entity;
  role: SplatRole;
  source: SplatSource;
  /** Label used for bounding boxes when role is 'object'. */
  label: string;
  splatCount: number;
  /** Present for in-app-created splats; enables .ply export. */
  points?: SplatPoint[];
}

export const SPLAT_EXTENSIONS = ['.ply', '.compressed.ply', '.sog'];

export function isSplatFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.ply') || lower.endsWith('.sog');
}

type Listener = (entries: SplatEntry[]) => void;

/**
 * Owns all gaussian splats in the studio scene: imports (.ply /
 * .compressed.ply / .sog), in-app creation (primitives, mesh conversion),
 * roles (backdrop vs labeled object), and lifecycle.
 */
export class SplatManager {
  private app: AppBase;
  private parent: Entity;
  private listeners = new Set<Listener>();
  entries: SplatEntry[] = [];

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

  private register(entry: Omit<SplatEntry, 'id'>, id?: string): SplatEntry {
    const full: SplatEntry = { ...entry, id: id ?? crypto.randomUUID() };
    this.entries.push(full);
    this.parent.addChild(full.entity);
    this.emit();
    return full;
  }

  /**
   * Imports a splat file dropped or picked by the user. `persistedId`
   * is passed by rehydration to reuse the stored id (skips re-saving).
   */
  async importFile(
    file: File,
    role: SplatRole = 'backdrop',
    persistedId?: string
  ): Promise<SplatEntry> {
    if (!isSplatFilename(file.name)) {
      throw new Error(
        `Unsupported splat format: ${file.name}. Supported: ${SPLAT_EXTENSIONS.join(', ')}`
      );
    }
    // The gsplat parsers select by asset.file.filename extension and read
    // asset.file.contents as a Response when present, skipping any fetch.
    const url = URL.createObjectURL(file);
    const asset = new Asset(file.name, 'gsplat', {
      url,
      filename: file.name,
      contents: new Response(file) as unknown as ArrayBuffer,
    });
    try {
      const entry = await this.loadAsset(
        asset,
        file.name,
        role,
        { kind: 'file', filename: file.name },
        persistedId
      );
      if (!persistedId) {
        void putAssetBlob(SPLAT_STORE, entry.id, file).catch((err) =>
          console.warn('splat blob persist failed', err)
        );
      }
      return entry;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Imports a splat from a URL (e.g. a hosted .sog or .compressed.ply). */
  async importUrl(url: string, name: string, role: SplatRole = 'backdrop'): Promise<SplatEntry> {
    const asset = new Asset(name, 'gsplat', { url });
    return this.loadAsset(asset, name, role, { kind: 'url', url });
  }

  private loadAsset(
    asset: Asset,
    name: string,
    role: SplatRole,
    source: SplatSource,
    persistedId?: string
  ): Promise<SplatEntry> {
    return new Promise((resolve, reject) => {
      asset.on('load', () => {
        const entity = new Entity(name, this.app);
        entity.addComponent('gsplat', { asset, unified: true });
        // PLY splat scans are commonly captured Y-down; flip to match scene.
        entity.setLocalEulerAngles(0, 0, 180);
        const resource = asset.resource as { numSplats?: number } | null;
        resolve(
          this.register(
            {
              name,
              entity,
              role,
              source,
              label: defaultLabel(name),
              splatCount: resource?.numSplats ?? 0,
            },
            persistedId
          )
        );
      });
      asset.on('error', (err: string) => reject(new Error(err)));
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  /** Creates a procedural splat primitive in-app. */
  createPrimitive(opts: PrimitiveOptions, role: SplatRole = 'object'): SplatEntry {
    const points = primitiveSplatPoints(opts);
    return this.createFromPoints(`${opts.kind} splat`, points, role, {
      kind: 'primitive',
      primitive: opts.kind,
    });
  }

  /** Converts a mesh entity (e.g. imported GLB) into a splat entry. */
  createFromMesh(
    meshEntity: Entity,
    name: string,
    opts: MeshToSplatOptions = {},
    role: SplatRole = 'object'
  ): SplatEntry {
    const points = meshEntityToSplatPoints(meshEntity, opts);
    if (points.length === 0) {
      throw new Error(`No mesh surface found on "${name}" to convert to splats`);
    }
    return this.createFromPoints(`${name} (splat)`, points, role, {
      kind: 'mesh',
      meshName: name,
    });
  }

  /** Creates a splat entry from raw points (shared by primitives / mesh conversion). */
  createFromPoints(
    name: string,
    points: SplatPoint[],
    role: SplatRole,
    source: SplatSource
  ): SplatEntry {
    const container = buildSplatContainer(this.app.graphicsDevice, points);
    const entity = splatEntityFromContainer(this.app, name, container);
    const entry = this.register({
      name,
      entity,
      role,
      source,
      label: defaultLabel(name),
      splatCount: points.length,
      points,
    });
    // Created splats persist as their PLY serialization so reloads
    // rehydrate them through the normal import path.
    void putAssetBlob(SPLAT_STORE, entry.id, pointsToPly(points)).catch((err) =>
      console.warn('splat blob persist failed', err)
    );
    return entry;
  }

  setRole(id: string, role: SplatRole): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.role = role;
      this.emit();
    }
  }

  setLabel(id: string, label: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.label = label;
      this.emit();
    }
  }

  remove(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index >= 0) {
      const [entry] = this.entries.splice(index, 1);
      entry.entity.destroy();
      void deleteAssetBlob(SPLAT_STORE, entry.id).catch(() => {});
      this.emit();
    }
  }

  get(id: string): SplatEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  destroy(): void {
    for (const entry of this.entries) entry.entity.destroy();
    this.entries = [];
    this.listeners.clear();
  }
}

function defaultLabel(name: string): string {
  return name
    .replace(/\.(compressed\.)?(ply|sog)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase() || 'object';
}
