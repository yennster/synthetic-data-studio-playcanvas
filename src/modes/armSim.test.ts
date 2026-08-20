import { describe, expect, it } from 'vitest';
import { solveBraccioIk } from '../lib/braccioIk';
import { BRACCIO_LIMITS_RAD } from '../lib/braccio';
import { ARM_PICKUP_SUCCESS_LIFT_M } from '../lib/armPickupOutcome';
import { DEFAULT_IMU_NOISE, type ImuNoiseConfig } from '../lib/imuNoise';
import {
  braccioFk,
  createArmSim,
  type ArmPickupTarget,
  type ArmTick,
} from './armSim';
import { ROBOT_TICK_MS } from './roverSim';
import { runRobotBatch, type RobotRunSettings } from './robotRunner';
import type { EdgeImpulseConfig } from '../lib/edgeImpulse';

/** Deterministic RNG (mulberry32). */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NO_NOISE: ImuNoiseConfig = { ...DEFAULT_IMU_NOISE, enabled: false };

const REACHABLE_TARGET: ArmPickupTarget = {
  id: 'obj-1',
  position: [0.18, 0.015, 0.12],
  halfExtents: [0.015, 0.015, 0.015],
  meta: { id: 'obj-1', type: 'primitive', kind: 'cube', label: 'cube' },
};

const UNREACHABLE_TARGET: ArmPickupTarget = {
  id: 'obj-2',
  position: [0.5, 0.015, 0.5], // radial 0.71 m — far outside the 0.25 m reach
  halfExtents: [0.015, 0.015, 0.015],
  meta: { id: 'obj-2', type: 'primitive', kind: 'cube', label: 'cube' },
};

function runArmWindow(
  target: ArmPickupTarget | null,
  durationMs = 3000,
): { ticks: ArmTick[]; sim: ReturnType<typeof createArmSim> } {
  const sim = createArmSim({
    trajectory: 'pick_place',
    durationMs,
    target,
    imuNoise: NO_NOISE,
    rng: seededRng(21),
    timeOriginMs: 5000,
  });
  const ticks: ArmTick[] = [];
  for (let ms = 0; ms <= durationMs; ms += ROBOT_TICK_MS) {
    ticks.push(sim.tick(ms));
  }
  return { ticks, sim };
}

