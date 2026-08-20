import { useCallback, useEffect, useRef, useState } from 'react';
import { Vec3, type Entity } from 'playcanvas';
import { useEngine } from '../engine/EngineContext';
import {
  defaultObject,
  useStore,
  type ArmTrajectoryKind,
  type ObjectKind,
  type RealismSettings,
  type RobotKind,
  type SceneObject,
  type UploadModality,
} from '../store/useStore';
import { RoverRig } from '../engine/RoverRig';
import { ArmRig, type ArmPovMount } from '../engine/ArmRig';
import { BRACCIO_LIMITS_RAD, BRACCIO_REST_RAD } from '../lib/braccio';
import type { BraccioJointVector } from '../lib/braccioIk';
import { saveBlob } from '../lib/captureFormats';
import { degToRad, radToDeg } from '../lib/math';
import { applyRealismToBlob } from '../lib/realism';
import type { IngestionMetadataExtras, RoverEvent } from '../lib/types';
import {
  runRobotBatch,
  type RobotImageCapture,
  type RobotRunProgress,
  type RobotRunTally,
} from '../modes/robotRunner';
import type { RoverTick, WorldAabb } from '../modes/roverSim';
import type { ArmPickupTarget, ArmTick } from '../modes/armSim';
import {
  CollapsibleCard,
  NumberField,
  RadioPills,
  SliderRow,
  ToggleSwitch,
  type RadioPillOption,
} from './primitives';
import { EiAuthCard } from './EiAuthCard';
import { EiInferenceCard } from './EiInferenceCard';
import { RealismCard } from './RealismCard';
import { SceneObjectsCard } from './SceneObjectsCard';
import { computePipRect } from './useCaptureCameraSync';
import './robot.css';

/** POV camera field of view (degrees) — matches the original robot POV. */
const POV_FOV = 70;

function formatTally(t: RobotRunTally): string {
  return `${t.sensorUploaded} sensor up · ${t.sensorZipped} sensor zip · ${t.imagesUploaded} img up · ${t.imagesZipped} img zip · ${t.failed} failed`;
}

/**
 * Flatten realism config into EI image-metadata fields — same shape as
 * EiUploadCard's realismMeta so vision + robotics captures can be
 * mixed downstream without branching.
 */
function realismMeta(r: RealismSettings): IngestionMetadataExtras {
  if (r.mode === 'off') {
    return { realism_mode: 'off', realism_intensity: 0 };
  }
  const avg = (r.grain + r.chromatic + r.vignette + r.jitter + r.jpeg) / 5;
  return {
    realism_mode: r.mode,
    realism_intensity: avg,
    realism_grain: r.grain,
    realism_chromatic: r.chromatic,
    realism_vignette: r.vignette,
    realism_jitter: r.jitter,
    realism_jpeg: r.jpeg,
    realism_randomize: r.randomize,
  };
}

/* ------------------------------------------------------------------ *
 * Scene-object → world AABB mapping. Mirrors ObjectManager's           *
 * KIND_CONFIG footprints (unit-primitive scale × object scale);        *
 * rotation is ignored — the planner only needs a conservative          *
 * footprint.                                                           *
 * ------------------------------------------------------------------ */

const KIND_FOOTPRINT: Record<ObjectKind, { w: number; h: number; d: number }> = {
  cube: { w: 0.6, h: 0.6, d: 0.6 },
  sphere: { w: 0.8, h: 0.8, d: 0.8 },
  cylinder: { w: 0.7, h: 0.7, d: 0.7 },
  torus: { w: 0.94, h: 0.376, d: 0.94 },
  capsule: { w: 0.6, h: 1.2, d: 0.6 },
  phone: { w: 0.5, h: 1.0, d: 0.08 },
  soda_can: { w: 0.44, h: 0.62, d: 0.44 },
};

function objectHalfExtents(o: SceneObject): [number, number, number] {
  const f = KIND_FOOTPRINT[o.kind];
  return [(f.w * o.scale) / 2, (f.h * o.scale) / 2, (f.d * o.scale) / 2];
}

/** Center Y: physics objects rest on the floor (ObjectManager restY);
 * others honor their stored center Y. */
function objectCenterY(o: SceneObject, halfY: number): number {
  return o.physics ? halfY : o.position[1];
}

