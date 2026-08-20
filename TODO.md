# TODO

> Actionable task list. Check items off as they land; add new ones at the right phase.
> Keep in sync with [STATUS.md](STATUS.md). `[~]` = in progress.

## Phase 0 — Foundation
- [x] Vite + React + TS scaffold, deps (`playcanvas@2.21.4`, `zustand`, `jszip`, `vitest`)
- [~] Feature map of original synthetic-data-studio → docs/ORIGINAL-FEATURES.md
- [ ] docs/FEATURE-PARITY.md matrix (original feature → status in this repo)
- [ ] LICENSE (Apache-2.0), README, package.json metadata (author yennster / Jenny Speelman)
- [ ] Create private GitHub repo `yennster/synthetic-data-studio-playcanvas`, push initial commit

## Phase 1 — Engine core
- [ ] `src/engine/createApp.ts`: AppBase bootstrap (GSplatComponentSystem, handlers, fill window, resize)
- [ ] Scene manager: ground, lighting, environment/backdrop system, theme-aware clear color
- [ ] Camera rig: orbit controls (CameraControls script), virtual capture camera separate from view camera
- [ ] Entity/selection framework: pick, drag-move, transform gizmo equivalents

## Phase 2 — Gaussian splats (new headline feature)
- [ ] Import: drag&drop + file picker for .ply/.compressed.ply/.sog/.spz → gsplat asset → entity
- [ ] Splat library card: list imported splats, use as **backdrop/environment** or as **object**
- [ ] Create: mesh→splat converter (sample GLB surfaces → GSplatContainer)
- [ ] Create: image→splat plane, procedural primitives (box/sphere/plane clouds)
- [ ] Edit: crop box, sphere-delete, paint tint (GSplatProcessor pipeline)
- [ ] Export edited/created splats to .ply
- [ ] Persist splat assets in IndexedDB (same UX as original's imported assets)

## Phase 3 — Capture & export pipeline
- [ ] Offscreen render target capture at configurable resolution
- [ ] Camera trajectory / randomization (orbit ranges, jitter, distance, height)
- [ ] Domain randomization: lighting, backdrop, object placement, distractors
- [ ] 2D bounding-box computation for labeled objects (project AABBs; match original's format)
- [ ] ZIP export (images + Edge Impulse-compatible labels layout — confirm exact format from feature map)
- [ ] Seeded RNG (port rng.ts semantics)

## Phase 4 — Edge Impulse
- [ ] API-key auth card + project list (port edgeImpulse.ts contract)
- [ ] Ingestion upload: images w/ bounding-box structured labels; category split; progress UI
- [ ] IMU/time-series upload payloads
- [ ] In-browser inference on EI models + overlay (port eiModel.ts approach)

## Phase 5 — Modes (parity with original)
- [ ] Object detection mode
- [ ] Visual anomaly mode
- [ ] Motion / IMU mode (procedural motions + IMU noise model)
- [ ] Rover mode (drive sim, lidar/ToF ring, obstacle scenes)
- [ ] Arm mode (Braccio kinematics, IK, trajectories, pickup outcomes, POV camera)
- [ ] Hand tracking (MediaPipe) — decide priority after feature map
- [ ] Realism pipeline (diffusion img2img api route) — port api/realism-diffusion.ts

## Phase 6 — Platform
- [ ] USDZ/GLB import (GLB native via ContainerHandler; USDZ needs wasm — check headers)
- [ ] URL params + presets (port surface from docs/url-parameters.md)
- [ ] Iframe embed support
- [ ] Theme toggle (light/dark)
- [ ] Tests: port applicable unit tests, add splat-specific ones
- [ ] CI (GitHub Actions test workflow)
