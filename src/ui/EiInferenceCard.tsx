import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import {
  buildEiDeployment,
  downloadEiHistoricDeployment,
  listEiDeploymentHistory,
  listEiProjects,
  waitForEiJob,
  type EiDeploymentHistoryEntry,
  type EiProject,
} from '../lib/edgeImpulse';
import {
  canvasToFeatures,
  loadEiModel,
  loadEiModelFromZip,
  type EiResult,
  type LoadedEiModel,
} from '../lib/eiModel';
import { eiAuthSatisfied } from '../lib/eiAuth';
import { URL_FLAGS } from '../lib/urlParams';
import { CollapsibleCard, SliderRow } from './primitives';
import { InferenceOverlay } from './InferenceOverlay';
import './ei.css';

/** Live-inference rate. Throttled independently of the preview repaint
 * so a slow model can't drag the render loop down. */
const INFERENCE_INTERVAL_MS = 200; // 5 Hz

/** How often the PiP overlay rect is re-measured against the engine's
 * preview camera viewport. */
const PIP_TRACK_MS = 300;

type CardModel = { loaded: LoadedEiModel; name: string };

/**
 * The loaded model handle lives at module level, NOT in the zustand
 * store: the Emscripten runtime is a live wasm instance (heap, Embind
 * vtables) — not serializable, and persisting it would break the
 * store's partialize. Module scope (rather than component state alone)
 * lets the model survive panel remounts, e.g. a mode round-trip.
 */
let cachedModel: CardModel | null = null;

/** wasm/browser matcher for deployment-history entries. */
function isWasmBrowser(e: EiDeploymentHistoryEntry): boolean {
  const fmt = (e.deploymentFormat || '').toLowerCase();
  const targetFmt = (e.deploymentTarget?.format || '').toLowerCase();
  const targetName = (e.deploymentTarget?.name || '').toLowerCase();
  return (
    fmt === 'wasm' ||
    targetFmt === 'wasm' ||
    targetName.includes('webassembly') ||
    targetName.includes('browser')
  );
}

/** Translate raw fetch / runtime errors into something actionable. */
function explainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed/.test(msg)) {
    return `Network/CORS error contacting the Edge Impulse Studio API. Check your network, that the API key is valid, and (production hosts only) that the page can reach studio.edgeimpulse.com without a CSP block. Original: ${msg}`;
  }
  if (/401/.test(msg))
    return `${msg} — API key rejected. Double-check Dashboard → Keys in your project.`;
  if (/403/.test(msg))
    return `${msg} — API key doesn't have access to this project.`;
  return msg;
}

function modelSummary(name: string, m: CardModel['loaded'], built = false) {
  const i = m.info;
  return `${built ? 'Built & loaded' : 'Loaded'} ${name}: ${i.inputWidth}×${
    i.inputHeight
  } ${i.isRgb ? 'RGB' : 'GRAY'}${i.isObjectDetection ? ' · object detection' : ''}${
    i.hasVisualAnomaly ? ' · visual anomaly' : ''
  }`;
}

type PipRect = { left: number; top: number; width: number; height: number };

/**
 * Edge Impulse model picker, loader, and inference runner. Shared by
 * detection/anomaly mode (virtual camera) and robotics mode (robot
 * POV) — `previewSource` only changes the hint describing where the
 * boxes render.
 *
 * Inference pipeline per tick: `engine.capture.captureFrame` at the
 * model's input dims (skipped when a capture is already in flight),
 * blob → offscreen canvas → `canvasToFeatures` → `classify`. The
 * result stays local to this card; detection boxes render through
 * `InferenceOverlay` in a portal positioned over the engine's PiP
 * preview viewport.
 */
