import { describe, expect, it } from 'vitest';
import {
  A_XY,
  HAND_LOST_GRACE_MS,
  H_NEUTRAL,
  PINCH_LERP,
  cameraYawAngle,
  composeYawRotation,
  createDrivenImuSampler,
  createFreeBody,
  createHandStateTracker,
  handMappingScale,
  mapHandToTarget,
  pinchTargetToWorld,
  quatDeltaOmega,
  quatFromAxisAngle,
  quatMul,
  quatSlerp,
  rotateVecByQuat,
  rotateVecIntoBody,
} from './handKinematics';
import type { Landmark, Quat } from './handMath';
import { DEFAULT_IMU_NOISE, type ImuNoiseConfig } from './imuNoise';

const G = 9.81;
const NO_NOISE: ImuNoiseConfig = { ...DEFAULT_IMU_NOISE, enabled: false };

/**
 * 21-landmark hand with the palm anchored so handSize (wrist 0 → middle
 * MCP 9) is exactly 0.13 = H_NEUTRAL, and the thumb/index tips split
 * symmetrically around (0.5, 0.7) by `pinchDist`. computePinchStrength's
 * ratio is then pinchDist/0.13.
 */
function makeHand(pinchDist: number): Landmark[] {
  const arr: Landmark[] = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.75,
    z: 0,
  }));
  arr[0] = { x: 0.5, y: 0.8, z: 0 }; // wrist
  arr[9] = { x: 0.5, y: 0.67, z: 0 }; // middle MCP → handSize 0.13
  arr[4] = { x: 0.5 - pinchDist / 2, y: 0.7, z: 0 }; // thumb tip
  arr[8] = { x: 0.5 + pinchDist / 2, y: 0.7, z: 0 }; // index tip
  arr[5] = { x: 0.55, y: 0.68, z: 0 }; // index MCP
  arr[17] = { x: 0.45, y: 0.68, z: 0 }; // pinky MCP
  return arr;
}

/** pinchDist that produces a given pinch strength (inverting §6.3's map). */
function distForPinch(strength: number): number {
  return (0.15 + 0.45 * (1 - strength)) * 0.13;
}

// ---------- Quaternion helpers ----------

describe('quat helpers', () => {
  const IDENT: Quat = [0, 0, 0, 1];

  it('quatMul with identity is a no-op', () => {
    const q = quatFromAxisAngle([0, 1, 0], 0.7);
    expect(quatMul(q, IDENT)).toEqual(q);
    for (let i = 0; i < 4; i++) {
      expect(quatMul(IDENT, q)[i]).toBeCloseTo(q[i], 12);
    }
  });

  it('rotateVecByQuat rotates +Z to +X under a +90° yaw', () => {
    const yaw = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    const v = rotateVecByQuat(yaw, [0, 0, 1]);
    expect(v[0]).toBeCloseTo(1, 10);
    expect(v[1]).toBeCloseTo(0, 10);
    expect(v[2]).toBeCloseTo(0, 10);
  });

  it('rotateVecIntoBody inverts rotateVecByQuat', () => {
    const q = quatFromAxisAngle([0.6, 0.8, 0], 1.1);
    const world = rotateVecByQuat(q, [0.3, -0.4, 0.9]);
    const back = rotateVecIntoBody(q, world);
    expect(back[0]).toBeCloseTo(0.3, 10);
    expect(back[1]).toBeCloseTo(-0.4, 10);
    expect(back[2]).toBeCloseTo(0.9, 10);
  });

  it('quatSlerp hits both endpoints and stays unit-length midway', () => {
    const a = quatFromAxisAngle([0, 1, 0], 0.2);
    const b = quatFromAxisAngle([0, 1, 0], 1.4);
    expect(quatSlerp(a, b, 0)[3]).toBeCloseTo(a[3], 10);
    expect(quatSlerp(a, b, 1)[3]).toBeCloseTo(b[3], 10);
    const mid = quatSlerp(a, b, 0.5);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 10);
    // Same-axis slerp halves the angle: 0.2 + (1.4-0.2)/2 = 0.8.
    expect(2 * Math.acos(mid[3])).toBeCloseTo(0.8, 6);
  });

  it('quatSlerp takes the short way round across hemispheres', () => {
    const a: Quat = [0, 0, 0, 1];
    const b = quatFromAxisAngle([0, 1, 0], 0.4);
    const negB: Quat = [-b[0], -b[1], -b[2], -b[3]]; // same rotation
    const mid = quatSlerp(a, negB, 0.5);
    // Must interpolate toward the 0.2 rad rotation, not spin 2π−0.4.
    const v = rotateVecByQuat(mid, [0, 0, 1]);
    expect(v[0]).toBeCloseTo(Math.sin(0.2), 6);
    expect(v[2]).toBeCloseTo(Math.cos(0.2), 6);
  });

  it('quatDeltaOmega recovers a constant angular rate', () => {
    const rate = 3; // rad/s about +Y
    const dt = 1 / 60;
    const prev = quatFromAxisAngle([0, 1, 0], 0.5);
    const next = quatMul(quatFromAxisAngle([0, 1, 0], rate * dt), prev);
    const w = quatDeltaOmega(prev, next, dt);
    expect(w[0]).toBeCloseTo(0, 8);
    expect(w[1]).toBeCloseTo(rate, 6);
    expect(w[2]).toBeCloseTo(0, 8);
  });

  it('quatDeltaOmega returns zero for identical quats or dt<=0', () => {
    const q = quatFromAxisAngle([1, 0, 0], 0.3);
    expect(quatDeltaOmega(q, q, 1 / 60)).toEqual([0, 0, 0]);
    expect(quatDeltaOmega(q, quatFromAxisAngle([1, 0, 0], 0.5), 0)).toEqual([
      0, 0, 0,
    ]);
  });
});

