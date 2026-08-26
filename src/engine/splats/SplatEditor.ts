import {
  GSPLAT_STREAM_INSTANCE,
  GSplatProcessor,
  PIXELFORMAT_R8,
  PIXELFORMAT_RGBA8,
  Vec3,
  WORKBUFFER_UPDATE_ONCE,
  type AppBase,
  type Entity,
} from 'playcanvas';
import type { SplatEditOp } from '../../lib/splatOps';

/**
 * GPU splat editing via instance streams: erase (sphere/box/crop) writes 0
 * into a `splatVisible` stream and the work-buffer modifier collapses those
 * splats' scale; tint writes (color, strength) into a `splatTint` stream
 * and the modifier mixes it into the splat color. Works on ANY splat —
 * imported scans included — mirroring the engine's gaussian-splatting
 * editor example. Edits are non-destructive to the source asset (reset
 * restores).
 *
 * All coordinates are the splat's LOCAL space (`getCenter()` raw): ops are
 * recorded/persisted in local space (see lib/splatOps.ts), so applying them
 * here is transform-independent and reload replay is exact.
 */

/** Erases splats whose local-space center lies inside a sphere. */
const sphereEraseShader = {
  processGLSL: /* glsl */ `
    uniform vec4 uEraseSphere; // xyz = local center, w = radius

    void process() {
      if (distance(getCenter(), uEraseSphere.xyz) < uEraseSphere.w) {
        writeSplatVisible(vec4(0.0));
      } else {
        discard;
      }
    }
  `,
  processWGSL: /* wgsl */ `
    uniform uEraseSphere: vec4f;

    fn process() {
      if (distance(getCenter(), uniform.uEraseSphere.xyz) < uniform.uEraseSphere.w) {
        writeSplatVisible(vec4f(0.0));
      } else {
        discard;
      }
    }
  `,
};

/** Erases splats inside (mode 0) or outside (mode 1 = crop) a local AABB. */
const boxShader = {
  processGLSL: /* glsl */ `
    uniform vec3 uBoxMin;
    uniform vec3 uBoxMax;
    uniform float uKeepInside; // 1.0 = crop (erase outside), 0.0 = erase inside

    void process() {
      vec3 local = getCenter();
      bool inside = all(greaterThanEqual(local, uBoxMin)) && all(lessThanEqual(local, uBoxMax));
      bool erase = (uKeepInside > 0.5) ? !inside : inside;
      if (erase) {
        writeSplatVisible(vec4(0.0));
      } else {
        discard;
      }
    }
  `,
  processWGSL: /* wgsl */ `
    uniform uBoxMin: vec3f;
    uniform uBoxMax: vec3f;
    uniform uKeepInside: f32;

    fn process() {
      let local = getCenter();
      let inside = all(local >= uniform.uBoxMin) && all(local <= uniform.uBoxMax);
      let erase = select(inside, !inside, uniform.uKeepInside > 0.5);
      if (erase) {
        writeSplatVisible(vec4f(0.0));
      } else {
        discard;
      }
    }
  `,
};

/**
 * Writes (tint color, strength) for splats inside a local-space sphere.
 * Each stroke OVERWRITES the splat's tint state; the modifier applies one
 * mix(base, tint, strength), so restrokes don't compound (the CPU bake in
 * lib/splatOps.ts mirrors this exactly).
 */
const tintShader = {
  processGLSL: /* glsl */ `
    uniform vec4 uTintSphere; // xyz = local center, w = radius
    uniform vec4 uTintColor;  // rgb = tint, a = strength

    void process() {
      if (distance(getCenter(), uTintSphere.xyz) < uTintSphere.w) {
        writeSplatTint(uTintColor);
      } else {
        discard;
      }
    }
  `,
  processWGSL: /* wgsl */ `
    uniform uTintSphere: vec4f;
    uniform uTintColor: vec4f;

    fn process() {
      if (distance(getCenter(), uniform.uTintSphere.xyz) < uniform.uTintSphere.w) {
        writeSplatTint(uniform.uTintColor);
      } else {
        discard;
      }
    }
  `,
};

const workBufferModifier = {
  glsl: /* glsl */ `
    void modifySplatCenter(inout vec3 center) {
    }

    void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
      float visible = texelFetch(splatVisible, splat.uv, 0).r;
      if (visible < 0.5) {
        scale = vec3(0.0); // erased — collapse to nothing
      }
    }

    void modifySplatColor(vec3 center, inout vec4 color) {
      vec4 tint = texelFetch(splatTint, splat.uv, 0);
      color.rgb = mix(color.rgb, tint.rgb, tint.a);
    }
  `,
  wgsl: /* wgsl */ `
    fn modifySplatCenter(center: ptr<function, vec3f>) {
    }

    fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
      let visible = textureLoad(splatVisible, splat.uv, 0).r;
      if (visible < 0.5) {
        *scale = vec3f(0.0);
      }
    }

    fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
      let tint = textureLoad(splatTint, splat.uv, 0);
      (*color) = vec4f(mix((*color).rgb, tint.rgb, tint.a), (*color).a);
    }
  `,
};

interface EditState {
  sphereProc: GSplatProcessor;
  boxProc: GSplatProcessor;
  tintProc: GSplatProcessor;
}

export class SplatEditor {
  private app: AppBase;
  private states = new Map<Entity, EditState>();

  constructor(app: AppBase) {
    this.app = app;
  }

