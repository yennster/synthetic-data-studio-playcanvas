/**
 * Applies parsed URL presets/flags to the store at boot — the app-layer
 * wiring for the pure parsers in urlParams.ts and embed.ts. Called once
 * from App before the engine mounts.
 */

import { URL_FLAGS, URL_PRESETS } from './urlParams';
import {
  applyApiKeyFromUrl,
  applyEiCategoryFromUrl,
  applyThemeFromUrl,
} from './embed';
import { setEdgeImpulseHosts } from './edgeImpulse';
import { defaultObject, useStore } from '../store/useStore';

let applied = false;

export function applyUrlPresets(): void {
  if (applied || typeof window === 'undefined') return;
  applied = true;

  // `?clearStore=1`: wipe persistence, then reload without the flag so
  // the store rehydrates from a clean slate.
  if (URL_FLAGS.clearStore) {
    localStorage.clear();
    try {
      indexedDB.deleteDatabase('sds-pc-assets');
    } catch {
      // best effort
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('clearStore');
    window.location.replace(url.toString());
    return;
  }

  const search = window.location.search;
  const store = useStore.getState();

  // EI host overrides must land before any EI call (allowlisted inside).
  const params = new URLSearchParams(search);
  setEdgeImpulseHosts({
    studioHost: params.get('studioHost'),
    ingestionHost: params.get('ingestionHost'),
  });

  applyApiKeyFromUrl(search, (apiKey) => store.setEi({ apiKey }));
  applyEiCategoryFromUrl(search, (category) => store.setEi({ category }));
  applyThemeFromUrl(search, (theme) => store.setTheme(theme));

  const p = URL_PRESETS;
  if (p.mode) store.setMode(p.mode);
  if (p.theme) store.setTheme(p.theme);
  if (p.eiLabel) store.setEi({ label: p.eiLabel });
  if (p.eiCategory) store.setEi({ category: p.eiCategory });
  if (p.robotKind) store.setRobot({ kind: p.robotKind });
  if (p.roverEvent) store.setRobot({ roverEvent: p.roverEvent });
  if (p.sampleRate !== undefined) store.setSampleRateHz(p.sampleRate);

  const capturePatch: Partial<import('../store/useStore').CaptureSettings> = {};
  if (p.batchCount !== undefined) capturePatch.batchCount = p.batchCount;
  if (p.trajectory !== undefined) capturePatch.cameraTrajectory = p.trajectory;
  if (p.trajectoryRadius !== undefined)
    capturePatch.trajectoryRadius = p.trajectoryRadius;
  if (p.trajectoryHeight !== undefined)
    capturePatch.trajectoryHeight = p.trajectoryHeight;
  if (p.fov !== undefined) capturePatch.fov = p.fov;
  if (p.resolution) {
    capturePatch.width = p.resolution.width;
    capturePatch.height = p.resolution.height;
  }
  if (p.camPos) capturePatch.camPos = p.camPos;
  if (p.camTarget) capturePatch.camTarget = p.camTarget;
  if (p.lightIntensity !== undefined) capturePatch.lightIntensity = p.lightIntensity;
  if (Object.keys(capturePatch).length > 0) store.setCapture(capturePatch);

  if (p.realismMode) store.setRealism({ mode: p.realismMode });
  if (p.realism) store.setRealism(p.realism);

  // Seed the scene with primitive objects (?objects=cube,sphere&objectCount=N).
  if (p.objects && p.objects.length > 0) {
    const count = p.objectCount ?? p.objects.length;
    for (let i = 0; i < count; i++) {
      const kind = p.objects[i % p.objects.length];
      store.addObject(defaultObject(kind, kind, i));
    }
  }
}

/** Test hook. */
export function _resetApplyUrlPresetsForTest(): void {
  applied = false;
}
