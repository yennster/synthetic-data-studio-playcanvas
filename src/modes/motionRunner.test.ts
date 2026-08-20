import { describe, expect, it } from 'vitest';
import {
  buildMotionMetadata,
  generateMotionTrace,
  type MotionTraceSettings,
} from './motionRunner';
import { mulberry32 } from '../lib/rng';
import { DEFAULT_IMU_NOISE } from '../lib/imuNoise';
import type { AccelSample } from '../lib/types';
import type { DropSettings } from '../store/useStore';

const G = 9.81;

/** Noise off by default so assertions see the clean kinematic model. */
function settings(overrides: Partial<MotionTraceSettings> = {}): MotionTraceSettings {
  return {
    durationMs: 1500,
    sampleRateHz: 100,
    heightMin: 1.5,
    heightMax: 1.5,
    throwSpeed: 4,
    pushSpeed: 3,
    shakeFreq: 4.5,
    shakeAmp: 0.2,
    imuNoise: { ...DEFAULT_IMU_NOISE, enabled: false },
    startTimeMs: 1000,
    ...overrides,
  };
}

const accMag = (s: AccelSample) => Math.hypot(s.ax, s.ay, s.az);
const gyrMag = (s: AccelSample) => Math.hypot(s.gx, s.gy, s.gz);

/** Longest contiguous run of samples whose accel magnitude is within
 * `tol` of `target`. Returns [startIndex, endIndexExclusive]. */
function longestRunNear(
  trace: AccelSample[],
  target: number,
  tol: number
): [number, number] {
  let best: [number, number] = [0, 0];
  let start = -1;
  for (let i = 0; i <= trace.length; i++) {
    const inBand = i < trace.length && Math.abs(accMag(trace[i]) - target) < tol;
    if (inBand && start < 0) start = i;
    if (!inBand && start >= 0) {
      if (i - start > best[1] - best[0]) best = [start, i];
      start = -1;
    }
  }
  return best;
}

describe('generateMotionTrace — sampling contract', () => {
  it('emits ≈ sampleRate × duration samples with exact spacing', () => {
    const trace = generateMotionTrace('drop', settings(), mulberry32(42));
    expect(trace.length).toBe(150); // 1.5 s × 100 Hz
    expect(trace[0].t).toBe(1000);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i].t - trace[i - 1].t).toBeCloseTo(10, 6);
    }
  });

  it('scales the sample count with rate and duration', () => {
    const a = generateMotionTrace(
      'shake',
      settings({ durationMs: 2000, sampleRateHz: 200 }),
      mulberry32(1)
    );
    expect(a.length).toBe(400);
    const b = generateMotionTrace(
      'push',
      settings({ durationMs: 300, sampleRateHz: 20 }),
      mulberry32(1)
    );
    expect(b.length).toBe(6);
  });

  it('is deterministic for a given seed', () => {
    const a = generateMotionTrace('throw', settings(), mulberry32(7));
    const b = generateMotionTrace('throw', settings(), mulberry32(7));
    expect(a).toEqual(b);
  });
});

describe('generateMotionTrace — drop', () => {
  const trace = generateMotionTrace('drop', settings(), mulberry32(42));

  it('starts with a still held baseline (pre-release ≥ 40 ms)', () => {
    // randomPreReleaseMs guarantees ≥ 40 ms of hold; at 100 Hz the first
    // four samples (t = 0..30 ms) are always inside it.
    for (const s of trace.slice(0, 4)) {
      expect(accMag(s)).toBeLessThan(0.5);
      expect(gyrMag(s)).toBeLessThan(1e-9);
    }
  });

  it('shows ~1 g free-fall (gravity rotated through the tumble)', () => {
    // h = 1.5 m → ~0.55 s of flight → ≥ ~50 samples reading |a| ≈ g.
    const [start, end] = longestRunNear(trace, G, 0.3);
    expect(end - start).toBeGreaterThanOrEqual(40);
    // The tumbling orientation sweeps gravity across axes: no single
    // axis holds the full −g for the whole flight, but the magnitude
    // stays pinned at g.
    for (let i = start; i < end; i++) {
      expect(accMag(trace[i])).toBeCloseTo(G, 1);
    }
  });

  it('tumbles during flight: constant gyro magnitude ≤ 3·√3 rad/s', () => {
    const [start, end] = longestRunNear(trace, G, 0.3);
    const w0 = gyrMag(trace[start]);
    expect(w0).toBeGreaterThan(0.1);
    expect(w0).toBeLessThanOrEqual(3 * Math.sqrt(3) + 1e-9);
    for (let i = start; i < end; i++) {
      expect(gyrMag(trace[i])).toBeCloseTo(w0, 6);
    }
  });

  it('ends the fall with an impact spike then settles', () => {
    const [fallStart, fallEnd] = longestRunNear(trace, G, 0.3);
    const peak = Math.max(...trace.map(accMag));
    const peakIdx = trace.findIndex((s) => accMag(s) === peak);
    expect(peak).toBeGreaterThan(3 * G);
    expect(peakIdx).toBeGreaterThanOrEqual(fallStart);
    // After the spike + ringing the body is at rest again.
    const tail = trace.slice(-5);
    for (const s of tail) expect(accMag(s)).toBeLessThan(1.5);
    expect(fallEnd).toBeGreaterThan(fallStart);
  });
});

