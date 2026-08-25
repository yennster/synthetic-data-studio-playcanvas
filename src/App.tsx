import { EngineProvider } from './engine/EngineContext';
import { Sidebar } from './ui/Sidebar';
import { Hud } from './ui/Hud';
import { ThemeSync } from './ui/ThemeSync';
import { SkyboxSync } from './ui/SkyboxSync';
import { WelcomePrompt } from './ui/WelcomePrompt';
import { useCaptureCameraSync } from './ui/useCaptureCameraSync';
import { useStore } from './store/useStore';
import { URL_FLAGS } from './lib/urlParams';

/** Hook host: keeps the capture/preview cameras in step with the store. */
function CaptureSync() {
  useCaptureCameraSync();
  return null;
}

export default function App() {
  const engineStatus = useStore((s) => s.engineStatus);
  const engineError = useStore((s) => s.engineError);
  const busyMessage = useStore((s) => s.busyMessage);
  const noChrome = URL_FLAGS.embed || URL_FLAGS.ui === 'minimal';

  return (
    <EngineProvider>
      <ThemeSync />
      <SkyboxSync />
      <CaptureSync />
      <div className={`ui-overlay${noChrome ? ' no-chrome' : ''}`}>
        {!noChrome && <Sidebar />}
        <Hud />
        {!noChrome && <WelcomePrompt />}
        {engineStatus === 'booting' && <div className="status-pill">Starting engine…</div>}
        {engineStatus === 'error' && (
          <div className="status-pill error">Engine failed: {engineError}</div>
        )}
        {busyMessage && <div className="status-pill">{busyMessage}</div>}
      </div>
    </EngineProvider>
  );
}
