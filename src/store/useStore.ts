import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * localStorage with trailing-edge throttled writes. zustand's persist
 * middleware fires on EVERY set(), and recording pushes samples at up to
 * 500 Hz — synchronous setItem at that rate starves the sampler on slow
 * machines. The last pending value always lands within `delayMs`.
 */
function throttledLocalStorage(delayMs: number): Storage {
  let pending: { key: string; value: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (pending) localStorage.setItem(pending.key, pending.value);
    pending = null;
  };
  return {
    getItem: (k: string) => localStorage.getItem(k),
    removeItem: (k: string) => {
      pending = null;
      localStorage.removeItem(k);
    },
    setItem: (key: string, value: string) => {
      pending = { key, value };
      if (timer === null) timer = setTimeout(flush, delayMs);
    },
  } as Storage;
}
import { BRACCIO_REST_RAD } from '../lib/braccio';
import type { SplatEntry } from '../engine/splats/SplatManager';
import type { SkyboxPreset } from '../engine/SkyboxManager';
import type { ModelEntry } from '../engine/ModelManager';
import type {
  AccelSample,
  BoundingBox,
  CameraTrajectory,
  Capture,
  EiCategory,
  LidarSample,
  RoverEvent,
} from '../lib/types';

export type Theme = 'dark' | 'light';
export type EngineStatus = 'booting' | 'ready' | 'error';
export type Mode = 'detection' | 'anomaly' | 'motion' | 'robot';

/** Primitive kinds spawnable into the scene (same set as the original). */
export type ObjectKind =
  | 'cube'
  | 'sphere'
  | 'cylinder'
  | 'torus'
  | 'capsule'
  | 'phone'
  | 'soda_can';

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  label: string;
  position: [number, number, number];
  /** Yaw around Y in radians. */
  rotation: number;
  scale: number;
  color: string;
  metalness: number;
  roughness: number;
  physics: boolean;
  owner?: 'rover' | 'arm';
}

export interface CaptureSettings {
  width: number;
  height: number;
  camPos: [number, number, number];
  camTarget: [number, number, number];
  fov: number;
  randomizeCamera: boolean;
  randomizeLighting: boolean;
  randomizeObjects: boolean;
  batchCount: number;
  lightIntensity: number;
  envRotation: number;
  cameraTrajectory: CameraTrajectory;
  trajectoryRadius: number;
  trajectoryHeight: number;
  /** Pin the capture camera onto the trajectory path. */
  lockToTrajectory: boolean;
  /** Where along the path the locked camera sits (0..1). */
  trajectoryPhase: number;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  width: 640,
  height: 480,
  camPos: [3.5, 3, 3.5],
  camTarget: [0, 0.5, 0],
  fov: 45,
  randomizeCamera: true,
  randomizeLighting: true,
  randomizeObjects: false,
  batchCount: 10,
  lightIntensity: 1.1,
  envRotation: 0,
  cameraTrajectory: 'random',
  trajectoryRadius: 4,
  trajectoryHeight: 2,
  lockToTrajectory: false,
  trajectoryPhase: 0,
};

export type RealismMode = 'off' | 'random' | 'diffusion';

export interface RealismSettings {
  mode: RealismMode;
  grain: number;
  chromatic: number;
  vignette: number;
  jitter: number;
  jpeg: number;
  randomize: boolean;
}

export const DEFAULT_REALISM: RealismSettings = {
  mode: 'off',
  grain: 0.5,
  chromatic: 0.5,
  vignette: 0.3,
  jitter: 0.5,
  jpeg: 0.5,
  randomize: false,
};

export interface EdgeImpulseConfig {
  apiKey: string;
  hmacKey: string;
  category: EiCategory;
  label: string;
  device: string;
}

export interface ImuNoiseSettings {
  enabled: boolean;
  accelRange: number;
  gyroRange: number;
  accelNoiseDensity: number;
  gyroNoiseDensity: number;
  accelBiasInstability: number;
  gyroBiasInstability: number;
  scaleFactorError: number;
  adcBits: number;
}

/** LSM6DSO-style defaults, matching the original app. */
export const DEFAULT_IMU_NOISE: ImuNoiseSettings = {
  enabled: true,
  accelRange: 39.24,
  gyroRange: 34.9,
  accelNoiseDensity: 5.9e-4,
  gyroNoiseDensity: 1.2e-4,
  accelBiasInstability: 1e-4,
  gyroBiasInstability: 5e-6,
  scaleFactorError: 0.005,
  adcBits: 16,
};

