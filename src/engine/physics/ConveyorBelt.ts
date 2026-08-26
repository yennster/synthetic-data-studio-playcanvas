import {
  ADDRESS_REPEAT,
  Color,
  Entity,
  PIXELFORMAT_SRGBA8,
  StandardMaterial,
  Texture,
  Vec2,
  type AppBase,
} from 'playcanvas';
import {
  BELT_HEIGHT,
  BELT_LENGTH,
  BELT_TEXTURE_REPEAT,
  BELT_TOP_Y,
  BELT_WIDTH,
  beltTextureOffsetDelta,
} from '../../lib/beltPhysics';

// Layout (all in world Y) — ported from the original Conveyor.tsx:
//   ground top:            0
//   leg bottom:            0
//   leg top / belt bottom: BELT_TOP_Y - BELT_HEIGHT = 0.4
//   belt top:              BELT_TOP_Y               = 0.5
const BELT_BOTTOM_Y = BELT_TOP_Y - BELT_HEIGHT;
const LEG_HEIGHT = BELT_BOTTOM_Y;

/** Draws the original's 64×256 stripe pattern (8 light stripes on dark). */
function drawStripeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#222831';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#3d4651';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(0, i * 32, c.width, 16);
  }
  ctx.fillStyle = '#1a1f26';
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(0, i * 32 - 1, c.width, 2);
  }
  return c;
}

/**
 * The conveyor belt's visual half: belt slab with a scrolling striped
 * texture, side rails, end rollers, support frame and legs — geometry and
 * materials ported from the original Conveyor.tsx. Everything is
 * world-layer content parented under the studio content root, so capture
 * and preview cameras see the belt exactly like the ground plane.
 *
 * The physics half (belt/rail colliders + the z-velocity transport hack)
 * lives in PhysicsWorld; both read the same constants from
 * lib/beltPhysics.ts so the visual and the collider can't drift apart.
 *
 * The stripe scroll is locked to the transport speed via
 * `beltTextureOffsetDelta` (UV advance = speed·dt·repeat/length), the
 * original's fix for its historical stripes-1.33×-too-fast bug.
 */
export class ConveyorBelt {
  private app: AppBase;
  private root: Entity;
  private beltMaterial: StandardMaterial;
  private materials: StandardMaterial[] = [];
  private texture: Texture;
  private speed = 0;
  private offsetY = 0;

