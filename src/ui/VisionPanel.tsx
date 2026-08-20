import { useEffect, useRef, useState } from 'react';
import { Color } from 'playcanvas';
import { useEngine } from '../engine/EngineContext';
import { useStore, type CaptureSettings } from '../store/useStore';
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

  return (
    <CollapsibleCard heading="Virtual camera">
      <div className="vision-stack">
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
      </div>
    </CollapsibleCard>
  );
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

  return (
    <CollapsibleCard heading="Capture">
      <div className="vision-stack">
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
        <button
          className="primary"
          onClick={onCapture}
          disabled={!engine || busy || running}
        >
          📸 Capture frame
        </button>

        <div className="capture-topline">
          <NumberField
            label="Batch count"
            value={capture.batchCount}
            min={1}
            max={500}
            step={1}
            onChange={(n) => setCapture({ batchCount: n })}
          />
          {running ? (
            <button className="danger" onClick={() => (cancelRef.current = true)}>
              ■ Stop
            </button>
          ) : (
            <button className="primary" onClick={onBatch} disabled={!engine || busy}>
              ⚡ Batch ({capture.batchCount})
            </button>
          )}
        </div>

        <fieldset className="capture-randomize">
          <legend>Randomize</legend>
          <label
            className={`vision-check${
              capture.cameraTrajectory !== 'random' ? ' disabled' : ''
            }`}
            title="Jitter the camera around its base pose per shot. Only applies on the Random trajectory — deterministic paths place the camera exactly."
          >
            <input
              type="checkbox"
              checked={capture.randomizeCamera}
              disabled={capture.cameraTrajectory !== 'random'}
              onChange={(e) => setCapture({ randomizeCamera: e.target.checked })}
            />
            <span>Camera</span>
          </label>
          <label className="vision-check" title="Jitter the key light intensity per shot.">
            <input
              type="checkbox"
              checked={capture.randomizeLighting}
              onChange={(e) => setCapture({ randomizeLighting: e.target.checked })}
            />
            <span>Lighting</span>
          </label>
          <label
            className="vision-check"
            title="Nudge spawned object positions and yaw per shot (restored after the batch)."
          >
            <input
              type="checkbox"
              checked={capture.randomizeObjects}
              onChange={(e) => setCapture({ randomizeObjects: e.target.checked })}
            />
            <span>Objects</span>
          </label>
        </fieldset>

        <label className="vision-field">
          Camera trajectory
          <select
            value={capture.cameraTrajectory}
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
        </label>
        {capture.cameraTrajectory !== 'random' && (
          <div className="vision-row">
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
          </div>
        )}

        <div className="capture-footer">
          <span>{captures.length} captures</span>
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