export type MotionClass = 'drop' | 'throw' | 'push' | 'shake';

export interface DropSettings {
  count: number;
  heightMin: number;
  heightMax: number;
  durationMs: number;
  motion: MotionClass;
  throwSpeed: number;
  pushSpeed: number;
  shakeFreq: number;
  shakeAmp: number;
}

export const DEFAULT_DROPS: DropSettings = {
  count: 10,
  heightMin: 1.0,
  heightMax: 2.5,
  durationMs: 1500,
  motion: 'drop',
  throwSpeed: 4,
  pushSpeed: 3,
  shakeFreq: 4.5,
  shakeAmp: 0.2,
};

export type ArmTrajectoryKind =
  | 'pick_place'
  | 'sweep'
  | 'wave'
  | 'random_pose'
  | 'draw_circle';
export type RobotKind = 'rover' | 'arm';
export type UploadModality = 'fused' | 'imu' | 'lidar';

export interface RobotSettings {
  kind: RobotKind;
  roverEvent: RoverEvent;
  armTrajectory: ArmTrajectoryKind;
  count: number;
  durationMs: number;
  lidarBins: number;
  lidarMaxRange: number;
  uploadModality: UploadModality;
  rosExport: boolean;
  armCameraMount: 'base' | 'shoulder' | 'elbow' | 'wrist' | 'gripper';
  armRandomizeTarget: boolean;
  objectDetection: boolean;
  captureAtRest: boolean;
  objectDetectionWidth: number;
  objectDetectionHeight: number;
  objectDetectionImagesPerIteration: number;
  /** Braccio idle/home pose (servo-radians ×5 + gripper aperture 0..1).
   * Optional: persisted snapshots from before this field existed lack
   * it — consumers fall back to BRACCIO_REST_RAD. */
  armHomePose?: [number, number, number, number, number, number];
}

export const DEFAULT_ROBOT: RobotSettings = {
  kind: 'rover',
  roverEvent: 'cruise',
  armTrajectory: 'pick_place',
  count: 10,
  durationMs: 3000,
  lidarBins: 16,
  lidarMaxRange: 6,
  uploadModality: 'fused',
  rosExport: false,
  armCameraMount: 'wrist',
  armRandomizeTarget: false,
  objectDetection: false,
  captureAtRest: false,
  objectDetectionWidth: 640,
  objectDetectionHeight: 480,
  objectDetectionImagesPerIteration: 1,
  armHomePose: [...BRACCIO_REST_RAD],
};

export interface StatusState {
  kind: 'idle' | 'busy' | 'ok' | 'err';
  msg: string;
}

/** Reload-persisted asset metadata; blobs live in IndexedDB (assetStore). */
export interface PendingAsset {
  id: string;
  name: string;
  /** Filename with the extension the importer needs (e.g. scan.sog). */
  filename: string;
  label: string;
  /** Splats only. */
  role?: 'backdrop' | 'object';
  position: [number, number, number];
  eulerAngles: [number, number, number];
  scale: [number, number, number];
  /** false when hidden (e.g. a mesh replaced by its splat conversion). */
  enabled?: boolean;
  /** Models only: material/color override ("use if it's pink"). */
  override?: {
    enabled: boolean;
    color: string;
    roughness: number;
    metalness: number;
  };
}

interface StudioState {
  // Shell
  theme: Theme;
  mode: Mode;
  engineStatus: EngineStatus;
  engineError: string | null;
  status: StatusState;
  busyMessage: string | null;
  cardOpen: Record<string, boolean>;

  // Asset mirrors (live objects owned by the engine managers)
  splats: SplatEntry[];
  models: ModelEntry[];
  // Reload persistence metadata (blobs in IndexedDB)
  pendingSplats: PendingAsset[];
  pendingModels: PendingAsset[];

  // Scene
  sceneObjects: SceneObject[];
  selectedIds: string[];

  /** Procedural sky panorama behind splat scans / open scenes. */
  skybox: SkyboxPreset;
  /** Width of the virtual-camera / POV preview overlay, CSS px. */
  pipWidth: number;

  // Vision capture
  capture: CaptureSettings;
  captures: Capture[];
  anomalyLabel: string;
  realism: RealismSettings;

  // Edge Impulse
  ei: EdgeImpulseConfig;
  eiThreshold: number;
  eiLive: boolean;

  // Motion
  sampleRateHz: number;
  isRecording: boolean;
  samples: AccelSample[];
  imuNoise: ImuNoiseSettings;
  drops: DropSettings;
  dropsRunning: boolean;

