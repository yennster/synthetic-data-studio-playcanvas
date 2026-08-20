import {
  Color,
  Entity,
  StandardMaterial,
  type AppBase,
} from 'playcanvas';
import { BRACCIO_LINKS } from '../lib/braccio';
import { clamp01 } from '../lib/math';

/** The five POV camera mount points along the arm, matching the store's
 * `robot.armCameraMount` union. */
export type ArmPovMount = 'base' | 'shoulder' | 'elbow' | 'wrist' | 'gripper';

export const ARM_POV_MOUNTS: readonly ArmPovMount[] = [
  'base',
  'shoulder',
  'elbow',
  'wrist',
  'gripper',
];

const RAD2DEG = 180 / Math.PI;

interface PovAnchor {
  mount: Entity;
  look: Entity;
}

/**
 * PlayCanvas visual for the Arduino TinkerKit Braccio, built from the
 * published link dimensions in `BRACCIO_LINKS`. The entity hierarchy
 * mirrors the servo chain one joint per group:
 *
 *   root → baseYaw(M1,+Y) → shoulder(M2,+X) → elbow(M3,+X)
 *        → wristPitch(M4,+X) → wristRoll(M5,+Y) → end effector
 *        → parallel-jaw fingers (M6 aperture)
 *
 * `setJoints` applies a 6-vector: joints 0–4 are servo radians, joint 5
 * is the normalized gripper aperture (0 closed … 1 open) — the same
 * convention as `BRACCIO_REST_RAD` and the arm trajectory generators.
 *
 * Each mount point carries a pair of named anchors,
 * `arm-pov-${mount}` / `arm-pov-${mount}-look`, that the POV preview
 * and object-detection capture read world positions from each frame.
 */
export class ArmRig {
  readonly root: Entity;

  private baseYaw: Entity;
  private shoulder: Entity;
  private elbow: Entity;
  private wristPitch: Entity;
  private wristRoll: Entity;
  private fingerL: Entity;
  private fingerR: Entity;
  private anchors: Record<ArmPovMount, PovAnchor>;
  private materials: StandardMaterial[] = [];

  constructor(app: AppBase, parent: Entity) {
    const L = BRACCIO_LINKS;

    this.root = new Entity('arm-rig', app);
    parent.addChild(this.root);

    const plateMat = this.material('#171a20', 0.2, 0.25);
    const servoMat = this.material('#3b4451', 0.4, 0.5);
    const linkMat = this.material('#b8501e', 0.25, 0.6);
    const eyeMat = this.material('#10231c', 0.2, 0.7, '#3ddc84');

    // Mounting plate (cosmetic disc).
    this.prim(app, 'arm-plate', 'cylinder', plateMat, [
      L.plateRadius * 2,
      L.plateThickness,
      L.plateRadius * 2,
    ], [0, L.plateThickness / 2, 0]);

    // M1 base yaw.
    this.baseYaw = this.group(app, 'arm-base-yaw', this.root, [
      0,
      L.plateThickness,
      0,
    ]);
    this.prim(
      app,
      'arm-base-column',
      'cylinder',
      servoMat,
      [0.09, L.base, 0.09],
      [0, L.base / 2, 0],
      this.baseYaw,
    );

    // M2 shoulder.
    this.shoulder = this.group(app, 'arm-shoulder', this.baseYaw, [0, L.base, 0]);
    this.prim(
      app,
      'arm-upper',
      'box',
      linkMat,
      [0.06, L.shoulder, 0.06],
      [0, L.shoulder / 2, 0],
      this.shoulder,
    );

    // M3 elbow.
    this.elbow = this.group(app, 'arm-elbow', this.shoulder, [0, L.shoulder, 0]);
    this.prim(
      app,
      'arm-forearm',
      'box',
      linkMat,
      [0.05, L.elbow, 0.05],
      [0, L.elbow / 2, 0],
      this.elbow,
    );

    // M4 wrist pitch.
    this.wristPitch = this.group(app, 'arm-wrist-pitch', this.elbow, [
      0,
      L.elbow,
      0,
    ]);
    this.prim(
      app,
      'arm-wrist-link',
      'box',
      servoMat,
      [0.04, L.wristPitch, 0.04],
      [0, L.wristPitch / 2, 0],
      this.wristPitch,
    );

    // M5 wrist roll.
    this.wristRoll = this.group(app, 'arm-wrist-roll', this.wristPitch, [
      0,
      L.wristPitch,
      0,
    ]);
    this.prim(
      app,
      'arm-roll-cyl',
      'cylinder',
      servoMat,
      [0.05, L.wristRoll, 0.05],
      [0, L.wristRoll / 2, 0],
      this.wristRoll,
    );

    // End effector: carrier plate + parallel-jaw fingers (M6).
    const endEffector = this.group(app, 'arm-end-effector', this.wristRoll, [
      0,
      L.wristRoll,
      0,
    ]);
    this.prim(
      app,
      'arm-carrier',
      'box',
      plateMat,
      [L.gripperWidth + 0.04, 0.02, 0.04],
      [0, 0.01, 0],
      endEffector,
    );
    this.fingerL = this.prim(
      app,
      'arm-finger-l',
      'box',
      servoMat,
      [0.018, L.fingerLength, 0.025],
      [-L.gripperWidth / 2, L.fingerLength / 2 + 0.02, 0],
      endEffector,
    );
    this.fingerR = this.prim(
      app,
      'arm-finger-r',
      'box',
      servoMat,
      [0.018, L.fingerLength, 0.025],
      [L.gripperWidth / 2, L.fingerLength / 2 + 0.02, 0],
      endEffector,
    );
    // Wrist "eye" marker so the default POV mount is visible on the rig.
    this.prim(
      app,
      'arm-eye',
      'cylinder',
      eyeMat,
      [0.016, 0.012, 0.016],
      [0, 0.04, 0.025],
      endEffector,
      [90, 0, 0],
    );

    // POV anchors. Look anchors are children of their mounts so the
    // pair moves as one; the base look is nudged off the vertical so a
    // lookAt with a Y-up vector never degenerates.
    this.anchors = {
      base: this.anchor(app, 'base', this.baseYaw, [0, L.base + 0.02, 0], [
        0.02,
        0.4,
        0,
      ]),
      shoulder: this.anchor(
        app,
        'shoulder',
        this.shoulder,
        [0.04, 0.04, 0.04],
        [0, L.shoulder, 0],
      ),
      elbow: this.anchor(app, 'elbow', this.elbow, [0.03, 0.03, 0.03], [
        0,
        L.elbow,
        0,
      ]),
      wrist: this.anchor(app, 'wrist', endEffector, [0, 0, 0], [
        0,
        L.fingerLength + 0.04,
        0,
      ]),
      gripper: this.anchor(
        app,
        'gripper',
        endEffector,
        [0, L.fingerLength + 0.01, 0],
        [0, 0.1, 0],
      ),
    };
  }

