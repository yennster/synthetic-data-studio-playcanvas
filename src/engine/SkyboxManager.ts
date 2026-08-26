import {
  ADDRESS_CLAMP_TO_EDGE,
  EnvLighting,
  PIXELFORMAT_RGBA8,
  Texture,
  type AppBase,
} from 'playcanvas';
import type { EnvironmentPreset } from '../lib/environmentPresets';

/**
 * Procedural equirectangular skyboxes so splat environments (and open
 * studio scenes) aren't floating in a black void. Each preset paints a
 * 2048x1024 panorama on a canvas, becomes the scene skybox, and feeds
 * image-based ambient lighting for mesh props. Splats are unlit, so the
 * sky only shows through where the scan has no coverage — pick one that
 * matches the scan's mood.
 *
 * Two families share the pipeline: the sky-only presets native to this
 * rebuild (day/sunset/overcast/night) and the scene presets ported from
 * the original app (studio/warehouse/whitebox/outdoor — those also
 * restyle the ground, see sceneEnvironment). A user-uploaded panorama
 * (`setCustomPanorama`) overrides whichever preset is active until
 * cleared.
 */

export type SkyboxPreset = 'none' | 'day' | 'sunset' | 'overcast' | 'night';

export const SKYBOX_PRESETS: { value: SkyboxPreset; label: string }[] = [
  { value: 'none', label: 'None (flat)' },
  { value: 'day', label: 'Day (blue sky)' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'overcast', label: 'Overcast' },
  { value: 'night', label: 'Night' },
];