// ---------- Screen → scene mapping ----------

describe('handMappingScale', () => {
  it('is 1 at the default camera distance and clamps to [1, 3]', () => {
    expect(handMappingScale(Math.hypot(4, 3, 6))).toBeCloseTo(1, 10);
    expect(handMappingScale(0.5)).toBe(1);
    expect(handMappingScale(1000)).toBe(3);
    expect(handMappingScale(2 * Math.hypot(4, 3, 6))).toBeCloseTo(2, 10);
  });
});

describe('mapHandToTarget', () => {
  it('maps the neutral pose (center-x, ground-y, neutral size) to the origin', () => {
    const t = mapHandToTarget(0.5, 0.85, H_NEUTRAL, 1);
    expect(t[0]).toBeCloseTo(0, 10);
    expect(t[1]).toBeCloseTo(0, 10);
    expect(t[2]).toBeCloseTo(0, 10);
  });

  it('mirrors x: hand on the image left maps to +x', () => {
    // cx = 0 (image left) → (1 − 0 − 0.5)·6 = +3.
    expect(mapHandToTarget(0, 0.85, H_NEUTRAL, 1)[0]).toBeCloseTo(3, 10);
    expect(mapHandToTarget(1, 0.85, H_NEUTRAL, 1)[0]).toBeCloseTo(-3, 10);
  });

  it('raises y as the hand moves up the frame', () => {
    expect(mapHandToTarget(0.5, 0.05, H_NEUTRAL, 1)[1]).toBeCloseTo(4, 10);
  });

  it('clamps the hand-size depth proxy to ±2.5 before scaling', () => {
    expect(mapHandToTarget(0.5, 0.85, 10, 1)[2]).toBe(2.5);
    expect(mapHandToTarget(0.5, 0.85, -10, 2)[2]).toBe(-5);
  });

  it('widens x/y with the mapping scale', () => {
    const t = mapHandToTarget(0, 0.05, H_NEUTRAL, 3);
    expect(t[0]).toBeCloseTo(9, 10);
    expect(t[1]).toBeCloseTo(12, 10);
  });
});