  /** Prepares an entity's gsplat for editing (idempotent). */
  private ensure(entity: Entity): EditState | null {
    const existing = this.states.get(entity);
    if (existing) return existing;

    const component = entity.gsplat;
    const resource = component?.resource as
      | { format?: { getStream(n: string): unknown; addExtraStreams(s: object[]): void } }
      | null
      | undefined;
    if (!component || !resource?.format) return null;

    if (!resource.format.getStream('splatVisible')) {
      resource.format.addExtraStreams([
        { name: 'splatVisible', format: PIXELFORMAT_R8, storage: GSPLAT_STREAM_INSTANCE },
      ]);
    }
    if (!resource.format.getStream('splatTint')) {
      resource.format.addExtraStreams([
        { name: 'splatTint', format: PIXELFORMAT_RGBA8, storage: GSPLAT_STREAM_INSTANCE },
      ]);
    }

    this.resetVisibility(entity);
    this.resetTint(entity);

    const device = this.app.graphicsDevice;
    const sphereProc = new GSplatProcessor(
      device,
      { component },
      { component, streams: ['splatVisible'] },
      sphereEraseShader
    );
    const boxProc = new GSplatProcessor(
      device,
      { component },
      { component, streams: ['splatVisible'] },
      boxShader
    );
    const tintProc = new GSplatProcessor(
      device,
      { component },
      { component, streams: ['splatTint'] },
      tintShader
    );
    component.setWorkBufferModifier(workBufferModifier);

    const state: EditState = { sphereProc, boxProc, tintProc };
    this.states.set(entity, state);
    return state;
  }

  private run(entity: Entity, proc: GSplatProcessor): void {
    proc.process();
    entity.gsplat!.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
  }

  /** Erases splats within `radius` of a LOCAL-space point. */
  eraseSphere(entity: Entity, localCenter: Vec3, radius: number): void {
    const state = this.ensure(entity);
    if (!state) return;
    state.sphereProc.setParameter('uEraseSphere', [
      localCenter.x,
      localCenter.y,
      localCenter.z,
      radius,
    ]);
    this.run(entity, state.sphereProc);
  }

  /** Tints splats within `radius` of a LOCAL-space point toward `color`. */
  tintSphere(
    entity: Entity,
    localCenter: Vec3,
    radius: number,
    color: [number, number, number],
    strength: number
  ): void {
    const state = this.ensure(entity);
    if (!state) return;
    state.tintProc.setParameter('uTintSphere', [
      localCenter.x,
      localCenter.y,
      localCenter.z,
      radius,
    ]);
    state.tintProc.setParameter('uTintColor', [color[0], color[1], color[2], strength]);
    this.run(entity, state.tintProc);
  }

  /** Erases everything OUTSIDE the LOCAL-space AABB (crop). */
  cropToBox(entity: Entity, min: Vec3, max: Vec3): void {
    this.applyBox(entity, min, max, true);
  }

  /** Erases everything INSIDE the LOCAL-space AABB. */
  eraseBox(entity: Entity, min: Vec3, max: Vec3): void {
    this.applyBox(entity, min, max, false);
  }

  private applyBox(entity: Entity, min: Vec3, max: Vec3, keepInside: boolean): void {
    const state = this.ensure(entity);
    if (!state) return;
    state.boxProc.setParameter('uBoxMin', [min.x, min.y, min.z]);
    state.boxProc.setParameter('uBoxMax', [max.x, max.y, max.z]);
    state.boxProc.setParameter('uKeepInside', keepInside ? 1 : 0);
    this.run(entity, state.boxProc);
  }

  /** Replays one recorded LOCAL-space edit op (reload restore path). */
  applyOp(entity: Entity, op: SplatEditOp): void {
    switch (op.kind) {
      case 'eraseSphere':
        this.eraseSphere(entity, new Vec3(...op.center), op.radius);
        break;
      case 'eraseBox':
        this.eraseBox(entity, new Vec3(...op.min), new Vec3(...op.max));
        break;
      case 'crop':
        this.cropToBox(entity, new Vec3(...op.min), new Vec3(...op.max));
        break;
      case 'tintSphere':
        this.tintSphere(entity, new Vec3(...op.center), op.radius, op.color, op.strength);
        break;
    }
  }

  /** Restores every splat to visible. */
  resetVisibility(entity: Entity): void {
    const texture = entity.gsplat?.getInstanceTexture('splatVisible');
    if (!texture) return;
    (texture.lock() as Uint8Array).fill(255);
    texture.unlock();
    if (this.states.has(entity)) {
      entity.gsplat!.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
    }
  }

  /** Clears every tint (strength 0). */
  resetTint(entity: Entity): void {
    const texture = entity.gsplat?.getInstanceTexture('splatTint');
    if (!texture) return;
    (texture.lock() as Uint8Array).fill(0);
    texture.unlock();
    if (this.states.has(entity)) {
      entity.gsplat!.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
    }
  }

  /** Restores the splat to its unedited state (visibility + tint). */
  resetEdits(entity: Entity): void {
    this.resetVisibility(entity);
    this.resetTint(entity);
  }

  /** Whether the entity has any edits prepared. */
  isEditing(entity: Entity): boolean {
    return this.states.has(entity);
  }

  release(entity: Entity): void {
    const state = this.states.get(entity);
    if (state) {
      state.sphereProc.destroy();
      state.boxProc.destroy();
      state.tintProc.destroy();
      this.states.delete(entity);
    }
  }

  /** Releases edit state for every entity NOT in `live` (removal sweep). */
  releaseExcept(live: ReadonlySet<Entity>): void {
    for (const entity of [...this.states.keys()]) {
      if (!live.has(entity)) this.release(entity);
    }
  }

  destroy(): void {
    for (const state of this.states.values()) {
      state.sphereProc.destroy();
      state.boxProc.destroy();
      state.tintProc.destroy();
    }
    this.states.clear();
  }
}
