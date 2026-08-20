import { useEffect, useRef, useState } from 'react';
import {
  useStore,
  type MotionClass,
  type ObjectKind,
} from '../store/useStore';
import {
  buildFileName,
  listEiProjects,
  retrainEiModel,
  uploadSample,
  waitForEiJob,
} from '../lib/edgeImpulse';
import { getRng } from '../lib/rng';
import { createIdleSampler, runProceduralBatch } from '../modes/motionRunner';
import {
  CollapsibleCard,
  NumberField,
  RadioPills,
  SliderRow,
  ToggleSwitch,
  type RadioPillOption,
} from './primitives';
import { EiAuthCard } from './EiAuthCard';
import './motion.css';

const OBJECTS: { value: ObjectKind; label: string }[] = [
  { value: 'cube', label: 'Cube' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'torus', label: 'Torus' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'phone', label: 'Phone slab' },
  { value: 'soda_can', label: 'Soda can' },
];

const MOTION_OPTIONS: RadioPillOption<MotionClass>[] = [
  { value: 'drop', label: 'drop' },
  { value: 'throw', label: 'throw' },
  { value: 'push', label: 'push' },
  { value: 'shake', label: 'shake' },
];

/**
 * 'Realistic IMU noise' switch bound to the store's imuNoise.enabled.
 * Exported so RobotPanel can reuse it (shared per the original app).
 */
export function ImuNoiseToggle() {
  const enabled = useStore((s) => s.imuNoise.enabled);
  const setImuNoise = useStore((s) => s.setImuNoise);
  return (
    <ToggleSwitch
      title="Realistic IMU noise"
      on={enabled}
      onChange={(on) => setImuNoise({ enabled: on })}
      help="On: LSM6DSO-style bias drift, scale-factor error, quantization, and range clipping. Off: clean simulated sensor output."
    />
  );
}

const explainEiError = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed/.test(msg)) {
    return `Network/CORS error contacting the Edge Impulse Studio API. Check your network and API key. Original: ${msg}`;
  }
  if (/401/.test(msg)) {
    return `${msg} — API key rejected. Double-check Dashboard → Keys in your project.`;
  }
  if (/403/.test(msg)) {
    return `${msg} — API key doesn't have access to this project.`;
  }
  return msg;
};

/**
 * Motion mode sidebar: Object, Recording, Procedural motions, EI auth,
 * and Upload cards. Hand tracking is not ported yet (MediaPipe), so the
 * webcam toggle renders disabled and manual recording synthesizes a
 * live near-still 'idle' trace through the IMU-noise pipeline — the
 * full record → upload path stays exercisable end to end.
 */
