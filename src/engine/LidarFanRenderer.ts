import { Color, Vec3, type AppBase } from 'playcanvas';
import { buildLidarFan } from '../lib/lidarFan';

/**
 * Live lidar beam fan drawn with the immediate-line API on the Immediate
 * layer: one line per bin from the rover's lidar puck out to the measured
 * range (bin 0 forward, CCW — the same layout `scanLidar` records).
 *
 * The capture rig and the POV/PiP preview camera exclude the Immediate
 * layer, so beams never reach training images or the preview — the
 * PlayCanvas equivalent of the original's `hideForCapture` flag on its
 * `rover-lidar-fan` LineSegments.
 *
 * The panel updates `setState` at the lidar's 20 Hz scan cadence; this
 * class just redraws the latest scan every frame (immediate lines live
 * for one frame only).
 */

export interface LidarFanState {
  /** World-space ring center (the rover's lidar puck). */
  origin: [number, number, number];
  /** Rover yaw in radians — bin 0 points along this heading. */
  heading: number;
  /** Latest scan, one range per bin, clamped to maxRange. */
  ranges: readonly number[];
  maxRange: number;
}

// The original's fan color (#5eead4 at 0.45 alpha). Max-range "no
// return" beams reuse the hue at a fraction of the alpha so real hits
// pop against the ambient fan.
const HIT = new Color(0.369, 0.918, 0.831, 0.45);
const MISS = new Color(0.369, 0.918, 0.831, 0.14);

export class LidarFanRenderer {
  private app: AppBase;
  private state: LidarFanState | null = null;
  private handler: () => void;

  // Scratch vectors reused every frame.
  private a = new Vec3();
  private b = new Vec3();

  constructor(app: AppBase) {
    this.app = app;
    this.handler = () => this.draw();
    app.on('update', this.handler);
  }

  setState(state: LidarFanState | null): void {
    this.state = state;
  }

  private draw(): void {
    const s = this.state;
    if (!s) return;
    const [ox, oy, oz] = s.origin;
    this.a.set(ox, oy, oz);
    for (const seg of buildLidarFan(s.heading, s.ranges, s.maxRange)) {
      this.b.set(ox + seg.dirX * seg.range, oy, oz + seg.dirZ * seg.range);
      this.app.drawLine(this.a, this.b, seg.hit ? HIT : MISS, true);
    }
  }

  destroy(): void {
    this.app.off('update', this.handler);
    this.state = null;
  }
}
