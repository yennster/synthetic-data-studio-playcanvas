import { useStore, type RealismSettings } from '../store/useStore';
import {
  listEiProjects,
  retrainEiModel,
  uploadCaptures,
  waitForEiJob,
} from '../lib/edgeImpulse';
import type { IngestionMetadataExtras } from '../lib/types';
import { eiAuthSatisfied } from '../lib/eiAuth';
import { URL_FLAGS } from '../lib/urlParams';
import { CollapsibleCard } from './primitives';
import './ei.css';

/**
 * Vision (detection / anomaly) upload card: pushes the accumulated
 * captures to the Edge Impulse Ingestion API and offers a one-click
 * retrain of the (single) project the API key resolves to.
 *
 * Labelling per mode:
 *  - detection: per-capture label falls back to `ei.label`; bounding
 *    boxes ride along in the `x-bounding-boxes` header.
 *  - anomaly: batch label (`anomalyLabel`) applies; boxes are never
 *    attached (uploadCaptures gets includeBoxes=false → passes null).
 */

/**
 * Flatten realism config into EI image-metadata fields — same shape as
 * the original app's realismMeta so vision + robotics captures can be
 * mixed downstream without branching. `realism_intensity` is the mean
 * of the five knobs.
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

/** Translate raw fetch / runtime errors into something actionable. */
function explainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed/.test(msg)) {
    return `Network/CORS error contacting Edge Impulse Studio. Check network, API key, and CSP. Original: ${msg}`;
  }
  if (/401/.test(msg)) return `${msg} — API key rejected.`;
  if (/403/.test(msg)) return `${msg} — API key doesn't have access.`;
  return msg;
}

export function EiUploadCard() {
  const mode = useStore((s) => s.mode);
  const captures = useStore((s) => s.captures);
  const anomalyLabel = useStore((s) => s.anomalyLabel);
  const ei = useStore((s) => s.ei);
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);

  const onUpload = async () => {
    setStatus('busy', `Uploading 0/${captures.length}…`);
    const includeBoxes = mode === 'detection';
    const defaultLabel = mode === 'anomaly' ? anomalyLabel : ei.label;
    const realism = useStore.getState().realism;
    const result = await uploadCaptures(
      ei,
      captures,
      defaultLabel,
      includeBoxes,
      (p) => {
        setStatus(
          'busy',
          `Uploading ${p.done}/${p.total}${p.failed ? ` · ${p.failed} failed` : ''}`
        );
      },
      { mode, ...realismMeta(realism) }
    );
    if (result.failed === 0) {
      setStatus('ok', `Uploaded ${result.done} images`);
    } else {
      setStatus(
        'err',
        `${result.done} ok / ${result.failed} failed: ${result.lastError ?? '?'}`
      );
    }
  };

  /**
   * Retrain whichever project this API key resolves to. With a
   * project-scoped key (the common case) the single project is
   * unambiguous; if the key sees multiple projects, the user has to
   * retrain from the Studio so they pick the right one.
   */
  const onRetrainModel = async () => {
    if (!ei.apiKey) {
      setStatus('err', 'Enter your Edge Impulse API key first');
      return;
    }
    try {
      setStatus('busy', 'Finding Edge Impulse project…');
      const projects = await listEiProjects(ei.apiKey);
      if (projects.length === 0) {
        setStatus('err', 'No projects accessible to this API key');
        return;
      }
      if (projects.length > 1) {
        setStatus(
          'err',
          'Multi-project API key — use a project API key, or retrain from the Studio instead.'
        );
        return;
      }
      const { id: projectId, name: projectName } = projects[0];
      setStatus('busy', `Starting retrain for ${projectName}…`);
      const { jobId } = await retrainEiModel(ei.apiKey, projectId);
      await waitForEiJob(ei.apiKey, projectId, jobId, {
        onProgress: (elapsed) => {
          setStatus(
            'busy',
            `Retrain job #${jobId} running (${Math.floor(elapsed / 1000)}s)…`
          );
        },
      });
      setStatus(
        'ok',
        `Retrained ${projectName}. Build a browser deployment to refresh the in-browser model.`
      );
    } catch (e) {
      setStatus('err', `Retrain model: ${explainError(e)}`);
    }
  };

  const boxesTotal = captures.reduce((acc, c) => acc + c.boxes.length, 0);
  // `?bypassAuth=1` lifts the key gate so the flows can be demoed
  // offline; the requests themselves still fail loudly without a key.
  const authOk = eiAuthSatisfied(ei.apiKey, URL_FLAGS.bypassAuth);

  return (
    <CollapsibleCard heading="Upload to Edge Impulse">
      <div className="ei-stack">
        {!authOk && (
          <p className="ei-note">
            Set your API key in the <strong>Edge Impulse · auth</strong> card.
          </p>
        )}
        {mode === 'anomaly' && (
          <p className="ei-note">
            Each capture is uploaded with the batch label above. Bounding boxes
            are <strong>not</strong> attached.
          </p>
        )}
        {mode === 'detection' && (
          <p className="ei-note">
            Each capture is uploaded with bounding boxes ({boxesTotal} total).
          </p>
        )}
        <button
          className="primary"
          onClick={onUpload}
          disabled={
            captures.length === 0 || !authOk || status.kind === 'busy'
          }
        >
          ⤴ Upload {captures.length} images
        </button>
        <button
          onClick={onRetrainModel}
          disabled={!authOk || status.kind === 'busy'}
          title="Retrain the selected project's current impulse with the last known Studio settings."
        >
          ↻ Retrain model
        </button>
      </div>
    </CollapsibleCard>
  );
}