describe('pinchTargetToWorld / cameraYawAngle', () => {
  it('is the identity mapping when the camera sits on +Z', () => {
    const w = pinchTargetToWorld([1, 2, 3], [0, 1.5, 8]);
    expect(w[0]).toBeCloseTo(1, 10);
    expect(w[1]).toBeCloseTo(2, 10);
    expect(w[2]).toBeCloseTo(3, 10);
  });

  it('yaws the basis with the camera: camera on +X swaps axes', () => {
    // back = +X, right = up × back = −Z; target x goes to world −z.
    const w = pinchTargetToWorld([1, 0, 0], [10, 2, 0]);
    expect(w[0]).toBeCloseTo(0, 10);
    expect(w[2]).toBeCloseTo(-1, 10);
    // target z (toward camera) goes to world +x.
    const w2 = pinchTargetToWorld([0, 0, 1], [10, 2, 0]);
    expect(w2[0]).toBeCloseTo(1, 10);
    expect(w2[2]).toBeCloseTo(0, 10);
  });

  it('keeps hand height as world height regardless of camera yaw', () => {
    const w = pinchTargetToWorld([0, 1.7, 0], [-3, 9, 4]);
    expect(w[1]).toBeCloseTo(1.7, 10);
  });

  it('falls back to the +Z basis when the camera is directly overhead', () => {
    const w = pinchTargetToWorld([1, 0, 0], [0, 12, 0]);
    expect(w[0]).toBeCloseTo(1, 10);
    expect(w[2]).toBeCloseTo(0, 10);
  });

  it('cameraYawAngle measures yaw from +Z toward +X', () => {
    expect(cameraYawAngle([0, 3, 5])).toBeCloseTo(0, 10);
    expect(cameraYawAngle([5, 3, 0])).toBeCloseTo(Math.PI / 2, 10);
    expect(cameraYawAngle([0, 3, 0])).toBe(0); // degenerate overhead
  });

  it('composeYawRotation prepends the camera yaw', () => {
    const yawed = composeYawRotation(Math.PI / 2, [0, 0, 0, 1]);
    const v = rotateVecByQuat(yawed, [0, 0, 1]);
    expect(v[0]).toBeCloseTo(1, 10);
    expect(v[2]).toBeCloseTo(0, 10);
  });
});

// ---------- Hand-state tracker ----------

describe('createHandStateTracker', () => {
  it('latches the grab with 0.65/0.45 hysteresis', () => {
    const tr = createHandStateTracker();
    // Open hand: no grab.
    let s = tr.update(makeHand(distForPinch(0.2)), 0, 1);
    expect(s.grabbed).toBe(false);
    // Strong pinch: grab latches.
    s = tr.update(makeHand(distForPinch(0.9)), 16, 1);
    expect(s.pinch).toBeGreaterThan(0.65);
    expect(s.grabbed).toBe(true);
    // Mid-zone (0.45 < pinch < 0.65): grab persists.
    s = tr.update(makeHand(distForPinch(0.55)), 32, 1);
    expect(s.pinch).toBeGreaterThan(0.45);
    expect(s.pinch).toBeLessThan(0.65);
    expect(s.grabbed).toBe(true);
    // Below the release threshold: grab drops.
    s = tr.update(makeHand(distForPinch(0.3)), 48, 1);
    expect(s.grabbed).toBe(false);
    // Mid-zone from below: still not grabbed.
    s = tr.update(makeHand(distForPinch(0.55)), 64, 1);
    expect(s.grabbed).toBe(false);
  });

  it('freezes the grab and target inside the 350 ms dropout grace', () => {
    const tr = createHandStateTracker();
    tr.update(makeHand(distForPinch(0.9)), 0, 1);
    const held = tr.update(null, 100, 1);
    expect(held.detected).toBe(false);
    expect(held.grabbed).toBe(true);
    expect(held.target).not.toBeNull();
    // Still inside grace on a later blip.
    const held2 = tr.update(null, HAND_LOST_GRACE_MS - 1, 1);
    expect(held2.grabbed).toBe(true);
  });

  it('releases everything past the grace window', () => {
    const tr = createHandStateTracker();
    tr.update(makeHand(distForPinch(0.9)), 0, 1);
    const s = tr.update(null, HAND_LOST_GRACE_MS + 1, 1);
    expect(s.grabbed).toBe(false);
    expect(s.pinch).toBe(0);
    expect(s.target).toBeNull();
    expect(s.rotation).toBeNull();
  });

  it('re-detecting within grace keeps the grab alive', () => {
    const tr = createHandStateTracker();
    tr.update(makeHand(distForPinch(0.9)), 0, 1);
    tr.update(null, 200, 1);
    const s = tr.update(makeHand(distForPinch(0.55)), 300, 1);
    expect(s.detected).toBe(true);
    expect(s.grabbed).toBe(true); // mid-zone pinch keeps the latch
  });

  it('smooths the target exponentially (first frame raw, then A_XY steps)', () => {
    const tr = createHandStateTracker();
    // Neutral pose → raw target [0, 0, 0].
    tr.update(makeHand(distForPinch(0.2)), 0, 1);
    // Jump the pinch centroid: tips moved to cx = 0.25 give rawX = 1.5.
    const hand = makeHand(distForPinch(0.2));
    hand[4] = { x: 0.25, y: 0.7, z: 0 };
    hand[8] = { x: 0.25, y: 0.7, z: 0 };
    const raw = (1 - 0.25 - 0.5) * 6; // 1.5
    const s = tr.update(hand, 16, 1);
    expect(s.target![0]).toBeCloseTo(raw * A_XY, 6);
  });
});

