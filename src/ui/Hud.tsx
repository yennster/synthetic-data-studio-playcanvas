import { useState } from 'react';
import { useStore } from '../store/useStore';
import { URL_FLAGS } from '../lib/urlParams';

const TIP_KEY = 'sds-hud-tip-open';

const CONTROLS: [string, string][] = [
  ['Left-drag', 'orbit the camera'],
  ['Middle-drag / Shift+drag', 'pan'],
  ['Scroll', 'zoom'],
  ['Right-drag', 'erase splats (when the ✏ brush is on)'],
  ['⛭ in a model row', 'move / rotate / resize / copy props'],
];

/** Dismissable viewport-controls help; open state persists. */
function TipPill() {
  const [open, setOpen] = useState(
    () => localStorage.getItem(TIP_KEY) === '1'
  );
  const toggle = (next: boolean) => {
    setOpen(next);
    localStorage.setItem(TIP_KEY, next ? '1' : '0');
  };
  if (!open) {
    return (
      <button
        className="hud-pill hud-tip-toggle"
        title="Viewport controls"
        onClick={() => toggle(true)}
      >
        ?
      </button>
    );
  }
  return (
    <div className="hud-tip">
      <div className="hud-tip-head">
        <span>Controls</span>
        <button className="icon" aria-label="Hide controls help" onClick={() => toggle(false)}>
          ✕
        </button>
      </div>
      <ul>
        {CONTROLS.map(([key, what]) => (
          <li key={key}>
            <strong>{key}</strong> {what}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MODE_LABEL: Record<string, string> = {
  detection: 'object detection',
  anomaly: 'visual anomaly',
  motion: 'motion',
  robot: 'robotics',
};

/** Overlay pills at the top of the scene. Hidden entirely when ?embed=1. */
export function Hud() {
  const mode = useStore((s) => s.mode);
  const sceneObjects = useStore((s) => s.sceneObjects);
  const models = useStore((s) => s.models);
  const splats = useStore((s) => s.splats);
  const captures = useStore((s) => s.captures);
  const robotCaptures = useStore((s) => s.robotCaptures);
  const isRecording = useStore((s) => s.isRecording);
  const samples = useStore((s) => s.samples);

  if (URL_FLAGS.embed) return null;

  const objectCount = sceneObjects.length + models.length;
  const captureCount = mode === 'robot' ? robotCaptures : captures.length;

  return (
    <div className="hud">
      <span className="hud-pill">Mode: {MODE_LABEL[mode]}</span>
      <span className="hud-pill">Objects: {objectCount}</span>
      <span className="hud-pill">Splats: {splats.length}</span>
      {mode === 'motion' ? (
        isRecording && (
          <span className="hud-pill live">● REC · {samples.length}</span>
        )
      ) : (
        <span className={`hud-pill${captureCount > 0 ? ' live' : ''}`}>
          Captures: {captureCount}
        </span>
      )}
      <TipPill />
    </div>
  );
}
