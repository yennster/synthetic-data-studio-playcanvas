import { useState } from 'react';
import { EngineProvider } from './engine/EngineContext';
import { Sidebar } from './ui/Sidebar';
import { Hud } from './ui/Hud';
import { ThemeSync } from './ui/ThemeSync';
import { SkyboxSync } from './ui/SkyboxSync';
import { WelcomePrompt } from './ui/WelcomePrompt';
import { SelectionChip } from './ui/useSelection';
import { useCaptureCameraSync } from './ui/useCaptureCameraSync';
import { useStore } from './store/useStore';
import { URL_FLAGS } from './lib/urlParams';

/** Hook host: keeps the capture/preview cameras in step with the store. */
function CaptureSync() {
  useCaptureCameraSync();
  return null;
}

const SIDEBAR_KEY = 'sds-sidebar-hidden';

export default function App() {
  const engineStatus = useStore((s) => s.engineStatus);
  const engineError = useStore((s) => s.engineError);
  const busyMessage = useStore((s) => s.busyMessage);
  const noChrome = URL_FLAGS.embed || URL_FLAGS.ui === 'minimal';
  const [sidebarHidden, setSidebarHidden] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === '1'
  );
  const toggleSidebar = () => {
    setSidebarHidden((h) => {
      localStorage.setItem(SIDEBAR_KEY, h ? '0' : '1');
      return !h;
    });
  };

  return (
    <EngineProvider>
      <ThemeSync />
      <SkyboxSync />
      <CaptureSync />
      <div
        className={`ui-overlay${noChrome ? ' no-chrome' : ''}${
          sidebarHidden ? ' sidebar-hidden' : ''
        }`}
      >
        {!noChrome && !sidebarHidden && <Sidebar />}
        {!noChrome && (
          <button
            className="sidebar-toggle"
            title={sidebarHidden ? 'Show the sidebar' : 'Hide the sidebar (more viewport)'}
            aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            onClick={toggleSidebar}
          >
            {sidebarHidden ? '☰' : '⟨'}
          </button>
        )}
        <Hud />
        <SelectionChip />
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
