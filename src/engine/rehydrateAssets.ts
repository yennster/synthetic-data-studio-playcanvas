import type { StudioEngine } from './StudioEngine';
import { useStore, type PendingAsset } from '../store/useStore';
import { getAssetBlob, deleteAssetBlob, MODEL_STORE, SPLAT_STORE } from '../lib/assetStore';

// Module-level guard (not a ref): React StrictMode's synthetic remount
// would otherwise race two rehydrations into the asset managers.
let rehydrateStarted = false;

/** Test hook. */
export function _resetRehydrateForTest(): void {
  rehydrateStarted = false;
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
  try {
    for (const meta of pendingSplats) {
      try {
        const blob = await getAssetBlob(SPLAT_STORE, meta.id);
        if (!blob) {
          console.warn(`splat blob missing for ${meta.name}; pruning`);
          continue;
        }
        const file = new File([blob], meta.filename);
        const entry = await engine.splats.importFile(file, meta.role ?? 'backdrop', meta.id);
        engine.splats.setLabel(entry.id, meta.label);
        applyTransform(entry.entity, meta);
      } catch (err) {
        console.warn(`splat restore failed for ${meta.name}`, err);
        void deleteAssetBlob(SPLAT_STORE, meta.id).catch(() => {});
      }
    }
    for (const meta of pendingModels) {
      try {
        const blob = await getAssetBlob(MODEL_STORE, meta.id);
        if (!blob) {
          console.warn(`model blob missing for ${meta.name}; pruning`);
          continue;
        }
        const file = new File([blob], meta.filename);
        const entry = await engine.models.importFile(file, meta.id);
        engine.models.setLabel(entry.id, meta.label);
        applyTransform(entry.entity, meta);
      } catch (err) {
        console.warn(`model restore failed for ${meta.name}`, err);
        void deleteAssetBlob(MODEL_STORE, meta.id).catch(() => {});
      }
    }
  } finally {
    setBusy(null);
  }
}

/**
 * Builds pending metadata from live entries; the shell calls this on
 * every entries change so reloads restore the latest state.
 */
export function snapshotPendingAssets(engine: StudioEngine): void {
  const store = useStore.getState();
  const vec = (v: { x: number; y: number; z: number }): [number, number, number] => [
    v.x,
    v.y,
    v.z,
  ];

  store.setPendingSplats(
    engine.splats.entries.map((e) => ({
      id: e.id,
      name: e.name,
      filename:
        e.source.kind === 'file'
          ? e.source.filename
          : `${e.name.replace(/[^a-zA-Z0-9_. -]/g, '_') || 'splat'}.ply`,
      label: e.label,
      role: e.role,
      position: vec(e.entity.getLocalPosition()),
      eulerAngles: vec(e.entity.getLocalEulerAngles()),
      scale: vec(e.entity.getLocalScale()),
    }))
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
    }))
  );
}
