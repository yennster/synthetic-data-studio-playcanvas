import { Quat, type AppBase, type Entity } from 'playcanvas';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { ObjectKind, SceneObject } from '../../store/useStore';
import {
  BODY_FRICTION,
  BODY_RESTITUTION,
  FLOOR_RESCUE_Y,
  RESPAWN_Y,
  SETTLE_TIMEOUT_MS,
  bodySettled,
  colliderSpecForKind,
  type ColliderSpec,
} from '../../lib/physicsSpec';
import { BELT_COLLIDER_DEPTH, BELT_LENGTH, BELT_TOP_Y, BELT_WIDTH, isOnBelt } from '../../lib/beltPhysics';

type RapierModule = typeof import('@dimforge/rapier3d-compat');

/** Fixed physics timestep (s) — matches Rapier's default solver tuning. */
const FIXED_DT = 1 / 60;
/** Cap on catch-up steps per frame so a long hidden-tab pause can't spiral. */
const MAX_STEPS_PER_FRAME = 8;

/** Axis-aligned box for `setStaticBounds` wall colliders. */
export interface StaticAabb {
  min: [number, number, number];
  max: [number, number, number];
}

interface TrackedBody {
  body: RigidBody;
  collider: Collider;
  kind: ObjectKind;
  scale: number;
  /** Last store pose applied to (or emitted from) this body. Store writes
   * matching these within epsilon are our own settle-sync echoes and must
   * not teleport the body (same two-way filter as the original app). */
  lastPos: [number, number, number];
  lastYaw: number;
  sleeping: boolean;
}

/** routeSelectionTransform's rounding convention (mm precision). */
const r = (v: number) => Math.round(v * 1000) / 1000;

/** Yaw (rotation about world Y) of a quaternion, radians. */
function quatYaw(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}

/**
 * Lazily-initialized Rapier physics world for spawned primitives.
 *
 * - Rapier (~2 MB wasm) is dynamic-imported on first need — when a
 *   physics-enabled object appears or the conveyor turns on — so it
 *   never weighs on the initial bundle.
 * - Fixed-step (1/60) with an accumulator, driven from the app update
 *   loop; `settleSync` steps the same world synchronously in sim-time
 *   for batch captures (hidden-tab-safe: no timers, no rAF).
 * - Store⇄body sync: `syncObjects` mirrors the vision pool
 *   (owner == null, physics=true) into dynamic bodies; each frame body
 *   poses drive the entities; a body falling asleep emits its settled
 *   pose through `onSettled` so the store (and the panel fields /
 *   persistence) stay truthful.
 * - Conveyor transport: bodies on the belt get the belt's z velocity
 *   each step (x damped ×0.4, y untouched) — the original app's
 *   surface-velocity hack, ported verbatim.
 */
export class PhysicsWorld {
  /** Settled-pose write-back; wired to the store by EngineContext. */
  onSettled:
    | ((id: string, pose: { position: [number, number, number]; rotation: number }) => void)
    | null = null;

  private app: AppBase;
  private getEntity: (id: string) => Entity | null;
  private rapier: RapierModule | null = null;
  private world: World | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadFailed = false;
  private tracked = new Map<string, TrackedBody>();
  private lastObjects: SceneObject[] = [];
  private accumulator = 0;

  private beltActive = false;
  private beltSpeed = 0;
  private beltColliders: Collider[] = [];
  private boundsColliders: Collider[] = [];
  private pendingBounds: StaticAabb[] | null = null;

  private tmpQuat = new Quat();

  constructor(app: AppBase, getEntity: (id: string) => Entity | null) {
    this.app = app;
    this.getEntity = getEntity;
    app.on('update', this.frameUpdate, this);
  }

  /** True once Rapier is loaded and the world exists. */
  isReady(): boolean {
    return this.world !== null;
  }

  /** True while a live dynamic body drives this object's entity pose
   * (ObjectManager skips its own pose writes for tracked ids). */
  isTracking(id: string): boolean {
    return this.tracked.has(id);
  }