describe('braccioFk', () => {
  it('round-trips the IK solution back to the target point', () => {
    const target = { x: 0.18, y: 0.05, z: 0.12 };
    const joints = solveBraccioIk(target, 0.5);
    const fk = braccioFk(joints);
    expect(fk.tip[0]).toBeCloseTo(target.x, 3);
    expect(fk.tip[1]).toBeCloseTo(target.y, 3);
    expect(fk.tip[2]).toBeCloseTo(target.z, 3);
    // Tip-down approach: the approach axis points at the floor.
    expect(fk.bz[1]).toBeCloseTo(-1, 2);
  });

  it('reaches a second in-annulus point and clamps saturated solves', () => {
    const reachable = { x: 0.1, y: 0.06, z: 0.15 };
    const j2 = solveBraccioIk(reachable, 0.5);
    const fk = braccioFk(j2);
    expect(fk.tip[0]).toBeCloseTo(reachable.x, 3);
    expect(fk.tip[1]).toBeCloseTo(reachable.y, 3);
    expect(fk.tip[2]).toBeCloseTo(reachable.z, 3);
    // A target behind the yaw range saturates but stays in-limit.
    const joints = solveBraccioIk({ x: -0.1, y: 0.1, z: 0.15 }, 0.5);
    for (let i = 0; i < 5; i++) {
      const [lo, hi] = BRACCIO_LIMITS_RAD[i];
      expect(joints[i]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(joints[i]).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});

describe('createArmSim pick_place outcome', () => {
  it('reaches a reachable target within IK tolerance and reports success', () => {
    const { ticks, sim } = runArmWindow(REACHABLE_TARGET);
    const outcome = sim.getOutcome();

    expect(outcome.observation).not.toBeNull();
    expect(outcome.observation!.failureReason).toBeNull();
    expect(outcome.observation!.success).toBe(true);
    expect(outcome.observation!.maxLiftM).toBeGreaterThanOrEqual(
      ARM_PICKUP_SUCCESS_LIFT_M,
    );
    // The lift keyframe hovers 6 cm above the grasp point.
    expect(outcome.observation!.maxLiftM).toBeCloseTo(0.06, 1);
    expect(outcome.observation!.graspableAtClose).toBe(true);

    expect(outcome.metadata.pickup_attempted).toBe(true);
    expect(outcome.metadata.pickup_success).toBe(true);
    expect(outcome.metadata.arm_target_type).toBe('primitive');
    expect(outcome.metadata.pickup_failure_reason).toBeUndefined();

    // The target follows the gripper during the lift.
    const midLift = ticks[Math.floor(ticks.length * 0.6)];
    expect(midLift.targetPos).not.toBeNull();
    expect(midLift.targetPos![1]).toBeGreaterThan(REACHABLE_TARGET.position[1]);
  });

  it('rejects an unreachable target, holds the gripper open, and fails', () => {
    const { ticks, sim } = runArmWindow(UNREACHABLE_TARGET);
    const outcome = sim.getOutcome();

    expect(outcome.observation).not.toBeNull();
    expect(outcome.observation!.success).toBe(false);
    expect(outcome.observation!.failureReason).toBe('target_drifted');
    expect(outcome.observation!.graspableAtClose).toBe(false);
    expect(outcome.metadata.pickup_success).toBe(false);
    expect(outcome.metadata.pickup_failure_reason).toBe('target_drifted');

    // After the mid-window rejection the commanded aperture is forced
    // fully open — never pretend the grasp worked.
    const late = ticks.filter((_, i) => i / (ticks.length - 1) > 0.7);
    for (const t of late) expect(t.joints[5]).toBe(1);
  });

  it('emits IMU + joint samples in lockstep with in-limit joints', () => {
    const { ticks } = runArmWindow(REACHABLE_TARGET, 1000);
    expect(ticks.length).toBe(21); // 1000 ms at 20 Hz, inclusive endpoints
    for (const tick of ticks) {
      expect(tick.jointSample.t).toBe(tick.imu.t);
      expect(tick.jointSample.joints).toHaveLength(6);
      for (let i = 0; i < 5; i++) {
        const [lo, hi] = BRACCIO_LIMITS_RAD[i];
        expect(tick.joints[i]).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(tick.joints[i]).toBeLessThanOrEqual(hi + 1e-9);
      }
      expect(tick.joints[5]).toBeGreaterThanOrEqual(0);
      expect(tick.joints[5]).toBeLessThanOrEqual(1);
      // Proper acceleration magnitude stays plausible (gravity-dominated).
      const mag = Math.hypot(tick.imu.ax, tick.imu.ay, tick.imu.az);
      expect(mag).toBeGreaterThan(0.1);
      expect(Number.isFinite(mag)).toBe(true);
    }
    // Timestamps advance at the record rate from the injected origin.
    expect(ticks[0].t).toBe(5000);
    expect(ticks[1].t - ticks[0].t).toBeCloseTo(ROBOT_TICK_MS, 9);
  });

  it('placeholder fallback (no target) records no pickup attempt', () => {
    const { sim } = runArmWindow(null, 1000);
    const outcome = sim.getOutcome();
    expect(outcome.observation).toBeNull();
    expect(outcome.metadata.pickup_attempted).toBe(false);
    expect(outcome.metadata.arm_target_type).toBe('fallback');
  });
});

// ---------------------------------------------------------------------
// Runner: arm zip layout contract
// ---------------------------------------------------------------------

const EI_OFFLINE: EdgeImpulseConfig = {
  apiKey: '',
  hmacKey: '',
  category: 'training',
  label: 'idle',
  device: 'synthetic-hand-3d',
};

function armSettings(patch: Partial<RobotRunSettings> = {}): RobotRunSettings {
  return {
    kind: 'arm',
    roverEvent: 'cruise',
    armTrajectory: 'pick_place',
    count: 1,
    durationMs: 400,
    lidarBins: 16,
    lidarMaxRange: 6,
    uploadModality: 'fused',
    rosExport: true,
    objectDetection: false,
    captureAtRest: false,
    objectDetectionImagesPerIteration: 1,
    ...patch,
  };
}

const instantSleep = (): Promise<void> => Promise.resolve();
const TS = String.raw`\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}`;

describe('runRobotBatch (arm)', () => {
  it('offline run: zip entries follow the arm naming contract', async () => {
    const entries: { name: string; data: unknown }[] = [];
    const result = await runRobotBatch({
      robot: armSettings(),
      ei: EI_OFFLINE,
      imuNoise: NO_NOISE,
      armTarget: () => REACHABLE_TARGET,
      rng: seededRng(8),
      sleep: instantSleep,
      buildZip: async (zipEntries) => {
        entries.push(...zipEntries);
        return new Blob([]);
      },
    });

    expect(result.sensorZipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.zip).not.toBeNull();

    const names = result.zip!.entryNames;
    // `${trajectory}_${i+1}.<ts>.json` + sibling rosbag + info.labels.
    expect(names[0]).toMatch(new RegExp(`^pick_place_1\\.${TS}\\.json$`));
    expect(names[1]).toBe(names[0].replace(/\.json$/, '.rosbag.jsonl'));
    expect(names[2]).toBe('info.labels');
    // Zip stem counts recorded samples, not zip entries.
    expect(result.zip!.name).toMatch(
      new RegExp(`^arm_pick_place_1\\.${TS}\\.zip$`),
    );

    // The acquisition payload is a 6-channel IMU time-series.
    const payload = JSON.parse(entries[0].data as string);
    expect(payload.payload.sensors).toHaveLength(6);
    expect(payload.payload.sensors[3]).toEqual({ name: 'gyrX', units: 'rad/s' });

    // info.labels carries the trajectory label + pickup metadata.
    const info = JSON.parse(
      entries.find((e) => e.name === 'info.labels')!.data as string,
    );
    expect(info.files[0].label).toEqual({ type: 'label', label: 'pick_place' });
    expect(info.files[0].metadata.robot_kind).toBe('arm');
    expect(info.files[0].metadata.trajectory).toBe('pick_place');
    expect(info.files[0].metadata.arm_target_id).toBe('obj-1');
    expect(info.files[0].metadata.pickup_attempted).toBe('true');
    expect(info.files[0].metadata.pickup_success).toBe('true');

    // The rosbag pairs end-effector IMU and joint-state lines.
    const jsonl = (entries[1].data as string).trim().split('\n');
    const first = JSON.parse(jsonl[0]);
    expect(first.topic).toBe('/end_effector/imu');
    expect(first.msg.header.frame_id).toBe('end_effector');
    const last = JSON.parse(jsonl[jsonl.length - 1]);
    expect(last.topic).toBe('/joint_states');
    expect(last.msg.name).toEqual([
      'M1_base',
      'M2_shoulder',
      'M3_elbow',
      'M4_wrist_pitch',
      'M5_wrist_roll',
      'M6_gripper',
    ]);
    // 9 IMU lines + 9 joint lines for the 400 ms window.
    expect(jsonl).toHaveLength(18);
  });
});
