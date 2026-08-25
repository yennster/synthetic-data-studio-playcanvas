import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import {
  isSplatFilename,
  SPLAT_EXTENSIONS,
  type SplatEntry,
} from '../engine/splats/SplatManager';
import { pointsToPly } from '../engine/splats/splatExport';
import { centerSplatBackdrop, groundSplatObject } from '../engine/splats/splatPlacement';
import { snapshotPendingAssets } from '../engine/rehydrateAssets';
import { saveBlob } from '../lib/captureFormats';
import { NumberField, SliderRow } from './primitives';

/**
 * Splat library card: import scans, create primitives, manage roles/labels.
 */
export function SplatLibrary() {
  const engine = useEngine();
  const splats = useStore((s) => s.splats);
  const setBusy = useStore((s) => s.setBusy);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [erasingId, setErasingId] = useState<string | null>(null);
  const [brushRadius, setBrushRadius] = useState(0.15);

  // Keep the engine's erase brush in step with the UI state.
  useEffect(() => {
    if (!engine) return;
    const entry = erasingId ? engine.splats.get(erasingId) : undefined;
    engine.setEraseMode(entry?.entity ?? null, brushRadius);
    return () => engine.setEraseMode(null);
  }, [engine, erasingId, brushRadius]);

  // Drop the brush if its target splat is removed.
  useEffect(() => {
    if (erasingId && !splats.some((s) => s.id === erasingId)) {
      setErasingId(null);
    }
  }, [splats, erasingId]);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!engine) return;
      setError(null);
      for (const file of Array.from(files)) {
        if (!isSplatFilename(file.name)) {
          setError(`${file.name}: unsupported (use ${SPLAT_EXTENSIONS.join(', ')})`);
          continue;
        }
        setBusy(`Importing ${file.name}…`);
        try {
          await engine.splats.importFile(file);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(null);
        }
      }
    },
    [engine, setBusy]
  );

  return (
    <section className="card">
      <h2>Gaussian Splats</h2>
      <div
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void importFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        Drop .ply / .compressed.ply / .sog here, or click to browse
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ply,.sog"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="button-row">
        <button
          disabled={!engine}
          onClick={() => engine?.splats.createPrimitive({ kind: 'plane', size: 4, count: 30000 })}
        >
          + Plane
        </button>
        <button
          disabled={!engine}
          onClick={() => engine?.splats.createPrimitive({ kind: 'box', size: 0.5 })}
        >
          + Box
        </button>
        <button
          disabled={!engine}
          onClick={() => engine?.splats.createPrimitive({ kind: 'sphere', size: 0.5 })}
        >
          + Sphere
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <ul className="asset-list">
        {splats.map((entry) => (
          <li key={entry.id} className="splat-row">
            <span className="asset-name splat-row-name" title={`${entry.name} — ${entry.splatCount} splats`}>
              {entry.name}
            </span>
            <div className="splat-row-main">
              <select
                value={entry.role}
                aria-label={`${entry.name} role`}
                onChange={(e) =>
                  engine?.splats.setRole(entry.id, e.target.value as 'backdrop' | 'object')
                }
              >
                <option value="backdrop">backdrop</option>
                <option value="object">object</option>
              </select>
              <span className="splat-row-spacer" />
              <button
                className={`icon${erasingId === entry.id ? ' primary' : ''}`}
                title="Edit: move / erase brush (right-drag in the scene)"
                onClick={() =>
                  setErasingId(erasingId === entry.id ? null : entry.id)
                }
              >
                ⛭
              </button>
              {entry.points && (
                <button
                  className="icon"
                  title="Export as .ply (3D Gaussian Splatting)"
                  onClick={() =>
                    saveBlob(
                      pointsToPly(entry.points!),
                      `${entry.name.replace(/\.(compressed\.)?(ply|sog)$/i, '') || 'splat'}.ply`
                    )
                  }
                >
                  ⤓
                </button>
              )}
              <button
                className="icon"
                title="Remove"
                onClick={() => engine?.splats.remove(entry.id)}
              >
                ✕
              </button>
            </div>
            {erasingId === entry.id && (
              <div className="splat-row-edit">
                <SplatTransformControls entry={entry} />
                <label>
                  Brush {brushRadius.toFixed(2)} m
                  <input
                    type="range"
                    min={0.02}
                    max={1}
                    step={0.01}
                    value={brushRadius}
                    onChange={(e) => setBrushRadius(Number(e.target.value))}
                  />
                </label>
                <button
                  title="Re-center this scan: floor to y=0, center over the origin — fixes scans placed before the floor convention (or after manual moves)"
                  onClick={() => {
                    if (!engine) return;
                    const e = engine.splats.get(entry.id);
                    if (!e) return;
                    const ok =
                      e.role === 'backdrop'
                        ? centerSplatBackdrop(e)
                        : groundSplatObject(e);
                    if (ok) snapshotPendingAssets(engine);
                  }}
                >
                  ⌖ Ground here
                </button>
                <button
                  onClick={() => {
                    const e = engine?.splats.get(entry.id);
                    if (e) engine?.splatEditor.resetVisibility(e.entity);
                  }}
                >
                  Reset edits
                </button>
                <p className="hint">Right-drag on the splat to erase. LMB orbits.</p>
              </div>
            )}
          </li>
        ))}
        {splats.length === 0 && <li className="empty">No splats yet</li>}
      </ul>
    </section>
  );
}

/** Move / rotate / scale controls for one splat entry. */
function SplatTransformControls({ entry }: { entry: SplatEntry }) {
  const engine = useEngine();
  const [, setTick] = useState(0);
  const pos = entry.entity.getLocalPosition();
  const yaw = entry.entity.getLocalEulerAngles().y;
  const scale = entry.entity.getLocalScale().x;
  const move = (axis: 0 | 1 | 2, value: number) => {
    const p: [number, number, number] = [pos.x, pos.y, pos.z];
    p[axis] = value;
    engine?.splats.setTransform(entry.id, { position: p });
    setTick((t) => t + 1);
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return (
    <>
      <div className="splat-move-row">
        <NumberField label="X" value={r2(pos.x)} min={-50} max={50} step={0.1} onChange={(v) => move(0, v)} />
        <NumberField label="Y" value={r2(pos.y)} min={-50} max={50} step={0.1} onChange={(v) => move(1, v)} />
        <NumberField label="Z" value={r2(pos.z)} min={-50} max={50} step={0.1} onChange={(v) => move(2, v)} />
      </div>
      <SliderRow
        label="Rotate"
        value={yaw}
        min={-180}
        max={180}
        step={1}
        formatValue={(v) => `${Math.round(v)}°`}
        onChange={(v) => {
          engine?.splats.setTransform(entry.id, { yawDeg: v });
          setTick((t) => t + 1);
        }}
      />
      <SliderRow
        label="Scale ×"
        value={scale}
        min={0.05}
        max={5}
        step={0.05}
        onChange={(v) => {
          engine?.splats.setTransform(entry.id, { scale: v });
          setTick((t) => t + 1);
        }}
      />
    </>
  );
}
