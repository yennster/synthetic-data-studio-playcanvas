import {
  BoundingBox,
  Color,
  Entity,
  EVENT_MOUSEDOWN,
  EVENT_MOUSEMOVE,
  EVENT_MOUSEUP,
  MOUSEBUTTON_RIGHT,
  Picker,
  TONEMAP_ACES,
  Vec2,
  Vec3,
  Vec4,
  type AppBase,
} from 'playcanvas';
// eslint-disable-next-line import/no-unresolved
// @ts-expect-error - shipped script module has no type declarations
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
import { createApp } from './createApp';
import { createSceneEnvironment, type SceneEnvironment } from './sceneEnvironment';
import { ModelManager, computeWorldBounds } from './ModelManager';
import { ObjectManager } from './ObjectManager';
import { SplatManager } from './splats/SplatManager';
import { SplatEditor } from './splats/SplatEditor';
import { CaptureRig } from './capture/CaptureRig';
import type { LabelTarget } from './capture/projectBoxes';

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
  objects: ObjectManager;
  capture: CaptureRig;
  splatEditor: SplatEditor;
  /** In-canvas picture-in-picture preview of the capture camera. */
  previewCamera: Entity;
  private eraseTarget: { entity: Entity; radius: number } | null = null;
  private erasing = false;
  private picker: Picker | null = null;
  private pickerDirty = true;
  private cameraControls: any;

  private constructor(app: AppBase) {
    this.app = app;

    this.content = new Entity('studio-content', app);
    app.root.addChild(this.content);

    this.environment = createSceneEnvironment(app, this.content);
    this.splats = new SplatManager(app, this.content);
    this.models = new ModelManager(app, this.content);
    this.objects = new ObjectManager(app, this.content);
    this.capture = new CaptureRig(app);
    this.splatEditor = new SplatEditor(app);
    this.setupEraseInput();
    // Removing a splat releases its edit processors and drops the brush.
    this.splats.onChange((entries) => {
      const live = new Set(entries.map((e) => e.entity));
      this.splatEditor.releaseExcept(live);
      if (this.eraseTarget && !live.has(this.eraseTarget.entity)) {
        this.eraseTarget = null;
        this.erasing = false;
      }
    });

    this.previewCamera = new Entity('preview-camera', app);
    this.previewCamera.addComponent('camera', {
      fov: 45,
      nearClip: 0.05,
      farClip: 100,
      clearColor: new Color(0.08, 0.09, 0.11),
      toneMapping: TONEMAP_ACES,
      priority: 1, // render the PiP after the main view
      rect: new Vec4(0.02, 0.02, 0.25, 0.25),
    });
    this.previewCamera.enabled = false;
    app.root.addChild(this.previewCamera);

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

  /**
   * Splat erase brush: while active, right-drag erases splats of the target
   * entity around the picked world point (LMB still orbits the camera).
   */
  setEraseMode(entity: Entity | null, radius = 0.15): void {
    this.eraseTarget = entity ? { entity, radius } : null;
    this.erasing = false;
    if (entity) this.app.mouse?.disableContextMenu();
  }

  private setupEraseInput(): void {
    const mouse = this.app.mouse;
    if (!mouse) return;

    const eraseAt = (x: number, y: number) => {
      const target = this.eraseTarget;
      if (!target) return;
      if (!this.picker) this.picker = new Picker(this.app, 1, 1, true);
      const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
      if (this.pickerDirty) {
        this.picker.resize(canvas.clientWidth, canvas.clientHeight);
        const worldLayer = this.app.scene.layers.getLayerByName('World');
        this.picker.prepare(this.viewCamera.camera!, this.app.scene, worldLayer ? [worldLayer] : undefined);
        this.pickerDirty = false;
      }
      this.picker.getWorldPointAsync(x, y).then((worldPoint: Vec3 | null) => {
        const current = this.eraseTarget;
        // The entity may have been removed while the async pick resolved.
        if (worldPoint && current && current.entity.gsplat) {
          this.splatEditor.eraseSphere(current.entity, worldPoint, current.radius);
        }
      });
    };

    mouse.on(EVENT_MOUSEDOWN, (e: { button: number; x: number; y: number }) => {
      if (this.eraseTarget && e.button === MOUSEBUTTON_RIGHT) {
        this.erasing = true;
        this.pickerDirty = true;
        eraseAt(e.x, e.y);
      }
    });
    mouse.on(EVENT_MOUSEMOVE, (e: { x: number; y: number }) => {
      if (this.erasing) eraseAt(e.x, e.y);
    });
    mouse.on(EVENT_MOUSEUP, (e: { button: number }) => {
      if (e.button === MOUSEBUTTON_RIGHT) this.erasing = false;
    });
  }

  /** Frames the view camera on a world-space point. */
  focusOn(point: Vec3, resetZoom = false): void {
    this.cameraControls?.focus?.(point, resetZoom);
  }

  /**
   * Poses the capture + preview cameras from capture settings. The preview
   * camera is the in-canvas PiP; the capture rig renders offscreen.
   */
  setCaptureCameraPose(
    pos: [number, number, number],
    target: [number, number, number],
    fov: number
  ): void {
    const p = new Vec3(pos[0], pos[1], pos[2]);
    const t = new Vec3(target[0], target[1], target[2]);
    this.capture.setPose(p, t);
    this.capture.setFov(fov);
    this.previewCamera.setPosition(p);
    this.previewCamera.lookAt(t);
    this.previewCamera.camera!.fov = fov;
  }

  /** Shows/hides the PiP preview and sets its viewport in CSS pixels. */
  setPreviewRect(visible: boolean, rect?: { x: number; y: number; w: number; h: number }): void {
    this.previewCamera.enabled = visible;
    if (visible && rect) {
      const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      this.previewCamera.camera!.rect = new Vec4(
        rect.x / cw,
        // rect Y is measured from the bottom of the canvas
        1 - (rect.y + rect.h) / ch,
        rect.w / cw,
        rect.h / ch
      );
    }
  }

  /**
   * Collects the labelled capture targets for bounding-box computation:
   * spawned primitives (owner-filtered by `scope` — robot-owned obstacles
   * must not leak into vision captures and vice versa), imported models
   * (one box across all mesh instances), and splats with role 'object'
   * (resource AABB transformed to world space). Models and splats have no
   * owner tag yet, so they participate in vision captures only.
   */
  getLabelTargets(scope: 'vision' | 'rover' | 'arm' = 'vision'): LabelTarget[] {
    const targets: LabelTarget[] = [...this.objects.getLabelTargets(scope)];
    if (scope !== 'vision') return targets;
    for (const model of this.models.entries) {
      if (!model.entity.enabled) continue;
      const aabb = computeWorldBounds(model.entity);
      targets.push({ label: model.label, aabbs: [aabb] });
    }
    for (const splat of this.splats.entries) {
      if (splat.role !== 'object' || !splat.entity.enabled) continue;
      const resource = splat.entity.gsplat?.resource as
        | { aabb?: BoundingBox }
        | null
        | undefined;
      if (!resource?.aabb) continue;
      const world = new BoundingBox();
      world.setFromTransformedAabb(resource.aabb, splat.entity.getWorldTransform());
      targets.push({ label: splat.label, aabbs: [world] });
    }
    return targets;
  }

  destroy(): void {
    this.picker?.destroy();
    this.splatEditor.destroy();
    this.capture.destroy();
    this.objects.destroy();
    this.models.destroy();
    this.splats.destroy();
    this.environment.destroy();
    this.app.destroy();
  }
}