  /**
   * Loads Rapier and builds the world (idempotent). Resolves once ready
   * — or immediately if a previous load failed (callers fall back to the
   * kinematic instant-rest path in that case).
   */
  ensureLoaded(): Promise<void> {
    if (this.world || this.loadFailed) return Promise.resolve();
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const RAPIER = await import('@dimforge/rapier3d-compat');
        await RAPIER.init();
        this.rapier = RAPIER;
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = FIXED_DT;
        // Static ground plane: top face at y=0 — the splat floor
        // convention. Same slab + material as the original app.
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(20, 0.5, 20)
            .setTranslation(0, -0.5, 0)
            .setFriction(0.8)
            .setRestitution(0.3)
        );
        this.world = world;
        // Apply state that arrived while loading.
        this.applyBeltColliders();
        if (this.pendingBounds) this.setStaticBounds(this.pendingBounds);
        this.syncObjects(this.lastObjects);
      })().catch((err) => {
        this.loadFailed = true;
        console.warn('Physics disabled — Rapier failed to load:', err);
      });
    }
    return this.loadPromise;
  }

  /**
   * Reconciles Rapier bodies against the store snapshot. Only the vision
   * pool (owner == null) with physics=true gets real dynamics — robot-owned
   * objects are posed analytically by their sims. Called by EngineContext
   * on every sceneObjects change.
   */
  syncObjects(objects: SceneObject[]): void {
    this.lastObjects = objects;
    if (!this.world) {
      // First physics-enabled object triggers the lazy load.
      if (!this.loadFailed && objects.some((o) => !o.owner && o.physics)) {
        void this.ensureLoaded();
      }
      return;
    }
    const seen = new Set<string>();
    for (const obj of objects) {
      if (obj.owner || !obj.physics) continue;
      seen.add(obj.id);
      const t = this.tracked.get(obj.id);
      if (!t) {
        this.createBody(obj);
        continue;
      }
      if (t.kind !== obj.kind || t.scale !== obj.scale) {
        // Shape changed — rebuild the body at the new dims.
        this.removeBody(obj.id);
        this.createBody(obj);
        continue;
      }
      const dx = obj.position[0] - t.lastPos[0];
      const dy = obj.position[1] - t.lastPos[1];
      const dz = obj.position[2] - t.lastPos[2];
      if (dx * dx + dy * dy + dz * dz > 0.0025) {
        // The user (or a batch) moved it — teleport and drop cleanly.
        t.body.setTranslation(
          { x: obj.position[0], y: obj.position[1], z: obj.position[2] },
          true
        );
        t.body.setRotation(this.yawQuat(obj.rotation), true);
        t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        t.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else if (Math.abs(obj.rotation - t.lastYaw) > 1e-3) {
        // Yaw slider — re-orient in place without disturbing position.
        t.body.setRotation(this.yawQuat(obj.rotation), true);
        t.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      t.lastPos = [obj.position[0], obj.position[1], obj.position[2]];
      t.lastYaw = obj.rotation;
    }
    for (const id of [...this.tracked.keys()]) {
      if (!seen.has(id)) this.removeBody(id);
    }
  }

  /**
   * Applies a full-euler drop orientation to a body (batch randomization
   * uses full-sphere rotations; the store only keeps yaw). Position comes
   * through the store → `syncObjects` teleport path.
   */
  applyDropRotation(id: string, euler: [number, number, number]): void {
    const t = this.tracked.get(id);
    if (!t) return;
    this.tmpQuat.setFromEulerAngles(
      (euler[0] * 180) / Math.PI,
      (euler[1] * 180) / Math.PI,
      (euler[2] * 180) / Math.PI
    );
    t.body.setRotation(
      { x: this.tmpQuat.x, y: this.tmpQuat.y, z: this.tmpQuat.z, w: this.tmpQuat.w },
      true
    );
    t.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Steps the world synchronously until every body settles (speed below
   * threshold and — in belt mode — on the belt or fallen low) or
   * SETTLE_TIMEOUT_MS of *simulated* time elapses. Pure sim-time loop:
   * batches stay deterministic under `?seed=` and keep working in hidden
   * tabs where rAF and timers are throttled.
   */
  settleSync(opts: { belt: boolean }): void {
    if (!this.world) return;
    const maxSteps = Math.ceil(SETTLE_TIMEOUT_MS / 1000 / FIXED_DT);
    for (let i = 0; i < maxSteps; i++) {
      this.stepOnce();
      if (this.allSettled(opts.belt)) break;
    }
    this.accumulator = 0;
    this.writeEntityPoses();
    this.emitSleepTransitions();
  }

  /** Enables/disables the belt collider set and stores the transport speed. */
  setBelt(active: boolean, speed: number): void {
    this.beltSpeed = speed;
    if (active !== this.beltActive) {
      this.beltActive = active;
      this.applyBeltColliders();
    }
    if (active) void this.ensureLoaded();
  }

  /**
   * Replaces the generic static wall colliders with one fixed cuboid per
   * AABB. No caller yet — this is the hook for future environment presets
   * (warehouse/whitebox room walls, per the original's ±20 wall colliders):
   * when a preset lands, EngineContext passes its wall boxes here.
   */
  setStaticBounds(aabbs: StaticAabb[]): void {
    if (!this.world || !this.rapier) {
      this.pendingBounds = aabbs;
      if (aabbs.length > 0) void this.ensureLoaded();
      return;
    }
    this.pendingBounds = null;
    for (const c of this.boundsColliders) this.world.removeCollider(c, true);
    this.boundsColliders = [];
    for (const box of aabbs) {
      const hx = (box.max[0] - box.min[0]) / 2;
      const hy = (box.max[1] - box.min[1]) / 2;
      const hz = (box.max[2] - box.min[2]) / 2;
      this.boundsColliders.push(
        this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(hx, hy, hz)
            .setTranslation(box.min[0] + hx, box.min[1] + hy, box.min[2] + hz)
            .setFriction(0.5)
        )
      );
    }
  }

  destroy(): void {
    this.app.off('update', this.frameUpdate, this);
    this.tracked.clear();
    this.world?.free();
    this.world = null;
  }

  /* ---------------------------------------------------------------- */
  /* internals                                                         */
  /* ---------------------------------------------------------------- */

  private yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
    this.tmpQuat.setFromEulerAngles(0, (yaw * 180) / Math.PI, 0);
    return { x: this.tmpQuat.x, y: this.tmpQuat.y, z: this.tmpQuat.z, w: this.tmpQuat.w };
  }

  private createBody(obj: SceneObject): void {
    if (!this.world || !this.rapier) return;
    const RAPIER = this.rapier;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(obj.position[0], obj.position[1], obj.position[2])
      .setRotation(this.yawQuat(obj.rotation))
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);
    const spec = colliderSpecForKind(obj.kind, obj.scale);
    const colliderDesc = this.colliderDescFor(spec)
      .setFriction(BODY_FRICTION)
      .setRestitution(BODY_RESTITUTION);
    const collider = this.world.createCollider(colliderDesc, body);
    this.tracked.set(obj.id, {
      body,
      collider,
      kind: obj.kind,
      scale: obj.scale,
      lastPos: [obj.position[0], obj.position[1], obj.position[2]],
      lastYaw: obj.rotation,
      sleeping: false,
    });
  }

  private colliderDescFor(spec: ColliderSpec) {
    const RAPIER = this.rapier!;
    switch (spec.shape) {
      case 'cuboid':
        return RAPIER.ColliderDesc.cuboid(
          spec.halfExtents[0],
          spec.halfExtents[1],
          spec.halfExtents[2]
        );
      case 'ball':
        return RAPIER.ColliderDesc.ball(spec.radius);
      case 'cylinder':
        return RAPIER.ColliderDesc.cylinder(spec.halfHeight, spec.radius);
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(spec.halfHeight, spec.radius);
    }
  }

  private removeBody(id: string): void {
    const t = this.tracked.get(id);
    if (!t || !this.world) return;
    this.world.removeRigidBody(t.body);
    this.tracked.delete(id);
  }

  private applyBeltColliders(): void {
    if (!this.world || !this.rapier) return;
    for (const c of this.beltColliders) this.world.removeCollider(c, true);
    this.beltColliders = [];
    if (!this.beltActive) return;
    const RAPIER = this.rapier;
    // Belt slab — collider extends below the visual surface so fast
    // falls can't tunnel through the thin top (original constants).
    this.beltColliders.push(
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(BELT_WIDTH / 2, BELT_COLLIDER_DEPTH / 2, BELT_LENGTH / 2)
          .setTranslation(0, BELT_TOP_Y - BELT_COLLIDER_DEPTH / 2, 0)
          .setFriction(0.9)
          .setRestitution(0.1)
      )
    );
    // Side rails — inner faces flush with the belt edges, sealing the
    // tip-over gap that used to let cans slip off sideways.
    for (const side of [-1, 1]) {
      this.beltColliders.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.06, 0.22, BELT_LENGTH / 2)
            .setTranslation(side * (BELT_WIDTH / 2 + 0.06), BELT_TOP_Y + 0.16, 0)
            .setFriction(0.4)
            .setRestitution(0.05)
        )
      );
    }
  }

  private frameUpdate(dt: number): void {
    if (!this.world) return;
    this.accumulator += Math.min(dt, 1);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.stepOnce();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    // Drop unpayable debt so a long stall doesn't fast-forward later.
    if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;
    if (steps > 0) {
      this.rescueFallen();
      this.writeEntityPoses();
      this.emitSleepTransitions();
    }
  }

  private stepOnce(): void {
    const world = this.world!;
    // Belt transport (Rapier lacks native surface velocity): override the
    // Z velocity of bodies on the belt; damp X so nothing skitters
    // sideways forever; leave Y alone so gravity/bouncing still work.
    if (this.beltActive && Math.abs(this.beltSpeed) >= 1e-4) {
      for (const t of this.tracked.values()) {
        const p = t.body.translation();
        if (!isOnBelt(p)) continue;
        const lv = t.body.linvel();
        t.body.setLinvel({ x: lv.x * 0.4, y: lv.y, z: this.beltSpeed }, true);
      }
    }
    world.step();
  }

  private allSettled(beltMode: boolean): boolean {
    for (const t of this.tracked.values()) {
      const lv = t.body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (!bodySettled({ speed, position: t.body.translation() }, beltMode)) return false;
    }
    return true;
  }

  /** Teleports bodies that tunneled through the ground back above their
   * last known spot (original rescue behavior). */
  private rescueFallen(): void {
    for (const t of this.tracked.values()) {
      const p = t.body.translation();
      if (p.y >= FLOOR_RESCUE_Y) continue;
      t.body.setTranslation({ x: t.lastPos[0], y: RESPAWN_Y, z: t.lastPos[2] }, true);
      t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      t.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  private writeEntityPoses(): void {
    for (const [id, t] of this.tracked) {
      const entity = this.getEntity(id);
      if (!entity) continue;
      const p = t.body.translation();
      const q = t.body.rotation();
      // Entities are direct children of the identity content root, so
      // local == world (same convention as ObjectManager).
      entity.setLocalPosition(p.x, p.y, p.z);
      entity.setLocalRotation(q.x, q.y, q.z, q.w);
    }
  }

  /** On falling asleep, a body writes its settled pose to the store
   * (rounded like routeSelectionTransform) via `onSettled`. */
  private emitSleepTransitions(): void {
    // Snapshot: onSettled synchronously re-enters syncObjects via the
    // store subscription, which may rebuild bodies (mutating the map).
    for (const [id, t] of [...this.tracked]) {
      const sleeping = t.body.isSleeping();
      if (sleeping === t.sleeping) continue;
      t.sleeping = sleeping;
      if (!sleeping) continue;
      const p = t.body.translation();
      const yaw = r(quatYaw(t.body.rotation()));
      const pos: [number, number, number] = [r(p.x), r(p.y), r(p.z)];
      // Record before emitting so the resulting store echo is a no-op.
      t.lastPos = pos;
      t.lastYaw = yaw;
      this.onSettled?.(id, { position: pos, rotation: yaw });
    }
  }
}
