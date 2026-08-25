import { useEffect, useRef, useState } from 'react';
import { Color } from 'playcanvas';
import { useEngine } from '../engine/EngineContext';
import { useStore, type CaptureSettings } from '../store/useStore';
import { SKYBOX_PRESETS, type SkyboxPreset } from '../engine/SkyboxManager';
import type { CameraTrajectory } from '../lib/types';
import { sampleCameraTrajectory } from '../lib/cameraTrajectory';
import { captureSingle, runBatch } from '../modes/visionRunner';
import {
  CollapsibleCard,
  NumberField,
  SliderRow,
  ToggleSwitch,
} from './primitives';
import { SceneObjectsCard } from './SceneObjectsCard';
import { RealismCard } from './RealismCard';
import { EiAuthCard } from './EiAuthCard';
import { EiInferenceCard } from './EiInferenceCard';
import { EiUploadCard } from './EiUploadCard';
import { PIP_WIDTH, pipHeight } from './useCaptureCameraSync';
import './vision.css';

/**
 * Sidebar panel shared by the detection and anomaly modes: Scene,
 * Objects, Virtual camera, Realism, Capture, then the Edge Impulse
 * cards. The engine mirrors store state (scene objects via the shell's
 * subscription, capture camera via useCaptureCameraSync) — this panel
 * only reads/writes the store plus a few direct environment setters.
 */
