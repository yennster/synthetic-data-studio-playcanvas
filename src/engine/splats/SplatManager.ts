import { Asset, Entity, type AppBase, type BoundingBox } from 'playcanvas';
import { computeTightLocalAabb } from './splatPlacement';
import {
  buildSplatContainer,
  primitiveSplatPoints,
  splatEntityFromContainer,
  type PrimitiveOptions,
  type SplatPoint,
} from './splatCreate';
import { meshEntityToSplatPoints, type MeshToSplatOptions } from './meshToSplat';
import { gsplatDataToPly, pointsToPly } from './splatExport';
import { deleteAssetBlob, putAssetBlob, SPLAT_STORE } from '../../lib/assetStore';
import { gunzip, parseSpz, spzToGsplatData } from '../../lib/spz';
import { shouldCoalesceOps, type SplatEditOp } from '../../lib/splatOps';

/** How a splat participates in synthetic data generation. */
export type SplatRole = 'backdrop' | 'object';

export type SplatSource =
  | { kind: 'file'; filename: string }
  | { kind: 'url'; url: string }
  | { kind: 'primitive'; primitive: PrimitiveOptions['kind'] }
  | { kind: 'mesh'; meshName: string }
  | { kind: 'image'; imageName: string };

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
  /** Present for imported splats; unloaded on remove. */
  asset?: Asset;
  /** Outlier-trimmed local AABB (scan floaters inflate resource.aabb);
   * used for bounding boxes, selection, and hit-testing. */
  tightAabb?: BoundingBox;
  /** Cached LOCAL-space point sample (inside tightAabb) for tight
   * screen-space bounding boxes. */
  labelSample?: Float32Array;
  /** Recorded GPU brush edits (LOCAL splat space): replayed on reload and
   * baked into destructive exports. See lib/splatOps.ts. */
  editOps?: SplatEditOp[];
}

export const SPLAT_EXTENSIONS = ['.ply', '.compressed.ply', '.sog', '.spz'];

export function isSplatFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.ply') || lower.endsWith('.sog') || lower.endsWith('.spz');
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
   * Outlier-trimmed LOCAL AABB for an entry, computed lazily (splat
   * centers aren't available at the moment the load event fires) and
   * cached on the entry.
   */
  tightLocalAabb(entry: SplatEntry): BoundingBox | null {
    if (entry.tightAabb) return entry.tightAabb;
    const resource = entry.entity.gsplat?.resource as
      | { centers?: Float32Array }
      | null
      | undefined;
    const computed = computeTightLocalAabb(resource);
    if (computed) entry.tightAabb = computed;
    return computed;
  }

  /**
   * LOCAL-space point sample for screen-space label boxes: up to ~5000
   * splat centers inside the outlier-trimmed bounds. Lazy + cached.
   */
  labelSamplePoints(entry: SplatEntry): Float32Array | null {
    if (entry.labelSample) return entry.labelSample;
    const tight = this.tightLocalAabb(entry);
    const resource = entry.entity.gsplat?.resource as
      | { centers?: Float32Array }
      | null
      | undefined;
    const centers = resource?.centers;
    if (!tight || !centers || centers.length < 30) return null;
    const count = centers.length / 3;
    const step = Math.max(1, Math.floor(count / 5000));
    const min = tight.getMin();
    const max = tight.getMax();
    const out: number[] = [];
    for (let i = 0; i < count; i += step) {
      const x = centers[i * 3];
      const y = centers[i * 3 + 1];
      const z = centers[i * 3 + 2];
      if (
        x >= min.x && x <= max.x &&
        y >= min.y && y <= max.y &&
        z >= min.z && z <= max.z
      ) {
        out.push(x, y, z);
      }
    }
    if (out.length < 30) return null;
    entry.labelSample = new Float32Array(out);
    return entry.labelSample;
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
    // The engine has no .spz parser — transcode Niantic SPZ to an
    // uncompressed 3DGS .ply in memory and feed it through the normal
    // .ply path. The ORIGINAL .spz blob is what persists in IndexedDB
    // (10–20× smaller); rehydration re-transcodes on load.
    let loadFile = file;
    if (file.name.toLowerCase().endsWith('.spz')) {
      const gaussians = parseSpz(await gunzip(await file.arrayBuffer()));
      const data = spzToGsplatData(gaussians);
      loadFile = new File(
        [gsplatDataToPly(data)],
        file.name.replace(/\.spz$/i, '.ply')
      );
    }
    // The gsplat parsers select by asset.file.filename extension and read
    // asset.file.contents as a Response when present, skipping any fetch.
    const url = URL.createObjectURL(loadFile);
    const asset = new Asset(loadFile.name, 'gsplat', {
      url,
      filename: loadFile.name,
      contents: new Response(loadFile) as unknown as ArrayBuffer,
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
              asset,
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

  /**
   * Moves/rotates/scales a splat from the UI. Yaw composes with the
   * import-time 180° Z flip. Emits so persistence snapshots capture it.
   */
  setTransform(
    id: string,
    patch: { position?: [number, number, number]; yawDeg?: number; scale?: number }
  ): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (patch.position) entry.entity.setLocalPosition(...patch.position);
    if (patch.yawDeg !== undefined) {
      const e = entry.entity.getLocalEulerAngles();
      entry.entity.setLocalEulerAngles(e.x, patch.yawDeg, e.z);
    }
    if (patch.scale !== undefined && patch.scale > 0) {
      entry.entity.setLocalScale(patch.scale, patch.scale, patch.scale);
    }
    this.emit();
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

  /**
   * Records a GPU brush op (LOCAL splat space) on the entry that owns
   * `entity`. Near-identical drag strokes are coalesced. Does NOT emit —
   * brush strokes arrive per mousemove; call {@link notifyEditsChanged}
   * once at stroke end so persistence snapshots the log.
   */
  recordEditOp(entity: Entity, op: SplatEditOp): void {
    const entry = this.entries.find((e) => e.entity === entity);
    if (!entry) return;
    const ops = entry.editOps ?? (entry.editOps = []);
    if (ops.length > 0 && shouldCoalesceOps(ops[ops.length - 1], op)) return;
    ops.push(op);
  }

  /** Emits after a batch of {@link recordEditOp} calls (stroke end). */
  notifyEditsChanged(): void {
    this.emit();
  }

  /** Drops an entry's recorded edit ops (pairs with a GPU edit reset). */
  clearEditOps(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry && entry.editOps) {
      entry.editOps = undefined;
      this.emit();
    }
  }

  remove(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index >= 0) {
      const [entry] = this.entries.splice(index, 1);
      entry.entity.destroy();
      if (entry.asset) {
        this.app.assets.remove(entry.asset);
        entry.asset.unload();
      }
      void deleteAssetBlob(SPLAT_STORE, entry.id).catch(() => {});
      this.emit();
    }
  }

  get(id: string): SplatEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  destroy(): void {
    for (const entry of this.entries) {
      entry.entity.destroy();
      if (entry.asset) {
        this.app.assets.remove(entry.asset);
        entry.asset.unload();
      }
    }
    this.entries = [];
    this.listeners.clear();
  }
}

function defaultLabel(name: string): string {
  return name
    .replace(/\.(compressed\.)?(ply|sog|spz)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase() || 'object';
}