  /**
   * Poses the chain. `joints` follows the app-wide Braccio convention:
   * indices 0–4 are servo radians (M1 base … M5 wrist roll), index 5 is
   * the normalized gripper aperture 0..1. Values beyond the array
   * default to 0.
   */
  setJoints(joints: readonly number[]): void {
    const j = (i: number) => joints[i] ?? 0;
    this.baseYaw.setLocalEulerAngles(0, j(0) * RAD2DEG, 0);
    this.shoulder.setLocalEulerAngles(j(1) * RAD2DEG, 0, 0);
    this.elbow.setLocalEulerAngles(j(2) * RAD2DEG, 0, 0);
    this.wristPitch.setLocalEulerAngles(j(3) * RAD2DEG, 0, 0);
    this.wristRoll.setLocalEulerAngles(0, j(4) * RAD2DEG, 0);

    const half = (BRACCIO_LINKS.gripperWidth / 2) * clamp01(j(5));
    const fingerY = BRACCIO_LINKS.fingerLength / 2 + 0.02;
    this.fingerL.setLocalPosition(-half, fingerY, 0);
    this.fingerR.setLocalPosition(half, fingerY, 0);
  }

  /** The POV mount/look anchor pair for a mount point. */
  getPovAnchors(mount: ArmPovMount): PovAnchor {
    return this.anchors[mount];
  }

  destroy(): void {
    this.root.destroy();
    for (const m of this.materials) m.destroy();
    this.materials = [];
  }

  private group(
    app: AppBase,
    name: string,
    parent: Entity,
    position: [number, number, number],
  ): Entity {
    const e = new Entity(name, app);
    e.setLocalPosition(position[0], position[1], position[2]);
    parent.addChild(e);
    return e;
  }

  private anchor(
    app: AppBase,
    mountName: ArmPovMount,
    parent: Entity,
    mountPos: [number, number, number],
    lookPos: [number, number, number],
  ): PovAnchor {
    const mount = new Entity(`arm-pov-${mountName}`, app);
    mount.setLocalPosition(mountPos[0], mountPos[1], mountPos[2]);
    parent.addChild(mount);
    const look = new Entity(`arm-pov-${mountName}-look`, app);
    look.setLocalPosition(lookPos[0], lookPos[1], lookPos[2]);
    mount.addChild(look);
    return { mount, look };
  }

  private material(
    hex: string,
    metalness: number,
    gloss: number,
    emissiveHex?: string,
  ): StandardMaterial {
    const m = new StandardMaterial();
    m.diffuse = new Color().fromString(hex);
    m.useMetalness = true;
    m.metalness = metalness;
    m.gloss = gloss;
    if (emissiveHex) {
      m.emissive = new Color().fromString(emissiveHex);
      m.emissiveIntensity = 0.7;
    }
    m.update();
    this.materials.push(m);
    return m;
  }

  private prim(
    app: AppBase,
    name: string,
    type: string,
    material: StandardMaterial,
    scale: [number, number, number],
    position: [number, number, number],
    parent: Entity = this.root,
    euler?: [number, number, number],
  ): Entity {
    const e = new Entity(name, app);
    e.addComponent('render', { type, material, castShadows: true });
    e.setLocalScale(scale[0], scale[1], scale[2]);
    e.setLocalPosition(position[0], position[1], position[2]);
    if (euler) e.setLocalEulerAngles(euler[0], euler[1], euler[2]);
    parent.addChild(e);
    return e;
  }
}
