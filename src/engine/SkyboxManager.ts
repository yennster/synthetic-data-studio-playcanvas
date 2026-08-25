import {
  ADDRESS_CLAMP_TO_EDGE,
  EnvLighting,
  PIXELFORMAT_RGBA8,
  Texture,
  type AppBase,
} from 'playcanvas';

/**
 * Procedural equirectangular skyboxes so splat environments (and open
 * studio scenes) aren't floating in a black void. Each preset paints a
 * 2048x1024 panorama on a canvas, becomes the scene skybox, and feeds
 * image-based ambient lighting for mesh props. Splats are unlit, so the
 * sky only shows through where the scan has no coverage — pick one that
 * matches the scan's mood.
 */

export type SkyboxPreset = 'none' | 'day' | 'sunset' | 'overcast' | 'night';

export const SKYBOX_PRESETS: { value: SkyboxPreset; label: string }[] = [
  { value: 'none', label: 'None (flat)' },
  { value: 'day', label: 'Day (blue sky)' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'overcast', label: 'Overcast' },
  { value: 'night', label: 'Night' },
];

function paintPanorama(preset: Exclude<SkyboxPreset, 'none'>): HTMLCanvasElement {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  switch (preset) {
    case 'day':
      sky.addColorStop(0, '#2d69c4');
      sky.addColorStop(0.45, '#7fb2e8');
      sky.addColorStop(0.55, '#cfe4f5');
      sky.addColorStop(0.62, '#b9c6b4');
      sky.addColorStop(1, '#6d7a6b');
      break;
    case 'sunset':
      sky.addColorStop(0, '#2b2a55');
      sky.addColorStop(0.4, '#8a4a7d');
      sky.addColorStop(0.52, '#e2703f');
      sky.addColorStop(0.58, '#f5b06a');
      sky.addColorStop(0.64, '#7d5a52');
      sky.addColorStop(1, '#3a3234');
      break;
    case 'overcast':
      sky.addColorStop(0, '#9aa2ab');
      sky.addColorStop(0.5, '#c9cfd6');
      sky.addColorStop(0.6, '#b3b8bd');
      sky.addColorStop(1, '#7d8288');
      break;
    case 'night':
      sky.addColorStop(0, '#04060f');
      sky.addColorStop(0.55, '#0a1226');
      sky.addColorStop(0.62, '#14203a');
      sky.addColorStop(1, '#080b12');
      break;
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  if (preset === 'day' || preset === 'sunset') {
    // Sun disc with a soft bloom, sitting above the horizon.
    const sx = w * 0.7;
    const sy = preset === 'day' ? h * 0.3 : h * 0.52;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.22);
    const core = preset === 'day' ? '255, 252, 235' : '255, 214, 150';
    glow.addColorStop(0, `rgba(${core}, 0.95)`);
    glow.addColorStop(0.12, `rgba(${core}, 0.55)`);
    glow.addColorStop(1, `rgba(${core}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  if (preset === 'night') {
    // Deterministic star field (no Math.random — stable across loads).
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 420; i++) {
      const x = rand() * w;
      const y = rand() * h * 0.58;
      const r = rand() * 1.1 + 0.2;
      ctx.fillStyle = `rgba(220, 228, 255, ${0.35 + rand() * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

export class SkyboxManager {
  private app: AppBase;
  private resources: Texture[] = [];
  private current: SkyboxPreset = 'none';

  constructor(app: AppBase) {
    this.app = app;
  }

  get preset(): SkyboxPreset {
    return this.current;
  }

  setPreset(preset: SkyboxPreset): void {
    if (preset === this.current) return;
    this.current = preset;
    this.clearResources();

    if (preset === 'none') {
      this.app.scene.skybox = null;
      this.app.scene.envAtlas = null;
      return;
    }

    const canvas = paintPanorama(preset);
    const equirect = new Texture(this.app.graphicsDevice, {
      name: `sky-${preset}`,
      width: canvas.width,
      height: canvas.height,
      format: PIXELFORMAT_RGBA8,
      mipmaps: false,
      addressU: ADDRESS_CLAMP_TO_EDGE,
      addressV: ADDRESS_CLAMP_TO_EDGE,
    });
    equirect.setSource(canvas);

    const skybox = EnvLighting.generateSkyboxCubemap(equirect);
    const lighting = EnvLighting.generateLightingSource(equirect);
    const atlas = EnvLighting.generateAtlas(lighting);
    lighting.destroy();

    this.app.scene.skybox = skybox;
    this.app.scene.envAtlas = atlas;
    this.resources.push(equirect, skybox, atlas);
  }

  private clearResources(): void {
    this.app.scene.skybox = null;
    this.app.scene.envAtlas = null;
    for (const t of this.resources) t.destroy();
    this.resources = [];
  }

  destroy(): void {
    this.clearResources();
  }
}
