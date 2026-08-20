import { useEffect } from 'react';
import { Color } from 'playcanvas';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';

/** Keeps the engine's clear color and ground in step with the UI theme. */
export function ThemeSync() {
  const engine = useEngine();
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    if (!engine) return;
    if (theme === 'dark') {
      engine.setClearColor(new Color(0.08, 0.09, 0.11));
      engine.environment.setGroundColor(new Color(0.42, 0.43, 0.45));
    } else {
      engine.setClearColor(new Color(0.78, 0.8, 0.84));
      engine.environment.setGroundColor(new Color(0.88, 0.88, 0.86));
    }
  }, [engine, theme]);

  return null;
}
