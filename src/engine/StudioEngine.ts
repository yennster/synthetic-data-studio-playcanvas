import {
  BoundingBox,
  Color,
  Entity,
  LAYERID_DEPTH,
  LAYERID_SKYBOX,
  LAYERID_WORLD,
  EVENT_MOUSEDOWN,
  EVENT_MOUSEMOVE,
  EVENT_MOUSEUP,
  MOUSEBUTTON_RIGHT,
  Mat4,
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
import { SkyboxManager } from './SkyboxManager';
import { GizmoRenderer } from './GizmoRenderer';
import { sampleCameraTrajectory } from '../lib/cameraTrajectory';
import type { SplatEditOp } from '../lib/splatOps';
import { SelectionController } from './SelectionController';
import { CaptureRig } from './capture/CaptureRig';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { ConveyorBelt } from './physics/ConveyorBelt';
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
  /** Lazy Rapier world for spawned primitives (loads on first need). */
  physics: PhysicsWorld;
  /** Conveyor-belt visuals; colliders/transport live in `physics`. */
  conveyor: ConveyorBelt;
  capture: CaptureRig;
  splatEditor: SplatEditor;
  skybox: SkyboxManager;
  gizmos: GizmoRenderer;
  selection: SelectionController;
  /** In-canvas picture-in-picture preview of the capture camera. */
  previewCamera: Entity;
  private eraseTarget: {
    entity: Entity;
    radius: number;
    mode: 'erase' | 'tint';
    tintColor: [number, number, number];
    tintStrength: number;
  } | null = null;
  private erasing = false;
  private picker: Picker | null = null;
  private pickerDirty = true;
  /** Set by the UI layer: receives gizmo-handle drag updates. */
  onGizmoHandleDrag: ((handle: 'camera' | 'target', pos: [number, number, number]) => void) | null =
    null;
  private gizmoDrag: {
    handle: 'camera' | 'target' | 'trajectory';
    planeY: number;
    startY: number;
    startScreenY: number;
    worldPerPixel: number;
    shift: boolean;
    grabOffset: [number, number];
  } | null = null;
  private cameraControls: any;

  private constructor(app: AppBase) {
    this.app = app;

    this.content = new Entity('studio-content', app);
    app.root.addChild(this.content);

    this.environment = createSceneEnvironment(app, this.content);
    this.splats = new SplatManager(app, this.content);
    this.models = new ModelManager(app, this.content);
    this.objects = new ObjectManager(app, this.content);
    this.physics = new PhysicsWorld(app, (id) => this.objects.getEntity(id));
    // While a body exists for an object, the physics world owns its pose.
    this.objects.externallyPosed = (id) => this.physics.isTracking(id);
    this.conveyor = new ConveyorBelt(app, this.content);
    this.capture = new CaptureRig(app);
    this.splatEditor = new SplatEditor(app);
    this.skybox = new SkyboxManager(app);
    this.gizmos = new GizmoRenderer(app);
    // Registration order matters: camera-gizmo handles get first claim on
    // a mousedown; the selection controller checks isBlocked before acting.
    this.setupEraseInput();
    this.setupGizmoDrag();
    this.selection = new SelectionController({
      app,
      getViewCamera: () => this.viewCamera,
      objects: this.objects,
      models: this.models,
      splats: this.splats,
      setOrbitEnabled: (enabled) => {
        if (this.cameraControls) this.cameraControls.enabled = enabled;
      },
    });
    this.selection.isBlocked = () => this.gizmoDrag !== null || this.eraseTarget !== null;
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
      // No Immediate layer: the PiP shows what a capture would, gizmo-free.
      layers: [LAYERID_WORLD, LAYERID_DEPTH, LAYERID_SKYBOX],
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
        // Fly mode: WASD move, Q/E down/up, arrows, Shift fast, Ctrl slow.
        enableFly: true,
        enablePan: true,
        focusPoint: new Vec3(0, 0.5, 0),
        zoomRange: new Vec2(0.5, 40),
      },
    });
    // Room-scale speeds — the stock 10 m/s crosses an apartment scan in
    // half a second.
    this.cameraControls.moveSpeed = 2.5;
    this.cameraControls.moveFastSpeed = 6;
    this.cameraControls.moveSlowSpeed = 0.8;
    app.root.addChild(this.viewCamera);

    // The camera-controls key source listens on window with no focus
    // guard — typing "wasd" into a label field would fly the camera
    // (and it consumes the move keys even in orbit mode, so toggling
    // enableFly is not enough). Block movement keys at the CAPTURE
    // phase while an input-like element has focus, so the script's
    // bubble-phase listener never sees them.
    const MOVE_KEYS = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);
    const isFormTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    };
    const blockKeys = (e: KeyboardEvent) => {
      if (MOVE_KEYS.has(e.code) && isFormTarget(document.activeElement)) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', blockKeys, true);
    window.addEventListener('keyup', blockKeys, true);
    app.on('destroy', () => {
      window.removeEventListener('keydown', blockKeys, true);
      window.removeEventListener('keyup', blockKeys, true);
    });
  }

  static async create(canvas: HTMLCanvasElement): Promise<StudioEngine> {
    const app = await createApp(canvas);
    const engine = new StudioEngine(app);
    app.start();
    // Browsers suspend requestAnimationFrame in hidden tabs, which would
    // freeze asset imports, batch runs, and robot sims mid-flight. Pump
    // the loop manually (4 Hz) whenever the document is hidden; tick()
    // has a reentrancy guard, so this is safe alongside live rAF.
    const pump = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        app.tick(performance.now());
      }
    }, 250);
    app.on('destroy', () => clearInterval(pump));
    return engine;
  }

  setClearColor(color: Color): void {
    this.viewCamera.camera!.clearColor = color;
  }

  /**
   * Splat brush: while active, right-drag erases (or tints) splats of the
   * target entity around the picked world point (LMB still orbits the
   * camera). Every applied stroke is also recorded on the entry's edit-op
   * log for reload replay and destructive export.
   */
  setEraseMode(
    entity: Entity | null,
    radius = 0.15,
    options?: {
      mode?: 'erase' | 'tint';
      tintColor?: [number, number, number];
      tintStrength?: number;
    }
  ): void {
    this.eraseTarget = entity
      ? {
          entity,
          radius,
          mode: options?.mode ?? 'erase',
          tintColor: options?.tintColor ?? [1, 0, 0],
          tintStrength: options?.tintStrength ?? 0.8,
        }
      : null;
    this.erasing = false;
    if (entity) this.app.mouse?.disableContextMenu();
  }

  /**
   * Direct manipulation of the capture-camera gizmo: left-drag near the
   * frustum origin moves the camera, near the pink cross moves the
   * target. Dragging is horizontal at the handle's height; hold Shift to
   * raise/lower instead. Orbit input pauses during the drag.
   */
  private setupGizmoDrag(): void {
    const mouse = this.app.mouse;
    if (!mouse) return;
    const GRAB_PX = 36;
    const screen = new Vec3();

    interface Hit {
      handle: 'camera' | 'target' | 'trajectory';
      planeY: number;
      /** Trajectory grabs keep the grabbed path point under the cursor. */
      grabOffset: [number, number];
    }

    const handleAt = (x: number, y: number): Hit | null => {
      const state = this.gizmos.currentState();
      if (!state || !state.visible) return null;
      const cam = this.viewCamera.camera!;
      let best: Hit | null = null;
      let bestDist = GRAB_PX;
      for (const [handle, p] of [
        ['camera', state.camPos],
        ['target', state.camTarget],
      ] as const) {
        cam.worldToScreen(new Vec3(p[0], p[1], p[2]), screen);
        if (screen.z < 0) continue; // behind the view
        const d = Math.hypot(screen.x - x, screen.y - y);
        if (d < bestDist) {
          bestDist = d;
          best = { handle, planeY: p[1], grabOffset: [0, 0] };
        }
      }
      if (best) return best;

      // The trajectory path itself is grabbable: dragging it moves the
      // whole scaffold (its center is the camera target).
      if (state.trajectory !== 'random') {
        let ringDist = 18;
        for (let i = 0; i <= 64; i++) {
          const p = sampleCameraTrajectory({
            trajectory: state.trajectory,
            index: i,
            total: 64,
            target: state.camTarget,
            radius: state.trajectoryRadius,
            height: state.trajectoryHeight,
          });
          cam.worldToScreen(new Vec3(p[0], p[1], p[2]), screen);
          if (screen.z <= 0) continue;
          const d = Math.hypot(screen.x - x, screen.y - y);
          if (d < ringDist) {
            ringDist = d;
            best = {
              handle: 'trajectory',
              planeY: p[1],
              grabOffset: [p[0] - state.camTarget[0], p[2] - state.camTarget[2]],
            };
          }
        }
      }
      return best;
    };

    const planePoint = (x: number, y: number, planeY: number): Vec3 | null => {
      const cam = this.viewCamera.camera!;
      const near = cam.screenToWorld(x, y, cam.nearClip);
      const far = cam.screenToWorld(x, y, cam.farClip);
      const dy = far.y - near.y;
      if (Math.abs(dy) < 1e-6) return null;
      const t = (planeY - near.y) / dy;
      if (t < 0 || t > 1) return null;
      return new Vec3(
        near.x + (far.x - near.x) * t,
        planeY,
        near.z + (far.z - near.z) * t
      );
    };

    mouse.on(EVENT_MOUSEDOWN, (e: { button: number; x: number; y: number; event: MouseEvent }) => {
      if (e.button !== 0 || this.eraseTarget) return;
      const hit = handleAt(e.x, e.y);
      if (!hit) return;
      const state = this.gizmos.currentState()!;
      const p = hit.handle === 'camera' ? state.camPos : state.camTarget;
      const cam = this.viewCamera.camera!;
      const eye = this.viewCamera.getPosition();
      const dist = Math.hypot(p[0] - eye.x, p[1] - eye.y, p[2] - eye.z);
      const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
      this.gizmoDrag = {
        handle: hit.handle,
        planeY: hit.planeY,
        startY: p[1],
        startScreenY: e.y,
        worldPerPixel:
          (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) /
          Math.max(1, canvas.clientHeight),
        shift: e.event?.shiftKey ?? false,
        grabOffset: hit.grabOffset,
      };
      if (this.cameraControls) this.cameraControls.enabled = false;
    });

    mouse.on(EVENT_MOUSEMOVE, (e: { x: number; y: number; event: MouseEvent }) => {
      const drag = this.gizmoDrag;
      if (!drag) return;
      const state = this.gizmos.currentState();
      if (!state) return;
      // Trajectory grabs move the scaffold's center — the camera target.
      const logical = drag.handle === 'camera' ? 'camera' : 'target';
      const p = logical === 'camera' ? state.camPos : state.camTarget;
      const shift = e.event?.shiftKey ?? drag.shift;
      if (shift) {
        const newY = drag.startY + (drag.startScreenY - e.y) * drag.worldPerPixel;
        this.onGizmoHandleDrag?.(logical, [p[0], newY, p[2]]);
        if (drag.handle !== 'trajectory') drag.planeY = newY;
      } else {
        const point = planePoint(e.x, e.y, drag.planeY);
        if (point) {
          this.onGizmoHandleDrag?.(logical, [
            point.x - drag.grabOffset[0],
            p[1],
            point.z - drag.grabOffset[1],
          ]);
        }
      }
    });

    mouse.on(EVENT_MOUSEUP, (e: { button: number }) => {
      if (e.button === 0 && this.gizmoDrag) {
        this.gizmoDrag = null;
        if (this.cameraControls) this.cameraControls.enabled = true;
      }
    });
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
          // Ops live in the splat's LOCAL space so they are recordable,
          // replayable after reload, and bakeable into exports.
          const world = current.entity.getWorldTransform();
          const local = new Mat4().copy(world).invert().transformPoint(worldPoint);
          const worldScale = world.getScale().x || 1;
          const op: SplatEditOp =
            current.mode === 'tint'
              ? {
                  kind: 'tintSphere',
                  center: [local.x, local.y, local.z],
                  radius: current.radius / worldScale,
                  color: [...current.tintColor],
                  strength: current.tintStrength,
                }
              : {
                  kind: 'eraseSphere',
                  center: [local.x, local.y, local.z],
                  radius: current.radius / worldScale,
                };
          this.splatEditor.applyOp(current.entity, op);
          this.splats.recordEditOp(current.entity, op);
          // A pick can resolve after mouseup (stroke already ended) —
          // snapshot immediately so the trailing op persists too.
          if (!this.erasing) this.splats.notifyEditsChanged();
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
      if (e.button === MOUSEBUTTON_RIGHT && this.erasing) {
        this.erasing = false;
        // Stroke finished — emit once so persistence snapshots the op log.
        this.splats.notifyEditsChanged();
      }
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
      targets.push({
        label: model.label,
        aabbs: [aabb],
        worldPoints: this.models.labelSamplePoints(model) ?? undefined,
      });
    }
    for (const splat of this.splats.entries) {
      if (splat.role !== 'object' || !splat.entity.enabled) continue;
      const resource = splat.entity.gsplat?.resource as
        | { aabb?: BoundingBox }
        | null
        | undefined;
      // Prefer the outlier-trimmed bounds — scan floaters inflate the
      // resource AABB far past the visible object.
      const local = this.splats.tightLocalAabb(splat) ?? resource?.aabb;
      if (!local) continue;
      const world = new BoundingBox();
      world.setFromTransformedAabb(local, splat.entity.getWorldTransform());
      // Tight boxes come from projecting actual splat centers.
      let worldPoints: Float32Array | undefined;
      const localSample = this.splats.labelSamplePoints(splat);
      if (localSample) {
        worldPoints = new Float32Array(localSample.length);
        const wt = splat.entity.getWorldTransform();
        const v = new Vec3();
        const o = new Vec3();
        for (let i = 0; i < localSample.length; i += 3) {
          v.set(localSample[i], localSample[i + 1], localSample[i + 2]);
          wt.transformPoint(v, o);
          worldPoints[i] = o.x;
          worldPoints[i + 1] = o.y;
          worldPoints[i + 2] = o.z;
        }
      }
      targets.push({ label: splat.label, aabbs: [world], worldPoints });
    }
    return targets;
  }

  destroy(): void {
    this.picker?.destroy();
    this.selection.destroy();
    this.gizmos.destroy();
    this.skybox.destroy();
    this.splatEditor.destroy();
    this.capture.destroy();
    this.conveyor.destroy();
    this.physics.destroy();
    this.objects.destroy();
    this.models.destroy();
    this.splats.destroy();
    this.environment.destroy();
    this.app.destroy();
  }
}
