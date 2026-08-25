import { useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import { CollapsibleCard } from './primitives';
import { importSampleAsset } from './sampleImport';
import { SAMPLE_ASSETS, type SampleAsset } from '../lib/sampleAssets';
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
  const setStatus = useStore((s) => s.setStatus);
  const [loading, setLoading] = useState<string | null>(null);

  const matches = (sample: SampleAsset) =>
    sample.kind === 'splat'
      ? splats.filter((e) => e.name === sample.filename)
      : models.filter(
          (e) =>
            e.name === sample.filename || e.name.startsWith(`${sample.filename} (`)
        );

  const addCopy = (sample: SampleAsset) => {
    if (!engine) return;
    const existing = matches(sample);
    if (existing.length === 0) {
      void importSample(sample);
    } else if (sample.kind === 'model') {
      engine.models.duplicate(existing[0].id);
    }
  };

  const removeCopy = (sample: SampleAsset) => {
    if (!engine) return;
    const existing = matches(sample);
    if (existing.length === 0) return;
    const last = existing[existing.length - 1];
    if (sample.kind === 'splat') engine.splats.remove(last.id);
    else engine.models.remove(last.id);
  };

  const importSample = async (sample: SampleAsset) => {
    if (!engine || loading) return;
    setLoading(sample.name);
    try {
      await importSampleAsset(engine, sample);
    } catch (err) {
      setStatus('err', (err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const renderGroup = (kind: 'splat' | 'model', title: string) => (
    <div className="gallery-group">
      <h3>{title}</h3>
      <ul className="gallery-list">
        {SAMPLE_ASSETS.filter((s) => s.kind === kind).map((sample) => {
          const count = matches(sample).length;
          const busy = loading !== null;
          return (
            <li key={sample.name} className="gallery-row">
              <div className="gallery-main">
                <span className="gallery-name">{sample.name}</span>
                <span className="gallery-size">{sample.sizeMB} MB</span>
                {loading === sample.name ? (
                  <span className="gallery-size">Loading…</span>
                ) : (
                  <span className="gallery-counter">
                    <button
                      className="icon"
                      aria-label={`Remove one ${sample.name}`}
                      disabled={!engine || busy || count === 0}
                      onClick={() => removeCopy(sample)}
                    >
                      −
                    </button>
                    <span className="gallery-count">{count}</span>
                    <button
                      className="icon"
                      aria-label={`Add one ${sample.name}`}
                      disabled={
                        !engine ||
                        busy ||
                        (sample.kind === 'splat' && count > 0)
                      }
                      onClick={() => addCopy(sample)}
                    >
                      +
                    </button>
                  </span>
                )}
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
          );
        })}
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
