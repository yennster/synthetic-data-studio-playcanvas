import { useCallback, useRef, useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import { isSplatFilename, SPLAT_EXTENSIONS } from '../engine/splats/SplatManager';

/**
 * Splat library card: import scans, create primitives, manage roles/labels.
 */
export function SplatLibrary() {
  const engine = useEngine();
  const splats = useStore((s) => s.splats);
  const setBusy = useStore((s) => s.setBusy);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

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
          <li key={entry.id}>
            <span className="asset-name" title={`${entry.splatCount} splats`}>
              {entry.name}
            </span>
            <select
              value={entry.role}
              onChange={(e) =>
                engine?.splats.setRole(entry.id, e.target.value as 'backdrop' | 'object')
              }
            >
              <option value="backdrop">backdrop</option>
              <option value="object">object</option>
            </select>
            <button className="icon" onClick={() => engine?.splats.remove(entry.id)}>
              ✕
            </button>
          </li>
        ))}
        {splats.length === 0 && <li className="empty">No splats yet</li>}
      </ul>
    </section>
  );
}