// ---------- Analytic free body ----------

describe('createFreeBody', () => {
  const REST = 0.3;

  it('falls under gravity and settles at the rest height', () => {
    const body = createFreeBody({
      pos: [0, 2, 0],
      quat: [0, 0, 0, 1],
      linvel: [0, 0, 0],
      angvel: [0, 0, 0],
      restY: REST,
    });
    let last = body.step(1 / 60);
    expect(last.pos[1]).toBeLessThan(2); // dropping
    for (let i = 0; i < 600 && !last.settled; i++) last = body.step(1 / 60);
    expect(last.settled).toBe(true);
    expect(last.pos[1]).toBeCloseTo(REST, 10);
  });

  it('bounces once with restitution before settling', () => {
    const body = createFreeBody({
      pos: [0, 1.5, 0],
      quat: [0, 0, 0, 1],
      linvel: [0, 0, 0],
      angvel: [0, 0, 0],
      restY: REST,
    });
    let touched = false;
    let rose = false;
    let prevY = 1.5;
    for (let i = 0; i < 600; i++) {
      const p = body.step(1 / 120);
      if (p.pos[1] <= REST + 1e-9) touched = true;
      if (touched && p.pos[1] > prevY + 1e-9) rose = true;
      prevY = p.pos[1];
      if (p.settled) break;
    }
    expect(touched).toBe(true);
    expect(rose).toBe(true); // restitution bounce, not a dead stop
  });

  it('slides out horizontal velocity with friction and settles', () => {
    const body = createFreeBody({
      pos: [0, REST, 0],
      quat: [0, 0, 0, 1],
      linvel: [2, 0, 0],
      angvel: [0, 0, 0],
      restY: REST,
    });
    let last = body.step(1 / 60);
    const early = last.pos[0];
    for (let i = 0; i < 600 && !last.settled; i++) last = body.step(1 / 60);
    expect(last.settled).toBe(true);
    expect(last.pos[0]).toBeGreaterThan(early); // travelled then stopped
    // v²/(2µg) total slide ≈ 0.453 m for v=2.
    expect(last.pos[0]).toBeLessThan(0.6);
  });

  it('keeps a settled pose frozen and clamps huge dt spikes', () => {
    const body = createFreeBody({
      pos: [0, REST, 0],
      quat: [0, 0, 0, 1],
      linvel: [0, 0, 0],
      angvel: [0, 0, 0],
      restY: REST,
    });
    let last = body.step(1 / 60);
    for (let i = 0; i < 200 && !last.settled; i++) last = body.step(1 / 60);
    expect(last.settled).toBe(true);
    const frozen = body.step(5); // tab-jank dt
    expect(frozen.pos).toEqual(last.pos);
    expect(frozen.settled).toBe(true);
  });

  it('integrates the tumble from the release spin', () => {
    const body = createFreeBody({
      pos: [0, 5, 0],
      quat: [0, 0, 0, 1],
      linvel: [0, 0, 0],
      angvel: [0, Math.PI, 0], // half turn per second about +Y
      restY: REST,
    });
    let p = body.step(0.05);
    for (let i = 0; i < 9; i++) p = body.step(0.05); // 0.5 s airborne
    // Half of a half-turn = 90°: quat ≈ axis-angle(+Y, π/2).
    expect(Math.abs(p.quat[1])).toBeCloseTo(Math.sin(Math.PI / 4), 4);
    expect(Math.abs(p.quat[3])).toBeCloseTo(Math.cos(Math.PI / 4), 4);
  });
});

// ---------- Driven-pose IMU sampler ----------

