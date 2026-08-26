/**
 * Conveyor-belt geometry constants and pure belt math, ported from the
 * original app's `beltDynamics.ts`. Renderer-agnostic — the engine-side
 * `ConveyorBelt` builds meshes from these numbers and `PhysicsWorld`
 * applies the transport hack using `isOnBelt`.
 */

/** Belt length along the Z axis, meters. */
export const BELT_LENGTH = 8;
export const BELT_WIDTH = 1.6;
/** Visual thickness of the belt slab. */
export const BELT_HEIGHT = 0.1;
/** Y world position of the top of the belt (where objects sit). The whole
 * conveyor — belt slab, rails, end caps, support legs — is positioned
 * relative to this so the legs stand on the ground (y=0) and the belt sits
 * comfortably above it. */
export const BELT_TOP_Y = 0.5;
/** Collider depth — extends below BELT_TOP_Y so fast-falling objects don't
 * tunnel through the thin visual surface. */
export const BELT_COLLIDER_DEPTH = 0.4;

/** How many times the stripe pattern tiles along the belt's length. The
 * texture-scroll code scales the UV offset by this to keep the visual
 * stripe speed locked to the physical body speed. */
export const BELT_TEXTURE_REPEAT = 6;

/**
 * Returns true when the body's translation is within the belt's XZ footprint
 * AND its Y is in a thin band just above the belt surface (so falling objects
 * aren't snapped sideways from outside the belt extent).
 */
export function isOnBelt(t: { x: number; y: number; z: number }): boolean {
  return (
    Math.abs(t.x) < BELT_WIDTH / 2 &&
    Math.abs(t.z) < BELT_LENGTH / 2 &&
    t.y > BELT_TOP_Y - 0.05 &&
    t.y < BELT_TOP_Y + 0.8
  );
}

/**
 * Per-frame UV-offset advance for the conveyor's stripe texture, given the
 * belt's `speed` (m/s of world) and the elapsed `dt` (s) since the last
 * frame.
 *
 * The texture tiles `repeat` times across `length` meters of belt, so one
 * UV unit covers `length / repeat` meters of world. To make the visible
 * stripes scroll at the same world-space speed as the rigid bodies the
 * belt transports, the UV offset has to advance at `speed * repeat /
 * length` per second — the inverse of the world-per-UV ratio. Without
 * this scaling the stripes drift faster than the bodies (the original
 * app's historical bug — at `repeat=6, length=8` the texture slid 1.33×
 * too fast).
 */
export function beltTextureOffsetDelta(
  speed: number,
  dt: number,
  repeat: number,
  length: number
): number {
  return (speed * dt * repeat) / length;
}

/**
 * Convert a UV-offset advance back into the world-space distance the
 * stripes appear to travel. Inverse of the relationship encoded in
 * `beltTextureOffsetDelta` — lets a test check the speed-matching
 * invariant as a round trip instead of restating the formula.
 */
export function visualScrollDistance(
  offsetDelta: number,
  repeat: number,
  length: number
): number {
  return (offsetDelta * length) / repeat;
}