/** Deterministic LCG (no Math.random — stable across loads). */
function makeRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function paintPanorama(preset: Exclude<EnvironmentPreset, 'none'>): HTMLCanvasElement {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Scene presets (ported from the original app) have bespoke painters.
  switch (preset) {
    case 'studio':
      paintStudioCyclorama(ctx, w, h);
      return canvas;
    case 'whitebox':
      paintWhiteboxCyclorama(ctx, w, h);
      return canvas;
    case 'warehouse':
      paintWarehousePanorama(ctx, w, h);
      return canvas;
    case 'outdoor':
      paintOutdoorSky(ctx, w, h);
      return canvas;
  }

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
    const rand = makeRand(42);
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

/* ------------------------------------------------------------------ *
 * Scene-preset painters, ported from the original SceneEnvironment.tsx *
 * (three.js). Same gradients/shapes; Math.random swapped for seeded    *
 * rands to match this file's determinism convention.                   *
 * ------------------------------------------------------------------ */

/** Sky + drifting clouds + horizon haze over a ground band. */
function paintOutdoorSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#3d7fb8');
  grad.addColorStop(0.45, '#7fb1d4');
  grad.addColorStop(0.55, '#bcd6e6');
  grad.addColorStop(0.6, '#c8d8df');
  grad.addColorStop(0.62, '#7a8a72');
  grad.addColorStop(1, '#3a5e2a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Soft clouds in the upper half; mirror-wrap near the left seam so
  // the panorama tiles cleanly behind the camera.
  const rand = makeRand(7);
  for (let i = 0; i < 24; i++) {
    const cx = rand() * w;
    const cy = rand() * h * 0.45;
    const r = 40 + rand() * 140;
    for (const x of cx < 200 ? [cx, cx + w] : [cx]) {
      const g = ctx.createRadialGradient(x, cy, 0, x, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Horizon haze.
  const haze = ctx.createLinearGradient(0, h * 0.52, 0, h * 0.62);
  haze.addColorStop(0, 'rgba(220, 220, 210, 0)');
  haze.addColorStop(0.5, 'rgba(220, 220, 210, 0.45)');
  haze.addColorStop(1, 'rgba(220, 220, 210, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.52, w, h * 0.1);
}

/** Dark ceiling + overhead lights, weathered wall band, floor fade. */
function paintWarehousePanorama(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  // Top: dark ceiling with a row of overhead lights.
  ctx.fillStyle = '#1f1c18';
  ctx.fillRect(0, 0, w, h * 0.4);
  for (let i = 0; i < 8; i++) {
    const x = ((i + 0.5) / 8) * w;
    const y = h * 0.22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 90);
    g.addColorStop(0, 'rgba(255, 235, 180, 0.85)');
    g.addColorStop(1, 'rgba(255, 235, 180, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, Math.PI * 2);
    ctx.fill();
  }
  // Wall band (the bulk of what we see at eye level).
  ctx.fillStyle = '#cdc4b4';
  ctx.fillRect(0, h * 0.4, w, h * 0.45);
  // Soft tonal blobs + vertical streaks for a paint-weathering vibe.
  const rand = makeRand(11);
  for (let i = 0; i < 60; i++) {
    const x = rand() * w;
    const y = h * 0.4 + rand() * h * 0.45;
    const r = 50 + rand() * 160;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.5;
    grad.addColorStop(
      0,
      `rgba(${dark ? 50 : 230}, ${dark ? 45 : 220}, ${dark ? 40 : 200}, 0.10)`
    );
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    const x = rand() * w;
    const y0 = h * 0.4 + rand() * h * 0.1;
    const len = 80 + rand() * 250;
    const g = ctx.createLinearGradient(x, y0, x, y0 + len);
    g.addColorStop(0, 'rgba(60, 55, 45, 0)');
    g.addColorStop(0.5, 'rgba(60, 55, 45, 0.18)');
    g.addColorStop(1, 'rgba(60, 55, 45, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, 1 + rand() * 2, len);
  }
  // Floor band so the panorama blends down to the actual floor color
  // without a hard edge.
  ctx.fillStyle = '#1f1c18';
  ctx.fillRect(0, h * 0.85, w, h * 0.15);
  const fadeUp = ctx.createLinearGradient(0, h * 0.82, 0, h * 0.9);
  fadeUp.addColorStop(0, 'rgba(31, 28, 24, 0)');
  fadeUp.addColorStop(1, 'rgba(31, 28, 24, 1)');
  ctx.fillStyle = fadeUp;
  ctx.fillRect(0, h * 0.82, w, h * 0.08);
}

/** Dark gradient cyclorama with faint vignetting blobs at the equator. */
function paintStudioCyclorama(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#181c22');
  g.addColorStop(1, '#0a0c10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = makeRand(23);
  for (let i = 0; i < 10; i++) {
    const x = rand() * w;
    const y = h / 2 + (rand() - 0.5) * h * 0.3;
    const r = 200 + rand() * 300;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.04)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Bright off-white seamless backdrop. */
function paintWhiteboxCyclorama(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f5f5f2');
  g.addColorStop(0.6, '#eeeeea');
  g.addColorStop(1, '#dcdcd6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Image sources the custom-panorama path accepts (drawable + sized). */
export type PanoramaSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

export class SkyboxManager {
  private app: AppBase;
  private resources: Texture[] = [];
  private current: EnvironmentPreset = 'none';
  /** User-uploaded equirect panorama; overrides `current` while set. */
  private customSource: PanoramaSource | null = null;

  constructor(app: AppBase) {
    this.app = app;
  }

  get preset(): EnvironmentPreset {
    return this.current;
  }

  setPreset(preset: EnvironmentPreset): void {
    if (preset === this.current) return;
    this.current = preset;
    // A custom panorama keeps showing regardless of the preset choice.
    if (!this.customSource) this.apply();
  }

  /**
   * Install a user-uploaded 2:1 equirect image as the sky (null clears
   * back to the active preset). The wall-texture slot in the Scene card
   * lands here — the original app treated the wall upload as a skybox
   * panorama too.
   */
  setCustomPanorama(source: PanoramaSource | null): void {
    if (source === this.customSource) return;
    this.customSource = source;
    this.apply();
  }

  private apply(): void {
    this.clearResources();

    let source: PanoramaSource;
    let width: number;
    let height: number;
    let name: string;
    if (this.customSource) {
      source = this.customSource;
      width = this.customSource.width;
      height = this.customSource.height;
      name = 'sky-custom';
    } else if (this.current === 'none') {
      return;
    } else {
      const canvas = paintPanorama(this.current);
      source = canvas;
      width = canvas.width;
      height = canvas.height;
      name = `sky-${this.current}`;
    }

    const equirect = new Texture(this.app.graphicsDevice, {
      name,
      width,
      height,
      format: PIXELFORMAT_RGBA8,
      mipmaps: false,
      addressU: ADDRESS_CLAMP_TO_EDGE,
      addressV: ADDRESS_CLAMP_TO_EDGE,
    });
    // Cast: the engine accepts ImageBitmap sources at runtime (its upload
    // paths test `instanceof ImageBitmap`) but the d.ts omits it.
    equirect.setSource(source as unknown as HTMLCanvasElement);

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
