import {
  Color,
  Entity,
  TONEMAP_ACES,
  Vec2,
  Vec3,
  type AppBase,
} from 'playcanvas';
// eslint-disable-next-line import/no-unresolved
// @ts-expect-error - shipped script module has no type declarations
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
import { createApp } from './createApp';
import { createSceneEnvironment, type SceneEnvironment } from './sceneEnvironment';
import { ModelManager } from './ModelManager';
import { SplatManager } from './splats/SplatManager';

/**
 * Central imperative facade over the PlayCanvas app. React UI talks to this;
 * engine subsystems (splats, capture, sims) hang off it.
 */
export class StudioEngine {
  app: AppBase;
  /** Root for all studio content (scene resets destroy children of this). */
  content: Entity;
  /** The user's viewport camera with orbit/pan/zoom controls. */
  viewCamera: Entity;
  environment: SceneEnvironment;
  splats: SplatManager;
  models: ModelManager;
  private cameraControls: any;

  private constructor(app: AppBase) {
    this.app = app;

    this.content = new Entity('studio-content', app);
    app.root.addChild(this.content);

    this.environment = createSceneEnvironment(app, this.content);
    this.splats = new SplatManager(app, this.content);
    this.models = new ModelManager(app, this.content);

    this.viewCamera = new Entity('view-camera', app);
    this.viewCamera.addComponent('camera', {
      fov: 45,
      clearColor: new Color(0.08, 0.09, 0.11),
      toneMapping: TONEMAP_ACES,
    });
    this.viewCamera.setLocalPosition(3.5, 2.2, 3.5);
    this.viewCamera.addComponent('script');
    this.cameraControls = this.viewCamera.script!.create(CameraControls as any, {
      properties: {
        enableFly: false,
        enablePan: true,
        focusPoint: new Vec3(0, 0.5, 0),
        zoomRange: new Vec2(0.5, 40),
      },
    });
    app.root.addChild(this.viewCamera);
  }

  static async create(canvas: HTMLCanvasElement): Promise<StudioEngine> {
    const app = await createApp(canvas);
    const engine = new StudioEngine(app);
    app.start();
    return engine;
  }

  setClearColor(color: Color): void {
    this.viewCamera.camera!.clearColor = color;
  }

  /** Frames the view camera on a world-space point. */
  focusOn(point: Vec3, resetZoom = false): void {
    this.cameraControls?.focus?.(point, resetZoom);
  }

  destroy(): void {
    this.models.destroy();
    this.splats.destroy();
    this.environment.destroy();
    this.app.destroy();
  }
}
