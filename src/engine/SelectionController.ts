import {
  BoundingBox,
  Color,
  EVENT_MOUSEDOWN,
  EVENT_MOUSEMOVE,
  EVENT_MOUSEUP,
  Vec3,
  type AppBase,
  type Entity,
} from 'playcanvas';
import { computeWorldBounds } from './ModelManager';
import type { ModelManager } from './ModelManager';
import type { ObjectManager } from './ObjectManager';
import type { SplatManager } from './splats/SplatManager';

/**
 * Direct viewport manipulation of scene content:
 *
 * - click a prop / spawned object / splat-object → select (yellow box)
 * - drag the SELECTED thing → move in the horizontal plane
 * - Shift+drag → raise / lower
 * - Alt+drag → rotate (yaw)
 * - Ctrl/Cmd+drag → scale
 * - click empty space or Esc → deselect
 *
 * Dragging an unselected object orbits the camera as usual — selection is
 * one click away, so orbit never gets hijacked by accident.
 *
 * The controller only RESOLVES hits and computes absolute transform
 * values from a drag-start snapshot; writing them belongs to the UI
 * layer via `onTransform` (spawned primitives live in the store, models
 * and splats go through their managers), so ownership rules stay intact.
 */

export type SelectableKind = 'object' | 'model' | 'splat';

export interface Selection {
  kind: SelectableKind;
  id: string;
  label: string;
  entity: Entity;
}

export interface TransformPatch {
  position?: [number, number, number];
  yawDeg?: number;
  scale?: number;
}

const SELECT_COLOR = new Color(1, 0.85, 0.2);
const CLICK_SLOP_PX = 5;

interface DragState {
  startX: number;
  startY: number;
  startPos: Vec3;
  startYawDeg: number;
  startScale: number;
  planeY: number;
  /** World-units-per-pixel at the object's distance, for Y drags. */
  worldPerPixel: number;
  /** Grab offset so the object doesn't snap its center to the cursor. */
  grabOffset: Vec3;
  moved: boolean;
}

export class SelectionController {
  private app: AppBase;
  private getViewCamera: () => Entity;
  private objects: ObjectManager;
  private models: ModelManager;
  private splats: SplatManager;
  /** True while a drag is transforming the selection (orbit paused). */
  dragging = false;
  private selection: Selection | null = null;
  private drag: DragState | null = null;
  private pendingClick: { x: number; y: number; hit: Selection | null } | null = null;
  private updateHandler: () => void;

  /** UI wiring. */
  onSelect: ((selection: Selection | null) => void) | null = null;
  onTransform: ((selection: Selection, patch: TransformPatch) => void) | null = null;
  /** Lets other input owners (camera-gizmo drag) take priority. */
  isBlocked: (() => boolean) | null = null;
  private setOrbitEnabled: (enabled: boolean) => void;

  constructor(opts: {
    app: AppBase;
    getViewCamera: () => Entity;
    objects: ObjectManager;
    models: ModelManager;
    splats: SplatManager;
    setOrbitEnabled: (enabled: boolean) => void;
  }) {
    this.app = opts.app;
    this.getViewCamera = opts.getViewCamera;
    this.objects = opts.objects;
    this.models = opts.models;
    this.splats = opts.splats;
    this.setOrbitEnabled = opts.setOrbitEnabled;
    this.updateHandler = () => this.drawSelectionBox();
    this.app.on('update', this.updateHandler);
    this.attachInput();
  }

  get current(): Selection | null {
    return this.selection;
  }

  select(selection: Selection | null): void {
    this.selection = selection;
    this.onSelect?.(selection);
  }

  clear(): void {
    if (this.drag) {
      this.drag = null;
      this.dragging = false;
      this.setOrbitEnabled(true);
    }
    this.select(null);
  }

  /** Selectable candidates, cheap enough to rebuild per mousedown. */
  private candidates(): Selection[] {
    const list: Selection[] = [];
    for (const { id, entity, label } of this.objects.getSelectables()) {
      list.push({ kind: 'object', id, label, entity });
    }
    for (const m of this.models.entries) {
      if (m.entity.enabled) {
        list.push({ kind: 'model', id: m.id, label: m.label, entity: m.entity });
      }
    }
    for (const s of this.splats.entries) {
      if (s.role === 'object' && s.entity.enabled) {
        list.push({ kind: 'splat', id: s.id, label: s.label, entity: s.entity });
      }
    }
    return list;
  }

  private worldAabb(sel: Selection): BoundingBox | null {
    if (sel.kind === 'splat') {
      const resource = sel.entity.gsplat?.resource as
        | { aabb?: BoundingBox }
        | null
        | undefined;
      if (!resource?.aabb) return null;
      const world = new BoundingBox();
      world.setFromTransformedAabb(resource.aabb, sel.entity.getWorldTransform());
      return world;
    }
    const bounds = computeWorldBounds(sel.entity);
    return bounds.halfExtents.lengthSq() > 0 ? bounds : null;
  }

