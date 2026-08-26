import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyUrlPresets } from './lib/applyUrlPresets';
import { initPostContentHeight } from './lib/embed';
import { URL_FLAGS } from './lib/urlParams';
import './styles.css';

// URL presets (mode, camera, EI key, seed, …) land before first render.
applyUrlPresets();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Iframe embed: post `{type:'IFRAME_HEIGHT', height}` to the parent frame
// so embedders (e.g. Edge Impulse Studio) can size the iframe to fit.
// Only wired when actually framed (or `?embed=1` says so); the target
// origin resolves from `?embedOrigin=` or document.referrer, and
// initPostContentHeight no-ops entirely when neither is available — it
// never broadcasts to '*'. Load/resize listeners + a body ResizeObserver
// only, so nothing lands in the engine's per-frame hot path.
if (URL_FLAGS.embed || window.self !== window.parent) {
  const teardown = initPostContentHeight();
  window.addEventListener('pagehide', teardown, { once: true });
}
