import { useEffect } from 'react';
import { useEngine } from '../engine/EngineContext';
import { useStore } from '../store/useStore';

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
