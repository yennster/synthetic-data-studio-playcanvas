import { useEffect } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import {
  floorStyleFor,
  migrateLegacySkybox,
} from '../lib/environmentPresets';
import { getAssetBlob, TEXTURE_STORE, type TextureKind } from '../lib/assetStore';

/**
 * Applies the store's environment preset + custom floor/wall textures
 * to the engine (all modes): the preset drives the sky panorama and —
 * for scene presets — the ground material; custom uploads override
 * whichever piece they cover. Texture bytes are pulled from IndexedDB
 * on demand, so uploads survive reloads without bloating localStorage.
 */
export function EnvironmentSync() {
  const engine = useEngine();
  const envPreset = useStore((s) => s.envPreset);
  const customFloor = useStore((s) => s.customFloorTexture);
  const customWall = useStore((s) => s.customWallTexture);

  // One-time migration: earlier builds persisted the sky under a
  // separate `skybox` field. Adopt it into envPreset, then blank the
  // legacy field so this never re-fires.
  useEffect(() => {
    const s = useStore.getState();
    if (s.skybox === 'none') return;
    const migrated = migrateLegacySkybox(s.envPreset, s.skybox);
    if (migrated) s.setEnvPreset(migrated);
    // Always blank the legacy field — even when not adopted (e.g. envPreset
    // was already chosen elsewhere), a lingering value would get re-adopted
    // the next time the user picks 'none', making that choice never stick.
    s.setSkybox('none');
  }, []);

  useEffect(() => {
    if (!engine) return;
    engine.skybox.setPreset(envPreset);
    engine.environment.setFloorStyle(floorStyleFor(envPreset));
  }, [engine, envPreset]);

  // Custom floor → ground diffuse map (tiled); custom wall → equirect
  // sky panorama. Both load their blob out of IndexedDB keyed by slot.
  useEffect(
    () =>
      applyCustomTexture(engine, 'floor', customFloor, (bmp) =>
        engine!.environment.setCustomFloorTexture(bmp)
      ),
    [engine, customFloor]
  );
  useEffect(
    () =>
      applyCustomTexture(engine, 'wall', customWall, (bmp) =>
        engine!.skybox.setCustomPanorama(bmp)
      ),
    [engine, customWall]
  );

  return null;
}

/**
 * Effect body for one texture slot: decode the stored blob and hand the
 * bitmap to the engine, or clear the slot when meta is null/missing.
 * Returns the effect cleanup.
 */
function applyCustomTexture(
  engine: ReturnType<typeof useEngine>,
  kind: TextureKind,
  meta: { name: string } | null,
  apply: (bmp: ImageBitmap | null) => void
): (() => void) | undefined {
  if (!engine) return undefined;
  if (!meta) {
    apply(null);
    return undefined;
  }
  let cancelled = false;
  void (async () => {
    try {
      const blob = await getAssetBlob(TEXTURE_STORE, kind);
      if (cancelled) return;
      if (!blob) {
        // Meta without bytes (e.g. IDB cleared elsewhere) — treat as unset.
        apply(null);
        return;
      }
      const bmp = await createImageBitmap(blob);
      if (cancelled) {
        bmp.close();
        return;
      }
      apply(bmp);
    } catch (err) {
      console.warn(`[textures] failed to load custom ${kind}:`, err);
    }
  })();
  return () => {
    cancelled = true;
  };
}