  /** Screen-rect hit test over world AABBs; nearest to the camera wins. */
  private hitTest(x: number, y: number): Selection | null {
    const cam = this.getViewCamera().camera!;
    const eye = this.getViewCamera().getPosition();
    const screen = new Vec3();
    const corner = new Vec3();
    let best: Selection | null = null;
    let bestDist = Infinity;

    for (const sel of this.candidates()) {
      const aabb = this.worldAabb(sel);
      if (!aabb) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let inFront = false;
      for (let i = 0; i < 8; i++) {
        corner.set(
          aabb.center.x + (i & 1 ? 1 : -1) * aabb.halfExtents.x,
          aabb.center.y + (i & 2 ? 1 : -1) * aabb.halfExtents.y,
          aabb.center.z + (i & 4 ? 1 : -1) * aabb.halfExtents.z
        );
        cam.worldToScreen(corner, screen);
        if (screen.z <= 0) continue;
        inFront = true;
        if (screen.x < minX) minX = screen.x;
        if (screen.y < minY) minY = screen.y;
        if (screen.x > maxX) maxX = screen.x;
        if (screen.y > maxY) maxY = screen.y;
      }
      if (!inFront) continue;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const d = aabb.center.distance(eye);
      if (d < bestDist) {
        bestDist = d;
        best = sel;
      }
    }
    return best;
  }

  private stillExists(sel: Selection): boolean {
    switch (sel.kind) {
      case 'object':
        return this.objects.getSelectables().some((o) => o.id === sel.id);
      case 'model':
        return this.models.entries.some((m) => m.id === sel.id && m.entity.enabled);
      case 'splat':
        return this.splats.entries.some((s) => s.id === sel.id);
    }
  }

  private attachInput(): void {
    const mouse = this.app.mouse;
    if (!mouse) return;

    mouse.on(EVENT_MOUSEDOWN, (e: { button: number; x: number; y: number }) => {
      if (e.button !== 0 || this.isBlocked?.()) return;
      const hit = this.hitTest(e.x, e.y);

      if (hit && this.selection && hit.kind === this.selection.kind && hit.id === this.selection.id) {
        // Drag on the selected thing = transform it.
        const entity = this.selection.entity;
        const pos = entity.getLocalPosition().clone();
        const cam = this.getViewCamera().camera!;
        const eye = this.getViewCamera().getPosition();
        const dist = entity.getPosition().distance(eye);
        const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
        const grab = this.planePoint(e.x, e.y, pos.y);
        this.drag = {
          startX: e.x,
          startY: e.y,
          startPos: pos,
          startYawDeg: entity.getLocalEulerAngles().y,
          startScale: entity.getLocalScale().x,
          planeY: pos.y,
          worldPerPixel:
            (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) /
            Math.max(1, canvas.clientHeight),
          grabOffset: grab ? grab.sub(entity.getPosition()) : new Vec3(),
          moved: false,
        };
        this.dragging = true;
        this.setOrbitEnabled(false);
        return;
      }

      // Otherwise remember the press: a clean click selects/deselects on
      // mouseup; a real drag stays an orbit.
      this.pendingClick = { x: e.x, y: e.y, hit };
    });

    mouse.on(
      EVENT_MOUSEMOVE,
      (e: { x: number; y: number; event?: MouseEvent }) => {
        const drag = this.drag;
        if (!drag || !this.selection) return;
        if (!this.stillExists(this.selection)) {
          this.clear();
          return;
        }
        const dx = e.x - drag.startX;
        const dy = e.y - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;

        const native = e.event;
        const sel = this.selection;
        if (native?.altKey) {
          this.onTransform?.(sel, { yawDeg: norm180(drag.startYawDeg + dx * 0.5) });
        } else if (native?.ctrlKey || native?.metaKey) {
          const factor = Math.exp(-dy * 0.005);
          this.onTransform?.(sel, {
            scale: clamp(drag.startScale * factor, 0.02, 20),
          });
        } else if (native?.shiftKey) {
          this.onTransform?.(sel, {
            position: [
              drag.startPos.x,
              drag.startPos.y - dy * drag.worldPerPixel,
              drag.startPos.z,
            ],
          });
        } else {
          const point = this.planePoint(e.x, e.y, drag.planeY);
          if (point) {
            this.onTransform?.(sel, {
              position: [
                point.x - drag.grabOffset.x,
                drag.startPos.y,
                point.z - drag.grabOffset.z,
              ],
            });
          }
        }
      }
    );

    mouse.on(EVENT_MOUSEUP, (e: { button: number; x: number; y: number }) => {
      if (e.button !== 0) return;
      if (this.drag) {
        this.drag = null;
        this.dragging = false;
        this.setOrbitEnabled(true);
        return;
      }
      const pending = this.pendingClick;
      this.pendingClick = null;
      if (!pending) return;
      // Only a clean click (no orbiting) changes the selection.
      if (Math.hypot(e.x - pending.x, e.y - pending.y) > CLICK_SLOP_PX) return;
      this.select(pending.hit);
    });
  }

  private planePoint(x: number, y: number, planeY: number): Vec3 | null {
    const cam = this.getViewCamera().camera!;
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
  }

  /** Yellow AABB wireframe around the selection (Immediate layer only —
   * excluded from captures, the PiP, and inference frames). */
  private drawSelectionBox(): void {
    const sel = this.selection;
    if (!sel) return;
    if (!this.stillExists(sel)) {
      this.clear();
      return;
    }
    const aabb = this.worldAabb(sel);
    if (!aabb) return;
    const c = aabb.center;
    const h = aabb.halfExtents;
    const p = (ix: number, iy: number, iz: number) =>
      new Vec3(c.x + ix * h.x, c.y + iy * h.y, c.z + iz * h.z);
    const corners = [
      p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1),
      p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1),
    ];
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [a, b] of edges) {
      this.app.drawLine(corners[a], corners[b], SELECT_COLOR, true);
    }
  }

  destroy(): void {
    this.app.off('update', this.updateHandler);
    this.selection = null;
    this.drag = null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function norm180(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
