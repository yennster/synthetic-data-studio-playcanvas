import { useCallback, useRef, useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import { isModelFilename, MODEL_EXTENSIONS } from '../engine/ModelManager';

/**
 * Model library card: import GLB props, edit labels, convert to splats.
 */
export function ModelLibrary() {
  const engine = useEngine();
  const models = useStore((s) => s.models);
  const setBusy = useStore((s) => s.setBusy);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

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
        // Hide the mesh original so the splat version takes its place.
        entry.entity.enabled = false;
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [engine, setBusy]
  );

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
          <li key={entry.id}>
            <span className="asset-name" title={entry.label}>
              {entry.name}
            </span>
            <button
              title="Convert to gaussian splat"
              onClick={() => convertToSplat(entry.id)}
            >
              → splat
            </button>
            <button className="icon" onClick={() => engine?.models.remove(entry.id)}>
              ✕
            </button>
          </li>
        ))}
        {models.length === 0 && <li className="empty">No models yet</li>}
      </ul>
    </section>
  );
}
