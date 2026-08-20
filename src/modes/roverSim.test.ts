import { describe, expect, it } from 'vitest';
import { DEFAULT_IMU_NOISE, type ImuNoiseConfig } from '../lib/imuNoise';
import { scanLidar } from '../lib/lidar';
import {
  aabbToObstacleDisc,
  createRoverSim,
  makeAabbLidarCaster,
  ROBOT_TICK_MS,
  ROVER_LIDAR_HEIGHT,
  type RoverTick,
  type WorldAabb,
} from './roverSim';
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

function box(
  cx: number,
  cz: number,
  half: number,
  height = 1,
): WorldAabb {
  return {
    min: [cx - half, 0, cz - half],
    max: [cx + half, height, cz + half],
  };
}

function runWindow(
  event: 'cruise' | 'collision' | 'stuck',
  obstacles: WorldAabb[],
  seed = 42,
  durationMs = 3000,
): RoverTick[] {
  const sim = createRoverSim({
    event,
    obstacles,
    durationMs,
    lidarBins: 16,
    lidarMaxRange: 6,
    imuNoise: NO_NOISE,
    rng: seededRng(seed),
    timeOriginMs: 1000,
  });
  const ticks: RoverTick[] = [];
  for (let ms = 0; ms <= durationMs; ms += ROBOT_TICK_MS) {
    ticks.push(sim.tick(ms));
  }
  return ticks;
}

function maxHorizontalAccel(ticks: RoverTick[]): number {
  return Math.max(...ticks.map((t) => Math.hypot(t.imu.ax, t.imu.az)));
}

describe('makeAabbLidarCaster', () => {
  it('returns the entry distance for a box hit', () => {
    const cast = makeAabbLidarCaster([
      { min: [-0.5, 0, 1.5], max: [0.5, 1, 2.5] },
    ]);
    const d = cast([0, ROVER_LIDAR_HEIGHT, 0], [0, 0, 1]);
    expect(d).toBeCloseTo(1.5, 6);
  });

  it('misses boxes off the ray and above/below the beam plane', () => {
    const cast = makeAabbLidarCaster([
      { min: [2, 0, 1.5], max: [3, 1, 2.5] }, // off to the side
      { min: [-0.5, 2, 1.5], max: [0.5, 3, 2.5] }, // above the beam
    ]);
    expect(cast([0, ROVER_LIDAR_HEIGHT, 0], [0, 0, 1])).toBeNull();
  });

  it('ignores hits inside the near clip', () => {
    // Ray starts inside the box: front-face entry is behind the origin,
    // so the caster reports a miss (front-side semantics).
    const cast = makeAabbLidarCaster([
      { min: [-1, 0, -1], max: [1, 1, 1] },
    ]);
    expect(cast([0, 0.5, 0], [0, 0, 1])).toBeNull();
  });
});

