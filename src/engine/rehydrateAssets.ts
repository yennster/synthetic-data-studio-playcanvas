import type { StudioEngine } from './StudioEngine';
import { useStore, type PendingAsset } from '../store/useStore';
import { getAssetBlob, deleteAssetBlob, MODEL_STORE, SPLAT_STORE } from '../lib/assetStore';
import { flipEditOpsZ180, plyReimportEuler, sanitizeEditOps } from '../lib/splatOps';

// Module-level guard (not a ref): React StrictMode's synthetic remount
// would otherwise race two rehydrations into the asset managers.
let rehydrateStarted = false;
// While restoring, manager onChange events fire per import — snapshots
// taken then would overwrite the FULL pending list with the partial one
// and permanently drop everything not yet restored.
let rehydrating = false;

/** Test hook. */
export function _resetRehydrateForTest(): void {
  rehydrateStarted = false;
  rehydrating = false;
}

function applyTransform(
  entity: { setLocalPosition(x: number, y: number, z: number): void; setLocalEulerAngles(x: number, y: number, z: number): void; setLocalScale(x: number, y: number, z: number): void },
  meta: PendingAsset
): void {
  entity.setLocalPosition(...meta.position);
  entity.setLocalEulerAngles(...meta.eulerAngles);
  entity.setLocalScale(...meta.scale);
}

/**
 * Re-imports persisted splats/models from IndexedDB blobs at boot,
 * restoring roles, labels, and transforms. Missing blobs are pruned.
 */
export async function rehydrateAssets(engine: StudioEngine): Promise<void> {
  if (rehydrateStarted) return;
  rehydrateStarted = true;

  const { pendingSplats, pendingModels, setBusy } = useStore.getState();
  const total = pendingSplats.length + pendingModels.length;
  if (total === 0) return;

  setBusy(`Restoring ${total} asset(s)…`);
  rehydrating = true;
  try {
    for (const meta of pendingSplats) {
      try {
        const blob = await getAssetBlob(SPLAT_STORE, meta.id);
        if (!blob) {
          // Only a genuinely missing blob is pruned — import errors keep
          // the bytes so a fixed build can restore them later.
          console.warn(`splat blob missing for ${meta.name}; pruning`);
          void deleteAssetBlob(SPLAT_STORE, meta.id).catch(() => {});
          continue;
        }
        const file = new File([blob], meta.filename);
        const entry = await engine.splats.importFile(file, meta.role ?? 'backdrop', meta.id);
        engine.splats.setLabel(entry.id, meta.label);
        applyTransform(entry.entity, meta);
        if (!entry.entity.enabled && meta.enabled !== false) entry.entity.enabled = true;
        if (meta.enabled === false) entry.entity.enabled = false;
        // Brush edits are GPU-side visibility/tint streams — replay the
        // recorded op log so erase/tint edits survive reloads.
        const ops = sanitizeEditOps(meta.editOps);
        if (ops.length > 0) {
          entry.editOps = ops;
          for (const op of ops) engine.splatEditor.applyOp(entry.entity, op);
        }
      } catch (err) {
        console.warn(`splat restore failed for ${meta.name}`, err);
      }
    }
    for (const meta of pendingModels) {
      try {
        const blob = await getAssetBlob(MODEL_STORE, meta.id);
        if (!blob) {
          console.warn(`model blob missing for ${meta.name}; pruning`);
          void deleteAssetBlob(MODEL_STORE, meta.id).catch(() => {});
          continue;
        }
        const file = new File([blob], meta.filename);
        const entry = await engine.models.importFile(file, meta.id);
        engine.models.setLabel(entry.id, meta.label);
        applyTransform(entry.entity, meta);
        // Restore the material/color override before anything renders.
        if (meta.override) {
          engine.models.setMaterialOverride(entry.id, meta.override);
        }
        // A model converted to splats stays hidden behind its splat twin.
        if (meta.enabled === false) entry.entity.enabled = false;
      } catch (err) {
        console.warn(`model restore failed for ${meta.name}`, err);
      }
    }
  } finally {
    rehydrating = false;
    setBusy(null);
    // One authoritative snapshot now that everything that could restore has.
    snapshotPendingAssets(engine);
  }
}

/**
 * Builds pending metadata from live entries; the shell calls this on
 * every entries change so reloads restore the latest state. No-op while
 * rehydration is in progress (partial lists must not clobber the store).
 */
export function snapshotPendingAssets(engine: StudioEngine): void {
  if (rehydrating) return;
  const store = useStore.getState();
  const vec = (v: { x: number; y: number; z: number }): [number, number, number] => [
    v.x,
    v.y,
    v.z,
  ];

  store.setPendingSplats(
    engine.splats.entries.map((e) => {
      // Created splats (primitive/mesh/image) persist as a Y-down .ply and
      // reload through the import path, so their euler must be converted
      // to the .ply convention (see plyReimportEuler). File/url imports
      // already live in that convention.
      const created = e.source.kind !== 'file' && e.source.kind !== 'url';
      const euler = vec(e.entity.getLocalEulerAngles());
      return {
        id: e.id,
        name: e.name,
        filename:
          e.source.kind === 'file'
            ? e.source.filename
            : `${e.name.replace(/[^a-zA-Z0-9_. -]/g, '_') || 'splat'}.ply`,
        label: e.label,
        role: e.role,
        position: vec(e.entity.getLocalPosition()),
        eulerAngles: created ? plyReimportEuler(euler) : euler,
        scale: vec(e.entity.getLocalScale()),
        enabled: e.entity.enabled,
        // Created-splat ops were recorded against creation-space data; the
        // persisted .ply is flipped, so the persisted ops flip with it.
        editOps: e.editOps?.length
          ? created
            ? flipEditOpsZ180(e.editOps)
            : e.editOps
          : undefined,
      };
    })
  );
  store.setPendingModels(
    engine.models.entries.map((e) => ({
      id: e.id,
      name: e.name,
      filename: e.source.kind === 'file' ? e.source.filename : `${e.name}.glb`,
      label: e.label,
      position: vec(e.entity.getLocalPosition()),
      eulerAngles: vec(e.entity.getLocalEulerAngles()),
      scale: vec(e.entity.getLocalScale()),
      enabled: e.entity.enabled,
      override: { ...e.override },
    }))
  );
}