function robotObstacleAabbs(
  objects: SceneObject[],
  owner: RobotKind
): WorldAabb[] {
  const out: WorldAabb[] = [];
  for (const o of objects) {
    if (o.owner !== owner) continue;
    const [hx, hy, hz] = objectHalfExtents(o);
    const cy = objectCenterY(o, hy);
    out.push({
      min: [o.position[0] - hx, cy - hy, o.position[2] - hz],
      max: [o.position[0] + hx, cy + hy, o.position[2] + hz],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Robot-owned object spawners for the shared SceneObjectsCard.        *
 * ------------------------------------------------------------------ */

/** Rover obstacles spawn on a ring around the origin so the event
 * paths (spawn disc radius 4 m) have something to avoid or hit. */
function spawnRoverObstacle(kind: ObjectKind, label?: string): string {
  const s = useStore.getState();
  const index = s.sceneObjects.filter((o) => o.owner === 'rover').length;
  const base = defaultObject(kind, label || 'obstacle', index);
  const angle = Math.random() * Math.PI * 2;
  const radius = 1.0 + Math.random() * 2.0;
  return s.addObject({
    ...base,
    owner: 'rover',
    position: [Math.cos(angle) * radius, 1.2, Math.sin(angle) * radius],
  });
}

/** Arm pickups spawn inside the Braccio's floor-level reach: half-
 * annulus r ∈ [0.11, 0.22] m (0.11 clears the base plate, 0.22 stays
 * inside the ~0.238 m IK reach), x ≥ 0 so the base yaw stays within
 * its 0–180° servo range. */
const ARM_PICKUP_MIN_R = 0.11;
const ARM_PICKUP_MAX_R = 0.22;

function armPickupPosition(): [number, number, number] {
  const r =
    ARM_PICKUP_MIN_R + Math.random() * (ARM_PICKUP_MAX_R - ARM_PICKUP_MIN_R);
  const a = Math.random() * Math.PI;
  return [Math.sin(a) * r, 0.015, Math.cos(a) * r];
}

function spawnArmPickup(kind: ObjectKind, label?: string): string {
  const s = useStore.getState();
  const index = s.sceneObjects.filter((o) => o.owner === 'arm').length;
  const base = defaultObject(kind, label || 'pickup', index);
  return s.addObject({
    ...base,
    owner: 'arm',
    scale: 0.05,
    position: armPickupPosition(),
  });
}

function randomizeArmPickups(): void {
  const s = useStore.getState();
  for (const o of s.sceneObjects) {
    if (o.owner !== 'arm') continue;
    s.updateObject(o.id, {
      position: armPickupPosition(),
      rotation: Math.random() * Math.PI * 2,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Option tables.                                                      *
 * ------------------------------------------------------------------ */

const ROBOT_KINDS: { value: RobotKind; label: string; hint: string }[] = [
  { value: 'rover', label: 'Rover', hint: 'Chassis IMU + lidar / ToF ring' },
  {
    value: 'arm',
    label: 'Arm (Arduino Braccio)',
    hint: 'End-effector IMU, optional pick-and-place',
  },
];

const ROVER_EVENT_OPTIONS: RadioPillOption<RoverEvent>[] = [
  {
    value: 'cruise',
    label: 'cruise',
    hint: 'Drive cleanly through the obstacle field, no contact.',
  },
  {
    value: 'collision',
    label: 'collision',
    hint: 'Aim straight at an obstacle; bumper-style impact mid-window.',
  },
  {
    value: 'stuck',
    label: 'stuck',
    hint: 'Pin a wheel against an obstacle; vibrate without translation.',
  },
];

const ARM_TRAJECTORY_OPTIONS: RadioPillOption<ArmTrajectoryKind>[] = [
  {
    value: 'pick_place',
    label: 'pick place',
    hint: 'Approach a scene object, grasp, lift, place at a destination.',
  },
  {
    value: 'sweep',
    label: 'sweep',
    hint: 'Base servo sweeps left/right at a fixed shoulder/elbow.',
  },
  {
    value: 'wave',
    label: 'wave',
    hint: 'Wrist-pitch oscillation; clean gyro signature.',
  },
  {
    value: 'random_pose',
    label: 'random pose',
    hint: 'Interpolate between two random reachable joint vectors.',
  },
  {
    value: 'draw_circle',
    label: 'draw circle',
    hint: 'End-effector traces a horizontal circle via planar IK.',
  },
];

const MOUNT_OPTIONS: RadioPillOption<ArmPovMount>[] = [
  { value: 'base', label: 'Base', hint: 'Top of the base column, looking up the arm.' },
  { value: 'shoulder', label: 'Shoulder', hint: 'Eye on the shoulder joint, looking forward.' },
  { value: 'elbow', label: 'Elbow', hint: 'Eye on the elbow joint, looking down the forearm.' },
  { value: 'wrist', label: 'Wrist', hint: 'Wrist roll, looking past the gripper carrier.' },
  { value: 'gripper', label: 'Gripper', hint: 'Between the fingers, looking at the grasp point.' },
];

const MODALITY_OPTIONS: RadioPillOption<UploadModality>[] = [
  {
    value: 'fused',
    label: 'Fused (IMU+lidar)',
    hint: 'One sample, 6 IMU + N lidar channels. Best for sensor-fusion classifiers.',
  },
  {
    value: 'imu',
    label: 'IMU only',
    hint: 'Chassis IMU only. Useful for collision detection without lidar.',
  },
  {
    value: 'lidar',
    label: 'Lidar only',
    hint: 'Lidar only. Useful for environment-classification models.',
  },
];

/* ------------------------------------------------------------------ *
 * Panel.                                                              *
 * ------------------------------------------------------------------ */

export function RobotPanel() {
  const engine = useEngine();
  const robot = useStore((s) => s.robot);
  const setRobot = useStore((s) => s.setRobot);
  const robotRunning = useStore((s) => s.robotRunning);
  const setRobotRunning = useStore((s) => s.setRobotRunning);
  const clearRobotSamples = useStore((s) => s.clearRobotSamples);
  const clearObjects = useStore((s) => s.clearObjects);
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);
  const hasApiKey = useStore((s) => s.ei.apiKey.trim().length > 0);
  const imuCount = useStore((s) => s.robotImuSamples.length);
  const lidarCount = useStore((s) => s.lidarSamples.length);

  // Arm home pose lives in panel state: the shared store's RobotSettings
  // has no armHomePose field and the store is outside this panel's
  // write scope. The pose is handed to the runner per run and mirrored
  // into the rig, so behavior matches the original contract minus
  // persistence across reloads.
  const [armHomePose, setArmHomePose] = useState<BraccioJointVector>(() => [
    ...BRACCIO_REST_RAD,
  ]);
  const homePoseRef = useRef<BraccioJointVector>(armHomePose);

  const roverRigRef = useRef<RoverRig | null>(null);
  const armRigRef = useRef<ArmRig | null>(null);
  const mountRef = useRef<ArmPovMount>(robot.armCameraMount);
  const cancelRef = useRef(false);

  useEffect(() => {
    mountRef.current = robot.armCameraMount;
  }, [robot.armCameraMount]);

  // Rig lifecycle: create lazily when robot mode activates (this panel
  // only mounts in robot mode), swap on kind change, destroy on leave.
  useEffect(() => {
    if (!engine) return;
    if (robot.kind === 'rover') {
      const rig = new RoverRig(engine.app, engine.content);
      roverRigRef.current = rig;
      return () => {
        roverRigRef.current = null;
        rig.destroy();
      };
    }
    const rig = new ArmRig(engine.app, engine.content);
    rig.setJoints(homePoseRef.current);
    armRigRef.current = rig;
    return () => {
      armRigRef.current = null;
      rig.destroy();
    };
  }, [engine, robot.kind]);

  // Home-pose slider edits reflect on the idle rig immediately; while a
  // run is active the runner's per-tick joint callback owns the rig.
  useEffect(() => {
    homePoseRef.current = armHomePose;
    if (!useStore.getState().robotRunning) {
      armRigRef.current?.setJoints(armHomePose);
    }
  }, [armHomePose]);

  /** POV anchors for the active rig + mount selection. */
  const currentAnchors = useCallback((): {
    mount: Entity;
    look: Entity;
  } | null => {
    if (useStore.getState().robot.kind === 'rover') {
      const rig = roverRigRef.current;
      return rig ? { mount: rig.povMount, look: rig.povLook } : null;
    }
    const rig = armRigRef.current;
    return rig ? rig.getPovAnchors(mountRef.current) : null;
  }, []);

  // POV preview: drive the engine's PiP camera from the rig anchors
  // each frame. Reuses the vision PiP rect math (bottom-left, 240 px
  // wide) with the object-detection aspect.
  const povWidth = robot.objectDetectionWidth;
  const povHeight = robot.objectDetectionHeight;
  useEffect(() => {
    if (!engine) return;
    const cam = engine.previewCamera;
    const prevFov = cam.camera!.fov;
    cam.camera!.fov = POV_FOV;

    const applyRect = () => {
      const canvas = engine.app.graphicsDevice.canvas as HTMLCanvasElement;
      const canvasHeight = canvas.clientHeight || window.innerHeight;
      engine.setPreviewRect(true, computePipRect(povWidth, povHeight, canvasHeight));
    };
    applyRect();
    window.addEventListener('resize', applyRect);

    const dir = new Vec3();
    const update = () => {
      const anchors = currentAnchors();
      if (!anchors) return;
      const mp = anchors.mount.getPosition();
      const lp = anchors.look.getPosition();
      dir.sub2(lp, mp);
      if (dir.lengthSq() < 1e-8) return;
      dir.normalize();
      // Near-vertical view directions (base mount looking up the arm)
      // degenerate with a Y-up basis — swap the up reference.
      const up = Math.abs(dir.y) > 0.98 ? Vec3.FORWARD : Vec3.UP;
      cam.setPosition(mp);
      cam.lookAt(lp, up);
    };
    engine.app.on('update', update);

    return () => {
      engine.app.off('update', update);
      window.removeEventListener('resize', applyRect);
      engine.setPreviewRect(false);
      cam.camera!.fov = prevFov;
    };
  }, [engine, currentAnchors, povWidth, povHeight]);

  /**
   * Object-detection capture callback for the runner: renders one frame
   * from the current POV anchor through the offscreen capture rig
   * (boxes projected from the same pose), applies the realism pixel
   * pass, and reports the realism_* metadata keys. Returns null on
   * failure so the runner counts the shot as failed.
   */
  const capturePovImage = useCallback(
    async (_phase: 'rest' | 'motion'): Promise<RobotImageCapture | null> => {
      if (!engine) return null;
      const anchors = currentAnchors();
      if (!anchors) return null;
      const s = useStore.getState();
      try {
        engine.capture.setPose(
          anchors.mount.getPosition(),
          anchors.look.getPosition()
        );
        engine.capture.setFov(POV_FOV);
        const frame = await engine.capture.captureFrame(
          s.robot.objectDetectionWidth,
          s.robot.objectDetectionHeight,
          engine.getLabelTargets()
        );
        // Pixel-level pass only — boxes stay valid.
        const blob = await applyRealismToBlob(frame.blob, {
          mode: s.realism.mode,
          intensities: {
            grain: s.realism.grain,
            chromatic: s.realism.chromatic,
            vignette: s.realism.vignette,
            jitter: s.realism.jitter,
            jpeg: s.realism.jpeg,
          },
          randomize: s.realism.randomize,
          rng: Math.random,
        });
        useStore.getState().bumpRobotCaptures();
        return {
          blob,
          boxes: frame.boxes,
          width: frame.width,
          height: frame.height,
          metadata: realismMeta(s.realism),
        };
      } catch (err) {
        console.error('POV capture failed', err);
        return null;
      }
    },
    [engine, currentAnchors]
  );

  /** pick_place IK anchor per iteration: a random arm-owned scene
   * object (optionally re-randomized first), or null for the runner's
   * stock fallback point. */
  const pickArmTarget = useCallback(
    (_iteration: number): ArmPickupTarget | null => {
      const s = useStore.getState();
      if (s.robot.armTrajectory !== 'pick_place') return null;
      if (s.robot.armRandomizeTarget) randomizeArmPickups();
      const owned = useStore
        .getState()
        .sceneObjects.filter((o) => o.owner === 'arm');
      if (owned.length === 0) return null;
      const o = owned[Math.floor(Math.random() * owned.length)];
      const half = objectHalfExtents(o);
      const cy = objectCenterY(o, half[1]);
      return {
        id: o.id,
        position: [o.position[0], cy, o.position[2]],
        halfExtents: half,
        meta: { id: o.id, type: 'primitive', kind: o.kind, label: o.label },
      };
    },
    []
  );

  const onRun = useCallback(async () => {
    if (!engine || useStore.getState().robotRunning) return;
    cancelRef.current = false;
    const s = useStore.getState();
    clearRobotSamples();
    setRobotRunning(true);
    setStatus('busy', `Robot run starting — ${s.robot.count} iterations…`);
    try {
      const result = await runRobotBatch({
        robot: s.robot,
        ei: s.ei,
        imuNoise: s.imuNoise,
        obstacles: robotObstacleAabbs(s.sceneObjects, s.robot.kind),
        armHome: [...homePoseRef.current] as BraccioJointVector,
        armTarget: pickArmTarget,
        captureImage: s.robot.objectDetection ? capturePovImage : undefined,
        onIterationStart: () => useStore.getState().clearRobotSamples(),
        onRoverTick: (tick: RoverTick) => {
          roverRigRef.current?.setPose(
            tick.pose.x,
            tick.pose.z,
            tick.pose.heading
          );
          roverRigRef.current?.setContact(tick.inContact);
          const store = useStore.getState();
          store.pushRobotImuSample(tick.imu);
          store.pushLidarSample(tick.lidar);
        },
        onArmTick: (tick: ArmTick) => {
          armRigRef.current?.setJoints(tick.joints);
          useStore.getState().pushRobotImuSample(tick.imu);
          // TODO: mirror tick.targetPos onto the picked scene object so
          // the pickup visually rides the gripper. Skipped for now —
          // updateObject writes hit the persist middleware at 20 Hz.
        },
        onProgress: (p: RobotRunProgress) =>
          setStatus('busy', `${p.message} · ${formatTally(p)}`),
        isCancelled: () => cancelRef.current,
        confirmRouting: (message: string) => window.confirm(message),
      });
      if (result.aborted) {
        setStatus('idle', 'Run cancelled');
      } else {
        if (result.zip) saveBlob(result.zip.blob, result.zip.name);
        const saved = result.zip ? ` · saved ${result.zip.name}` : '';
        setStatus(
          'ok',
          `${result.cancelled ? 'Run stopped — ' : 'Robot run complete — '}${formatTally(result)}${saved}`
        );
      }
    } catch (err) {
      setStatus('err', `Robot run failed: ${(err as Error).message}`);
    } finally {
      setRobotRunning(false);
      roverRigRef.current?.setPose(0, 0, 0);
      roverRigRef.current?.setContact(false);
      armRigRef.current?.setJoints(homePoseRef.current);
    }
  }, [
    engine,
    capturePovImage,
    pickArmTarget,
    clearRobotSamples,
    setRobotRunning,
    setStatus,
  ]);

  const onResetScene = useCallback(() => {
    const kind = useStore.getState().robot.kind;
    clearObjects(kind);
    clearRobotSamples();
    if (kind === 'arm') setArmHomePose([...BRACCIO_REST_RAD]);
    roverRigRef.current?.setPose(0, 0, 0);
    roverRigRef.current?.setContact(false);
    armRigRef.current?.setJoints(BRACCIO_REST_RAD);
    setStatus('idle', '');
  }, [clearObjects, clearRobotSamples, setStatus]);

  const disabled = robotRunning;
  const imagesPerIteration = robot.captureAtRest
    ? 1
    : robot.objectDetectionImagesPerIteration;
  const activeKind = ROBOT_KINDS.find((k) => k.value === robot.kind);
  const isArm = robot.kind === 'arm';
  const isPickPlace = robot.armTrajectory === 'pick_place';

  return (
    <>
      <CollapsibleCard heading="Robot" defaultOpen>
        <div className="robot-stack">
          <div className="robot-kind-grid">
            {ROBOT_KINDS.map((k) => (
              <button
                key={k.value}
                className={robot.kind === k.value ? 'primary' : ''}
                title={k.hint}
                disabled={disabled}
                onClick={() => setRobot({ kind: k.value })}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="robot-hint">{activeKind?.hint}</p>
          <div className="button-row" style={{ marginTop: 0 }}>
            <button
              type="button"
              disabled={disabled}
              title="Regenerate the obstacle field, clear the rover pose and any in-flight recording."
              onClick={onResetScene}
            >
              ↺ Reset scene
            </button>
          </div>
        </div>
      </CollapsibleCard>

      {robot.kind === 'rover' ? (
        <CollapsibleCard heading="Event" defaultOpen>
          <RadioPills
            options={ROVER_EVENT_OPTIONS}
            value={robot.roverEvent}
            onChange={(roverEvent) => setRobot({ roverEvent })}
            ariaLabel="Rover event"
            disabled={disabled}
          />
        </CollapsibleCard>
      ) : (
        <CollapsibleCard heading="Trajectory" defaultOpen>
          <RadioPills
            options={ARM_TRAJECTORY_OPTIONS}
            value={robot.armTrajectory}
            onChange={(armTrajectory) => setRobot({ armTrajectory })}
            ariaLabel="Arm trajectory"
            columns={3}
            disabled={disabled}
          />
        </CollapsibleCard>
      )}

      {isArm && (
        <ArmHomePoseCard
          pose={armHomePose}
          onChange={setArmHomePose}
          disabled={disabled}
        />
      )}

      {isArm && (
        <CollapsibleCard heading="POV camera mount">
          <RadioPills
            options={MOUNT_OPTIONS}
            value={robot.armCameraMount}
            onChange={(armCameraMount) => setRobot({ armCameraMount })}
            ariaLabel="Arm camera mount"
            columns={3}
            disabled={disabled}
          />
        </CollapsibleCard>
      )}

      {isArm && (
        <SceneObjectsCard
          title={isPickPlace ? 'Pickup objects' : 'Scene props'}
          ownerFilter="arm"
          addCustom={spawnArmPickup}
          sizeRange={{ min: 0.02, max: 0.2, step: 0.005 }}
          defaultLabel={isPickPlace ? 'pickup' : 'prop'}
          disabled={disabled}
          helpText={
            isPickPlace
              ? 'The runner picks one as the IK anchor each iteration. Drag to retarget.'
              : 'Scenery for the POV camera; only pick_place actually interacts with them.'
          }
          footer={
            isPickPlace ? (
              <div style={{ marginTop: 8 }}>
                <ToggleSwitch
                  title="Randomize pickup position"
                  help="Re-sample each pickup object to a fresh random position inside the Braccio's reach at the start of every iteration."
                  on={robot.armRandomizeTarget}
                  disabled={disabled}
                  onChange={(next) => {
                    setRobot({ armRandomizeTarget: next });
                    // Immediate visual feedback: hop the pickups to
                    // fresh spots right away instead of waiting for
                    // the next run iteration.
                    if (next) randomizeArmPickups();
                  }}
                />
              </div>
            ) : undefined
          }
        />
      )}

      {robot.kind === 'rover' && (
        <SceneObjectsCard
          title="Scene obstacles"
          ownerFilter="rover"
          addCustom={spawnRoverObstacle}
          sizeRange={{ min: 0.05, max: 1.5, step: 0.05 }}
          defaultLabel="obstacle"
          disabled={disabled}
          helpText="Add obstacles the rover can bump into. The lidar ring and contact detector see them all."
        />
      )}

      <CollapsibleCard heading="Recording">
        <div className="robot-stack">
          <div className="robot-row">
            <NumberField
              label="Count"
              value={robot.count}
              onChange={(count) => setRobot({ count })}
              min={1}
              max={200}
              step={1}
              disabled={disabled}
            />
            <NumberField
              label="Per-iteration ms"
              value={robot.durationMs}
              onChange={(durationMs) => setRobot({ durationMs })}
              min={500}
              max={15000}
              step={100}
              disabled={disabled}
            />
          </div>
          <p className={`robot-counter${robotRunning ? ' live' : ''}`}>
            {robotRunning
              ? robot.kind === 'rover'
                ? `Capturing… ${imuCount} IMU · ${lidarCount} lidar this window`
                : `Capturing… ${imuCount} IMU samples this window`
              : robot.kind === 'rover'
                ? '6-channel IMU + N-channel lidar per sample.'
                : '6-channel end-effector IMU per sample.'}
          </p>
          <ImuNoiseToggle />
        </div>
      </CollapsibleCard>

      {robot.kind === 'rover' && (
        <>
          <CollapsibleCard heading="Lidar / ToF ring">
            <div className="robot-stack">
              <SliderRow
                label="Beams"
                value={robot.lidarBins}
                min={4}
                max={64}
                step={1}
                formatValue={(v) => v.toFixed(0)}
                onChange={(lidarBins) => setRobot({ lidarBins })}
                disabled={disabled}
              />
              <SliderRow
                label="Max range"
                value={robot.lidarMaxRange}
                min={1}
                max={20}
                step={0.5}
                formatValue={(v) => `${v.toFixed(1)} m`}
                hint="Out-of-range returns clamp to max — same semantics as a real ToF sensor reporting no return."
                onChange={(lidarMaxRange) => setRobot({ lidarMaxRange })}
                disabled={disabled}
              />
            </div>
          </CollapsibleCard>
          <CollapsibleCard heading="Sensor modality">
            <RadioPills
              options={MODALITY_OPTIONS}
              value={robot.uploadModality}
              onChange={(uploadModality) => setRobot({ uploadModality })}
              ariaLabel="Upload modality"
              disabled={disabled}
            />
          </CollapsibleCard>
        </>
      )}

      <section className="card">
        <ToggleSwitch
          title="Object detection"
          titleAs="h3"
          help={
            robot.objectDetection
              ? `Snap ${imagesPerIteration} POV-camera image${
                  imagesPerIteration === 1 ? '' : 's'
                } per iteration with 2D bounding boxes. EI accepts only one data type per project — the runner probes the project and routes the other to a local zip.`
              : undefined
          }
          on={robot.objectDetection}
          disabled={disabled}
          onChange={(objectDetection) => setRobot({ objectDetection })}
        />
        {robot.objectDetection && (
          <div className="robot-stack" style={{ marginTop: 10 }}>
            <ToggleSwitch
              title="Capture at rest"
              help="Snap before motion begins instead of mid-motion. Same one image per iteration."
              on={robot.captureAtRest}
              disabled={disabled}
              onChange={(captureAtRest) => setRobot({ captureAtRest })}
            />
            {!robot.captureAtRest && (
              <NumberField
                label="Images per iteration"
                value={robot.objectDetectionImagesPerIteration}
                onChange={(n) =>
                  setRobot({ objectDetectionImagesPerIteration: n })
                }
                min={1}
                max={20}
                step={1}
                disabled={disabled}
                title="Shots are spaced evenly across the window so none land at t=0 or t=duration."
              />
            )}
            <div className="robot-row">
              <NumberField
                label="Image width"
                value={robot.objectDetectionWidth}
                onChange={(objectDetectionWidth) =>
                  setRobot({ objectDetectionWidth })
                }
                min={128}
                max={1920}
                step={32}
                disabled={disabled}
              />
              <NumberField
                label="Image height"
                value={robot.objectDetectionHeight}
                onChange={(objectDetectionHeight) =>
                  setRobot({ objectDetectionHeight })
                }
                min={128}
                max={1920}
                step={32}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </section>

      {/* Realism only touches image captures, so it's gated on object
          detection — sensor-only runs have no pixels for it to modify. */}
      {robot.objectDetection && <RealismCard />}

      <EiAuthCard showHmac />

      {robot.objectDetection && <EiInferenceCard previewSource="robot-pov" />}

      <CollapsibleCard heading="Generate" defaultOpen>
        <div className="robot-stack">
          <p className="robot-hint">
            {robot.kind === 'rover' ? (
              <>
                Each iteration drives the rover through one{' '}
                <strong>{robot.roverEvent}</strong> event and records the IMU +
                lidar window.
              </>
            ) : (
              <>
                Each iteration runs one{' '}
                <strong>{robot.armTrajectory.replace(/_/g, ' ')}</strong> motion
                and records the end-effector IMU.
              </>
            )}
            {robot.objectDetection && (
              <>
                {' '}
                Plus <strong>{imagesPerIteration}</strong> POV image
                {imagesPerIteration === 1 ? '' : 's'} per iteration (
                {robot.captureAtRest ? 'at rest' : 'mid-motion'}) with 2D
                bounding boxes.
              </>
            )}
          </p>
          <ToggleSwitch
            title="ROS 2 export"
            help={
              robot.kind === 'rover'
                ? 'Also write each window as ROS 2 sensor-message JSONL (sensor_msgs/Imu + LaserScan). Bundles into the download zip alongside the EI payload.'
                : 'Also write each window as ROS 2 sensor-message JSONL — end-effector sensor_msgs/Imu + per-tick sensor_msgs/JointState. Bundles into the download zip alongside the EI payload.'
            }
            on={robot.rosExport}
            disabled={disabled}
            onChange={(rosExport) => setRobot({ rosExport })}
          />
          {robotRunning ? (
            <button
              className="danger"
              onClick={() => {
                cancelRef.current = true;
              }}
            >
              ■ Stop
            </button>
          ) : (
            <button
              className="primary"
              disabled={!engine || status.kind === 'busy'}
              onClick={() => void onRun()}
            >
              {`⚡ Generate & ${hasApiKey ? 'upload' : 'download'} ${robot.count} samples`}
            </button>
          )}
        </div>
      </CollapsibleCard>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-components.                                                     *
 * ------------------------------------------------------------------ */

/** Shared "Realistic IMU noise" switch (same store slice motion mode
 * uses, inlined here — swap for the motion panel's export if it grows
 * one). */
function ImuNoiseToggle() {
  const enabled = useStore((s) => s.imuNoise.enabled);
  const setImuNoise = useStore((s) => s.setImuNoise);
  return (
    <ToggleSwitch
      title="Realistic IMU noise"
      help="On: LSM6DSO-style bias drift, scale-factor error, quantization, and range clipping. Off: clean simulated sensor output."
      on={enabled}
      onChange={(next) => setImuNoise({ enabled: next })}
    />
  );
}

const JOINT_LABELS = [
  'M1 base',
  'M2 shoulder',
  'M3 elbow',
  'M4 wrist pitch',
  'M5 wrist roll',
];

/**
 * Per-joint home-pose editor. Joints 0–4 edit in degrees (how Braccio
 * Arduino sketches express servo angles), each slider clamped to the
 * published limit from `BRACCIO_LIMITS_RAD`; M6 shows as a normalized
 * 0–100 % aperture. Collapsed by default with a "custom" badge when
 * any joint is off the spec rest pose. `storageKey=""` deliberately
 * opts out of open-state persistence (per the original's hand-rolled
 * local collapsible).
 */
function ArmHomePoseCard({
  pose,
  onChange,
  disabled,
}: {
  pose: BraccioJointVector;
  onChange: (next: BraccioJointVector) => void;
  disabled: boolean;
}) {
  const isCustom = pose.some(
    (v, i) => Math.abs(v - BRACCIO_REST_RAD[i]) > 0.01
  );

  const setJoint = (idx: number, value: number) => {
    const next = [...pose] as BraccioJointVector;
    next[idx] = value;
    onChange(next);
  };

  return (
    <CollapsibleCard
      heading="Arm home pose"
      storageKey=""
      badge={isCustom ? 'custom' : undefined}
    >
      <div className="robot-stack">
        <p className="robot-hint">
          Servo angles the arm holds at idle and starts every trajectory
          from. Each slider is clamped to the published Braccio limit.
        </p>
        {JOINT_LABELS.map((label, i) => {
          const [loRad, hiRad] = BRACCIO_LIMITS_RAD[i];
          const lo = radToDeg(loRad);
          const hi = radToDeg(hiRad);
          return (
            <SliderRow
              key={label}
              label={`${label} (${lo.toFixed(0)}–${hi.toFixed(0)}°)`}
              value={radToDeg(pose[i])}
              min={lo}
              max={hi}
              step={1}
              formatValue={(v) => `${v.toFixed(0)}°`}
              onChange={(deg) => setJoint(i, degToRad(deg))}
              disabled={disabled}
            />
          );
        })}
        <SliderRow
          label="M6 gripper (0 = closed, 100 = open)"
          value={pose[5]}
          min={0}
          max={1}
          step={0.01}
          formatValue={(v) => `${(v * 100).toFixed(0)} %`}
          onChange={(v) => setJoint(5, v)}
          disabled={disabled}
        />
        <div className="button-row" style={{ marginTop: 0 }}>
          <button
            type="button"
            disabled={disabled}
            title="Reset every joint to the default Braccio home pose."
            onClick={() => onChange([...BRACCIO_REST_RAD])}
          >
            ↺ Reset to home
          </button>
        </div>
      </div>
    </CollapsibleCard>
  );
}
