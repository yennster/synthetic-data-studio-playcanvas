import { useEffect } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';

/** Applies the store's skybox preset to the engine (all modes). */
export function SkyboxSync() {
  const engine = useEngine();
  const skybox = useStore((s) => s.skybox);

  useEffect(() => {
    engine?.skybox.setPreset(skybox);
  }, [engine, skybox]);

  return null;
}
