import { describe, expect, it } from 'vitest';
import {
  BODY_FRICTION,
  BODY_RESTITUTION,
  SETTLE_TIMEOUT_MS,
  bodySettled,
  colliderSpecForKind,
  restHalfHeight,
} from '../../lib/physicsSpec';

/**
 * Real-Rapier integration check for the batch settle contract: a cube
 * dropped from 1 m must come to rest on the ground (top face y=0) at
 * y ≈ its half-extent within the 2500 ms sim-time budget, using the same
 * world setup as PhysicsWorld (gravity, 1/60 step, ground slab material,
 * body material) and the same `bodySettled` predicate the engine uses.
 *
 * rapier3d-compat inlines its wasm, so this runs headless under vitest;
 * everything is fixed-step sim-time — no timers, fully deterministic.
 */
describe('rapier settle integration', () => {
  it('a cube dropped from 1 m settles near y = half-extent within the timeout', async () => {
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();

    const FIXED_DT = 1 / 60;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = FIXED_DT;
    // Ground slab: top face at y=0 (PhysicsWorld's splat-floor convention).
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.5, 20)
        .setTranslation(0, -0.5, 0)
        .setFriction(0.8)
        .setRestitution(0.3)
    );

    const spec = colliderSpecForKind('cube', 1);
    if (spec.shape !== 'cuboid') throw new Error('cube must map to a cuboid');
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).setCcdEnabled(true)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...spec.halfExtents)
        .setFriction(BODY_FRICTION)
        .setRestitution(BODY_RESTITUTION),
      body
    );

    // Same loop shape as PhysicsWorld.settleSync (non-belt mode).
    const maxSteps = Math.ceil(SETTLE_TIMEOUT_MS / 1000 / FIXED_DT);
    let settledAtStep = -1;
    for (let i = 0; i < maxSteps; i++) {
      world.step();
      const lv = body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (bodySettled({ speed, position: body.translation() }, false)) {
        settledAtStep = i;
        break;
      }
    }

    expect(settledAtStep).toBeGreaterThanOrEqual(0);
    // Resting height: half-extent above the ground, with a small solver
    // margin. restHalfHeight('cube', 1) = 0.3.
    expect(body.translation().y).toBeCloseTo(restHalfHeight('cube', 1), 1);
    // Sanity: it actually fell (started at 1 m).
    expect(body.translation().y).toBeLessThan(0.5);
    world.free();
  });
});
