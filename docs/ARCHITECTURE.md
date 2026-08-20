# Architecture

How the PlayCanvas rebuild is put together, and why. For what the app must
do, see [ORIGINAL-FEATURES.md](ORIGINAL-FEATURES.md) (the behavior contract
from the three.js original) and [FEATURE-PARITY.md](FEATURE-PARITY.md).

## Layering

```
React UI (src/ui, src/App.tsx)
   │  reads zustand store, calls engine facade + mode runners
   ▼
zustand store (src/store/useStore.ts)      ← single source of UI truth
   │  engine mirrors sceneObjects; managers mirror back splats/models
   ▼
StudioEngine facade (src/engine/StudioEngine.ts)
   ├─ SplatManager      import/create/label gaussian splats
   ├─ SplatEditor       GPU erase/crop via splatVisible stream
   ├─ ModelManager      GLB props
   ├─ ObjectManager     spawned primitives (mirrors store.sceneObjects)
   ├─ CaptureRig        offscreen SSAA capture + readback
   ├─ preview camera    in-canvas PiP (camera.rect viewport)
   └─ sceneEnvironment  ground + light rig
   ▼
PlayCanvas engine 2.21 (AppBase, GSplat unified rendering)

src/modes/   — orchestration (visionRunner, motionRunner, robotRunner, sims)
src/lib/     — pure logic ported from the original + its test suites
```

Rules that keep this sane:

- **`src/lib/` is renderer-agnostic.** No `playcanvas` imports. Anything
  that needs the scene takes an injected callback (e.g. `scanLidar`'s
  `castRay`). This is what let the original's 335-test suite port over
  wholesale — those tests are the wire-format spec for Edge Impulse.
- **The store owns UI state; the engine owns entities.** `sceneObjects`
  flows store→engine via one subscription (EngineContext); splat/model
  entries flow engine→store via manager `onChange`. UI never touches
  entities directly and never calls `engine.objects.sync`.
- **Mode runners are functions, not components.** `visionRunner.ts` etc.
  read the store imperatively, drive the engine facade, and return
  results; React components only trigger them and render progress.

## Gaussian splats

- **Import**: `new Asset(name, 'gsplat', { url, filename, contents })`.
  Parser selection keys off `filename`'s extension; `contents` is a
  `Response` wrapping the dropped `File` so nothing round-trips through
  fetch. Formats: `.ply`, `.compressed.ply`, `.sog` (`.spz` needs the
  external parser + zstd wasm — TODO).
- **Create**: `GSplatFormat.createSimpleFormat(device)` →
  `GSplatContainer(device, count, format)` → write `dataCenter`
  (RGBA32F x,y,z,size) + `dataColor` (RGBA16F halves) + `centers` + aabb
  → `container.update(count)`. Component uses `unified: true`.
  Mesh→splat samples triangles area-weighted with UV texture lookup.
- **Edit**: extra instance stream `splatVisible` (R8) + `GSplatProcessor`
  shaders write 0 inside the erase sphere / outside the crop box; a
  work-buffer modifier zeroes the scale of invisible splats. Works on
  imported scans; non-destructive (reset refills 255).
- **Export**: in-app-created splats keep their `SplatPoint[]` and
  serialize to standard 3DGS binary PLY (`f_dc = (c-0.5)/SH_C0`,
  `opacity = logit(a)`, `scale = ln(size/2)`, identity rot).

## Capture pipeline

`CaptureRig.captureFrame(w, h, targets)`:

1. Dedicated capture camera renders to a reusable RenderTarget at
   2× (SSAA), enabled only for the two frames of the capture.
2. `texture.read(..., { immediate: true })` async readback; vertical
   flip (GL origin); canvas downsample to output size; PNG encode.
3. Bounding boxes projected on the CPU from the same camera pose:
   view-proj × AABB corners, behind-camera corners skipped, boxes
   clamped/rounded at OUTPUT resolution, <4px dropped — byte-identical
   sidecar semantics to the original.
4. `nextFrame()` waits for `frameend` but pumps `app.tick()` on a 100ms
   interval so hidden tabs still capture (rAF is suspended there).

The PiP preview is a *separate* camera rendering to a viewport rect
(`camera.rect`) — zero readback cost; EI live inference borrows the
CaptureRig (single-flight guarded) when it needs actual pixels.

## Physics (status)

None yet. Spawned objects "instant-settle" to a rest Y computed from
their dimensions; the conveyor and true physics (Ammo or a Rapier port)
are TODO Phase 5. Motion/robot IMU comes from analytic kinematics, not
MuJoCo — deliberate first pass, flagged 🔀 in FEATURE-PARITY.md.

## Persistence

- localStorage (`sds-pc-store` v1): settings, scene objects, pending
  asset metadata. API keys are never persisted.
- IndexedDB (`sds-pc-assets`, stores `splats`/`models`): raw imported
  bytes keyed by entry uuid; created splats persist as their PLY
  serialization so rehydration reuses the normal import path.
- `rehydrateAssets` runs once at boot behind a module-level guard
  (StrictMode-safe) and restores roles/labels/transforms.

## Testing

- `npx vitest run` — lib contract suites (ported) + engine pure-math
  tests (projectBoxes, splatExport). Keep green.
- `npx tsc -b` — strict; `erasableSyntaxOnly` (no parameter properties).
- CI: .github/workflows/test.yml (tsc + vitest + build).
- Browser verification: dev server + `window.__studio` debug handle.
