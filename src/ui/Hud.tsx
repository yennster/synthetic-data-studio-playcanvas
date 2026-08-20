import { useStore } from '../store/useStore';
import { URL_FLAGS } from '../lib/urlParams';

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
    </div>
  );
}
