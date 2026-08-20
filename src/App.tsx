import { EngineProvider } from './engine/EngineContext';
import { SplatLibrary } from './ui/SplatLibrary';
import { useStore } from './store/useStore';

export default function App() {
  const engineStatus = useStore((s) => s.engineStatus);
  const engineError = useStore((s) => s.engineError);
  const busyMessage = useStore((s) => s.busyMessage);

  return (
    <EngineProvider>
      <div className="ui-overlay">
        <aside className="sidebar">
          <header className="app-header">
            <h1>Synthetic Data Studio</h1>
            <p className="tagline">PlayCanvas · Gaussian Splats · Edge Impulse</p>
          </header>
          <SplatLibrary />
        </aside>
        {engineStatus === 'booting' && <div className="status-pill">Starting engine…</div>}
        {engineStatus === 'error' && (
          <div className="status-pill error">Engine failed: {engineError}</div>
        )}
        {busyMessage && <div className="status-pill">{busyMessage}</div>}
      </div>
    </EngineProvider>
  );
}