  // Robot
  robot: RobotSettings;
  robotRunning: boolean;
  robotCaptures: number;
  lidarSamples: LidarSample[];
  robotImuSamples: AccelSample[];

  // Actions
  setTheme(theme: Theme): void;
  setMode(mode: Mode): void;
  setEngineStatus(status: EngineStatus, error?: string): void;
  setStatus(kind: StatusState['kind'], msg: string): void;
  setBusy(message: string | null): void;
  setCardOpen(key: string, open: boolean): void;
  setSkybox(preset: SkyboxPreset): void;
  setPipWidth(width: number): void;
  setSplats(entries: SplatEntry[]): void;
  setModels(entries: ModelEntry[]): void;
  setPendingSplats(entries: PendingAsset[]): void;
  setPendingModels(entries: PendingAsset[]): void;

  addObject(obj: Omit<SceneObject, 'id'>): string;
  updateObject(id: string, patch: Partial<SceneObject>): void;
  removeObject(id: string): void;
  clearObjects(owner?: SceneObject['owner'] | 'vision'): void;
  setSelectedIds(ids: string[]): void;

  setCapture(patch: Partial<CaptureSettings>): void;
  resetCapture(): void;
  addCapture(capture: Capture): void;
  clearCaptures(): void;
  setAnomalyLabel(label: string): void;
  setRealism(patch: Partial<RealismSettings>): void;

  setEi(patch: Partial<EdgeImpulseConfig>): void;
  setEiThreshold(value: number): void;
  setEiLive(live: boolean): void;

  setSampleRateHz(hz: number): void;
  setRecording(recording: boolean): void;
  pushSample(sample: AccelSample): void;
  clearSamples(): void;
  setImuNoise(patch: Partial<ImuNoiseSettings>): void;
  setDrops(patch: Partial<DropSettings>): void;
  setDropsRunning(running: boolean): void;

  setRobot(patch: Partial<RobotSettings>): void;
  setRobotRunning(running: boolean): void;
  bumpRobotCaptures(): void;
  resetRobotCaptures(): void;
  pushLidarSample(sample: LidarSample): void;
  pushRobotImuSample(sample: AccelSample): void;
  clearRobotSamples(): void;
}

const OBJECT_COLORS = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#f472b6'];

/** Default material + spawn conventions carried over from the original. */
export function defaultObject(
  kind: ObjectKind,
  label: string,
  index: number
): Omit<SceneObject, 'id'> {
  const sodaCan = kind === 'soda_can';
  return {
    kind,
    label: label || kind,
    // Two columns at x = ±0.4 keep spawns within the belt's inner rails.
    position: [(index % 2) * 0.8 - 0.4, 1.2, Math.floor(index / 2) * -0.9],
    rotation: Math.random() * Math.PI * 2,
    scale: 1,
    color: sodaCan ? '#dc2626' : OBJECT_COLORS[index % OBJECT_COLORS.length],
    metalness: sodaCan ? 0.85 : 0.2,
    roughness: sodaCan ? 0.25 : 0.5,
    physics: true,
  };
}

