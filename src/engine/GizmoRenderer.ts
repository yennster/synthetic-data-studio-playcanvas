import { Color, Vec3, type AppBase } from 'playcanvas';
import { sampleCameraTrajectory } from '../lib/cameraTrajectory';
import type { CameraTrajectory } from '../lib/types';

/**
 * Editor gizmos drawn with the immediate-line API on the Immediate layer:
 * the capture camera's frustum (orange), its look-target marker (pink),
 * and the batch trajectory path (teal). The capture and preview cameras
 * exclude the Immediate layer, so gizmos never appear in training images
 * or the PiP — only in the editor viewport.
 */

export interface GizmoState {
  visible: boolean;
  camPos: [number, number, number];
  camTarget: [number, number, number];
  fov: number;
  aspect: number;
  trajectory: CameraTrajectory;
  trajectoryRadius: number;
  trajectoryHeight: number;
  batchCount: number;
}

const ORANGE = new Color(1, 0.42, 0.1);
const PINK = new Color(0.96, 0.45, 0.71);
const TEAL = new Color(0.24, 0.86, 0.79);

export class GizmoRenderer {
  private app: AppBase;
  private state: GizmoState | null = null;
  private handler: () => void;

  // Scratch vectors reused every frame.
  private eye = new Vec3();
  private target = new Vec3();
  private fwd = new Vec3();
  private right = new Vec3();
  private up = new Vec3();
  private corners: Vec3[] = [new Vec3(), new Vec3(), new Vec3(), new Vec3()];
  private a = new Vec3();
  private b = new Vec3();

  constructor(app: AppBase) {
    this.app = app;
    this.handler = () => this.draw();
    app.on('update', this.handler);
  }

  setState(state: GizmoState | null): void {
    this.state = state;
  }

  currentState(): GizmoState | null {
    return this.state;
  }

  private draw(): void {
    const s = this.state;
    if (!s || !s.visible) return;

    const { eye, target, fwd, right, up } = this;
    eye.set(s.camPos[0], s.camPos[1], s.camPos[2]);
    target.set(s.camTarget[0], s.camTarget[1], s.camTarget[2]);
    fwd.sub2(target, eye);
    const dist = fwd.length();
    if (dist < 1e-4) return;
    fwd.normalize();
    right.cross(fwd, Vec3.UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.cross(right, fwd).normalize();

    // Frustum pyramid out to a fixed visualization depth.
    const depth = Math.min(1.0, dist * 0.5);
    const h = Math.tan((s.fov * Math.PI) / 360) * depth;
    const w = h * s.aspect;
    for (let i = 0; i < 4; i++) {
      const sx = i === 0 || i === 3 ? -1 : 1;
      const sy = i < 2 ? 1 : -1;
      this.corners[i]
        .copy(eye)
        .add(this.a.copy(fwd).mulScalar(depth))
        .add(this.b.copy(right).mulScalar(sx * w))
        .add(this.a.copy(up).mulScalar(sy * h));
    }
    for (let i = 0; i < 4; i++) {
      this.app.drawLine(eye, this.corners[i], ORANGE, true);
      this.app.drawLine(this.corners[i], this.corners[(i + 1) % 4], ORANGE, true);
    }
    // Up tick so orientation reads at a glance.
    this.a.copy(eye).add(this.b.copy(up).mulScalar(0.12));
    this.app.drawLine(eye, this.a, ORANGE, true);
    // Sight line to the target.
    this.app.drawLine(eye, target, ORANGE, true);

    // Grab handle at the eye: a small octahedron so there's something
    // visually solid to aim the mouse at (both handles are draggable).
    const g = 0.07;
    const tips: Vec3[] = [
      this.a.clone().copy(eye).add(new Vec3(g, 0, 0)),
      this.a.clone().copy(eye).add(new Vec3(-g, 0, 0)),
      this.a.clone().copy(eye).add(new Vec3(0, g, 0)),
      this.a.clone().copy(eye).add(new Vec3(0, -g, 0)),
      this.a.clone().copy(eye).add(new Vec3(0, 0, g)),
      this.a.clone().copy(eye).add(new Vec3(0, 0, -g)),
    ];
    for (const i of [0, 1]) {
      for (const j of [2, 3]) this.app.drawLine(tips[i], tips[j], ORANGE, true);
      for (const j of [4, 5]) this.app.drawLine(tips[i], tips[j], ORANGE, true);
    }
    for (const i of [2, 3]) {
      for (const j of [4, 5]) this.app.drawLine(tips[i], tips[j], ORANGE, true);
    }

    // Target marker: three axis-aligned crosses plus a diamond outline.
    const m = 0.15;
    for (const axis of [Vec3.RIGHT, Vec3.UP, Vec3.FORWARD]) {
      this.a.copy(target).add(this.b.copy(axis).mulScalar(m));
      const a2 = this.a.clone();
      this.a.copy(target).sub(this.b.copy(axis).mulScalar(m));
      this.app.drawLine(a2, this.a, PINK, true);
    }
    const md = m * 0.6;
    const dTips: Vec3[] = [
      this.a.clone().copy(target).add(new Vec3(md, 0, 0)),
      this.a.clone().copy(target).add(new Vec3(-md, 0, 0)),
      this.a.clone().copy(target).add(new Vec3(0, 0, md)),
      this.a.clone().copy(target).add(new Vec3(0, 0, -md)),
    ];
    this.app.drawLine(dTips[0], dTips[2], PINK, true);
    this.app.drawLine(dTips[2], dTips[1], PINK, true);
    this.app.drawLine(dTips[1], dTips[3], PINK, true);
    this.app.drawLine(dTips[3], dTips[0], PINK, true);

    // Trajectory path (deterministic paths only).
    if (s.trajectory !== 'random') {
      const segments = 64;
      let prev: Vec3 | null = null;
      for (let i = 0; i <= segments; i++) {
        const p = sampleCameraTrajectory({
          trajectory: s.trajectory,
          index: i,
          total: segments,
          target: s.camTarget,
          radius: s.trajectoryRadius,
          height: s.trajectoryHeight,
        });
        const point = new Vec3(p[0], p[1], p[2]);
        if (prev) this.app.drawLine(prev, point, TEAL, true);
        prev = point;
      }
      // Shot markers at each batch index.
      const shots = Math.max(1, Math.min(s.batchCount, 64));
      for (let i = 0; i < shots; i++) {
        const p = sampleCameraTrajectory({
          trajectory: s.trajectory,
          index: i,
          total: shots,
          target: s.camTarget,
          radius: s.trajectoryRadius,
          height: s.trajectoryHeight,
        });
        this.a.set(p[0], p[1] - 0.05, p[2]);
        this.b.set(p[0], p[1] + 0.05, p[2]);
        this.app.drawLine(this.a, this.b, TEAL, true);
      }
    }
  }

  destroy(): void {
    this.app.off('update', this.handler);
    this.state = null;
  }
}
