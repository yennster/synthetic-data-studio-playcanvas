import { describe, expect, it } from 'vitest';
import { buildLidarFan } from './lidarFan';

describe('buildLidarFan', () => {
  it('emits one segment per bin', () => {
    const fan = buildLidarFan(0, [1, 2, 3, 4], 6);
    expect(fan.length).toBe(4);
  });

  it('points bin 0 along the rover forward axis (+Z at heading 0)', () => {
    const fan = buildLidarFan(0, [1, 1, 1, 1], 6);
    expect(fan[0].dirX).toBeCloseTo(0, 6);
    expect(fan[0].dirZ).toBeCloseTo(1, 6);
  });

  it('sweeps CCW about +Y — quarter turn lands on +X', () => {
    // 4 bins → bin 1 is a quarter turn: R_y(π/2) applied to +Z is +X,
    // matching scanLidar's world direction [sin θ, 0, cos θ].
    const fan = buildLidarFan(0, [1, 1, 1, 1], 6);
    expect(fan[1].dirX).toBeCloseTo(1, 6);
    expect(fan[1].dirZ).toBeCloseTo(0, 6);
  });

  it('rotates the whole fan with the heading', () => {
    const fan = buildLidarFan(Math.PI / 2, [1, 1], 6);
    expect(fan[0].dirX).toBeCloseTo(1, 6);
    expect(fan[0].dirZ).toBeCloseTo(0, 6);
  });

  it('flags hits inside maxRange and misses at the clamp', () => {
    const fan = buildLidarFan(0, [2.5, 6, 5.9999999], 6);
    expect(fan[0].hit).toBe(true);
    expect(fan[1].hit).toBe(false);
    // Within the float-noise epsilon of maxRange still counts as a miss.
    expect(fan[2].hit).toBe(false);
  });

  it('clamps ranges into [0, maxRange]', () => {
    const fan = buildLidarFan(0, [-1, 99], 6);
    expect(fan[0].range).toBe(0);
    expect(fan[1].range).toBe(6);
    expect(fan[1].hit).toBe(false);
  });

  it('keeps beam directions unit length', () => {
    const fan = buildLidarFan(1.23, [1, 1, 1, 1, 1], 6);
    for (const seg of fan) {
      expect(Math.hypot(seg.dirX, seg.dirZ)).toBeCloseTo(1, 6);
    }
  });
});
