import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import {
  isSplatFilename,
  SPLAT_EXTENSIONS,
  type SplatEntry,
} from '../engine/splats/SplatManager';
import { gsplatDataToPly, pointsToPly } from '../engine/splats/splatExport';
import { imageFileToPixels, imagePixelsToSplatPoints } from '../engine/splats/splatCreate';
import { readGsplatCpu } from '../engine/splats/readGsplatCpu';
import { centerSplatBackdrop, groundSplatObject } from '../engine/splats/splatPlacement';
import { snapshotPendingAssets } from '../engine/rehydrateAssets';
import { applyOpsToGsplatData, applyOpsToPoints } from '../lib/splatOps';
import { saveBlob } from '../lib/captureFormats';
import { NumberField, SliderRow } from './primitives';

type BrushMode = 'erase' | 'tint';

/** '#rrggbb' → linear-ish 0..1 rgb triple for the tint brush. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Splat library card: import scans, create primitives / image planes,
 * manage roles/labels, brush-edit (erase / paint tint), export.
 */
export function SplatLibrary() {
  const engine = useEngine();
  const splats = useStore((s) => s.splats);
  const setBusy = useStore((s) => s.setBusy);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [erasingId, setErasingId] = useState<string | null>(null);
  const [brushRadius, setBrushRadius] = useState(0.15);
  const [brushMode, setBrushMode] = useState<BrushMode>('erase');
  const [tintColor, setTintColor] = useState('#e0483c');
  const [tintStrength, setTintStrength] = useState(0.8);

  // Keep the engine's brush in step with the UI state.
  useEffect(() => {
    if (!engine) return;
    const entry = erasingId ? engine.splats.get(erasingId) : undefined;
    engine.setEraseMode(entry?.entity ?? null, brushRadius, {
      mode: brushMode,
      tintColor: hexToRgb(tintColor),
      tintStrength,
    });
    return () => engine.setEraseMode(null);
  }, [engine, erasingId, brushRadius, brushMode, tintColor, tintStrength]);

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

  const importImage = useCallback(
    async (file: File) => {
      if (!engine) return;
      setError(null);
      setBusy(`Converting ${file.name} to splats…`);
      try {
        const pixels = await imageFileToPixels(file);
        const points = imagePixelsToSplatPoints(pixels);
        if (points.length === 0) {
          throw new Error(`${file.name}: no opaque pixels to convert`);
        }
        const name = file.name.replace(/\.[a-z0-9]+$/i, '') || 'image';
        engine.splats.createFromPoints(`${name} (image)`, points, 'object', {
          kind: 'image',
          imageName: file.name,
        });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [engine, setBusy]
  );

  const exportEntry = useCallback(
    (entry: SplatEntry) => {
      const ops = entry.editOps ?? [];
      const filename = `${entry.name.replace(/\.(compressed\.)?(ply|sog|spz)$/i, '') || 'splat'}.ply`;
      setBusy(`Exporting ${filename}…`);
      // Let the busy indicator paint before the synchronous CPU bake.
      setTimeout(() => {
        try {
          if (entry.points) {
            saveBlob(pointsToPly(applyOpsToPoints(entry.points, ops)), filename);
            return;
          }
          const resource = entry.entity.gsplat?.resource as
            | { gsplatData?: unknown }
            | null
            | undefined;
          const data = readGsplatCpu(resource?.gsplatData);
          if (!data) {
            setError(`${entry.name}: splat data is not readable for export`);
            return;
          }
          // CPU readback keeps DC color only; higher-order SH is dropped.
          saveBlob(gsplatDataToPly(applyOpsToGsplatData(data, ops)), filename);
        } finally {
          setBusy(null);
        }
      }, 30);
    },
    [setBusy]
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
        Drop .ply / .compressed.ply / .sog / .spz here, or click to browse
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ply,.sog,.spz"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importImage(file);
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
        <button
          disabled={!engine}
          title="Convert an image into an upright splat plane (one splat per pixel)"
          onClick={() => imageInputRef.current?.click()}
        >
          + Image
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
                title="Edit: move / erase / paint brush (right-drag in the scene)"
                onClick={() =>
                  setErasingId(erasingId === entry.id ? null : entry.id)
                }
              >
                ⛭
              </button>
              <button
                className="icon"
                title="Export as .ply — erase/tint edits are baked in (higher-order SH is dropped for imported scans)"
                onClick={() => exportEntry(entry)}
              >
                ⤓
              </button>
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
                <div className="button-row">
                  <button
                    className={brushMode === 'erase' ? 'primary' : ''}
                    onClick={() => setBrushMode('erase')}
                  >
                    Erase
                  </button>
                  <button
                    className={brushMode === 'tint' ? 'primary' : ''}
                    onClick={() => setBrushMode('tint')}
                  >
                    Tint
                  </button>
                </div>
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
                {brushMode === 'tint' && (
                  <>
                    <label>
                      Tint color
                      <input
                        type="color"
                        value={tintColor}
                        onChange={(e) => setTintColor(e.target.value)}
                      />
                    </label>
                    <label>
                      Strength {Math.round(tintStrength * 100)}%
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={tintStrength}
                        onChange={(e) => setTintStrength(Number(e.target.value))}
                      />
                    </label>
                  </>
                )}
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
                    if (!e || !engine) return;
                    engine.splatEditor.resetEdits(e.entity);
                    engine.splats.clearEditOps(e.id);
                  }}
                >
                  Reset edits
                </button>
                <p className="hint">
                  Right-drag on the splat to {brushMode === 'tint' ? 'paint' : 'erase'}. LMB orbits.
                </p>
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
