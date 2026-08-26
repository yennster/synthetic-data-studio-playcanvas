import { useCallback, useRef, useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import { isModelFilename, MODEL_EXTENSIONS, type ModelEntry } from '../engine/ModelManager';
import { NumberField, SliderRow } from './primitives';

/**
 * Model library card: import GLB props, per-copy label + transform
 * controls (move / rotate / resize), material/color override for
 * broken-material imports, duplicate, convert to splats, remove.
 */
export function ModelLibrary() {
  const engine = useEngine();
  const models = useStore((s) => s.models);
  const setBusy = useStore((s) => s.setBusy);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped after engine-side transform writes so controls re-read values.
  const [, setTick] = useState(0);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!engine) return;
      setError(null);
      for (const file of Array.from(files)) {
        if (!isModelFilename(file.name)) {
          setError(`${file.name}: unsupported (use ${MODEL_EXTENSIONS.join(', ')})`);
          continue;
        }
        setBusy(`Importing ${file.name}…`);
        try {
          await engine.models.importFile(file);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(null);
        }
      }
    },
    [engine, setBusy]
  );

  const convertToSplat = useCallback(
    (id: string) => {
      if (!engine) return;
      const entry = engine.models.get(id);
      if (!entry) return;
      setBusy(`Converting ${entry.name} to splats…`);
      try {
        engine.splats.createFromMesh(entry.entity, entry.name);
        // Hide the mesh original so the splat version takes its place —
        // via the manager so persistence snapshots record the change.
        engine.models.setEnabled(entry.id, false);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [engine, setBusy]
  );

  const renderControls = (entry: ModelEntry) => {
    const pos = entry.entity.getLocalPosition();
    const yaw = entry.entity.getLocalEulerAngles().y;
    const scale = entry.entity.getLocalScale().x;
    const move = (axis: 0 | 1 | 2, value: number) => {
      const p: [number, number, number] = [pos.x, pos.y, pos.z];
      p[axis] = value;
      engine?.models.setTransform(entry.id, { position: p });
      setTick((t) => t + 1);
    };
    const override = entry.override;
    const setOverride = (
      patch: Partial<typeof override>
    ) => {
      engine?.models.setMaterialOverride(entry.id, patch);
      setTick((t) => t + 1);
    };
    return (
      <div className="model-controls">
        <label className="model-label-field">
          Label
          <input
            type="text"
            value={entry.label}
            onChange={(e) => engine?.models.setLabel(entry.id, e.target.value)}
            aria-label={`${entry.name} label`}
            title="Bounding-box label used in detection captures"
          />
        </label>
        <div className="model-controls-row">
          <NumberField label="X" value={round2(pos.x)} min={-30} max={30} step={0.1} onChange={(v) => move(0, v)} />
          <NumberField label="Y" value={round2(pos.y)} min={-10} max={30} step={0.1} onChange={(v) => move(1, v)} />
          <NumberField label="Z" value={round2(pos.z)} min={-30} max={30} step={0.1} onChange={(v) => move(2, v)} />
        </div>
        <SliderRow
          label="Rotate"
          value={yaw}
          min={-180}
          max={180}
          step={1}
          formatValue={(v) => `${Math.round(v)}°`}
          onChange={(v) => {
            engine?.models.setTransform(entry.id, { yawDeg: v });
            setTick((t) => t + 1);
          }}
        />
        <div className="model-scale-row">
          <SliderRow
            label="Size ×"
            value={scale}
            min={0.05}
            max={5}
            step={0.05}
            onChange={(v) => {
              engine?.models.setTransform(entry.id, { scale: v });
              setTick((t) => t + 1);
            }}
          />
          <NumberField
            className="model-scale-number"
            value={round2(scale)}
            min={0.05}
            max={5}
            step={0.05}
            aria-label={`${entry.name} size value`}
            onChange={(v) => {
              engine?.models.setTransform(entry.id, { scale: v });
              setTick((t) => t + 1);
            }}
          /></div>
        <label className="model-override-toggle">
          <input
            type="checkbox"
            checked={override.enabled}
            onChange={(e) => setOverride({ enabled: e.target.checked })}
          />
          <span>Override material (use if it&apos;s pink)</span>
        </label>
        {override.enabled && (
          <div className="model-override-row">
            <input
              type="color"
              value={override.color}
              onChange={(e) => setOverride({ color: e.target.value })}
              title={`Override color: ${override.color}`}
              aria-label={`${entry.name} override color`}
            />
            <SliderRow
              label="Rough"
              value={override.roughness}
              min={0}
              max={1}
              step={0.05}
              onChange={(roughness) => setOverride({ roughness })}
            />
            <SliderRow
              label="Metal"
              value={override.metalness}
              min={0}
              max={1}
              step={0.05}
              onChange={(metalness) => setOverride({ metalness })}
            />
          </div>
        )}
        <div className="button-row">
          <button onClick={() => engine?.models.duplicate(entry.id)}>+ Copy</button>
          <button onClick={() => convertToSplat(entry.id)}>→ splat</button>
        </div>
      </div>
    );
  };

  return (
    <section className="card">
      <h2>3D Models</h2>
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
        Drop .glb / .gltf here, or click to browse
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {error && <p className="error">{error}</p>}
      <ul className="asset-list">
        {models.map((entry) => (
          <li key={entry.id} className="splat-row">
            <div className="splat-row-main">
              <span className="asset-name" title={entry.label}>
                {entry.name}
              </span>
              <button
                className={`icon${openId === entry.id ? ' primary' : ''}`}
                title="Move / rotate / resize / copy"
                onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
              >
                ⛭
              </button>
              <button
                className="icon"
                title="Remove"
                onClick={() => engine?.models.remove(entry.id)}
              >
                ✕
              </button>
            </div>
            {openId === entry.id && renderControls(entry)}
          </li>
        ))}
        {models.length === 0 && <li className="empty">No models yet</li>}
      </ul>
    </section>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
