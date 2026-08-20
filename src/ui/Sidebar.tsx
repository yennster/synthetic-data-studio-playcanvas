import { lazy, Suspense } from 'react';
import { useStore, type Mode } from '../store/useStore';
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

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'detection', label: 'Object detection', hint: 'Images + bboxes' },
  { value: 'anomaly', label: 'Visual anomaly', hint: 'Images, batch label' },
  { value: 'motion', label: 'Motion', hint: 'Accelerometer' },
  { value: 'robot', label: 'Robotics', hint: 'Rover & Arm telemetry' },
];

const STATUS_LABEL: Record<string, string> = {
  idle: 'Status',
  busy: 'Working',
  ok: 'Done',
  err: 'Issue',
};

export function Sidebar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const status = useStore((s) => s.status);

  return (
    <aside className="sidebar">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>Synthetic Data Studio</h1>
            <p className="tagline">PlayCanvas · Gaussian Splats · Edge Impulse</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <section className="card">
        <h2>Mode</h2>
        <div className="mode-grid">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={mode === m.value ? 'primary' : ''}
              title={m.hint}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mode-hint">{MODES.find((m) => m.value === mode)?.hint}</p>
      </section>

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