describe('createDrivenImuSampler', () => {
  const DT = 1 / 60;

  it('reads +1 g up and zero gyro at rest', () => {
    const s = createDrivenImuSampler(() => 0.5);
    for (let i = 0; i < 5; i++) s.tick([1, 0.5, -2], [0, 0, 0, 1], DT);
    const r = s.sample(DT, NO_NOISE);
    expect(r.accel[0]).toBeCloseTo(0, 8);
    expect(r.accel[1]).toBeCloseTo(G, 8);
    expect(r.accel[2]).toBeCloseTo(0, 8);
    expect(r.gyro).toEqual([0, 0, 0]);
  });

  it('reads ~0 specific force in free fall', () => {
    const s = createDrivenImuSampler(() => 0.5);
    // y(t) = 2 − ½·g·t² sampled at fixed dt: the double difference of a
    // quadratic is exact, so accel − g cancels to numerical zero.
    for (let k = 0; k < 6; k++) {
      const t = k * DT;
      s.tick([0, 2 - 0.5 * G * t * t, 0], [0, 0, 0, 1], DT);
    }
    const r = s.sample(DT, NO_NOISE);
    expect(r.accel[0]).toBeCloseTo(0, 6);
    expect(r.accel[1]).toBeCloseTo(0, 6);
    expect(r.accel[2]).toBeCloseTo(0, 6);
  });

  it('reports a constant spin rate on the gyro channel', () => {
    const s = createDrivenImuSampler(() => 0.5);
    const rate = 2.5; // rad/s about +Y
    for (let k = 0; k < 5; k++) {
      s.tick([0, 1, 0], quatFromAxisAngle([0, 1, 0], rate * k * DT), DT);
    }
    const r = s.sample(DT, NO_NOISE);
    expect(r.gyro[0]).toBeCloseTo(0, 6);
    expect(r.gyro[1]).toBeCloseTo(rate, 5);
    expect(r.gyro[2]).toBeCloseTo(0, 6);
  });

  it('expresses the specific force in the body frame', () => {
    const s = createDrivenImuSampler(() => 0.5);
    // Body pitched 90° about +X: world up reads on the body's ∓z axis.
    const q = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
    for (let i = 0; i < 4; i++) s.tick([0, 1, 0], q, DT);
    const r = s.sample(DT, NO_NOISE);
    const mag = Math.hypot(r.accel[0], r.accel[1], r.accel[2]);
    expect(mag).toBeCloseTo(G, 6);
    expect(Math.abs(r.accel[2])).toBeCloseTo(G, 6);
    expect(r.accel[1]).toBeCloseTo(0, 6);
  });

  it('reset() swallows teleports instead of emitting velocity spikes', () => {
    const s = createDrivenImuSampler(() => 0.5);
    for (let i = 0; i < 4; i++) s.tick([0, 0.5, 0], [0, 0, 0, 1], DT);
    s.reset();
    // 100 m teleport right after a reset: differentiation history is
    // gone, so the first post-reset tick reads as stationary.
    s.tick([100, 0.5, -40], [0, 0, 0, 1], DT);
    const r = s.sample(DT, NO_NOISE);
    expect(r.accel[0]).toBeCloseTo(0, 6);
    expect(r.accel[1]).toBeCloseTo(G, 6);
    expect(r.accel[2]).toBeCloseTo(0, 6);
  });

  it('runs readings through the noise pipeline when enabled', () => {
    // Deterministic mid-range rng: bias walk and white noise collapse to
    // zero-mean gauss()=… — instead verify quantization structure: with
    // noise on, outputs land on the LSB grid.
    let calls = 0;
    const rng = () => {
      // Alternate to exercise Box–Muller without NaNs.
      calls += 1;
      return calls % 2 === 0 ? 0.25 : 0.75;
    };
    const s = createDrivenImuSampler(rng);
    for (let i = 0; i < 4; i++) s.tick([0, 0.5, 0], [0, 0, 0, 1], DT);
    const cfg: ImuNoiseConfig = { ...DEFAULT_IMU_NOISE, enabled: true };
    const r = s.sample(DT, cfg);
    const lsb = (2 * cfg.accelRange) / 2 ** cfg.adcBits;
    for (const v of r.accel) {
      expect(Math.abs(v / lsb - Math.round(v / lsb))).toBeLessThan(1e-6);
      expect(Math.abs(v)).toBeLessThanOrEqual(cfg.accelRange);
    }
  });

  it('exposes the PINCH_LERP follow constant the session shares', () => {
    // Guard against drift from the §6.1 contract value.
    expect(PINCH_LERP).toBe(0.35);
  });
});