describe('lidar range clamping', () => {
  it('clamps misses and beyond-range hits to maxRange', () => {
    const boxes = [box(0, 3, 0.5)]; // front face 2.5 m ahead
    const cast = makeAabbLidarCaster(boxes);
    const origin = { x: 0, y: ROVER_LIDAR_HEIGHT, z: 0 };

    const long = scanLidar({
      origin,
      heading: 0,
      bins: 8,
      maxRange: 6,
      castRay: cast,
    });
    expect(long[0]).toBeCloseTo(2.5, 6); // bin 0 = forward (+Z)
    // Bins pointing away from the obstacle clamp to maxRange.
    expect(long[4]).toBe(6);

    const short = scanLidar({
      origin,
      heading: 0,
      bins: 8,
      maxRange: 2,
      castRay: cast,
    });
    // The obstacle is beyond maxRange now — clamp, never 0/Infinity.
    for (const r of short) expect(r).toBe(2);
  });

  it('sim lidar samples never exceed maxRange', () => {
    const ticks = runWindow('cruise', [box(0, 0, 0.4)], 7);
    for (const tick of ticks) {
      expect(tick.lidar.ranges).toHaveLength(16);
      for (const r of tick.lidar.ranges) {
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('createRoverSim IMU', () => {
  it('cruise: no contact and no collision spike, gravity on body up', () => {
    // Obstacle off the spawn-disc chord corridor so the straight-line
    // cruise search succeeds (an origin obstacle forces the orbit
    // fallback, which carries centripetal acceleration by design).
    const ticks = runWindow('cruise', [box(3, 3, 0.4)], 3);
    expect(ticks.some((t) => t.inContact)).toBe(false);
    // Constant-velocity path → horizontal accel stays near zero.
    expect(maxHorizontalAccel(ticks)).toBeLessThan(0.5);
    for (const t of ticks) {
      expect(t.imu.ay).toBeCloseTo(9.81, 3);
    }
    // 20 Hz timestamps, monotonic from the injected origin.
    expect(ticks[0].imu.t).toBe(1000);
    expect(ticks[1].imu.t - ticks[0].imu.t).toBeCloseTo(ROBOT_TICK_MS, 9);
  });

  it('collision: makes contact mid-window and produces an accel spike', () => {
    const ticks = runWindow('collision', [box(0, 0, 0.3)], 11);
    const firstContact = ticks.findIndex((t) => t.inContact);
    expect(firstContact).toBeGreaterThan(0);
    // Impact lands inside the window, not at the very start.
    expect(firstContact / ticks.length).toBeGreaterThan(0.2);
    // The stop-in-one-tick deceleration + jolt dwarfs cruise noise.
    expect(maxHorizontalAccel(ticks)).toBeGreaterThan(3);
    // Once pinned against the obstacle, the rover stays in contact.
    expect(ticks[ticks.length - 1].inContact).toBe(true);
  });

  it('stuck: stays in contact for the whole window with vibration', () => {
    const ticks = runWindow('stuck', [box(1, 1, 0.3)], 5);
    for (const t of ticks) expect(t.inContact).toBe(true);
    // The tangential oscillation shows up as a non-trivial accel wiggle.
    expect(maxHorizontalAccel(ticks)).toBeGreaterThan(0.5);
  });

  it('is deterministic under a seeded rng', () => {
    const a = runWindow('collision', [box(0, 0, 0.3)], 99);
    const b = runWindow('collision', [box(0, 0, 0.3)], 99);
    expect(a.map((t) => t.imu.ax)).toEqual(b.map((t) => t.imu.ax));
    expect(a.map((t) => t.pose.x)).toEqual(b.map((t) => t.pose.x));
  });
});

describe('aabbToObstacleDisc', () => {
  it('uses the XZ bounding radius with a 5 cm floor', () => {
    const d = aabbToObstacleDisc(box(2, -1, 0.3));
    expect(d.x).toBe(2);
    expect(d.z).toBe(-1);
    expect(d.r).toBeCloseTo(Math.hypot(0.3, 0.3), 6);
    expect(aabbToObstacleDisc(box(0, 0, 0.01)).r).toBe(0.05);
  });
});

// ---------------------------------------------------------------------
// Runner: rover zip layout contract
// ---------------------------------------------------------------------

const EI_OFFLINE: EdgeImpulseConfig = {
  apiKey: '',
  hmacKey: '',
  category: 'training',
  label: 'idle',
  device: 'synthetic-rover',
};

function roverSettings(patch: Partial<RobotRunSettings> = {}): RobotRunSettings {
  return {
    kind: 'rover',
    roverEvent: 'cruise',
    armTrajectory: 'pick_place',
    count: 2,
    durationMs: 400,
    lidarBins: 8,
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

// buildFileName timestamp: `YYYY-MM-DD_HH-MM-SS-mmm`.
const TS = String.raw`\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}`;

describe('runRobotBatch (rover)', () => {
  it('offline run: zip entry names follow the contract patterns', async () => {
    const result = await runRobotBatch({
      robot: roverSettings(),
      ei: EI_OFFLINE,
      imuNoise: NO_NOISE,
      obstacles: [],
      rng: seededRng(1),
      sleep: instantSleep,
    });

    expect(result.sensorZipped).toBe(2);
    expect(result.sensorUploaded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.zip).not.toBeNull();

    const names = result.zip!.entryNames;
    // Per-iteration data-acquisition JSON: `${event}_${modality}_${i+1}.<ts>.json`.
    expect(names[0]).toMatch(new RegExp(`^cruise_fused_1\\.${TS}\\.json$`));
    // rosbag JSONL shares the JSON entry's stem.
    expect(names[1]).toBe(names[0].replace(/\.json$/, '.rosbag.jsonl'));
    expect(names[2]).toMatch(new RegExp(`^cruise_fused_2\\.${TS}\\.json$`));
    expect(names[3]).toBe(names[2].replace(/\.json$/, '.rosbag.jsonl'));
    expect(names[4]).toBe('info.labels');
    expect(names).toHaveLength(5);

    // Zip name: rover_${event}_${sampleCount}.<ts>.zip — counts recorded
    // samples, not zip entries (sidecars would inflate the number).
    expect(result.zip!.name).toMatch(new RegExp(`^rover_cruise_2\\.${TS}\\.zip$`));
  });

  it('offline zip entries carry valid payloads and info.labels metadata', async () => {
    const entries: { name: string; data: unknown }[] = [];
    const result = await runRobotBatch({
      robot: roverSettings({ count: 1, rosExport: false }),
      ei: EI_OFFLINE,
      imuNoise: NO_NOISE,
      obstacles: [],
      rng: seededRng(2),
      sleep: instantSleep,
      buildZip: async (zipEntries) => {
        entries.push(...zipEntries);
        return new Blob([]);
      },
    });
    expect(result.sensorZipped).toBe(1);

    const payload = JSON.parse(entries[0].data as string);
    // Fused payload: 6 IMU channels + 8 lidar bins.
    expect(payload.payload.sensors).toHaveLength(14);
    expect(payload.payload.sensors[0]).toEqual({ name: 'accX', units: 'm/s2' });
    expect(payload.payload.sensors[6]).toEqual({ name: 'r0', units: 'm' });
    expect(payload.payload.device_type).toBe('WEB_SIMULATOR');
    // 400 ms window at 20 Hz → 9 rows (t = 0..400 inclusive), 50 ms apart.
    expect(payload.payload.values).toHaveLength(9);
    expect(payload.payload.interval_ms).toBeCloseTo(50, 6);

    const info = JSON.parse(
      entries.find((e) => e.name === 'info.labels')!.data as string,
    );
    expect(info.version).toBe(1);
    expect(info.files).toHaveLength(1);
    expect(info.files[0].label).toEqual({ type: 'label', label: 'cruise' });
    expect(info.files[0].category).toBe('training');
    expect(info.files[0].metadata.robot_kind).toBe('rover');
    expect(info.files[0].metadata.event_index).toBe('1');
    expect(info.files[0].metadata.modality).toBe('fused');
    expect(info.files[0].metadata.lidar_bins).toBe('8');
  });

  it('routes object-detection images into the zip with the sidecar', async () => {
    const result = await runRobotBatch({
      robot: roverSettings({
        count: 1,
        objectDetection: true,
        captureAtRest: false,
        objectDetectionImagesPerIteration: 2,
        rosExport: false,
      }),
      ei: EI_OFFLINE,
      imuNoise: NO_NOISE,
      obstacles: [],
      rng: seededRng(3),
      sleep: instantSleep,
      captureImage: async () => ({
        blob: new Blob(['png'], { type: 'image/png' }),
        boxes: [{ label: 'cube', x: 1, y: 2, width: 3, height: 4 }],
        width: 640,
        height: 480,
      }),
    });
    expect(result.imagesZipped).toBe(2);
    const names = result.zip!.entryNames;
    const pngs = names.filter((n) => n.endsWith('.png'));
    expect(pngs).toHaveLength(2);
    // `${stem}_${phase}.${ts}.${idx 4-padded}.png` — image timestamps
    // keep the ISO 'T' (unlike buildFileName's '_'), per the original.
    const IMG_TS = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}`;
    for (const n of pngs) {
      expect(n).toMatch(
        new RegExp(`^rover_cruise_motion\\.${IMG_TS}\\.0001\\.png$`),
      );
    }
    expect(names).toContain('bounding_boxes.labels');
  });

  it('cancellation still packages the partial zip', async () => {
    let ticksSeen = 0;
    const result = await runRobotBatch({
      robot: roverSettings({ count: 3, rosExport: false }),
      ei: EI_OFFLINE,
      imuNoise: NO_NOISE,
      obstacles: [],
      rng: seededRng(4),
      sleep: instantSleep,
      onRoverTick: () => {
        ticksSeen += 1;
      },
      // Cancel partway through the second iteration.
      isCancelled: () => ticksSeen > 12,
    });
    expect(result.cancelled).toBe(true);
    expect(result.sensorZipped).toBe(1);
    expect(result.zip).not.toBeNull();
    expect(result.zip!.entryNames).toHaveLength(2); // 1 json + info.labels
  });
});
