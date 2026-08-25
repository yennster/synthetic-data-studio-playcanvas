import { useEffect } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';
import { sampleCameraTrajectory } from '../lib/cameraTrajectory';

/** PiP preview width in CSS pixels (fixed; height follows capture aspect). */
export const PIP_WIDTH = 240;
/** Margin between the PiP preview and the canvas edges, CSS pixels. */
export const PIP_MARGIN = 12;

/** PiP height for a given capture resolution: fixed width × aspect. */
export function pipHeight(captureWidth: number, captureHeight: number): number {
  return Math.round(PIP_WIDTH * (captureHeight / Math.max(1, captureWidth)));
}

/**
 * PiP viewport rect (CSS px, y from the canvas top) for the bottom-RIGHT
 * placement (the sidebar lives on the left in this rebuild). Pure so it
 * can be unit-tested and shared with the DOM frame that VisionPanel
 * draws around the preview.
 */
export function computePipRect(
  captureWidth: number,
  captureHeight: number,
  canvasHeight: number,
  canvasWidth?: number
): { x: number; y: number; w: number; h: number } {
  const h = pipHeight(captureWidth, captureHeight);
  const cw = canvasWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  return {
    x: cw - PIP_WIDTH - PIP_MARGIN,
    y: canvasHeight - h - PIP_MARGIN,
    w: PIP_WIDTH,
    h,
  };
}

/**
 * Keeps the engine's capture/preview cameras in step with the store's
 * capture settings. Mounted once by the shell (inside EngineProvider):
 *
 *  - `camPos` / `camTarget` / `fov` changes → `engine.setCaptureCameraPose`
 *    (poses both the offscreen capture rig and the in-canvas PiP camera).
 *  - `capture.lightIntensity` → `engine.environment.setLightIntensity`
 *    so the Scene / Virtual-camera sliders read back live.
 *  - PiP visibility + placement → `engine.setPreviewRect`: bottom-left,
 *    240 px wide, height from the capture aspect, 12 px margins, only in
 *    the detection/anomaly modes. Recomputed on window resize.
 */
export function useCaptureCameraSync(): void {
  const engine = useEngine();
  const mode = useStore((s) => s.mode);
  const camPos = useStore((s) => s.capture.camPos);
  const camTarget = useStore((s) => s.capture.camTarget);
  const fov = useStore((s) => s.capture.fov);
  const lightIntensity = useStore((s) => s.capture.lightIntensity);
  const width = useStore((s) => s.capture.width);
  const height = useStore((s) => s.capture.height);
  const trajectory = useStore((s) => s.capture.cameraTrajectory);
  const trajectoryRadius = useStore((s) => s.capture.trajectoryRadius);
  const trajectoryHeight = useStore((s) => s.capture.trajectoryHeight);
  const batchCount = useStore((s) => s.capture.batchCount);
  const lockToTrajectory = useStore((s) => s.capture.lockToTrajectory);
  const trajectoryPhase = useStore((s) => s.capture.trajectoryPhase);

  // Lock mode: the capture camera rides the trajectory scaffold. Any
  // change to the path (or the phase slider) re-derives camPos, so the
  // camera, its gizmo, and captures all stay pinned to the path.
  useEffect(() => {
    if (!lockToTrajectory || trajectory === 'random') return;
    const SEGMENTS = 512;
    const p = sampleCameraTrajectory({
      trajectory,
      index: Math.round(trajectoryPhase * SEGMENTS),
      total: SEGMENTS,
      target: camTarget,
      radius: trajectoryRadius,
      height: trajectoryHeight,
    });
    const next: [number, number, number] = [
      Math.round(p[0] * 100) / 100,
      Math.round(p[1] * 100) / 100,
      Math.round(p[2] * 100) / 100,
    ];
    const cur = useStore.getState().capture.camPos;
    if (
      Math.abs(cur[0] - next[0]) > 1e-6 ||
      Math.abs(cur[1] - next[1]) > 1e-6 ||
      Math.abs(cur[2] - next[2]) > 1e-6
    ) {
      useStore.getState().setCapture({ camPos: next });
    }
  }, [
    lockToTrajectory,
    trajectory,
    trajectoryPhase,
    camTarget,
    trajectoryRadius,
    trajectoryHeight,
  ]);

  // Gizmo handles are draggable in the viewport — write drags back to
  // the store (rounded so the number fields stay readable).
  useEffect(() => {
    if (!engine) return;
    const r = (v: number) => Math.round(v * 100) / 100;
    engine.onGizmoHandleDrag = (handle, pos) => {
      const value: [number, number, number] = [r(pos[0]), r(pos[1]), r(pos[2])];
      useStore
        .getState()
        .setCapture(handle === 'camera' ? { camPos: value } : { camTarget: value });
    };
    return () => {
      engine.onGizmoHandleDrag = null;
    };
  }, [engine]);

  // Editor gizmos: capture-camera frustum, target marker, trajectory path.
  // Visible in the vision modes only; never rendered by capture cameras.
  useEffect(() => {
    if (!engine) return;
    engine.gizmos.setState({
      visible: mode === 'detection' || mode === 'anomaly',
      camPos,
      camTarget,
      fov,
      aspect: width / Math.max(1, height),
      trajectory,
      trajectoryRadius,
      trajectoryHeight,
      batchCount,
    });
    return () => engine.gizmos.setState(null);
  }, [
    engine,
    mode,
    camPos,
    camTarget,
    fov,
    width,
    height,
    trajectory,
    trajectoryRadius,
    trajectoryHeight,
    batchCount,
  ]);

  useEffect(() => {
    // `mode` is a dep so returning from robot mode (whose POV drive moved
    // the preview camera) restores the vision pose and FOV.
    engine?.setCaptureCameraPose(camPos, camTarget, fov);
  }, [engine, mode, camPos, camTarget, fov]);

  useEffect(() => {
    engine?.environment.setLightIntensity(lightIntensity);
  }, [engine, lightIntensity]);

  useEffect(() => {
    if (!engine) return;
    const visible = mode === 'detection' || mode === 'anomaly';
    const apply = () => {
      if (!visible) {
        engine.setPreviewRect(false);
        return;
      }
      const canvas = engine.app.graphicsDevice.canvas as HTMLCanvasElement;
      const canvasHeight = canvas.clientHeight || window.innerHeight;
      engine.setPreviewRect(true, computePipRect(width, height, canvasHeight));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      engine.setPreviewRect(false);
    };
  }, [engine, mode, width, height]);
}
