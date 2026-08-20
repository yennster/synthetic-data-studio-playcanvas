/**
 * Pure capture-file helpers shared by the vision and robot pipelines:
 * Edge Impulse sidecar formats and capture filenames. Ported verbatim
 * from the original app's capture.ts (the render half was rebuilt on
 * PlayCanvas in src/engine/capture/).
 */

import type { Capture } from './types';

/**
 * Builds the Edge Impulse `bounding_boxes.labels` sidecar: files with zero
 * boxes are omitted from the map entirely; coordinates are top-left-origin
 * pixels at output resolution.
 */
export function buildBoundingBoxLabelsFile(captures: Capture[]): string {
  const boundingBoxes: Record<
    string,
    { label: string; x: number; y: number; width: number; height: number }[]
  > = {};
  for (const c of captures) {
    if (c.boxes.length === 0) continue;
    boundingBoxes[c.filename] = c.boxes.map((b) => ({ ...b }));
  }
  return JSON.stringify(
    {
      version: 1,
      type: 'bounding-box-labels',
      boundingBoxes,
    },
    null,
    2
  );
}

/** `${prefix}.${ISO ts, [:.]→'-', Z stripped}.${idx padded to 4}.${ext}` */
export function makeFilename(prefix: string, idx: number, ext = 'png'): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const safe = (prefix || 'capture').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}.${ts}.${String(idx).padStart(4, '0')}.${ext}`;
}

/** Anchor-click download; object URL revoked after 1 s. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
