/**
 * Curated sample assets: photoreal gaussian-splat environments/objects
 * and showcase GLB props, loaded from public CDNs on demand (then
 * persisted through the normal import path so they survive reloads).
 * Every entry carries its author and license, shown and linked in the
 * gallery UI: CC-BY-4.0 / CC0 scans and models, plus object scans from
 * the PlayCanvas engine's example assets (credited to PlayCanvas).
 * Full credits: docs/SAMPLE-CREDITS.md.
 */

export interface SampleAsset {
  kind: 'splat' | 'model';
  name: string;
  /** Filename handed to the importer (extension selects the parser). */
  filename: string;
  url: string;
  sizeMB: number;
  author: string;
  license: string;
  sourceUrl: string;
  /** Splats only: how the sample participates in captures. */
  role?: 'backdrop' | 'object';
  /** Default label for detection captures (models + splat objects). */
  label?: string;
  /** Models: desired largest dimension in meters after import. */
  targetSize?: number;
  /** Splat objects: uniform scale applied after grounding. */
  scale?: number;
}

const ENGINE_SPLATS =
  'https://raw.githubusercontent.com/playcanvas/engine/main/examples/assets/splats';
const KHRONOS =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

export const SAMPLE_ASSETS: SampleAsset[] = [
  {
    kind: 'splat',
    name: 'Apartment',
    filename: 'apartment.sog',
    url: `${ENGINE_SPLATS}/apartment.sog`,
    sizeMB: 8.4,
    author: 'Stephane Agullo (sa3d.fr)',
    license: 'CC-BY-4.0',
    sourceUrl: 'https://superspl.at/view?id=cdcec084',
    role: 'backdrop',
  },
  {
    kind: 'splat',
    name: 'Community Hall',
    filename: 'knock-community-hall.sog',
    url: `${ENGINE_SPLATS}/knock-community-hall.sog`,
    sizeMB: 27.8,
    author: 'scbenoit',
    license: 'CC-BY-4.0',
    sourceUrl: 'https://superspl.at/scene/0ff2e6dc',
    role: 'backdrop',
  },
  {
    kind: 'splat',
    name: 'Skull',
    filename: 'skull.sog',
    url: `${ENGINE_SPLATS}/skull.sog`,
    sizeMB: 5.4,
    author: 'PlayCanvas engine examples',
    license: 'PlayCanvas',
    sourceUrl: 'https://github.com/playcanvas/engine/tree/main/examples/assets/splats',
    role: 'object',
    label: 'skull',
    scale: 0.25,
  },
  {
    kind: 'splat',
    name: 'Guitar',
    filename: 'guitar.compressed.ply',
    url: `${ENGINE_SPLATS}/guitar.compressed.ply`,
    sizeMB: 1.5,
    author: 'PlayCanvas engine examples',
    license: 'PlayCanvas',
    sourceUrl: 'https://github.com/playcanvas/engine/tree/main/examples/assets/splats',
    role: 'object',
    label: 'guitar',
    scale: 0.33,
  },
  {
    kind: 'splat',
    name: 'Biker',
    filename: 'biker.compressed.ply',
    url: `${ENGINE_SPLATS}/biker.compressed.ply`,
    sizeMB: 2.5,
    author: 'PlayCanvas engine examples',
    license: 'PlayCanvas',
    sourceUrl: 'https://github.com/playcanvas/engine/tree/main/examples/assets/splats',
    role: 'object',
    label: 'biker',
    scale: 0.8,
  },
  {
    kind: 'model',
    name: 'Damaged Helmet',
    filename: 'DamagedHelmet.glb',
    url: `${KHRONOS}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb`,
    sizeMB: 3.8,
    author: 'theblueturtle_ / ctxwing',
    license: 'CC-BY-4.0',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet',
    label: 'helmet',
    targetSize: 0.6,
  },
  {
    kind: 'model',
    name: 'Avocado',
    filename: 'Avocado.glb',
    url: `${KHRONOS}/Avocado/glTF-Binary/Avocado.glb`,
    sizeMB: 8.1,
    author: 'Microsoft',
    license: 'CC0',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado',
    label: 'avocado',
    targetSize: 0.3,
  },
  {
    kind: 'model',
    name: 'Water Bottle',
    filename: 'WaterBottle.glb',
    url: `${KHRONOS}/WaterBottle/glTF-Binary/WaterBottle.glb`,
    sizeMB: 9.0,
    author: 'Microsoft',
    license: 'CC0',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/WaterBottle',
    label: 'bottle',
    targetSize: 0.3,
  },
  {
    kind: 'model',
    name: 'Lantern',
    filename: 'Lantern.glb',
    url: `${KHRONOS}/Lantern/glTF-Binary/Lantern.glb`,
    sizeMB: 9.6,
    author: 'Microsoft',
    license: 'CC0',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern',
    label: 'lantern',
    targetSize: 0.8,
  },
];

/** Downloads a sample as a File so the normal import path persists it. */
export async function fetchSampleFile(
  sample: SampleAsset,
  onProgress?: (loadedMB: number) => void
): Promise<File> {
  const res = await fetch(sample.url);
  if (!res.ok || !res.body) {
    throw new Error(`${sample.name}: download failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded / (1024 * 1024));
  }
  return new File(chunks as BlobPart[], sample.filename);
}
