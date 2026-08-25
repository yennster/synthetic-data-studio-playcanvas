import { lazy, Suspense } from 'react';
import { useStore, type Mode } from '../store/useStore';
import { URL_PRESETS } from '../lib/urlParams';
import { SampleGallery } from './SampleGallery';
import { SplatLibrary } from './SplatLibrary';
import { ModelLibrary } from './ModelLibrary';
import { ThemeToggle } from './ThemeToggle';

const VisionPanel = lazy(() =>
  import('./VisionPanel').then((m) => ({ default: m.VisionPanel }))
);
const MotionPanel = lazy(() =>
  import('./MotionPanel').then((m) => ({ default: m.MotionPanel }))
);
const RobotPanel = lazy(() =>
  import('./RobotPanel').then((m) => ({ default: m.RobotPanel }))
);

const ALL_MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'detection', label: 'Object detection', hint: 'Images + bboxes' },
  { value: 'anomaly', label: 'Visual anomaly', hint: 'Images, batch label' },
  { value: 'motion', label: 'Motion', hint: 'Accelerometer' },
  { value: 'robot', label: 'Robotics', hint: 'Rover & Arm telemetry' },
];

// `?onlyMode=detection` (csv) locks the picker down for deep links.
const MODES = URL_PRESETS.onlyMode?.length
  ? ALL_MODES.filter((m) => URL_PRESETS.onlyMode!.includes(m.value))
  : ALL_MODES;

const STATUS_LABEL: Record<string, string> = {
  idle: 'Status',
  busy: 'Working',
  ok: 'Done',
  err: 'Issue',
};

export function Sidebar({ onHide }: { onHide?: () => void }) {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const status = useStore((s) => s.status);
  // A running batch (robot/procedural/recording) must finish or be
  // stopped before switching modes — its panel owns the cancel flag, and
  // unmounting it would orphan the run.
  const runLocked = useStore(
    (s) => s.robotRunning || s.dropsRunning || s.isRecording
  );

  return (
    <aside className="sidebar">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>Synthetic Data Studio</h1>
            <p className="tagline">PlayCanvas · Gaussian Splats · Edge Impulse</p>
          </div>
          <div className="header-buttons">
            <ThemeToggle />
            {onHide && (
              <button
                className="icon theme-toggle"
                title="Hide the sidebar (more viewport)"
                aria-label="Hide sidebar"
                onClick={onHide}
              >
                ⟨
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="card">
        <h2>Mode</h2>
        <div className="mode-grid">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={mode === m.value ? 'primary' : ''}
              title={runLocked && m.value !== mode ? 'Stop the running batch first' : m.hint}
              disabled={runLocked && m.value !== mode}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mode-hint">{MODES.find((m) => m.value === mode)?.hint}</p>
      </section>

      <SampleGallery />
      <SplatLibrary />
      <ModelLibrary />

      <Suspense fallback={<section className="card">Loading controls…</section>}>
        {mode === 'motion' ? (
          <MotionPanel />
        ) : mode === 'robot' ? (
          <RobotPanel />
        ) : (
          <VisionPanel />
        )}
      </Suspense>

      {status.msg && (
        <div
          className={`status-bar status-${status.kind}`}
          aria-live={status.kind === 'err' ? 'assertive' : 'polite'}
        >
          <strong>{STATUS_LABEL[status.kind]}</strong> {status.msg}
        </div>
      )}
    </aside>
  );
}
