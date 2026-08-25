import {
  BoundingBox,
  Color,
  Entity,
  StandardMaterial,
  Vec3,
  type AppBase,
} from 'playcanvas';
import type { ObjectKind, SceneObject } from '../store/useStore';
import type { LabelTarget } from './capture/projectBoxes';

/**
 * Primitive dimensions carried over from the original app (three.js
 * geometries), expressed as local scale on PlayCanvas unit primitives.
 * PlayCanvas units: box 1^3, sphere d=1, capsule r0.5 h2, cylinder r0.5 h1,
 * torus ring 0.3 tube 0.2 (outer d=1, height 0.4).
 */
const KIND_CONFIG: Record<
  ObjectKind,
  { type: string; scale: [number, number, number]; height: number }
> = {
  cube: { type: 'box', scale: [0.6, 0.6, 0.6], height: 0.6 },
  sphere: { type: 'sphere', scale: [0.8, 0.8, 0.8], height: 0.8 },
  cylinder: { type: 'cylinder', scale: [0.7, 0.7, 0.7], height: 0.7 },
  torus: { type: 'torus', scale: [0.94, 0.94, 0.94], height: 0.376 },
  capsule: { type: 'capsule', scale: [0.6, 0.6, 0.6], height: 1.2 },
  phone: { type: 'box', scale: [0.5, 1.0, 0.08], height: 1.0 },
  soda_can: { type: 'cylinder', scale: [0.44, 0.62, 0.44], height: 0.62 },
};

interface Managed {
  entity: Entity;
  material: StandardMaterial;
  obj: SceneObject;
}

/**
 * Mirrors the store's sceneObjects into PlayCanvas entities. Objects with
 * physics=true rest on the ground plane (instant settle — a real physics
 * integration is tracked in TODO.md Phase 5); physics=false honors the
 * stored Y position exactly.
 */
export class ObjectManager {
  private app: AppBase;
  private parent: Entity;
  private managed = new Map<string, Managed>();

  constructor(app: AppBase, parent: Entity) {
    this.app = app;
    this.parent = parent;
  }

  /** Reconciles engine entities against the given store snapshot. */
  sync(objects: SceneObject[]): void {
    const seen = new Set<string>();
    for (const obj of objects) {
      seen.add(obj.id);
      const existing = this.managed.get(obj.id);
      if (!existing) {
        this.create(obj);
      } else if (existing.obj !== obj) {
        this.update(existing, obj);
      }
    }
    for (const [id, m] of this.managed) {
      if (!seen.has(id)) {
        m.entity.destroy();
        m.material.destroy();
        this.managed.delete(id);
      }
    }
  }

  private create(obj: SceneObject): void {
    const cfg = KIND_CONFIG[obj.kind];
    const material = new StandardMaterial();
    const entity = new Entity(`object-${obj.label}`, this.app);
    entity.addComponent('render', {
      type: cfg.type,
      material,
      castShadows: true,
    });
    this.parent.addChild(entity);
    const m: Managed = { entity, material, obj: { ...obj, color: '' } };
    this.managed.set(obj.id, m);
    this.update(m, obj);
  }

  private update(m: Managed, obj: SceneObject): void {
    const cfg = KIND_CONFIG[obj.kind];
    if (m.obj.color !== obj.color || m.obj.metalness !== obj.metalness || m.obj.roughness !== obj.roughness) {
      m.material.diffuse = new Color().fromString(obj.color);
      m.material.metalness = obj.metalness;
      m.material.gloss = 1 - obj.roughness;
      m.material.useMetalness = true;
      m.material.update();
    }
    const restY = (cfg.height * obj.scale) / 2;
    const y = obj.physics ? restY : obj.position[1];
    m.entity.setLocalPosition(obj.position[0], y, obj.position[2]);
    m.entity.setLocalEulerAngles(0, (obj.rotation * 180) / Math.PI, 0);
    m.entity.setLocalScale(
      cfg.scale[0] * obj.scale,
      cfg.scale[1] * obj.scale,
      cfg.scale[2] * obj.scale
    );
    m.obj = obj;
  }

  /**
   * Per-label capture targets (one AABB per object), filtered by owner:
   * 'vision' matches untagged objects; 'rover'/'arm' match robot-owned.
   * Without a scope every object is included.
   */
  getLabelTargets(scope?: 'vision' | 'rover' | 'arm'): LabelTarget[] {
    const targets: LabelTarget[] = [];
    for (const m of this.managed.values()) {
      if (scope === 'vision' && m.obj.owner != null) continue;
      if ((scope === 'rover' || scope === 'arm') && m.obj.owner !== scope) continue;
      const aabb = new BoundingBox();
      let first = true;
      for (const render of m.entity.findComponents('render') as any[]) {
        for (const mi of render.meshInstances ?? []) {
          if (first) {
            aabb.copy(mi.aabb);
            first = false;
          } else {
            aabb.add(mi.aabb);
          }
        }
      }
      if (first) continue;
      targets.push({ label: m.obj.label, aabbs: [aabb] });
    }
    return targets;
  }

  /** Selectable entries for viewport click-manipulation. */
  getSelectables(): { id: string; entity: Entity; label: string }[] {
    return [...this.managed.entries()].map(([id, m]) => ({
      id,
      entity: m.entity,
      label: m.obj.label,
    }));
  }

  /** Jitters object positions for domain randomization; returns undo data. */
  getPositions(): Map<string, Vec3> {
    const map = new Map<string, Vec3>();
    for (const [id, m] of this.managed) {
      map.set(id, m.entity.getLocalPosition().clone());
    }
    return map;
  }

  destroy(): void {
    for (const m of this.managed.values()) {
      m.entity.destroy();
      m.material.destroy();
    }
    this.managed.clear();
  }
}