  constructor(app: AppBase, parent: Entity) {
    this.app = app;

    this.texture = new Texture(app.graphicsDevice, {
      name: 'conveyor-stripes',
      width: 64,
      height: 256,
      format: PIXELFORMAT_SRGBA8,
      mipmaps: true,
      addressU: ADDRESS_REPEAT,
      addressV: ADDRESS_REPEAT,
    });
    this.texture.setSource(drawStripeCanvas());

    this.beltMaterial = new StandardMaterial();
    this.beltMaterial.diffuseMap = this.texture;
    // One stripe-canvas repeat across the width, BELT_TEXTURE_REPEAT
    // tiles along the length (same mapping as the original).
    this.beltMaterial.diffuseMapTiling = new Vec2(1, BELT_TEXTURE_REPEAT);
    this.beltMaterial.gloss = 1 - 0.7;
    this.beltMaterial.metalness = 0.1;
    this.beltMaterial.useMetalness = true;
    this.beltMaterial.update();
    this.materials.push(this.beltMaterial);

    this.root = new Entity('conveyor', app);
    this.root.enabled = false;
    parent.addChild(this.root);

    // Belt slab — top face at y = BELT_TOP_Y (the on-belt detection level).
    this.addBox(
      'belt-surface',
      this.beltMaterial,
      [BELT_WIDTH, BELT_HEIGHT, BELT_LENGTH],
      [0, BELT_TOP_Y - BELT_HEIGHT / 2, 0]
    );

    // Side rails — visuals matching the PhysicsWorld rail colliders.
    const railMat = this.makeMaterial('#9ca3af', 0.4, 0.6);
    for (const side of [-1, 1]) {
      this.addBox(
        `rail-${side}`,
        railMat,
        [0.08, 0.36, BELT_LENGTH],
        [side * (BELT_WIDTH / 2 + 0.06), BELT_TOP_Y + 0.18, 0]
      );
    }

    // End-cap rollers, laid along X at the belt's mid-height.
    const rollerMat = this.makeMaterial('#6b7280', 0.3, 0.8);
    const rollerRadius = BELT_HEIGHT / 1.6;
    for (const end of [-1, 1]) {
      const roller = new Entity(`roller-${end}`, app);
      roller.addComponent('render', {
        type: 'cylinder',
        material: rollerMat,
        castShadows: true,
      });
      // Unit cylinder: r 0.5, h 1 along Y → scale to r/rollerRadius, lay along X.
      roller.setLocalScale(rollerRadius * 2, BELT_WIDTH, rollerRadius * 2);
      roller.setLocalEulerAngles(0, 0, 90);
      roller.setLocalPosition(0, BELT_TOP_Y - BELT_HEIGHT / 2, end * (BELT_LENGTH / 2));
      this.root.addChild(roller);
    }

    // Frame: lengthwise beams under each outer edge + crossbars at the ends.
    const frameMat = this.makeMaterial('#4b5563', 0.5, 0.5);
    for (const side of [-1, 1]) {
      this.addBox(
        `beam-${side}`,
        frameMat,
        [0.06, 0.08, BELT_LENGTH - 0.2],
        [side * (BELT_WIDTH / 2 - 0.04), BELT_BOTTOM_Y - 0.04, 0]
      );
    }
    for (const end of [-1, 1]) {
      this.addBox(
        `crossbar-${end}`,
        frameMat,
        [BELT_WIDTH - 0.04, 0.06, 0.06],
        [0, BELT_BOTTOM_Y - 0.04, end * (BELT_LENGTH / 2 - 0.4)]
      );
    }

    // Support legs — bottoms on the ground (y=0), tucked inside the frame.
    for (const [x, z] of [
      [-(BELT_WIDTH / 2 - 0.04), -(BELT_LENGTH / 2 - 0.4)],
      [BELT_WIDTH / 2 - 0.04, -(BELT_LENGTH / 2 - 0.4)],
      [-(BELT_WIDTH / 2 - 0.04), BELT_LENGTH / 2 - 0.4],
      [BELT_WIDTH / 2 - 0.04, BELT_LENGTH / 2 - 0.4],
    ]) {
      this.addBox('leg', frameMat, [0.06, LEG_HEIGHT, 0.06], [x, LEG_HEIGHT / 2, z]);
    }

    app.on('update', this.onUpdate, this);
  }

  /** Shows/hides the whole belt assembly. */
  setActive(active: boolean): void {
    this.root.enabled = active;
  }

  /** Belt transport speed (m/s, +Z); drives the stripe scroll. */
  setSpeed(speed: number): void {
    this.speed = speed;
  }

  destroy(): void {
    this.app.off('update', this.onUpdate, this);
    this.root.destroy();
    for (const m of this.materials) m.destroy();
    this.texture.destroy();
  }

  private onUpdate(dt: number): void {
    if (!this.root.enabled || Math.abs(this.speed) < 1e-4) return;
    // Stripe scroll locked to body speed. PlayCanvas box top-face V runs
    // along +Z (verified from the mesh's UVs), and a growing sampling
    // offset moves the visible pattern toward -V — so ADVANCING the
    // offset for +Z transport scrolls stripes backwards. Subtract.
    this.offsetY -= beltTextureOffsetDelta(this.speed, dt, BELT_TEXTURE_REPEAT, BELT_LENGTH);
    // Keep the accumulator bounded; UVs wrap every 1.0 anyway.
    if (this.offsetY > 1e4 || this.offsetY < -1e4) this.offsetY %= 1;
    this.beltMaterial.diffuseMapOffset.set(0, this.offsetY);
    this.beltMaterial.update();
  }

  private makeMaterial(hex: string, roughness: number, metalness: number): StandardMaterial {
    const mat = new StandardMaterial();
    mat.diffuse = new Color().fromString(hex);
    mat.gloss = 1 - roughness;
    mat.metalness = metalness;
    mat.useMetalness = true;
    mat.update();
    this.materials.push(mat);
    return mat;
  }

  private addBox(
    name: string,
    material: StandardMaterial,
    scale: [number, number, number],
    position: [number, number, number]
  ): Entity {
    const e = new Entity(name, this.app);
    e.addComponent('render', { type: 'box', material, castShadows: true });
    e.setLocalScale(scale[0], scale[1], scale[2]);
    e.setLocalPosition(position[0], position[1], position[2]);
    this.root.addChild(e);
    return e;
  }
}
