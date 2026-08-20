import {
  Color,
  Entity,
  Mat4,
  PIXELFORMAT_RGBA8,
  RenderTarget,
  TONEMAP_ACES,
  Texture,
  Vec3,
  type AppBase,
} from 'playcanvas';
import type { BoundingBox } from '../../lib/types';
import { projectBoundingBoxes, type LabelTarget } from './projectBoxes';

/** 2x supersampling: render large, downsample to output size. Matches the
 * original app; makes SSAA invisible to bounding boxes and uploads. */
export const SSAA_FACTOR = 2;

export interface CaptureResult {
  blob: Blob;
  boxes: BoundingBox[];
  width: number;
  height: number;
}

const viewProj = new Mat4();
const invWorld = new Mat4();

/**
 * Offscreen capture camera. Owns a single reusable render target (recreated
 * only when the requested resolution changes) and a dedicated camera entity
 * that stays disabled between captures.
 */
export class CaptureRig {
  private app: AppBase;
  readonly cameraEntity: Entity;
  private rt: RenderTarget | null = null;
  private colorBuffer: Texture | null = null;
  private rtWidth = 0;
  private rtHeight = 0;
  private canvas2d: HTMLCanvasElement | null = null;
  /** Informational: true while a capture renders (callers are queued). */
  capturing = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(app: AppBase) {
    this.app = app;
    this.cameraEntity = new Entity('capture-camera', app);
    this.cameraEntity.addComponent('camera', {
      fov: 45,
      nearClip: 0.05,
      farClip: 100,
      clearColor: new Color(0.08, 0.09, 0.11),
      toneMapping: TONEMAP_ACES,
      priority: -1, // render before the main view
    });
    this.cameraEntity.enabled = false;
    app.root.addChild(this.cameraEntity);
  }

  setPose(position: Vec3, target: Vec3): void {
    this.cameraEntity.setPosition(position);
    this.cameraEntity.lookAt(target);
  }

  setFov(fov: number): void {
    this.cameraEntity.camera!.fov = fov;
  }

  private ensureTarget(width: number, height: number): void {
    const w = width * SSAA_FACTOR;
    const h = height * SSAA_FACTOR;
    if (this.rt && this.rtWidth === w && this.rtHeight === h) return;

    this.rt?.destroy();
    this.colorBuffer?.destroy();

    this.colorBuffer = new Texture(this.app.graphicsDevice, {
      name: 'capture-color',
      width: w,
      height: h,
      format: PIXELFORMAT_RGBA8,
      mipmaps: false,
    });
    this.rt = new RenderTarget({
      name: 'capture-rt',
      colorBuffer: this.colorBuffer,
      depth: true,
      samples: 1,
    });
    this.rtWidth = w;
    this.rtHeight = h;
    this.cameraEntity.camera!.renderTarget = this.rt;
    this.cameraEntity.camera!.aspectRatioMode = 1; // ASPECT_MANUAL
    this.cameraEntity.camera!.aspectRatio = width / height;
  }

  /**
   * Waits for the next frame to fully render (frameend). Browsers suspend
   * requestAnimationFrame in hidden tabs, which would stall batch capture
   * runs — so when no frame arrives we drive the app loop manually.
   */
  private nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const timer = setInterval(() => {
        if (!done) this.app.tick(performance.now());
      }, 100);
      this.app.once('frameend', () => {
        done = true;
        clearInterval(timer);
        resolve();
      });
    });
  }

  /**
   * Renders one frame from the capture camera at `width`x`height` (output
   * resolution; internally supersampled), computes bounding boxes for the
   * given label targets at output resolution, and returns a PNG blob.
   *
   * Concurrent callers are serialized on an internal queue — batch runs,
   * robot POV captures, and the live-inference loop all share this rig,
   * and a throw here used to silently drop dataset images.
   *
   * Pass `pose` to capture from a specific camera pose: it is applied
   * after any queued capture finishes, so the frame can't render with a
   * pose another caller set while this one waited.
   */
  captureFrame(
    width: number,
    height: number,
    targets: LabelTarget[],
    pose?: { position: Vec3; target: Vec3; fov: number }
  ): Promise<CaptureResult> {
    const run = this.queue.then(() => this.doCapture(width, height, targets, pose));
    this.queue = run.catch(() => {});
    return run;
  }

  private async doCapture(
    width: number,
    height: number,
    targets: LabelTarget[],
    pose?: { position: Vec3; target: Vec3; fov: number }
  ): Promise<CaptureResult> {
    this.capturing = true;
    try {
      if (pose) {
        this.setPose(pose.position, pose.target);
        this.setFov(pose.fov);
      }
      this.ensureTarget(width, height);
      this.cameraEntity.enabled = true;

      // Two frames: one so transforms/sorting settle, one to render.
      await this.nextFrame();
      await this.nextFrame();

      // Boxes from the same camera pose the pixels were rendered with.
      invWorld.copy(this.cameraEntity.getWorldTransform()).invert();
      viewProj.mul2(this.cameraEntity.camera!.projectionMatrix, invWorld);
      const boxes = projectBoundingBoxes(viewProj, width, height, targets);

      const w = this.rtWidth;
      const h = this.rtHeight;
      const data = (await this.colorBuffer!.read(0, 0, w, h, {
        renderTarget: this.rt!,
        // Execute the readback immediately rather than piggybacking on the
        // frame loop — captures are occasional and must work in hidden tabs.
        immediate: true,
      })) as Uint8Array;

      this.cameraEntity.enabled = false;

      // Flip vertically (GL bottom-left origin) into ImageData.
      const flipped = new Uint8ClampedArray(w * h * 4);
      const rowBytes = w * 4;
      for (let row = 0; row < h; row++) {
        const src = (h - 1 - row) * rowBytes;
        flipped.set(data.subarray(src, src + rowBytes), row * rowBytes);
      }

      if (!this.canvas2d) this.canvas2d = document.createElement('canvas');
      const full = document.createElement('canvas');
      full.width = w;
      full.height = h;
      full.getContext('2d')!.putImageData(new ImageData(flipped, w, h), 0, 0);

      // Downsample to output resolution.
      const out = this.canvas2d;
      out.width = width;
      out.height = height;
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(full, 0, 0, width, height);

      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
          'image/png'
        )
      );
      return { blob, boxes, width, height };
    } finally {
      this.cameraEntity.enabled = false;
      this.capturing = false;
    }
  }

  destroy(): void {
    this.rt?.destroy();
    this.colorBuffer?.destroy();
    this.cameraEntity.destroy();
  }
}