describe('generateMotionTrace — shake', () => {
  it('has a dominant frequency ≈ shakeFreq (±15% per-run jitter)', () => {
    const shakeFreq = 5;
    const trace = generateMotionTrace(
      'shake',
      settings({ durationMs: 2000, sampleRateHz: 200, shakeFreq }),
      mulberry32(99)
    );
    // Pick the body axis carrying the most signal (the random static
    // orientation distributes the sinusoid across axes).
    const axes: ('ax' | 'ay' | 'az')[] = ['ax', 'ay', 'az'];
    const variance = (k: 'ax' | 'ay' | 'az') => {
      const vals = trace.map((s) => s[k]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
    };
    const axis = axes.reduce((a, b) => (variance(a) >= variance(b) ? a : b));
    const signal = trace.map((s) => s[axis]);
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;

    // Goertzel-style scan for the peak frequency in the slider band.
    const dt = 1 / 200;
    let bestF = 0;
    let bestP = -1;
    for (let f = 1; f <= 10; f += 0.05) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < signal.length; i++) {
        const ang = 2 * Math.PI * f * i * dt;
        re += (signal[i] - mean) * Math.cos(ang);
        im += (signal[i] - mean) * Math.sin(ang);
      }
      const p = re * re + im * im;
      if (p > bestP) {
        bestP = p;
        bestF = f;
      }
    }
    // Effective frequency is shakeFreq × (0.85 + rng·0.3).
    expect(bestF).toBeGreaterThanOrEqual(shakeFreq * 0.85 - 0.1);
    expect(bestF).toBeLessThanOrEqual(shakeFreq * 1.15 + 0.1);
  });

  it('keeps the body held: no tumble on the gyro (noise off)', () => {
    const trace = generateMotionTrace('shake', settings(), mulberry32(3));
    for (const s of trace) expect(gyrMag(s)).toBeLessThan(1e-9);
  });
});

describe('generateMotionTrace — IMU noise integration', () => {
  it('applies the noise pipeline when enabled (and stays finite)', () => {
    const clean = generateMotionTrace('drop', settings(), mulberry32(5));
    const noisy = generateMotionTrace(
      'drop',
      settings({ imuNoise: { ...DEFAULT_IMU_NOISE, enabled: true } }),
      mulberry32(5)
    );
    expect(noisy.length).toBe(clean.length);
    expect(noisy.some((s, i) => s.ax !== clean[i].ax)).toBe(true);
    for (const s of noisy) {
      for (const v of [s.ax, s.ay, s.az, s.gx, s.gy, s.gz]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      // Range clipping: nothing escapes the configured dynamic range.
      expect(Math.abs(s.ax)).toBeLessThanOrEqual(DEFAULT_IMU_NOISE.accelRange);
      expect(Math.abs(s.gx)).toBeLessThanOrEqual(DEFAULT_IMU_NOISE.gyroRange);
    }
  });
});

describe('buildMotionMetadata', () => {
  const drops: DropSettings = {
    count: 10,
    heightMin: 1.0,
    heightMax: 2.5,
    durationMs: 1500,
    motion: 'drop',
    throwSpeed: 4,
    pushSpeed: 3,
    shakeFreq: 4.5,
    shakeAmp: 0.2,
  };

  it('carries the contract fields plus per-class params', () => {
    const meta = buildMotionMetadata(drops, 100, 'cube', 3);
    expect(meta).toMatchObject({
      mode: 'motion',
      shape: 'cube',
      sample_rate_hz: 100,
      generator: 'procedural',
      motion: 'drop',
      motion_index: 3,
      motion_total: 10,
      height_min_m: 1.0,
      height_max_m: 2.5,
      duration_ms: 1500,
    });
    expect(meta.throw_speed_mps).toBeUndefined();
    expect(meta.push_speed_mps).toBeUndefined();
  });

  it('switches params with the motion class', () => {
    const throwMeta = buildMotionMetadata({ ...drops, motion: 'throw' }, 100, 'cube', 1);
    expect(throwMeta.throw_speed_mps).toBe(4);
    expect(throwMeta.height_min_m).toBe(1.0);

    const pushMeta = buildMotionMetadata({ ...drops, motion: 'push' }, 100, 'cube', 1);
    expect(pushMeta.push_speed_mps).toBe(3);
    expect(pushMeta.height_min_m).toBeUndefined();

    const shakeMeta = buildMotionMetadata({ ...drops, motion: 'shake' }, 100, 'cube', 1);
    expect(shakeMeta.shake_freq_hz).toBe(4.5);
    expect(shakeMeta.shake_amp_m).toBe(0.2);
  });
});
