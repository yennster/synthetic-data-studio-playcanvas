/**
 * Pure physics-facing helpers: primitive-kind → Rapier collider mapping,
 * batch-randomization drop volumes, and the settle predicate. Kept
 * renderer/physics-engine agnostic so the whole contract is unit-testable;
 * `PhysicsWorld` (engine side) is the only consumer that touches Rapier.
 *
 * Numbers ported from the original app: drop volume and jitter from
 * VirtualCamera's batch loop (§4.3), settle thresholds from
 * `waitForObjectsToSettle`, body material from SpawnedObjects (§4.9).
 */

import type { ObjectKind } from '../store/useStore';
import { isOnBelt } from './beltPhysics';
import type { Rng } from './rng';

/** Batch settle: a body counts as at-rest below this linear speed (m/s). */
export const SETTLE_SPEED_THRESHOLD = 0.15;
/** Batch settle: give up waiting after this much *simulated* time. */
export const SETTLE_TIMEOUT_MS = 2500;

/** Body material shared by all spawned primitives (original values). */
export const BODY_RESTITUTION = 0.2;
export const BODY_FRICTION = 0.7;

/** Rescue: a body that tunneled below this Y is teleported back up. */
export const FLOOR_RESCUE_Y = -3;
export const RESPAWN_Y = 5;

/** Collider shape for one spawned primitive, in Rapier's parameter
 * conventions (half-extents / radii / half-height of the cylindrical
 * part). All dimensions are world meters at the given object scale. */
export type ColliderSpec =
  | { shape: 'cuboid'; halfExtents: [number, number, number] }
  | { shape: 'ball'; radius: number }
  | { shape: 'cylinder'; halfHeight: number; radius: number }
  | { shape: 'capsule'; halfHeight: number; radius: number };

/**
 * Base dimensions (scale = 1) per kind. Must stay in sync with
 * `KIND_CONFIG` in engine/ObjectManager.ts, which sizes the render
 * meshes these colliders stand in for: cube 0.6³, sphere ⌀0.8, cylinder
 * ⌀0.7×0.7, torus outer ⌀0.94×0.376, capsule r0.3 total height 1.2,
 * phone 0.5×1.0×0.08, soda_can ⌀0.44×0.62.
 */
const HALF_HEIGHT: Record<ObjectKind, number> = {
  cube: 0.3,
  sphere: 0.4,
  cylinder: 0.35,
  torus: 0.188,
  capsule: 0.6,
  phone: 0.5,
  soda_can: 0.31,
};

/**
 * Maps a primitive kind to its physics collider: cube/phone → cuboid,
 * sphere → ball, cylinder/soda_can → cylinder, capsule → capsule, and
 * torus → a flat cylinder approximation (Rapier has no torus primitive;
 * the outer radius / height match the render mesh so it rests and
 * stacks believably).
 */
export function colliderSpecForKind(kind: ObjectKind, scale: number): ColliderSpec {
  const s = scale;
  switch (kind) {
    case 'cube':
      return { shape: 'cuboid', halfExtents: [0.3 * s, 0.3 * s, 0.3 * s] };
    case 'phone':
      return { shape: 'cuboid', halfExtents: [0.25 * s, 0.5 * s, 0.04 * s] };
    case 'sphere':
      return { shape: 'ball', radius: 0.4 * s };
    case 'cylinder':
      return { shape: 'cylinder', halfHeight: 0.35 * s, radius: 0.35 * s };
    case 'soda_can':
      return { shape: 'cylinder', halfHeight: 0.31 * s, radius: 0.22 * s };
    case 'capsule':
      // Rapier capsule halfHeight covers the cylindrical part only:
      // total height 1.2 − 2 × 0.3 radius = 0.6 cylinder, half 0.3.
      return { shape: 'capsule', halfHeight: 0.3 * s, radius: 0.3 * s };
    case 'torus':
      return { shape: 'cylinder', halfHeight: 0.188 * s, radius: 0.47 * s };
  }
}

/** Rest height of a settled upright body (half its overall height). */
export function restHalfHeight(kind: ObjectKind, scale: number): number {
  return HALF_HEIGHT[kind] * scale;
}

/**
 * Conveyor drop volume from the original batch loop: x within the belt's
 * inner rails, y above the belt top, z along most of the belt length.
 * Consumes exactly 3 rng values (call order is the determinism contract
 * under `?seed=`).
 */
export function sampleBeltDropPosition(rng: Rng): [number, number, number] {
  return [
    (rng() - 0.5) * 1.2, // belt is ~1.6 m wide
    1.6 + rng() * 0.4, // above belt top
    (rng() - 0.5) * 6, // belt is 8 m long
  ];
}

/**
 * Non-belt randomization volume: jitter around the object's batch-start
 * position (±0.3 x/z, ±0.1 y floored at 0.2). Consumes exactly 3 rng
 * values.
 */
export function jitterDropPosition(
  rng: Rng,
  base: [number, number, number]
): [number, number, number] {
  return [
    base[0] + (rng() - 0.5) * 0.6,
    Math.max(0.2, base[1] + (rng() - 0.5) * 0.2),
    base[2] + (rng() - 0.5) * 0.6,
  ];
}

/** Full-sphere random orientation (original: 3 × `rng()*2π` eulers). */
export function sampleDropRotation(rng: Rng): [number, number, number] {
  return [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2];
}

/**
 * Per-body settle check from the original `waitForObjectsToSettle`:
 * the body must be slower than the threshold, and — in belt mode — either
 * on the belt or low enough (y ≤ 0.4) to have legitimately fallen off.
 * Mid-air bodies above the belt band block settling in belt mode.
 */
export function bodySettled(
  body: { speed: number; position: { x: number; y: number; z: number } },
  beltMode: boolean
): boolean {
  if (body.speed > SETTLE_SPEED_THRESHOLD) return false;
  if (beltMode && !isOnBelt(body.position) && body.position.y > 0.4) return false;
  return true;
}