export function EiInferenceCard({
  previewSource = 'virtual-camera',
}: {
  previewSource?: 'virtual-camera' | 'robot-pov';
}) {
  const engine = useEngine();
  const ei = useStore((s) => s.ei);
  const setStatus = useStore((s) => s.setStatus);
  const eiThreshold = useStore((s) => s.eiThreshold);
  const setEiThreshold = useStore((s) => s.setEiThreshold);
  const eiLive = useStore((s) => s.eiLive);
  const setEiLive = useStore((s) => s.setEiLive);

  const [model, setModelState] = useState<CardModel | null>(() => cachedModel);
  const [result, setResult] = useState<EiResult | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [projects, setProjects] = useState<EiProject[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null
  );
  const [pipRect, setPipRect] = useState<PipRect | null>(null);
  const [inferenceStatus, setInferenceStatus] = useState<{
    kind: 'idle' | 'busy' | 'ok' | 'err';
    msg: string;
  }>({ kind: 'idle', msg: '' });

  const modelFilesRef = useRef<HTMLInputElement>(null);
  const lastApiKeyRef = useRef(ei.apiKey);
  const inferBusyRef = useRef(false);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  const setModel = (next: CardModel | null) => {
    cachedModel = next;
    setModelState(next);
    setResult(null);
  };

  const setBoth = (kind: 'idle' | 'busy' | 'ok' | 'err', msg: string) => {
    setInferenceStatus({ kind, msg });
    if (kind !== 'idle') setStatus(kind, msg);
  };

  // Changing the API key invalidates the cached project list/selection.
  useEffect(() => {
    if (ei.apiKey === lastApiKeyRef.current) return;
    lastApiKeyRef.current = ei.apiKey;
    setProjects(null);
    setSelectedProjectId(null);
  }, [ei.apiKey]);

  // Live mode can't outlive the card that drives it.
  useEffect(() => {
    return () => {
      useStore.getState().setEiLive(false);
    };
  }, []);

  // ---- Inference ---------------------------------------------------------

  const runInference = useCallback(async () => {
    if (!engine || !model) return;
    // Re-entrancy guard: a capture+classify can span multiple ticks.
    if (inferBusyRef.current) return;
    inferBusyRef.current = true;
    try {
      const info = model.loaded.info;
      let blob: Blob;
      try {
        // Classify what the PREVIEW camera sees: in vision modes that is
        // the virtual camera; in robot mode RobotPanel drives it along
        // the POV mount, so inference follows the robot's eye. Capture at
        // the preview's aspect — canvasToFeatures squashes to model dims,
        // matching the original's preview→features semantics (and the
        // overlay's coordinate mapping back onto the PiP).
        const s = useStore.getState();
        const isRobot = s.mode === 'robot';
        const capW = isRobot ? s.robot.objectDetectionWidth : s.capture.width;
        const capH = isRobot ? s.robot.objectDetectionHeight : s.capture.height;
        const prevCam = engine.previewCamera;
        const pos = prevCam.getPosition().clone();
        const target = pos.clone().add(prevCam.forward);
        const cap = await engine.capture.captureFrame(capW, capH, [], {
          position: pos,
          target,
          fov: prevCam.camera!.fov,
        });
        blob = cap.blob;
      } catch {
        // Capture unavailable (engine tearing down) — skip this tick.
        return;
      }
      const bitmap = await createImageBitmap(blob);
      let canvas = scratchRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        scratchRef.current = canvas;
      }
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const features = canvasToFeatures(
        canvas,
        info.inputWidth,
        info.inputHeight,
        info.isRgb
      );
      const res = model.loaded.classifier.classify(features);
      setResult(res);
    } catch (e) {
      setStatus('err', `Inference: ${(e as Error).message}`);
    } finally {
      inferBusyRef.current = false;
    }
  }, [engine, model, setStatus]);

  // ~5 Hz live loop; stops on toggle, unload, or unmount.
  useEffect(() => {
    if (!eiLive || !model || !engine) return;
    const id = window.setInterval(() => {
      void runInference();
    }, INFERENCE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [eiLive, model, engine, runInference]);

  // Track the engine's PiP preview viewport so the overlay portal can
  // sit exactly over it (viewport coordinates → fixed CSS pixels).
  useEffect(() => {
    if (!engine || !model) {
      setPipRect(null);
      return;
    }
    const compute = (): PipRect | null => {
      const cam = engine.previewCamera;
      if (!cam.enabled || !cam.camera) return null;
      const canvas = engine.app.graphicsDevice.canvas as HTMLCanvasElement;
      const b = canvas.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return null;
      // camera.rect is (x, y, w, h) normalized with y from the bottom.
      const r = cam.camera.rect;
      const w = r.z * b.width;
      const h = r.w * b.height;
      if (w < 2 || h < 2) return null;
      return {
        left: b.left + r.x * b.width,
        top: b.top + (1 - r.y - r.w) * b.height,
        width: w,
        height: h,
      };
    };
    const update = () => {
      const next = compute();
      setPipRect((prev) => {
        if (prev === next) return prev;
        if (
          prev &&
          next &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.height === next.height
        ) {
          return prev;
        }
        return next;
      });
    };
    update();
    const id = window.setInterval(update, PIP_TRACK_MS);
    return () => window.clearInterval(id);
  }, [engine, model]);

  // ---- Model acquisition -------------------------------------------------

  const onListProjects = async () => {
    if (!ei.apiKey) {
      setBoth('err', 'Enter your Edge Impulse API key first');
      return;
    }
    setBoth('busy', 'Listing projects…');
    try {
      const list = await listEiProjects(ei.apiKey);
      setProjects(list);
      const nextProjectId =
        list.length === 1
          ? list[0].id
          : list.some((p) => p.id === selectedProjectId)
            ? selectedProjectId
            : null;
      setSelectedProjectId(nextProjectId);
      if (list.length === 0) {
        setBoth('err', 'No projects accessible to this API key');
      } else {
        setBoth(
          'ok',
          `Found ${list.length} project${list.length === 1 ? '' : 's'}`
        );
      }
    } catch (e) {
      setBoth('err', `List projects: ${explainError(e)}`);
    }
  };

  const projectName = (id: number) =>
    projects?.find((p) => p.id === id)?.name ?? `project-${id}`;

  const onFetchModel = async () => {
    if (!ei.apiKey) {
      setBoth('err', 'Enter your Edge Impulse API key first');
      return;
    }
    if (!selectedProjectId) {
      setBoth('err', 'Pick a project first');
      return;
    }
    setModelLoading(true);
    try {
      setBoth('busy', 'Checking deployment history…');
      const history = await listEiDeploymentHistory(
        ei.apiKey,
        selectedProjectId
      );
      const candidate = history.find(
        (e) => isWasmBrowser(e) && !e.impulseIsDeleted
      );
      if (!candidate) {
        if (history.length === 0) {
          setBoth(
            'err',
            'No deployments built yet. In the Studio: Deployment → Build with target "WebAssembly".'
          );
        } else {
          const formats = Array.from(
            new Set(
              history.map(
                (e) => e.deploymentTarget?.name || e.deploymentFormat || '?'
              )
            )
          ).join(', ');
          setBoth(
            'err',
            `No WebAssembly (browser) deployment found among ${history.length} build${
              history.length === 1 ? '' : 's'
            } (${formats}). In the Studio: Deployment → Build with target "WebAssembly".`
          );
        }
        return;
      }
      setBoth(
        'busy',
        `Downloading model v${candidate.deploymentVersion} (${candidate.engine}${
          candidate.modelType ? `/${candidate.modelType}` : ''
        })…`
      );
      const zip = await downloadEiHistoricDeployment(
        ei.apiKey,
        selectedProjectId,
        candidate.deploymentVersion
      );
      setBoth('busy', `Unpacking model (${(zip.size / 1024).toFixed(0)} KB)…`);
      const name = projectName(selectedProjectId);
      const loaded = await loadEiModelFromZip(zip, name);
      setModel({ loaded, name });
      setBoth('ok', modelSummary(name, loaded));
    } catch (e) {
      setBoth('err', `Fetch model: ${explainError(e)}`);
    } finally {
      setModelLoading(false);
    }
  };

  const onBuildBrowserDeployment = async () => {
    if (!ei.apiKey) {
      setBoth('err', 'Enter your Edge Impulse API key first');
      return;
    }
    if (!selectedProjectId) {
      setBoth('err', 'Pick a project first');
      return;
    }
    setModelLoading(true);
    try {
      setBoth('busy', 'Starting WebAssembly (browser) build…');
      const { jobId } = await buildEiDeployment(ei.apiKey, selectedProjectId);
      setBoth('busy', `Build job #${jobId} queued, waiting for it to finish…`);
      await waitForEiJob(ei.apiKey, selectedProjectId, jobId, {
        onProgress: (elapsed) => {
          setBoth(
            'busy',
            `Build job #${jobId} running (${Math.floor(elapsed / 1000)}s)…`
          );
        },
      });
      setBoth('busy', 'Build done — downloading model…');
      const history = await listEiDeploymentHistory(
        ei.apiKey,
        selectedProjectId
      );
      const candidate = history.find(
        (e) => isWasmBrowser(e) && !e.impulseIsDeleted
      );
      if (!candidate) {
        throw new Error(
          'Build finished but no WebAssembly deployment shows up in history'
        );
      }
      const zip = await downloadEiHistoricDeployment(
        ei.apiKey,
        selectedProjectId,
        candidate.deploymentVersion
      );
      const name = projectName(selectedProjectId);
      const loaded = await loadEiModelFromZip(zip, name);
      setModel({ loaded, name });
      setBoth('ok', modelSummary(name, loaded, true));
    } catch (e) {
      setBoth('err', `Build deployment: ${explainError(e)}`);
    } finally {
      setModelLoading(false);
    }
  };

  const onLoadModelFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const wasmFile =
      all.find((f) => f.name.toLowerCase().endsWith('.wasm')) ?? null;
    const jsFiles = all.filter((f) => f.name.toLowerCase().endsWith('.js'));
    const jsFile =
      jsFiles.find((f) =>
        f.name.toLowerCase().includes('edge-impulse-standalone')
      ) ??
      jsFiles.find(
        (f) => !/^run-impulse|^run-classifier|^index\.js$/i.test(f.name)
      ) ??
      jsFiles[0] ??
      null;
    if (!jsFile || !wasmFile) {
      setBoth(
        'err',
        'Pick BOTH the EI .js and .wasm from the unzipped WebAssembly deployment.'
      );
      return;
    }
    setModelLoading(true);
    setBoth('busy', `Loading model ${jsFile.name}…`);
    try {
      const loaded = await loadEiModel(jsFile, wasmFile, jsFile.name);
      const name = jsFile.name.replace(/\.js$/i, '');
      setModel({ loaded, name });
      setBoth('ok', modelSummary(jsFile.name, loaded));
    } catch (e) {
      setBoth('err', `Model load: ${(e as Error).message}`);
    } finally {
      setModelLoading(false);
      if (modelFilesRef.current) modelFilesRef.current.value = '';
    }
  };

  const onUnloadModel = () => {
    setModel(null);
    setEiLive(false);
    setBoth('ok', 'Model unloaded');
  };

  // ---- Render ------------------------------------------------------------

  const previewHint =
    previewSource === 'robot-pov'
      ? 'Detections appear as boxes on the Robot POV preview in the bottom-left.'
      : 'Detections appear as boxes on the virtual-camera preview in the bottom-left.';

  const inlineStatus = inferenceStatus.kind !== 'idle' && (
    <div
      className={`ei-status ${inferenceStatus.kind}`}
      role="status"
      aria-live="polite"
    >
      {inferenceStatus.kind === 'busy' && (
        <span className="ei-spinner" aria-hidden />
      )}
      <span>{inferenceStatus.msg}</span>
    </div>
  );

  const topClass = result
    ? [...result.classification].sort((a, b) => b.value - a.value)[0]
    : undefined;

  return (
    <CollapsibleCard
      heading="Inference (Edge Impulse model)"
      badge={model ? (eiLive ? 'live' : 'loaded') : undefined}
    >
      {!model ? (
        <div className="ei-stack">
          <p className="ei-note">
            Object detection (YOLO/MobileNet) and FOMO models are supported.
          </p>
          <fieldset className="ei-group">
            <legend>From your project</legend>
            <button
              onClick={onListProjects}
              disabled={
                modelLoading ||
                // `?bypassAuth=1` lifts the key gate for offline UI demos.
                !eiAuthSatisfied(ei.apiKey, URL_FLAGS.bypassAuth) ||
                inferenceStatus.kind === 'busy'
              }
              title={
                !eiAuthSatisfied(ei.apiKey, URL_FLAGS.bypassAuth)
                  ? 'Set your API key in the Edge Impulse · auth card above'
                  : undefined
              }
            >
              {inferenceStatus.kind === 'busy' &&
              inferenceStatus.msg.startsWith('Listing')
                ? '… listing'
                : projects
                  ? '↻ Refresh projects'
                  : '🔑 List projects'}
            </button>
            {projects && projects.length > 0 && (
              <>
                {projects.length === 1 ? (
                  <div className="ei-field">
                    <span className="ei-field-label">Project</span>
                    <div className="ei-project-name">
                      {projects[0].name}
                      {projects[0].owner ? ` · ${projects[0].owner}` : ''}
                    </div>
                  </div>
                ) : (
                  <label className="ei-field">
                    <span className="ei-field-label">Project</span>
                    <select
                      className="ei-select"
                      value={selectedProjectId ?? ''}
                      onChange={(e) =>
                        setSelectedProjectId(
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                    >
                      <option value="">(pick one)</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.owner ? ` · ${p.owner}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  onClick={onBuildBrowserDeployment}
                  disabled={modelLoading || !selectedProjectId}
                  title="Trigger a fresh WebAssembly (browser) build in the Studio, then auto-load it. Use this if the existing deployment is Node.js-only or there isn't one yet."
                >
                  🔨 Build browser deployment
                </button>
                <button
                  className="primary"
                  onClick={onFetchModel}
                  disabled={modelLoading || !selectedProjectId}
                >
                  {modelLoading ? '… loading' : '⤓ Fetch & load model'}
                </button>
              </>
            )}
          </fieldset>
          <fieldset className="ei-group">
            <legend>From file</legend>
            <p className="ei-note">
              Upload the <code>edge-impulse-standalone.js</code> +{' '}
              <code>.wasm</code> from an unzipped EI{' '}
              <strong>WebAssembly (browser)</strong> deployment.
            </p>
            <input
              ref={modelFilesRef}
              className="ei-file-input"
              type="file"
              accept=".js,.wasm"
              multiple
              disabled={modelLoading}
              onChange={(e) => void onLoadModelFiles(e.target.files)}
            />
          </fieldset>
          {inlineStatus}
        </div>
      ) : (
        <div className="ei-stack">
          <div>
            <div className="ei-model-name">{model.name}</div>
            <div className="ei-model-meta">
              {`${model.loaded.info.inputWidth}×${model.loaded.info.inputHeight} · ${
                model.loaded.info.isRgb ? 'RGB' : 'GRAY'
              }${model.loaded.info.isObjectDetection ? ' · obj-det' : ''}${
                model.loaded.info.hasVisualAnomaly ? ' · anomaly' : ''
              }`}
              {model.loaded.info.labels.length > 0 && (
                <div>
                  {model.loaded.info.labels.length} labels
                  {model.loaded.info.labels.length <= 6 &&
                    `: ${model.loaded.info.labels.join(', ')}`}
                </div>
              )}
            </div>
          </div>
          <SliderRow
            label="Threshold"
            value={eiThreshold}
            min={0.05}
            max={0.95}
            step={0.05}
            onChange={setEiThreshold}
            formatValue={(v) => `${(v * 100).toFixed(0)}%`}
          />
          <div className="button-row" style={{ marginTop: 0 }}>
            <button
              className="primary"
              disabled={!engine}
              onClick={() => void runInference()}
            >
              Run once
            </button>
            <button
              className={eiLive ? 'danger' : ''}
              disabled={!engine}
              onClick={() => setEiLive(!eiLive)}
            >
              {eiLive ? '■ Stop live' : '▶ Live'}
            </button>
          </div>
          <p className="ei-note">{previewHint}</p>
          {result && (
            <p className="ei-note">
              {result.bounding_boxes.length} boxes
              {topClass &&
                ` · top: ${topClass.label} ${(topClass.value * 100).toFixed(0)}%`}
              {typeof result.anomaly === 'number' &&
                ` · anomaly ${result.anomaly.toFixed(2)}`}
            </p>
          )}
          <button onClick={onUnloadModel}>Unload model</button>
          {inlineStatus}
        </div>
      )}
      {model &&
        result &&
        pipRect &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: pipRect.left,
              top: pipRect.top,
              width: pipRect.width,
              height: pipRect.height,
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            <InferenceOverlay
              result={result}
              modelInfo={model.loaded.info}
              threshold={eiThreshold}
              width={pipRect.width}
              height={pipRect.height}
              pixelRatio={Math.min(2, Math.max(1, window.devicePixelRatio || 1))}
            />
          </div>,
          document.body
        )}
    </CollapsibleCard>
  );
}
