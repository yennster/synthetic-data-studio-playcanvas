import {
  ADDRESS_REPEAT,
  Color,
  Entity,
  PIXELFORMAT_SRGBA8,
  SHADOW_PCSS_32F,
  StandardMaterial,
  Texture,
  type AppBase,
} from 'playcanvas';
import { CUSTOM_FLOOR_TILE, type FloorStyle } from '../lib/environmentPresets';

export interface SceneEnvironment {
  ground: Entity;
  keyLight: Entity;
  fillLight: Entity;
  /** Show/hide the procedural ground (hidden when a splat backdrop provides one). */
  setGroundVisible(visible: boolean): void;
  setGroundColor(color: Color): void;
  /**
   * Environment-preset ground look (procedural texture or flat color);
   * `null` restores the theme/user color set via setGroundColor.
   */
  setFloorStyle(style: FloorStyle | null): void;
  /**
   * User-uploaded floor image, tiled 4× across the ground. Overrides the
   * preset floor while set; `null` clears back to preset/theme.
   */
  setCustomFloorTexture(source: ImageBitmap | HTMLCanvasElement | null): void;
  /** Key light intensity, used by domain randomization. */
  setLightIntensity(intensity: number): void;
  /** Key light direction as euler angles. */
  setLightAngles(x: number, y: number): void;
  destroy(): void;
}

/** Deterministic LCG so procedural floors are stable across loads. */
function makeRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Ported from the original app's concreteTexture(): stained, cracked,
 * speckled concrete on a 512px canvas (tiled by diffuseMapTiling).
 */
