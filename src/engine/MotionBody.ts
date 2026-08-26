import { Color, Entity, StandardMaterial, type AppBase } from 'playcanvas';
import type { ObjectKind } from '../store/useStore';
import { KIND_CONFIG } from './ObjectManager';

/** Original ManipulatedMesh colors: teal while pinched, amber when free. */
const GRABBED = { diffuse: '#5eead4', emissive: '#0d4d44' };
const FREE = { diffuse: '#f59e0b', emissive: '#3d2706' };

/**
 * The motion-mode manipulated body: a single primitive the webcam hand
 * drives kinematically (grab/carry/throw). Purely a render target — the
 * hand-tracking session in modes/handTracking.ts owns all motion; this
 * class only mirrors poses onto a PlayCanvas entity and swaps the
 * grabbed/free tint. Created when the webcam toggle turns on, destroyed
 * when it turns off (the procedural runner is closed-form and never
 * needs a scene body).
 */
export class MotionBody {
  readonly entity: Entity;
  private material: StandardMaterial;
  private kind: ObjectKind;
  private grabbed = false;

  constructor(app: AppBase, parent: Entity, kind: ObjectKind) {
    this.kind = kind;
    this.material = new StandardMaterial();
    this.material.useMetalness = true;
    this.material.metalness = 0.2;
    this.material.gloss = 0.6;
    this.entity = new Entity('motion-body', app);
    this.entity.addComponent('render', {
      type: KIND_CONFIG[kind].type,
      material: this.material,
      castShadows: true,
    });
    parent.addChild(this.entity);
    this.applyKind();
    this.applyColor();
    this.resetToRest();
  }

  /** Resting center height for the current kind (floor is y=0). */
  restY(): number {
    const cfg = KIND_CONFIG[this.kind];
    return cfg.height / 2;
  }

  /** Swap the primitive; the body resets to its rest pose at origin. */
  setKind(kind: ObjectKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    const render = this.entity.render;
    // KIND_CONFIG types itself as string; every entry is a primitive name.
    if (render) render.type = KIND_CONFIG[kind].type as typeof render.type;
    this.applyKind();
    this.resetToRest();
  }

  /** World pose write: position + quaternion ([x, y, z, w]). */
  setPose(pos: readonly number[], quat: readonly number[]): void {
    this.entity.setLocalPosition(pos[0], pos[1], pos[2]);
    this.entity.setLocalRotation(quat[0], quat[1], quat[2], quat[3]);
  }

  setGrabbed(grabbed: boolean): void {
    if (grabbed === this.grabbed) return;
    this.grabbed = grabbed;
    this.applyColor();
  }

  resetToRest(): void {
    this.setPose([0, this.restY(), 0], [0, 0, 0, 1]);
  }

  destroy(): void {
    this.entity.destroy();
    this.material.destroy();
  }

  private applyKind(): void {
    const cfg = KIND_CONFIG[this.kind];
    this.entity.setLocalScale(cfg.scale[0], cfg.scale[1], cfg.scale[2]);
  }

  private applyColor(): void {
    const c = this.grabbed ? GRABBED : FREE;
    this.material.diffuse = new Color().fromString(c.diffuse);
    this.material.emissive = new Color().fromString(c.emissive);
    this.material.update();
  }
}
