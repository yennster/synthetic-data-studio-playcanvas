import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyUrlPresets } from './lib/applyUrlPresets';
import './styles.css';

// URL presets (mode, camera, EI key, seed, …) land before first render.
applyUrlPresets();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
