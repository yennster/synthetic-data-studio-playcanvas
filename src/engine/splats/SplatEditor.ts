import {
  GSPLAT_STREAM_INSTANCE,
  GSplatProcessor,
  PIXELFORMAT_R8,
  Vec3,
  WORKBUFFER_UPDATE_ONCE,
  type AppBase,
  type Entity,
} from 'playcanvas';

/**
 * GPU splat editing via a `splatVisible` instance stream: erase (sphere),
 * delete-in-box, and crop-to-box work on ANY splat — imported scans
 * included — by writing 0 into the stream and zeroing the splat's scale in
 * the work-buffer modifier. Mirrors the engine's gaussian-splatting editor
 * example. Edits are non-destructive to the source asset (reset restores).
 */

/** Erases splats whose world-space center lies inside a sphere. */
const sphereEraseShader = {
  processGLSL: /* glsl */ `
    uniform vec4 uEraseSphere; // xyz = world center, w = radius
    uniform mat4 matrix_model;

    void process() {
      vec3 world = (matrix_model * vec4(getCenter(), 1.0)).xyz;
      if (distance(world, uEraseSphere.xyz) < uEraseSphere.w) {
        writeSplatVisible(vec4(0.0));
      } else {
        discard;
      }
    }
  `,
  processWGSL: /* wgsl */ `
    uniform uEraseSphere: vec4f;
    uniform matrix_model: mat4x4f;

    fn process() {
      let world = (uniform.matrix_model * vec4f(getCenter(), 1.0)).xyz;
      if (distance(world, uniform.uEraseSphere.xyz) < uniform.uEraseSphere.w) {
        writeSplatVisible(vec4f(0.0));
      } else {
        discard;
      }
    }
  `,
};

/** Erases splats inside (mode 0) or outside (mode 1 = crop) a world AABB. */
const boxShader = {
  processGLSL: /* glsl */ `
    uniform vec3 uBoxMin;
    uniform vec3 uBoxMax;
    uniform float uKeepInside; // 1.0 = crop (erase outside), 0.0 = erase inside
    uniform mat4 matrix_model;

    void process() {
      vec3 world = (matrix_model * vec4(getCenter(), 1.0)).xyz;
      bool inside = all(greaterThanEqual(world, uBoxMin)) && all(lessThanEqual(world, uBoxMax));
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
    uniform matrix_model: mat4x4f;

    fn process() {
      let world = (uniform.matrix_model * vec4f(getCenter(), 1.0)).xyz;
      let inside = all(world >= uniform.uBoxMin) && all(world <= uniform.uBoxMax);
      let erase = select(inside, !inside, uniform.uKeepInside > 0.5);
      if (erase) {
        writeSplatVisible(vec4f(0.0));
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
    }
  `,
};

interface EditState {
  sphereProc: GSplatProcessor;
  boxProc: GSplatProcessor;
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

    this.resetVisibility(entity);

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
    component.setWorkBufferModifier(workBufferModifier);

    const state: EditState = { sphereProc, boxProc };
    this.states.set(entity, state);
    return state;
  }

  private run(entity: Entity, proc: GSplatProcessor): void {
    proc.process();
    entity.gsplat!.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
  }

  /** Erases splats within `radius` of a world-space point. */
  eraseSphere(entity: Entity, worldCenter: Vec3, radius: number): void {
    const state = this.ensure(entity);
    if (!state) return;
    state.sphereProc.setParameter('uEraseSphere', [
      worldCenter.x,
      worldCenter.y,
      worldCenter.z,
      radius,
    ]);
    this.run(entity, state.sphereProc);
  }

  /** Erases everything OUTSIDE the world AABB (crop). */
  cropToBox(entity: Entity, min: Vec3, max: Vec3): void {
    this.applyBox(entity, min, max, true);
  }

  /** Erases everything INSIDE the world AABB. */
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

  /** Whether the entity has any edits prepared. */
  isEditing(entity: Entity): boolean {
    return this.states.has(entity);
  }

  release(entity: Entity): void {
    const state = this.states.get(entity);
    if (state) {
      state.sphereProc.destroy();
      state.boxProc.destroy();
      this.states.delete(entity);
    }
  }

  destroy(): void {
    for (const state of this.states.values()) {
      state.sphereProc.destroy();
      state.boxProc.destroy();
    }
    this.states.clear();
  }
}