export function VisionPanel() {
  return (
    <>
      <SceneCard />
      <SceneObjectsCard ownerFilter="vision" />
      <VirtualCameraCard />
      <RealismCard />
      <CaptureCard />
      <EiAuthCard />
      <EiInferenceCard previewSource="virtual-camera" />
      <EiUploadCard />
      <VirtualCameraFrame />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/** Hex of the engine's default ground diffuse (0.42, 0.43, 0.45). */
const DEFAULT_GROUND_COLOR = '#6b6e73';

function SceneCard() {
  const engine = useEngine();
  const lightIntensity = useStore((s) => s.capture.lightIntensity);
  const setCapture = useStore((s) => s.setCapture);

  // Environment knobs are engine-side (not persisted): the procedural
  // ground + light rig is a viewing aid, not captured dataset state.
  const [groundVisible, setGroundVisible] = useState(true);
  const [groundColor, setGroundColor] = useState(DEFAULT_GROUND_COLOR);
  const skybox = useStore((s) => s.skybox);
  const setSkybox = useStore((s) => s.setSkybox);
  const [lightPitch, setLightPitch] = useState(50);
  const [lightYaw, setLightYaw] = useState(30);

  // Effects (not onChange handlers) so a late-booting engine picks up
  // the current UI state as soon as it's ready.
  useEffect(() => {
    engine?.environment.setGroundVisible(groundVisible);
  }, [engine, groundVisible]);
  useEffect(() => {
    engine?.environment.setGroundColor(new Color().fromString(groundColor));
  }, [engine, groundColor]);
  useEffect(() => {
    engine?.environment.setLightAngles(lightPitch, lightYaw);
  }, [engine, lightPitch, lightYaw]);

  return (
    <CollapsibleCard heading="Scene" defaultOpen>
      <div className="vision-stack">
        <label className="vision-row">
          <span className="vision-help">Sky</span>
          <select
            value={skybox}
            onChange={(e) => setSkybox(e.target.value as SkyboxPreset)}
            aria-label="Skybox preset"
          >
            {SKYBOX_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <ToggleSwitch
          title="Ground plane"
          help={
            groundVisible
              ? 'Procedural ground catches shadows and dropped objects.'
              : 'Hidden — use when a splat backdrop provides its own ground.'
          }
          on={groundVisible}
          onChange={setGroundVisible}
        />
        {groundVisible && (
          <div className="vision-row">
            <input
              type="color"
              className="vision-color flex-none"
              value={groundColor}
              onChange={(e) => setGroundColor(e.target.value)}
              title={`Ground color: ${groundColor}`}
              aria-label="Ground color"
            />
            <span className="vision-help">Ground color</span>
          </div>
        )}
        <SliderRow
          label="Key light"
          value={lightIntensity}
          min={0.2}
          max={2.5}
          step={0.05}
          hint="Key light intensity. Shared with the Virtual camera card; jittered per shot when batch Lighting randomization is on."
          onChange={(v) => {
            setCapture({ lightIntensity: v });
            engine?.environment.setLightIntensity(v);
          }}
        />
        <SliderRow
          label="Light pitch"
          value={lightPitch}
          min={5}
          max={85}
          step={1}
          formatValue={(v) => `${v.toFixed(0)}°`}
          hint="Key light elevation angle."
          onChange={setLightPitch}
        />
        <SliderRow
          label="Light yaw"
          value={lightYaw}
          min={-180}
          max={180}
          step={1}
          formatValue={(v) => `${v.toFixed(0)}°`}
          hint="Key light heading angle."
          onChange={setLightYaw}
        />
        <p className="vision-note">
          Environment presets (warehouse, outdoor) and the conveyor belt are
          tracked in TODO.md. In this edition, splat backdrops are the
          environment story — import a scan in the{' '}
          <strong>Gaussian Splats</strong> card and set its role to{' '}
          <em>backdrop</em>.
        </p>
      </div>
    </CollapsibleCard>
  );
}

/* ------------------------------------------------------------------ */
/* Virtual camera                                                      */
/* ------------------------------------------------------------------ */

const AXES = ['X', 'Y', 'Z'] as const;

function VirtualCameraCard() {
  const engine = useEngine();
  const capture = useStore((s) => s.capture);
  const setCapture = useStore((s) => s.setCapture);

  const useCurrentView = () => {
    if (!engine) return;
    const p = engine.viewCamera.getPosition();
    const f = engine.viewCamera.forward;
    // Aim at a point a few meters along the view direction.
    const d = 3;
    setCapture({
      camPos: [round1(p.x), round1(p.y), round1(p.z)],
      camTarget: [round1(p.x + f.x * d), round1(p.y + f.y * d), round1(p.z + f.z * d)],
    });
  };

  return (
    <CollapsibleCard heading="Virtual camera">
      <div className="vision-stack">
        <div className="button-row">
          <button
            className="primary"
            disabled={!engine}
            title="Snap the capture camera to what you're looking at right now"
            onClick={useCurrentView}
          >
            🎯 Use current view
          </button>
          <button
            disabled={!engine}
            title="Aim the capture camera back at the scene origin"
            onClick={() => setCapture({ camTarget: [0, 0.5, 0] })}
          >
            Aim at origin
          </button>
        </div>
        <p className="vision-help">
          The orange frustum in the viewport is this camera; pink cross =
          its target; teal path = the batch trajectory.
        </p>
        <div className="vision-row">
          <NumberField
            label="Width"
            value={capture.width}
            min={64}
            max={4096}
            step={32}
            onChange={(n) => setCapture({ width: n })}
          />
          <NumberField
            label="Height"
            value={capture.height}
            min={64}
            max={4096}
            step={32}
            onChange={(n) => setCapture({ height: n })}
          />
        </div>
        <SliderRow
          label="FOV"
          value={capture.fov}
          min={20}
          max={90}
          step={1}
          formatValue={(v) => `${v.toFixed(0)}°`}
          onChange={(v) => setCapture({ fov: v })}
        />
        <SliderRow
          label="Light intensity"
          value={capture.lightIntensity}
          min={0.2}
          max={2.5}
          step={0.05}
          onChange={(v) => {
            setCapture({ lightIntensity: v });
            engine?.environment.setLightIntensity(v);
          }}
        />
        <div className="vision-field">
          Cam X / Y / Z
          <div className="vision-row">
            {AXES.map((axis, i) => (
              <NumberField
                key={axis}
                value={capture.camPos[i]}
                step={0.1}
                aria-label={`Camera ${axis}`}
                onChange={(n) => {
                  const next = [...capture.camPos] as [number, number, number];
                  next[i] = n;
                  setCapture({ camPos: next });
                }}
              />
            ))}
          </div>
        </div>
        <div className="vision-field">
          Target X / Y / Z
          <div className="vision-row">
            {AXES.map((axis, i) => (
              <NumberField
                key={axis}
                value={capture.camTarget[i]}
                step={0.1}
                aria-label={`Camera target ${axis}`}
                onChange={(n) => {
                  const next = [...capture.camTarget] as [number, number, number];
                  next[i] = n;
                  setCapture({ camTarget: next });
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

const TRAJECTORY_OPTIONS: { value: CameraTrajectory; label: string }[] = [
  { value: 'random', label: 'Random (jitter base pose)' },
  { value: 'circle', label: 'Circular fly-around' },
  { value: 'figure8', label: 'Figure-eight' },
  { value: 'arc', label: 'Front arc (180°)' },
  { value: 'spiral', label: 'Ascending spiral' },
  { value: 'orbit_dome', label: 'Orbit dome (hemisphere)' },
];

function CaptureCard() {
  const engine = useEngine();
  const mode = useStore((s) => s.mode);
  const capture = useStore((s) => s.capture);
  const setCapture = useStore((s) => s.setCapture);
  const captures = useStore((s) => s.captures);
  const clearCaptures = useStore((s) => s.clearCaptures);
  const anomalyLabel = useStore((s) => s.anomalyLabel);
  const setAnomalyLabel = useStore((s) => s.setAnomalyLabel);
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);

  const cancelRef = useRef(false);
  const [running, setRunning] = useState(false);
  const busy = status.kind === 'busy';

  /** First sample of a deterministic path (frames the first batch shot). */
  const pathStart = (
    trajectory: CameraTrajectory,
    radius: number,
    height: number
  ): [number, number, number] =>
    sampleCameraTrajectory({
      trajectory,
      index: 0,
      total: Math.max(1, capture.batchCount),
      target: capture.camTarget,
      radius,
      height,
    });

  const snap = (patch: Partial<CaptureSettings>) => {
    const trajectory = patch.cameraTrajectory ?? capture.cameraTrajectory;
    setCapture({
      ...patch,
      camPos: pathStart(
        trajectory,
        patch.trajectoryRadius ?? capture.trajectoryRadius,
        patch.trajectoryHeight ?? capture.trajectoryHeight
      ),
    });
  };

  const onCapture = async () => {
    if (!engine) return;
    setStatus('busy', 'Capturing frame…');
    try {
      const c = await captureSingle(engine);
      setStatus('ok', `Captured ${c.filename}`);
    } catch (e) {
      setStatus('err', `Capture failed: ${(e as Error).message}`);
    }
  };

  const onBatch = async () => {
    if (!engine) return;
    cancelRef.current = false;
    setRunning(true);
    const total = capture.batchCount;
    setStatus('busy', `Capturing 0/${total}…`);
    try {
      const captured = await runBatch(
        engine,
        (p) => setStatus('busy', `Capturing ${p.done}/${p.total}…`),
        () => cancelRef.current
      );
      setStatus(
        'ok',
        cancelRef.current
          ? `Batch stopped — kept ${captured.length}/${total} captures`
          : `Captured ${captured.length} images`
      );
    } catch (e) {
      setStatus('err', `Batch failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const randomizeChips: {
    key: 'randomizeCamera' | 'randomizeLighting' | 'randomizeObjects';
    label: string;
    hint: string;
    disabled?: boolean;
  }[] = [
    {
      key: 'randomizeCamera',
      label: 'Camera',
      hint: 'Jitter the camera around its base pose per shot. Only applies on the Random path — deterministic paths place the camera exactly.',
      disabled: capture.cameraTrajectory !== 'random',
    },
    {
      key: 'randomizeLighting',
      label: 'Lighting',
      hint: 'Jitter the key light intensity per shot.',
    },
    {
      key: 'randomizeObjects',
      label: 'Objects',
      hint: 'Nudge spawned object positions and yaw per shot (restored after the batch).',
    },
  ];

  return (
    <CollapsibleCard heading="Capture">
      <div className="vision-stack capture-card">
        {mode === 'anomaly' && (
          <label className="vision-field">
            Batch label
            <input
              type="text"
              value={anomalyLabel}
              onChange={(e) => setAnomalyLabel(e.target.value)}
              placeholder="normal | anomaly"
            />
          </label>
        )}

        <div className="capture-actions">
          <button
            className="primary capture-main-btn"
            onClick={onCapture}
            disabled={!engine || busy || running}
          >
            📸 Capture
          </button>
          {running ? (
            <button
              className="danger capture-main-btn"
              onClick={() => (cancelRef.current = true)}
            >
              ■ Stop
            </button>
          ) : (
            <button
              className="capture-main-btn"
              onClick={onBatch}
              disabled={!engine || busy}
              title={`Capture ${capture.batchCount} frames along the path / with jitter`}
            >
              ⚡ Batch × {capture.batchCount}
            </button>
          )}
        </div>

        <div className="capture-section">
          <div className="capture-section-head">
            <span>Batch</span>
          </div>
          <div className="capture-batch-row">
            <NumberField
              label="Frames"
              value={capture.batchCount}
              min={1}
              max={500}
              step={1}
              onChange={(n) => setCapture({ batchCount: n })}
            />
            <div className="capture-chiprow" role="group" aria-label="Randomize per shot">
              <span className="capture-chiplabel">Randomize</span>
              {randomizeChips.map((chip) => (
                <button
                  key={chip.key}
                  className={`capture-chip${capture[chip.key] && !chip.disabled ? ' on' : ''}`}
                  aria-pressed={capture[chip.key] && !chip.disabled}
                  disabled={chip.disabled}
                  title={chip.hint}
                  onClick={() => setCapture({ [chip.key]: !capture[chip.key] })}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="capture-section">
          <div className="capture-section-head">
            <span>Camera path</span>
          </div>
          <select
            value={capture.cameraTrajectory}
            aria-label="Camera trajectory"
            onChange={(e) => {
              const next = e.target.value as CameraTrajectory;
              // Snap camPos onto the path's first sample so the preview
              // frames the first batch shot. Skip for 'random': that mode
              // jitters around the user's base pose — don't overwrite it.
              if (next === 'random') {
                setCapture({ cameraTrajectory: next });
              } else {
                snap({ cameraTrajectory: next });
              }
            }}
          >
            {TRAJECTORY_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {capture.cameraTrajectory !== 'random' && (
            <>
              <SliderRow
                label="Radius"
                value={capture.trajectoryRadius}
                min={0.5}
                max={15}
                step={0.1}
                formatValue={(v) => `${v.toFixed(1)} m`}
                onChange={(r) => snap({ trajectoryRadius: r })}
              />
              <SliderRow
                label="Height"
                value={capture.trajectoryHeight}
                min={0}
                max={10}
                step={0.1}
                formatValue={(v) => `${v.toFixed(1)} m`}
                onChange={(h) => snap({ trajectoryHeight: h })}
              />
              <ToggleSwitch
                title="Lock camera to path"
                help={
                  capture.lockToTrajectory
                    ? 'The capture camera rides the teal path — scrub its position below. You can also drag the path itself in the viewport.'
                    : 'Pin the capture camera onto the path; the phase slider then scrubs it along.'
                }
                on={capture.lockToTrajectory}
                onChange={(on) => setCapture({ lockToTrajectory: on })}
              />
              {capture.lockToTrajectory && (
                <SliderRow
                  label="Path position"
                  value={capture.trajectoryPhase}
                  min={0}
                  max={1}
                  step={0.005}
                  formatValue={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setCapture({ trajectoryPhase: v })}
                />
              )}
            </>
          )}
        </div>

        <div className="capture-footer">
          <span className="capture-count">
            {captures.length === 0
              ? 'No captures yet'
              : `${captures.length} capture${captures.length === 1 ? '' : 's'} ready`}
          </span>
          <button onClick={clearCaptures} disabled={captures.length === 0}>
            Clear
          </button>
        </div>
      </div>
    </CollapsibleCard>
  );
}

/* ------------------------------------------------------------------ */
/* PiP frame                                                           */
/* ------------------------------------------------------------------ */

/**
 * DOM outline + label over the engine's in-canvas PiP preview. The PiP
 * itself is rendered by the preview camera (placed by
 * useCaptureCameraSync); this element just frames it. Size mirrors
 * computePipRect: fixed 240 px width, height from the capture aspect,
 * 12 px from the bottom-left corner.
 */
function VirtualCameraFrame() {
  const width = useStore((s) => s.capture.width);
  const height = useStore((s) => s.capture.height);
  return (
    <div
      className="vc-pip-frame"
      style={{ width: PIP_WIDTH, height: pipHeight(width, height) }}
      aria-hidden="true"
    >
      <span className="vc-pip-label">Virtual camera</span>
    </div>
  );
}