function paintConcrete(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const rand = makeRand(31);
  ctx.fillStyle = '#a39a8c';
  ctx.fillRect(0, 0, 512, 512);
  // Soft tonal blobs to break up uniformity.
  for (let i = 0; i < 90; i++) {
    const r = 40 + rand() * 120;
    const x = rand() * 512;
    const y = rand() * 512;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.5;
    grad.addColorStop(
      0,
      `rgba(${dark ? 50 : 230}, ${dark ? 45 : 220}, ${dark ? 40 : 200}, 0.12)`
    );
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cracks — short jagged polylines.
  ctx.strokeStyle = 'rgba(40, 35, 30, 0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    let x = rand() * 512;
    let y = rand() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 4 + Math.floor(rand() * 4);
    for (let j = 0; j < segs; j++) {
      x += (rand() - 0.5) * 80;
      y += (rand() - 0.5) * 80;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Fine speckles for a gritty surface feel.
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(0, 0, 0, ${rand() * 0.18})`;
    ctx.fillRect(rand() * 512, rand() * 512, 1, 1);
  }
  return c;
}

/** Ported from the original app's grassTexture(): patchy green + blades. */
function paintGrass(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const rand = makeRand(57);
  ctx.fillStyle = '#3a5e2a';
  ctx.fillRect(0, 0, 512, 512);
  // Variation patches.
  for (let i = 0; i < 200; i++) {
    const r = 8 + rand() * 24;
    const x = rand() * 512;
    const y = rand() * 512;
    const g = 70 + rand() * 60;
    const dr = 30 + rand() * 30;
    ctx.fillStyle = `rgba(${dr}, ${g}, ${30 + rand() * 25}, 0.4)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Blade-like flecks.
  for (let i = 0; i < 4000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    ctx.strokeStyle = `rgba(${30 + rand() * 40}, ${100 + rand() * 80}, ${
      30 + rand() * 30
    }, 0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 4, y - 2 - rand() * 4);
    ctx.stroke();
  }
  return c;
}

/**
 * Builds the default studio environment: a ground plane that receives
 * shadows and a two-light rig. Splat backdrops can replace the ground;
 * environment presets and custom uploads can restyle it.
 */
export function createSceneEnvironment(app: AppBase, parent: Entity): SceneEnvironment {
  const groundMaterial = new StandardMaterial();
  groundMaterial.diffuse = new Color(0.42, 0.43, 0.45);
  groundMaterial.gloss = 0.3;
  groundMaterial.metalness = 0.2;
  groundMaterial.useMetalness = true;
  groundMaterial.update();

  const ground = new Entity('ground', app);
  ground.addComponent('render', {
    type: 'box',
    material: groundMaterial,
    castShadows: false,
  });
  ground.setLocalScale(30, 0.1, 30);
  ground.setLocalPosition(0, -0.05, 0);
  parent.addChild(ground);

  const keyLight = new Entity('key-light', app);
  keyLight.addComponent('light', {
    type: 'directional',
    color: Color.WHITE,
    castShadows: true,
    intensity: 1.6,
    shadowBias: 0.2,
    normalOffsetBias: 0.05,
    shadowDistance: 24,
    shadowResolution: 2048,
    shadowType: SHADOW_PCSS_32F,
    shadowIntensity: 0.6,
  });
  keyLight.setEulerAngles(50, 30, 0);
  parent.addChild(keyLight);

  const fillLight = new Entity('fill-light', app);
  fillLight.addComponent('light', {
    type: 'directional',
    color: new Color(0.8, 0.85, 1.0),
    castShadows: false,
    intensity: 0.5,
  });
  fillLight.setEulerAngles(-40, -120, 0);
  parent.addChild(fillLight);

  app.scene.ambientLight = new Color(0.25, 0.25, 0.28);

  /* ---------------- floor look state machine ---------------- */
  // Precedence: custom upload > preset style > theme/user base color.
  // ThemeSync and the Scene card color picker keep writing baseColor
  // even while overridden, so clearing an override restores the right
  // color without extra bookkeeping.
  const baseColor = new Color(0.42, 0.43, 0.45);
  let presetStyle: FloorStyle | null = null;
  let presetTexture: Texture | null = null;
  let customTexture: Texture | null = null;

  const makeTexture = (
    name: string,
    source: ImageBitmap | HTMLCanvasElement
  ): Texture => {
    const t = new Texture(app.graphicsDevice, {
      name,
      width: source.width,
      height: source.height,
      // sRGB so image colors survive the linear lighting pipeline.
      format: PIXELFORMAT_SRGBA8,
      mipmaps: true,
      anisotropy: 4,
      addressU: ADDRESS_REPEAT,
      addressV: ADDRESS_REPEAT,
    });
    // Cast: the engine accepts ImageBitmap sources at runtime (its upload
    // paths test `instanceof ImageBitmap`) but the d.ts omits it.
    t.setSource(source as unknown as HTMLCanvasElement);
    return t;
  };

  const applyFloor = (): void => {
    if (customTexture) {
      groundMaterial.diffuse = Color.WHITE;
      groundMaterial.diffuseMap = customTexture;
      groundMaterial.diffuseMapTiling.set(CUSTOM_FLOOR_TILE, CUSTOM_FLOOR_TILE);
      groundMaterial.gloss = 0.15; // roughness ~0.85, per the original
      groundMaterial.metalness = 0.05;
    } else if (presetStyle && presetStyle.kind !== 'flat') {
      if (!presetTexture) {
        const canvas =
          presetStyle.kind === 'concrete' ? paintConcrete() : paintGrass();
        presetTexture = makeTexture(`floor-${presetStyle.kind}`, canvas);
      }
      groundMaterial.diffuse = Color.WHITE;
      groundMaterial.diffuseMap = presetTexture;
      groundMaterial.diffuseMapTiling.set(presetStyle.repeat, presetStyle.repeat);
      groundMaterial.gloss = 0.15;
      groundMaterial.metalness = 0.05;
    } else if (presetStyle) {
      groundMaterial.diffuseMap = null;
      groundMaterial.diffuse = new Color().fromString(presetStyle.color);
      groundMaterial.gloss = 1 - presetStyle.roughness;
      groundMaterial.metalness = 0.05;
    } else {
      groundMaterial.diffuseMap = null;
      groundMaterial.diffuse = baseColor.clone();
      groundMaterial.gloss = 0.3;
      groundMaterial.metalness = 0.2;
    }
    groundMaterial.update();
  };

  return {
    ground,
    keyLight,
    fillLight,
    setGroundVisible(visible: boolean) {
      ground.enabled = visible;
    },
    setGroundColor(color: Color) {
      baseColor.copy(color);
      applyFloor();
    },
    setFloorStyle(style: FloorStyle | null) {
      // Same-kind updates keep the cached texture; anything else rebuilds.
      const sameTexKind =
        style !== null &&
        presetStyle !== null &&
        style.kind !== 'flat' &&
        style.kind === presetStyle.kind;
      if (!sameTexKind && presetTexture) {
        presetTexture.destroy();
        presetTexture = null;
      }
      presetStyle = style;
      applyFloor();
    },
    setCustomFloorTexture(source: ImageBitmap | HTMLCanvasElement | null) {
      if (customTexture) {
        customTexture.destroy();
        customTexture = null;
      }
      if (source) customTexture = makeTexture('floor-custom', source);
      applyFloor();
    },
    setLightIntensity(intensity: number) {
      keyLight.light!.intensity = intensity;
    },
    setLightAngles(x: number, y: number) {
      keyLight.setEulerAngles(x, y, 0);
    },
    destroy() {
      presetTexture?.destroy();
      customTexture?.destroy();
      ground.destroy();
      keyLight.destroy();
      fillLight.destroy();
    },
  };
}
