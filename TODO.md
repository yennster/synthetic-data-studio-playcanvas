# TODO

> Actionable task list. Check items off as they land; add new ones at the right phase.
> Keep in sync with [STATUS.md](STATUS.md) and [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md).
> `[~]` = in progress.

## Phase 0 — Foundation
- [x] Vite + React + TS scaffold, deps (`playcanvas@2.21.4`, `zustand`, `jszip`, `vitest`)
- [x] Feature map of original synthetic-data-studio → docs/ORIGINAL-FEATURES.md
- [x] docs/FEATURE-PARITY.md matrix + docs/ARCHITECTURE.md
- [x] LICENSE (Apache-2.0), README, package.json metadata (author Jenny Speelman)
- [x] Private GitHub repo `yennster/synthetic-data-studio-playcanvas`, pushed
- [x] CI: GitHub Actions tsc + vitest + build

## Phase 1 — Engine core
- [x] `src/engine/createApp.ts`: AppBase bootstrap (GSplat systems, handlers, fill window)
- [x] Scene environment: ground + two-light rig, theme-aware colors
- [x] View camera with CameraControls orbit/pan/zoom
- [x] Entity selection: click-select + viewport drag/rotate/scale (SelectionController); multi-select still open
- [x] Capture-camera gizmo (frustum + target marker + trajectory path on the Immediate layer, excluded from captures) with draggable handles (Shift = height)

## Phase 2 — Gaussian splats (new headline feature)
- [x] Import: drag&drop + picker for .ply/.compressed.ply/.sog
- [x] Import: .spz (src/lib/spz.ts — gzip, no zstd needed; verified against a real Niantic sample)
- [x] Splat library card: roles (backdrop/object), labels, remove
- [x] Create: mesh→splat converter (area-weighted sampling + texture colors)
- [x] Create: procedural primitives (plane/box/sphere)
- [x] Create: image→splat plane ("+ Image" button; one splat per non-transparent pixel)
- [x] Edit: GPU erase brush (right-drag), erase/crop box API, reset
- [x] Edit: paint tint brush (erase|tint toggle, color + strength, op-log replay)
- [x] Edit: apply edits destructively + export edited imported scans (CPU op log + SplatIterator readback; edits replay on reload)
- [x] Export created splats to 3DGS .ply
- [x] Persist splats + models in IndexedDB, restore on reload with transforms
- [x] Splat transform UI (position/rotation/scale in the edit panel)

## Phase 3 — Capture & export pipeline
- [x] Offscreen 2× SSAA render-target capture, hidden-tab safe
- [x] Bounding boxes: view-proj AABB projection at output res (orig contract, unit-tested)
- [x] Camera trajectories (ported, 154 tests) + random jitter + lighting/object randomization
- [x] ZIP export in exact EI layout (bounding_boxes.labels sidecar; STORE-only writer)
- [x] Realism pixel pass (ported: chromatic→jitter→vignette→grain, JPEG round-trip)
- [x] Seeded RNG (mulberry32, ?seed=)
- [x] Vision capture UI cards (Scene/Objects/VirtualCamera/Realism/Capture, PiP preview)

## Phase 4 — Edge Impulse
- [x] Full EI client ported (ingestion + Studio API + sidecars, 65 tests)
- [x] WASM model loader ported (eiModel.ts, all Emscripten quirks)
- [x] Auth card / upload card / inference card + overlay
- [ ] Verify a real end-to-end upload against a live EI project (needs API key — user)

## Phase 5 — Modes
- [x] Object detection + visual anomaly modes (verified in-browser)
- [x] Motion mode: analytic IMU synthesis + panel (MuJoCo parity marked 🔀; verified)
- [x] Rover: kinematic sim + lidar (ray-AABB) + panel + rig (verified)
- [x] Arm: Braccio playback via ported IK/trajectories + rig (verified)
- [x] Robot POV image capture wiring (runner captureImage → POV camera through CaptureRig)
- [x] Physics: real Rapier dynamics (src/engine/physics/), conveyor belt, drop/settle batches
- [x] Hand tracking (MediaPipe) for motion mode (pinch-grab body + driven IMU sampler)
- [ ] Realism diffusion mode endpoint (api/realism-diffusion port — hidden mode, low priority)

## Phase 6 — Platform
- [ ] USDZ import (needle-tools OpenUSD wasm + COOP/COEP headers) — GLB works today
- [x] URL params parsed (ported, full surface) + applyUrlPresets subset
- [x] applyUrlPresets: onlyMode, autoUpload, armPose, bypassAuth, env, conveyor, gizmos all wired
- [x] Theme toggle (dark/light) with engine sync
- [x] Persistence (localStorage v1 + IndexedDB assets)
- [x] Iframe embed height messaging (initPostContentHeight wired from main.tsx)
- [x] Custom floor/skybox textures + env presets (studio/warehouse/whitebox/outdoor)
- [x] Deploy (Vercel → canvas.jennyspeelman.dev); README screenshots: user-provided, placeholders in README