export const useStore = create<StudioState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      mode: 'detection',
      engineStatus: 'booting',
      engineError: null,
      status: { kind: 'idle', msg: '' },
      busyMessage: null,
      cardOpen: {},
      skybox: 'none',
      pipWidth: 240,

      splats: [],
      models: [],
      pendingSplats: [],
      pendingModels: [],

      sceneObjects: [],
      selectedIds: [],

      capture: { ...DEFAULT_CAPTURE_SETTINGS },
      captures: [],
      anomalyLabel: 'normal',
      realism: { ...DEFAULT_REALISM },

      ei: {
        apiKey: '',
        hmacKey: '',
        category: 'training',
        label: 'idle',
        device: 'synthetic-hand-3d',
      },
      eiThreshold: 0.5,
      eiLive: false,

      sampleRateHz: 100,
      isRecording: false,
      samples: [],
      imuNoise: { ...DEFAULT_IMU_NOISE },
      drops: { ...DEFAULT_DROPS },
      dropsRunning: false,

      robot: { ...DEFAULT_ROBOT },
      robotRunning: false,
      robotCaptures: 0,
      lidarSamples: [],
      robotImuSamples: [],

      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      setEngineStatus: (engineStatus, error) =>
        set({ engineStatus, engineError: error ?? null }),
      setStatus: (kind, msg) => set({ status: { kind, msg } }),
      setBusy: (busyMessage) => set({ busyMessage }),
      setCardOpen: (key, open) =>
        set((s) => ({ cardOpen: { ...s.cardOpen, [key]: open } })),
      setSkybox: (skybox) => set({ skybox }),
      setPipWidth: (pipWidth) =>
        set({ pipWidth: Math.min(640, Math.max(140, Math.round(pipWidth))) }),
      setSplats: (splats) => set({ splats }),
      setModels: (models) => set({ models }),
      setPendingSplats: (pendingSplats) => set({ pendingSplats }),
      setPendingModels: (pendingModels) => set({ pendingModels }),

      addObject: (obj) => {
        const id = crypto.randomUUID();
        set((s) => ({ sceneObjects: [...s.sceneObjects, { ...obj, id }] }));
        return id;
      },
      updateObject: (id, patch) =>
        set((s) => ({
          sceneObjects: s.sceneObjects.map((o) =>
            o.id === id ? { ...o, ...patch } : o
          ),
        })),
      removeObject: (id) =>
        set((s) => ({
          sceneObjects: s.sceneObjects.filter((o) => o.id !== id),
          selectedIds: s.selectedIds.filter((sid) => sid !== id),
        })),
      clearObjects: (owner) =>
        set((s) => ({
          sceneObjects:
            owner === undefined
              ? []
              : s.sceneObjects.filter((o) =>
                  owner === 'vision' ? o.owner != null : o.owner !== owner
                ),
        })),
      setSelectedIds: (selectedIds) => set({ selectedIds }),

      setCapture: (patch) => set((s) => ({ capture: { ...s.capture, ...patch } })),
      resetCapture: () => set({ capture: { ...DEFAULT_CAPTURE_SETTINGS } }),
      addCapture: (capture) => set((s) => ({ captures: [...s.captures, capture] })),
      clearCaptures: () => set({ captures: [] }),
      setAnomalyLabel: (anomalyLabel) => set({ anomalyLabel }),
      setRealism: (patch) => set((s) => ({ realism: { ...s.realism, ...patch } })),

      setEi: (patch) => set((s) => ({ ei: { ...s.ei, ...patch } })),
      setEiThreshold: (eiThreshold) => set({ eiThreshold }),
      setEiLive: (eiLive) => set({ eiLive }),

      setSampleRateHz: (sampleRateHz) => set({ sampleRateHz }),
      setRecording: (isRecording) => set({ isRecording }),
      pushSample: (sample) => {
        if (get().isRecording) set((s) => ({ samples: [...s.samples, sample] }));
      },
      clearSamples: () => set({ samples: [] }),
      setImuNoise: (patch) => set((s) => ({ imuNoise: { ...s.imuNoise, ...patch } })),
      setDrops: (patch) => set((s) => ({ drops: { ...s.drops, ...patch } })),
      setDropsRunning: (dropsRunning) => set({ dropsRunning }),

      setRobot: (patch) => set((s) => ({ robot: { ...s.robot, ...patch } })),
      setRobotRunning: (robotRunning) => set({ robotRunning }),
      bumpRobotCaptures: () => set((s) => ({ robotCaptures: s.robotCaptures + 1 })),
      resetRobotCaptures: () => set({ robotCaptures: 0 }),
      pushLidarSample: (sample) =>
        set((s) => ({ lidarSamples: [...s.lidarSamples, sample] })),
      pushRobotImuSample: (sample) =>
        set((s) => ({ robotImuSamples: [...s.robotImuSamples, sample] })),
      clearRobotSamples: () => set({ lidarSamples: [], robotImuSamples: [] }),
    }),
    {
      name: 'sds-pc-store',
      version: 1,
      storage: createJSONStorage(() => throttledLocalStorage(500)),
      partialize: (s) => ({
        theme: s.theme,
        mode: s.mode,
        skybox: s.skybox,
        pipWidth: s.pipWidth,
        cardOpen: s.cardOpen,
        sceneObjects: s.sceneObjects,
        capture: s.capture,
        anomalyLabel: s.anomalyLabel,
        realism: s.realism,
        eiThreshold: s.eiThreshold,
        sampleRateHz: s.sampleRateHz,
        imuNoise: s.imuNoise,
        drops: s.drops,
        robot: s.robot,
        pendingSplats: s.pendingSplats,
        pendingModels: s.pendingModels,
        // ei (API keys) deliberately NOT persisted.
      }),
    }
  )
);

export type { BoundingBox };

// Dev console handle — guarantees probes hit the page's live instance
// even when HMR forks module URLs.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __useStore?: typeof useStore }).__useStore = useStore;
}
