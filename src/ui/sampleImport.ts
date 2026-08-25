import { Vec3 } from 'playcanvas';
import type { StudioEngine } from '../engine/StudioEngine';
import { centerSplatBackdrop } from '../engine/splats/splatPlacement';
import { snapshotPendingAssets } from '../engine/rehydrateAssets';
import { fetchSampleFile, type SampleAsset } from '../lib/sampleAssets';
import { useStore } from '../store/useStore';

/**
 * Downloads and imports one sample asset through the normal import path
 * (persisted like a user import), with backdrop centering and prop size
 * normalization. Shared by the sample gallery and the first-load prompt.
 */
export async function importSampleAsset(
  engine: StudioEngine,
  sample: SampleAsset
): Promise<void> {
  const { setBusy, setStatus } = useStore.getState();
  try {
    const file = await fetchSampleFile(sample, (mb) =>
      setBusy(`Downloading ${sample.name}… ${mb.toFixed(1)} / ${sample.sizeMB} MB`)
    );
    setBusy(`Importing ${sample.name}…`);
    if (sample.kind === 'splat') {
      const entry = await engine.splats.importFile(file, sample.role ?? 'backdrop');
      if (sample.label) engine.splats.setLabel(entry.id, sample.label);
      if (sample.role === 'backdrop') {
        // Scans arrive at arbitrary world offsets — put the scan's
        // (outlier-robust) center over the origin with its floor at y=0.
        if (centerSplatBackdrop(entry)) {
          engine.focusOn(new Vec3(0, 1.2, 0));
          // The import snapshot ran before centering — persist the
          // corrected transform so reloads restore this placement.
          snapshotPendingAssets(engine);
        }
      }
    } else {
      const entry = await engine.models.importFile(file);
      if (sample.label) engine.models.setLabel(entry.id, sample.label);
      if (sample.targetSize) engine.models.normalizeSize(entry.id, sample.targetSize);
    }
    setStatus('ok', `${sample.name} added (${sample.license} · ${sample.author})`);
  } finally {
    setBusy(null);
  }
}
