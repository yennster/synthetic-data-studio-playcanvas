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
- [ ] Entity selection: click-select, multi-select, drag-move, keyboard shortcuts (original parity)
- [ ] Capture-camera gizmo (frustum visual on a gizmo-only layer) + orbit-center marker

## Phase 2 — Gaussian splats (new headline feature)
- [x] Import: drag&drop + picker for .ply/.compressed.ply/.sog
- [ ] Import: .spz (needs external SpzParser + zstd wasm from engine examples)
- [x] Splat library card: roles (backdrop/object), labels, remove
- [x] Create: mesh→splat converter (area-weighted sampling + texture colors)
- [x] Create: procedural primitives (plane/box/sphere)
- [ ] Create: image→splat plane (GSplatImage-style)
- [x] Edit: GPU erase brush (right-drag), erase/crop box API, reset
- [ ] Edit: apply edits destructively + export edited imported scans (needs GPU→CPU readback of streams)
- [x] Export created splats to 3DGS .ply
- [x] Persist splats + models in IndexedDB, restore on reload with transforms
- [ ] Splat transform UI (position/rotation/scale controls per entry)

## Phase 3 — Capture & export pipeline
- [x] Offscreen 2× SSAA render-target capture, hidden-tab safe
- [x] Bounding boxes: view-proj AABB projection at output res (orig contract, unit-tested)
- [x] Camera trajectories (ported, 154 tests) + random jitter + lighting/object randomization
- [x] ZIP export in exact EI layout (bounding_boxes.labels sidecar; STORE-only writer)
- [x] Realism pixel pass (ported: chromatic→jitter→vignette→grain, JPEG round-trip)
- [x] Seeded RNG (mulberry32, ?seed=)
- [~] Vision capture UI cards (agent in flight)

## Phase 4 — Edge Impulse
- [x] Full EI client ported (ingestion + Studio API + sidecars, 65 tests)
- [x] WASM model loader ported (eiModel.ts, all Emscripten quirks)
- [~] Auth card / upload card / inference card + overlay (agent in flight)
- [ ] Verify a real end-to-end upload against a live EI project (needs API key — user)

## Phase 5 — Modes
- [~] Object detection + visual anomaly modes (vision panel agent in flight)
- [~] Motion mode: analytic IMU synthesis + panel (agent in flight; MuJoCo parity marked 🔀)
- [~] Rover: kinematic sim + lidar (ray-AABB) + panel + rig (agents in flight)
- [~] Arm: Braccio playback via ported IK/trajectories + rig (agents in flight)
- [ ] Robot POV image capture wiring (runner captureImage → POV camera through CaptureRig)
- [ ] Physics: real dynamics (Ammo/Rapier), conveyor belt, drop/settle behaviors
- [ ] Hand tracking (MediaPipe) for motion mode
- [ ] Realism diffusion mode endpoint (api/realism-diffusion port — hidden mode, low priority)

## Phase 6 — Platform
- [ ] USDZ import (needle-tools OpenUSD wasm + COOP/COEP headers) — GLB works today
- [x] URL params parsed (ported, full surface) + applyUrlPresets subset
- [ ] applyUrlPresets: onlyMode filtering, autoUpload, armPose, gizmos flag behaviors
- [x] Theme toggle (dark/light) with engine sync
- [x] Persistence (localStorage v1 + IndexedDB assets)
- [ ] Iframe embed height messaging (initPostContentHeight port); embed docs
- [ ] Custom floor/skybox textures + env presets (studio/warehouse/whitebox/outdoor)
- [ ] Deploy (Vercel) + og-card + screenshots
