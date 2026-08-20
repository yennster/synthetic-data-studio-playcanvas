import { useEffect, useRef } from 'react';
import { clamp } from '../lib/math';
import type { EiModelInfo, EiResult } from '../lib/eiModel';

/**
 * Draws Edge Impulse model output — bounding boxes for object
 * detection, centroid dots for FOMO, heatmap cells for visual anomaly
 * — on a canvas meant to sit directly over the capture-camera PiP
 * preview.
 *
 * Model coordinates arrive in INPUT pixel space (e.g. 96×96), so we
 * rescale to overlay-pixel space using the loaded model's input
 * dimensions. Staying in canvas (not SVG) keeps us in the same
 * reference frame as the preview pixels, which simplifies scaling and
 * avoids subpixel mismatches.
 *
 * Purely presentational: the caller supplies the result + model info
 * and positions this component over the preview rect (it fills its
 * nearest positioned ancestor via `position: absolute; inset: 0`).
 */
export function InferenceOverlay({
  result,
  modelInfo,
  threshold,
  width,
  height,
  pixelRatio = 1,
}: {
  result: EiResult | null;
  modelInfo: EiModelInfo | null;
  threshold: number;
  /** Overlay size in CSS pixels (should match the preview rect). */
  width: number;
  height: number;
  /** Backing-store scale for crisp strokes on hi-DPI (clamp to ≤2). */
  pixelRatio?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!result || !modelInfo) return;

    const sx = width / modelInfo.inputWidth;
    const sy = height / modelInfo.inputHeight;

    // FOMO models output small cells whose center is the centroid; draw
    // both the box (light) and a stronger center dot. Standard object
    // detection bbox sizes are larger so the same renderer Just Works.
    const visible = result.bounding_boxes.filter((b) => b.value >= threshold);
    for (const b of visible) {
      const x = b.x * sx;
      const y = b.y * sy;
      const w = b.width * sx;
      const h = b.height * sy;
      const isFomo =
        b.width <= modelInfo.inputWidth / 8 &&
        b.height <= modelInfo.inputHeight / 8;

      // Outline — thick, high-contrast against any background. Black
      // halo underneath the colored stroke makes it visible on both
      // light and dark scene content.
      const color = colorFor(b.label);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = colorFor(b.label, 0.15);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      // Centroid dot — extra-prominent for FOMO.
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, isFomo ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Label pill above the box (or below if too close to the top).
      const text = `${b.label} ${(b.value * 100).toFixed(0)}%`;
      ctx.font = '700 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
      const tw = ctx.measureText(text).width;
      const pillPadX = 6;
      const pillH = 18;
      const pillW = tw + pillPadX * 2;
      const labelX = clamp(x, 0, width - pillW);
      const labelAbove = y - pillH >= 0;
      const labelY = labelAbove ? y - pillH : Math.min(y, height - pillH);
      ctx.fillStyle = color;
      ctx.fillRect(labelX, labelY, pillW, pillH);
      ctx.fillStyle = '#0b0d10';
      ctx.fillText(text, labelX + pillPadX, labelY + pillH - 5);
    }

    // Visual anomaly heatmap (if present) — translucent red overlay
    // proportional to the cell value.
    if (result.visual_ad_grid_cells && result.visual_ad_grid_cells.length > 0) {
      for (const c of result.visual_ad_grid_cells) {
        if (c.value < threshold) continue;
        ctx.fillStyle = `rgba(248,113,113,${Math.min(0.7, c.value)})`;
        ctx.fillRect(c.x * sx, c.y * sy, c.width * sx, c.height * sy);
      }
    }
  }, [result, modelInfo, threshold, width, height, pixelRatio]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(1, Math.round(width * pixelRatio))}
      height={Math.max(1, Math.round(height * pixelRatio))}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        transform: 'none',
        zIndex: 3,
      }}
    />
  );
}

/**
 * Stable label→color so the same class always draws the same hue.
 * Deterministic hash: h = h*31 + charCode (>>> 0), hue = h % 360.
 */
export function colorFor(label: string, alpha = 1): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return alpha === 1
    ? `hsl(${hue} 80% 60%)`
    : `hsla(${hue} 80% 60% / ${alpha})`;
}
