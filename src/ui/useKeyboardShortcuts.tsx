import { useEffect } from 'react';
import { Vec3 } from 'playcanvas';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import { captureSingle } from '../modes/visionRunner';
import { removeSelection, routeSelectionTransform } from './useSelection';

/**
 * App-level keyboard shortcuts (camera fly — WASD/QE/arrows, Shift fast,
 * Ctrl slow — is handled natively by CameraControls):
 *
 *   F           frame the selection (or the scene origin)
 *   Delete/⌫    remove the selection
 *   [ / ]       rotate the selection ∓15°
 *   - / =       scale the selection ×0.9 / ×1.1
 *   C           capture a frame (detection / anomaly modes)
 *   H           toggle the sidebar
 *   ?           toggle the controls help
 *
 * All shortcuts are inert while an input-like element has focus.
 */
export function useKeyboardShortcuts(): void {
  const engine = useEngine();

  useEffect(() => {
    if (!engine) return;

    const isFormTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (isFormTarget(e.target) || isFormTarget(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser combos alone
      const sel = engine.selection.current;
      const store = useStore.getState();

      // Object-kind selections keep their authoritative rotation/scale in
      // the store (entity values are wrapped eulers / kind-scaled).
      const currentYawDeg = () => {
        if (sel?.kind === 'object') {
          const obj = store.sceneObjects.find((o) => o.id === sel.id);
          if (obj) return (obj.rotation * 180) / Math.PI;
        }
        return sel?.entity.getLocalEulerAngles().y ?? 0;
      };
      const currentScale = () => {
        if (sel?.kind === 'object') {
          const obj = store.sceneObjects.find((o) => o.id === sel.id);
          if (obj) return obj.scale;
        }
        return sel?.entity.getLocalScale().x ?? 1;
      };

      switch (e.key) {
        case 'f':
        case 'F': {
          if (sel) {
            const p = sel.entity.getPosition();
            engine.focusOn(new Vec3(p.x, p.y, p.z));
          } else {
            engine.focusOn(new Vec3(0, 0.8, 0));
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          if (sel) {
            e.preventDefault();
            removeSelection(engine, sel);
          }
          break;
        }
        case '[':
        case ']': {
          if (sel) {
            const step = e.key === ']' ? 15 : -15;
            routeSelectionTransform(engine, sel, { yawDeg: currentYawDeg() + step });
          }
          break;
        }
        case '-':
        case '=': {
          if (sel) {
            const factor = e.key === '=' ? 1.1 : 1 / 1.1;
            const scale = Math.min(20, Math.max(0.02, currentScale() * factor));
            routeSelectionTransform(engine, sel, { scale });
          }
          break;
        }
        case 'c':
        case 'C': {
          const mode = store.mode;
          if (mode !== 'detection' && mode !== 'anomaly') break;
          if (store.status.kind === 'busy') break;
          store.setStatus('busy', 'Capturing frame…');
          void captureSingle(engine)
            .then((c) => store.setStatus('ok', `Captured ${c.filename}`))
            .catch((err: Error) =>
              store.setStatus('err', `Capture failed: ${err.message}`)
            );
          break;
        }
        case 'h':
        case 'H': {
          window.dispatchEvent(new CustomEvent('sds:toggle-sidebar'));
          break;
        }
        case '?': {
          window.dispatchEvent(new CustomEvent('sds:toggle-help'));
          break;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
}

/** Hook host for mounting inside the engine provider. */
export function KeyboardShortcuts() {
  useKeyboardShortcuts();
  return null;
}
