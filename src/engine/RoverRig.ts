import {
  Color,
  Entity,
  StandardMaterial,
  type AppBase,
} from 'playcanvas';

/**
 * Visual dimensions for the rover rig, meters. Kept exported so the
 * sims/runner side can share the chassis footprint (contact-disc radius,
 * lidar scan origin height) without importing PlayCanvas entities.
 */
export const ROVER_RIG_DIMS = {
  chassis: { w: 0.4, h: 0.15, d: 0.5 },
  wheelR: 0.09,
  wheelT: 0.05,
  rideHeight: 0.04,
  headSize: 0.14,
} as const;

/** World-space height of the lidar puck center when the rover sits on
 * the floor — the natural scan origin for the lidar ring. */
export const ROVER_LIDAR_HEIGHT =
  ROVER_RIG_DIMS.wheelR +
  ROVER_RIG_DIMS.rideHeight +
  ROVER_RIG_DIMS.chassis.h / 2 +
  ROVER_RIG_DIMS.headSize +
  0.015;

const RAD2DEG = 180 / Math.PI;

/**
 * PlayCanvas visual for the ground rover: chassis box, four wheel
 * cylinders, a sensor head with an emissive lidar puck, and named POV
 * camera anchors at the front ('rover-pov-mount' / 'rover-pov-look',
 * the look anchor 1 m ahead at chassis-top height).
 *
 * Purely visual — physics/trajectories live in src/modes/roverSim.ts;
 * the panel forwards the sim's per-tick pose into `setPose`.
 *
 * The live lidar beam fan is NOT part of this rig: it draws through
 * LidarFanRenderer on the Immediate layer (excluded from capture and
 * preview cameras — the original's hideForCapture semantics), reading
 * this rig's pose via `setPose`'s recorded x/z/heading.
 */
export class RoverRig {
  /** Root entity the panel poses via `setPose`. */
  readonly root: Entity;
  /** POV camera anchor at the chassis front ('rover-pov-mount'). */
  readonly povMount: Entity;
  /** Look-at anchor 1 m ahead of the rover ('rover-pov-look'). */
  readonly povLook: Entity;

  private materials: StandardMaterial[] = [];
  private chassisMat: StandardMaterial;
  private inContact = false;
  private headingRad = 0;

  constructor(app: AppBase, parent: Entity) {
    const { chassis, wheelR, wheelT, rideHeight, headSize } = ROVER_RIG_DIMS;
    const chassisY = wheelR + rideHeight;
    const chassisTopY = chassisY + chassis.h / 2;

    this.root = new Entity('rover-rig', app);
    parent.addChild(this.root);

    this.chassisMat = this.material('#2b3340', 0.3, 0.45);
    const darkMat = this.material('#171a20', 0.15, 0.2);
    const headMat = this.material('#0e1115', 0.5, 0.55);
    const puckMat = this.material('#0e1115', 0.2, 0.6, '#3ddc84');
    const lensMat = this.material('#10231c', 0.1, 0.7, '#ff5c1a');

    // Chassis.
    this.prim(app, 'rover-chassis', 'box', this.chassisMat, [
      chassis.w,
      chassis.h,
      chassis.d,
    ], [0, chassisY, 0]);

    // Sensor head + emissive lidar puck on top.
    this.prim(app, 'rover-head', 'box', headMat, [headSize, headSize, headSize], [
      0,
      chassisTopY + headSize / 2,
      0,
    ]);
    this.prim(app, 'rover-lidar-puck', 'cylinder', puckMat, [0.1, 0.03, 0.1], [
      0,
      chassisTopY + headSize + 0.015,
      0,
    ]);

    // Forward camera "lens" marker — a small cylinder poking out of the
    // chassis front so the user can see where the POV camera sits.
    this.prim(
      app,
      'rover-lens',
      'cylinder',
      lensMat,
      [0.05, 0.03, 0.05],
      [0, chassisTopY, chassis.d / 2 + 0.01],
      [90, 0, 0],
    );

    // Four wheels — cylinders spun onto the X axis at each corner.
    const wheelX = chassis.w / 2 + wheelT / 2;
    const wheelZ = chassis.d * 0.3;
    for (const [sx, sz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      this.prim(
        app,
        `rover-wheel-${sx}-${sz}`,
        'cylinder',
        darkMat,
        [wheelR * 2, wheelT, wheelR * 2],
        [sx * wheelX, wheelR, sz * wheelZ],
        [0, 0, 90],
      );
    }

    // POV camera anchors. The mount sits just above the chassis lip at
    // the front; the look anchor floats 1 m ahead at chassis-top height
    // so the POV camera sees the floor and the obstacle field, not sky.
    this.povMount = new Entity('rover-pov-mount', app);
    this.povMount.setLocalPosition(0, chassisTopY + 0.05, chassis.d / 2 + 0.02);
    this.root.addChild(this.povMount);

    this.povLook = new Entity('rover-pov-look', app);
    this.povLook.setLocalPosition(0, chassisTopY, chassis.d / 2 + 1.0);
    this.root.addChild(this.povLook);

    this.setPose(0, 0, 0);
  }

  /** Applies a sim pose: planar position + yaw (radians, 0 = +Z). */
  setPose(x: number, z: number, headingRad: number): void {
    this.headingRad = headingRad;
    this.root.setLocalPosition(x, 0, z);
    this.root.setLocalEulerAngles(0, headingRad * RAD2DEG, 0);
  }

  /** Last pose fed to `setPose` — the lidar fan reads the yaw here
   * (Euler extraction from the entity flips past ±90°). */
  get heading(): number {
    return this.headingRad;
  }

  /** Tints the chassis while the contact detector reports an obstacle
   * hit — the same red flash the original rover used. */
  setContact(inContact: boolean): void {
    if (inContact === this.inContact) return;
    this.inContact = inContact;
    this.chassisMat.diffuse = new Color().fromString(
      inContact ? '#7a2828' : '#2b3340',
    );
    this.chassisMat.update();
  }

  destroy(): void {
    this.root.destroy();
    for (const m of this.materials) m.destroy();
    this.materials = [];
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
    euler?: [number, number, number],
  ): Entity {
    const e = new Entity(name, app);
    e.addComponent('render', { type, material, castShadows: true });
    e.setLocalScale(scale[0], scale[1], scale[2]);
    e.setLocalPosition(position[0], position[1], position[2]);
    if (euler) e.setLocalEulerAngles(euler[0], euler[1], euler[2]);
    this.root.addChild(e);
    return e;
  }
}
