import { useEffect, useState } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import type { StudioEngine } from '../engine/StudioEngine';
import type { Selection, TransformPatch } from '../engine/SelectionController';

/**
 * Applies a transform patch to whatever owns the selection: spawned
 * primitives live in the store; models and splats go through their
 * managers (both persist). Shared by viewport drags and keyboard
 * shortcuts.
 */
export function routeSelectionTransform(
  engine: StudioEngine,
  sel: Selection,
  patch: TransformPatch
): void {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  if (sel.kind === 'object') {
    const store = useStore.getState();
    const obj = store.sceneObjects.find((o) => o.id === sel.id);
    if (!obj) return;
    const update: Partial<typeof obj> = {};
    if (patch.position) {
      update.position = [r(patch.position[0]), r(patch.position[1]), r(patch.position[2])];
      // A manual height change opts the object out of auto ground-rest.
      if (patch.position[1] !== obj.position[1] && obj.physics) {
        update.physics = false;
      }
    }
    if (patch.yawDeg !== undefined) update.rotation = (patch.yawDeg * Math.PI) / 180;
    if (patch.scale !== undefined) update.scale = r(patch.scale);
    store.updateObject(sel.id, update);
  } else if (sel.kind === 'model') {
    engine.models.setTransform(sel.id, patch);
  } else {
    engine.splats.setTransform(sel.id, patch);
  }
}

/** Removes whatever owns the selection. */
export function removeSelection(engine: StudioEngine, sel: Selection): void {
  if (sel.kind === 'object') useStore.getState().removeObject(sel.id);
  else if (sel.kind === 'model') engine.models.remove(sel.id);
  else engine.splats.remove(sel.id);
  engine.selection.clear();
}

/**
 * Wires the viewport SelectionController to the app:
 * - transform drags route to the right owner (store for spawned
 *   primitives; managers for models and splats — both persist)
 * - selection mirrors into store.selectedIds
 * - Esc clears the selection
 * Returns the live selection for the chip UI.
 */
export function useSelection(): Selection | null {
  const engine = useEngine();
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (!engine) return;
    const ctl = engine.selection;

    ctl.onSelect = (sel) => {
      setSelection(sel);
      useStore.getState().setSelectedIds(sel ? [sel.id] : []);
    };

    ctl.onTransform = (sel, patch) => routeSelectionTransform(engine, sel, patch);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ctl.clear();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      ctl.onSelect = null;
      ctl.onTransform = null;
      window.removeEventListener('keydown', onKey);
    };
  }, [engine]);

  return selection;
}

const KIND_LABEL: Record<Selection['kind'], string> = {
  object: 'object',
  model: 'prop',
  splat: 'splat',
};

/** Floating chip naming the selection + the drag shortcuts. */
export function SelectionChip() {
  const engine = useEngine();
  const selection = useSelection();
  if (!selection) return null;
  return (
    <div className="selection-chip">
      <div className="selection-chip-head">
        <strong>{selection.label}</strong>
        <span className="selection-chip-kind">{KIND_LABEL[selection.kind]}</span>
        <button
          className="icon"
          aria-label="Deselect"
          onClick={() => engine?.selection.clear()}
        >
          ✕
        </button>
      </div>
      <p>
        Drag move · <strong>⇧</strong> height · <strong>⌥</strong> rotate ·{' '}
        <strong>⌘/Ctrl</strong> scale · <strong>Esc</strong> deselect
      </p>
    </div>
  );
}