export function MotionPanel() {
  // Per-key selectors so the panel only re-renders for fields it reads
  // (samples push at up to 500 Hz while recording).
  const isRecording = useStore((s) => s.isRecording);
  const setRecording = useStore((s) => s.setRecording);
  const samples = useStore((s) => s.samples);
  const clearSamples = useStore((s) => s.clearSamples);
  const sampleRateHz = useStore((s) => s.sampleRateHz);
  const setSampleRateHz = useStore((s) => s.setSampleRateHz);
  const ei = useStore((s) => s.ei);
  const setEi = useStore((s) => s.setEi);
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);
  const drops = useStore((s) => s.drops);
  const setDrops = useStore((s) => s.setDrops);
  const dropsRunning = useStore((s) => s.dropsRunning);
  const setDropsRunning = useStore((s) => s.setDropsRunning);

  // The rebuilt store has no objectKind slice (the motion body isn't in
  // the scene yet) — the selection only feeds the `shape` metadata.
  const [objectKind, setObjectKind] = useState<ObjectKind>('cube');

  // Stop-button flag for the procedural runner, polled between
  // iterations (the store has no dropsCancelRequested field).
  const cancelRef = useRef(false);

  // Live 'idle' sampler: while recording, synthesize near-still noisy
  // samples at the configured rate so users can exercise the full
  // record → upload path without hand tracking.
  useEffect(() => {
    if (!isRecording) return;
    const st = useStore.getState();
    const sampler = createIdleSampler(st.imuNoise, getRng());
    let last = performance.now();
    const id = window.setInterval(
      () => {
        const now = performance.now();
        const dt = Math.max(1e-3, (now - last) / 1000);
        last = now;
        const { accel, gyro } = sampler(dt);
        useStore.getState().pushSample({
          t: now,
          ax: accel[0],
          ay: accel[1],
          az: accel[2],
          gx: gyro[0],
          gy: gyro[1],
          gz: gyro[2],
        });
      },
      // Browsers clamp intervals to ~4 ms; timestamps are real, so the
      // uploaded interval_ms stays honest even when the timer lags.
      Math.max(4, Math.round(1000 / st.sampleRateHz))
    );
    return () => window.clearInterval(id);
  }, [isRecording]);

  const onRecord = () => {
    clearSamples();
    setRecording(true);
  };

  const onUpload = async () => {
    setStatus('busy', 'Uploading…');
    try {
      const res = await uploadSample(
        ei,
        samples,
        sampleRateHz,
        buildFileName(ei.label),
        {
          mode: 'motion',
          shape: objectKind,
          sample_rate_hz: sampleRateHz,
          hand_tracking: false,
        }
      );
      if (res.ok) {
        setStatus('ok', `Uploaded ${samples.length} samples (${res.status}).`);
        clearSamples();
      } else {
        setStatus('err', `Upload failed (${res.status}): ${res.body}`);
      }
    } catch (e) {
      setStatus('err', `Upload error: ${(e as Error).message}`);
    }
  };

  const onRetrainModel = async () => {
    const apiKey = ei.apiKey.trim();
    if (!apiKey) {
      setStatus('err', 'Enter your Edge Impulse API key first');
      return;
    }
    try {
      setStatus('busy', 'Finding Edge Impulse project…');
      const projects = await listEiProjects(apiKey);
      if (projects.length === 0) {
        setStatus('err', 'No projects accessible to this API key');
        return;
      }
      if (projects.length > 1) {
        setStatus(
          'err',
          'This API key can access multiple projects. Use a project API key to retrain from Motion mode.'
        );
        return;
      }
      const project = projects[0];
      setStatus('busy', `Starting retrain for ${project.name}…`);
      const { jobId } = await retrainEiModel(apiKey, project.id);
      await waitForEiJob(apiKey, project.id, jobId, {
        onProgress: (elapsed) => {
          setStatus(
            'busy',
            `Retrain job #${jobId} running (${Math.floor(elapsed / 1000)}s)…`
          );
        },
      });
      setStatus('ok', `Retrained ${project.name}.`);
    } catch (e) {
      setStatus('err', `Retrain model: ${explainEiError(e)}`);
    }
  };

  const onRunProcedural = async () => {
    cancelRef.current = false;
    setDropsRunning(true);
    const st = useStore.getState();
    const shouldUpload = st.ei.apiKey.trim().length > 0;
    try {
      const result = await runProceduralBatch({
        ei: st.ei,
        drops: st.drops,
        sampleRateHz: st.sampleRateHz,
        imuNoise: st.imuNoise,
        shape: objectKind,
        rng: getRng(),
        isCancelled: () => cancelRef.current,
        onProgress: (p) => {
          setStatus(
            'busy',
            shouldUpload
              ? `Motions: ${p.uploaded} uploaded · ${p.failed} failed (of ${p.done}/${p.total})`
              : `Motions: ${p.captured} captured · ${p.failed} failed (of ${p.done}/${p.total})`
          );
        },
      });
      const headline = result.cancelled
        ? 'Procedural motions stopped'
        : 'Procedural motions complete';
      const failedSuffix = result.failed ? ` · ${result.failed} failed` : '';
      if (result.uploadedMode) {
        setStatus(
          result.cancelled || result.failed > 0 ? 'err' : 'ok',
          `${headline}: ${result.uploaded} uploaded${failedSuffix}`
        );
      } else if (result.zipFileCount > 0) {
        setStatus(
          result.cancelled || result.failed > 0 ? 'err' : 'ok',
          `${headline}: downloaded ${result.zipFileCount} files${failedSuffix}`
        );
      } else {
        setStatus('err', `${headline}: no samples captured`);
      }
    } catch (e) {
      setStatus('err', `Motions error: ${(e as Error).message}`);
    } finally {
      setDropsRunning(false);
      cancelRef.current = false;
    }
  };

  // Actual recorded span, not count/rate — the sampler is timer-capped,
  // so the requested rate is only an upper bound.
  const durationSec =
    samples.length > 1
      ? (samples[samples.length - 1].t - samples[0].t) / 1000
      : samples.length / sampleRateHz;
  const hasApiKey = ei.apiKey.trim().length > 0;
  const showHeightSliders =
    drops.motion === 'drop' || drops.motion === 'throw' || drops.motion === 'shake';
  const heightLabel = drops.motion === 'shake' ? 'Center height' : 'Drop height';

  return (
    <>
      <CollapsibleCard heading="Object" defaultOpen>
        <label className="motion-field">
          Object
          <select
            value={objectKind}
            onChange={(e) => setObjectKind(e.target.value as ObjectKind)}
          >
            {OBJECTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div title="Hand tracking arrives with the MediaPipe port — see TODO.md">
          <ToggleSwitch
            title="Webcam control"
            on={false}
            disabled
            onChange={() => {}}
            help="Camera stays off; procedural drops still work."
          />
        </div>
        <p className="motion-note">
          IMU samples are 6-channel: accelerometer (m/s²) + gyroscope (rad/s).
        </p>
      </CollapsibleCard>

      <CollapsibleCard heading="Recording">
        <label className="motion-field">
          Label
          <input
            type="text"
            value={ei.label}
            onChange={(e) => setEi({ label: e.target.value })}
            placeholder="e.g. shake, idle, drop"
          />
        </label>
        <NumberField
          label="Sample rate (Hz)"
          value={sampleRateHz}
          onChange={setSampleRateHz}
          min={20}
          max={500}
          step={10}
          disabled={isRecording}
        />
        <div className="button-row">
          {isRecording ? (
            <button className="danger" onClick={() => setRecording(false)}>
              ■ Stop
            </button>
          ) : (
            <button className="primary" onClick={onRecord}>
              ● Record
            </button>
          )}
          <button
            onClick={clearSamples}
            disabled={isRecording || samples.length === 0}
          >
            Clear
          </button>
        </div>
        <div className="motion-readout">
          {isRecording && (
            <span className="rec-dot" aria-hidden="true">
              ●
            </span>
          )}
          <span>
            {samples.length} samples · {durationSec.toFixed(2)}s
          </span>
        </div>
        <ImuNoiseToggle />
      </CollapsibleCard>

      <CollapsibleCard heading="Procedural motions">
        <p className="motion-note">
          Generate N samples automatically for the selected motion class. Each
          iteration synthesizes one labelled IMU trace.
        </p>
        <RadioPills
          options={MOTION_OPTIONS}
          value={drops.motion}
          onChange={(m) => {
            setDrops({ motion: m });
            setEi({ label: m });
          }}
          ariaLabel="Motion class"
          disabled={dropsRunning}
        />
        <div className="motion-row">
          <NumberField
            label="Count"
            value={drops.count}
            onChange={(n) => setDrops({ count: n })}
            min={1}
            max={500}
            step={1}
            disabled={dropsRunning}
          />
          <NumberField
            label={`Per-${drops.motion} ms`}
            value={drops.durationMs}
            onChange={(n) => setDrops({ durationMs: n })}
            min={300}
            max={6000}
            step={100}
            disabled={dropsRunning}
          />
        </div>
        {showHeightSliders && (
          <>
            <SliderRow
              label={`${heightLabel} min`}
              value={drops.heightMin}
              min={0.3}
              max={4}
              step={0.05}
              formatValue={(v) => `${v.toFixed(2)} m`}
              disabled={dropsRunning}
              onChange={(next) =>
                setDrops({ heightMin: Math.min(drops.heightMax - 0.05, next) })
              }
            />
            <SliderRow
              label={`${heightLabel} max`}
              value={drops.heightMax}
              min={0.3}
              max={4}
              step={0.05}
              formatValue={(v) => `${v.toFixed(2)} m`}
              disabled={dropsRunning}
              onChange={(next) =>
                setDrops({ heightMax: Math.max(drops.heightMin + 0.05, next) })
              }
            />
          </>
        )}
        {drops.motion === 'throw' && (
          <SliderRow
            label="Throw speed"
            value={drops.throwSpeed}
            min={1}
            max={10}
            step={0.1}
            formatValue={(v) => `${v.toFixed(1)} m/s`}
            disabled={dropsRunning}
            onChange={(next) => setDrops({ throwSpeed: next })}
          />
        )}
        {drops.motion === 'push' && (
          <SliderRow
            label="Push speed"
            value={drops.pushSpeed}
            min={0.5}
            max={8}
            step={0.1}
            formatValue={(v) => `${v.toFixed(1)} m/s`}
            disabled={dropsRunning}
            onChange={(next) => setDrops({ pushSpeed: next })}
          />
        )}
        {drops.motion === 'shake' && (
          <>
            <SliderRow
              label="Shake frequency"
              value={drops.shakeFreq}
              min={1}
              max={10}
              step={0.1}
              formatValue={(v) => `${v.toFixed(1)} Hz`}
              disabled={dropsRunning}
              onChange={(next) => setDrops({ shakeFreq: next })}
            />
            <SliderRow
              label="Shake amplitude"
              value={drops.shakeAmp}
              min={0.02}
              max={0.5}
              step={0.01}
              formatValue={(v) => `${(v * 100).toFixed(0)} cm`}
              disabled={dropsRunning}
              onChange={(next) => setDrops({ shakeAmp: next })}
            />
          </>
        )}
        {dropsRunning ? (
          <button
            className="danger motion-run-button"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            ■ Stop
          </button>
        ) : (
          <button
            className="primary motion-run-button"
            onClick={onRunProcedural}
            disabled={isRecording}
          >
            {`⚡ Generate & ${hasApiKey ? 'upload' : 'download'} ${drops.count} samples`}
          </button>
        )}
      </CollapsibleCard>

      <EiAuthCard showHmac />

      <CollapsibleCard heading="Upload to Edge Impulse">
        {!ei.apiKey && (
          <p className="motion-note">
            Set your API key in the <strong>Edge Impulse · auth</strong> card
            above.
          </p>
        )}
        <div className="button-row">
          <button
            className="primary"
            onClick={onUpload}
            disabled={
              isRecording ||
              samples.length === 0 ||
              !ei.apiKey ||
              status.kind === 'busy'
            }
          >
            ⤴ Upload {samples.length} samples
          </button>
          <button
            onClick={onRetrainModel}
            disabled={!ei.apiKey || status.kind === 'busy'}
            title={
              !ei.apiKey ? 'Set your API key in the auth card first' : undefined
            }
          >
            ↻ Retrain model
          </button>
        </div>
      </CollapsibleCard>
    </>
  );
}
