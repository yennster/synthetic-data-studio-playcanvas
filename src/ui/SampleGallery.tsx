import { useState } from 'react';
import { Vec3 } from 'playcanvas';
import { useEngine } from '../engine/EngineContext';
import { centerSplatBackdrop } from '../engine/splats/splatPlacement';
import { snapshotPendingAssets } from '../engine/rehydrateAssets';
import { useStore } from '../store/useStore';
import { CollapsibleCard } from './primitives';
import {
  fetchSampleFile,
  SAMPLE_ASSETS,
  type SampleAsset,
} from '../lib/sampleAssets';
import './gallery.css';

/**
 * One-click sample gallery: photoreal splat environments and showcase
 * GLB props with their CC-BY/CC0 credits. Downloads route through the
 * normal import path, so samples persist like any user import.
 */
export function SampleGallery() {
  const engine = useEngine();
  const splats = useStore((s) => s.splats);
  const models = useStore((s) => s.models);
  const setBusy = useStore((s) => s.setBusy);
  const setStatus = useStore((s) => s.setStatus);
  const [loading, setLoading] = useState<string | null>(null);

  const isLoaded = (sample: SampleAsset) =>
    sample.kind === 'splat'
      ? splats.some((e) => e.name === sample.filename)
      : models.some((e) => e.name === sample.filename);

  const importSample = async (sample: SampleAsset) => {
    if (!engine || loading) return;
    setLoading(sample.name);
    try {
      const file = await fetchSampleFile(sample, (mb) =>
        setBusy(`Downloading ${sample.name}… ${mb.toFixed(1)} / ${sample.sizeMB} MB`)
      );
      setBusy(`Importing ${sample.name}…`);
      if (sample.kind === 'splat') {
        const entry = await engine.splats.importFile(file, sample.role ?? 'backdrop');
        if (sample.label) engine.splats.setLabel(entry.id, sample.label);
        if (sample.role === 'backdrop') {
          // Scans arrive in arbitrary world offsets — bring the scan's
          // (outlier-robust) center over the origin at a livable height
          // so the studio camera starts inside the environment.
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
    } catch (err) {
      setStatus('err', (err as Error).message);
    } finally {
      setBusy(null);
      setLoading(null);
    }
  };

  const renderGroup = (kind: 'splat' | 'model', title: string) => (
    <div className="gallery-group">
      <h3>{title}</h3>
      <ul className="gallery-list">
        {SAMPLE_ASSETS.filter((s) => s.kind === kind).map((sample) => (
          <li key={sample.name} className="gallery-row">
            <div className="gallery-main">
              <span className="gallery-name">{sample.name}</span>
              <span className="gallery-size">{sample.sizeMB} MB</span>
              <button
                disabled={!engine || loading !== null || isLoaded(sample)}
                onClick={() => void importSample(sample)}
              >
                {isLoaded(sample)
                  ? '✓ Added'
                  : loading === sample.name
                    ? 'Loading…'
                    : '+ Add'}
              </button>
            </div>
            <a
              className="gallery-credit"
              href={sample.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {sample.license} · {sample.author}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <CollapsibleCard heading="Sample gallery" storageKey="sample-gallery" defaultOpen>
      <p className="gallery-hint">
        Photoreal splat scans to use as capture environments, and props to
        detect (or convert to splats). Downloads once, then persists.
      </p>
      {renderGroup('splat', 'Splat environments')}
      {renderGroup('model', 'Props (GLB)')}
    </CollapsibleCard>
  );
}
