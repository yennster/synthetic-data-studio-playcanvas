# Project Status

> **Purpose of this file**: living snapshot of where the project is, so any agent (or human)
> can pick up work without reading the whole git history. Update this file **every work session**:
> bump the date, move items between sections, and keep "Next steps" honest.
> Detailed task list: [TODO.md](TODO.md). Design rationale: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
> Original app's behavior contract: [docs/ORIGINAL-FEATURES.md](docs/ORIGINAL-FEATURES.md).
> Parity tracking: [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md).

**Last updated:** 2026-08-20 (end of session 1)

## What this project is

A ground-up reimplementation of [yennster/synthetic-data-studio](https://github.com/yennster/synthetic-data-studio)
(React + three.js) on the **PlayCanvas engine**, adding **gaussian splat import and in-app splat
creation/editing** for hyper-realistic synthetic data. Repo:
`github.com/yennster/synthetic-data-studio-playcanvas` (private).

- Engine: `playcanvas` **2.21.4** (npm), TypeScript, Vite, React, zustand.
- `npm run dev` → http://localhost:5173. `npx vitest run` → 399 tests. `npx tsc -b` clean. CI on push.

## Working today (all verified in-browser this session)

**Gaussian splats (headline additions)**
- Import `.ply` / `.compressed.ply` / `.sog` (drag-drop/picker); role = backdrop (hides
  procedural ground) or labeled object (gets bounding boxes in captures)
- Create in-app: procedural primitives + **mesh→splat conversion** (GLB → splats with texture colors)
- Edit: GPU **erase brush** (right-drag), crop/erase box API, reset — works on imported scans
- Export created splats to standard 3DGS `.ply` (round-trip verified)
- Splats + models persist in IndexedDB and restore on reload with transforms

**All four modes, end-to-end**
- **Object detection**: scene objects/GLB/splat-objects → single capture (PNG+`bounding_boxes.labels`
  zip) and batch (trajectories: circle/figure8/arc/spiral/orbit_dome, camera/light/object jitter,
  base restore) — verified with pixel-correct boxes; PiP virtual-camera preview (bottom-right)
- **Visual anomaly**: batch label, no boxes (shares VisionPanel)
- **Motion**: analytic IMU synthesis (drop/throw/push/shake w/ original param semantics + LSM6DSO
  noise model) — procedural batch → EI upload or zip w/ `info.labels`; manual record path
- **Robotics**: kinematic rover (cruise/collision/stuck + analytic ray-AABB lidar) and Braccio arm
  (5 trajectories via ported IK, pickup outcome metadata) — live rigs, POV camera PiP, 20 Hz
  recording, upload/zip routing, ROS 2 JSONL export, POV image capture with boxes

**Edge Impulse** — full ported client (65 tests): auth card, category/split, ingestion uploads
(images w/ `x-bounding-boxes`, IMU/lidar/fused acquisition JSON + HMAC), Studio API (projects,
deployment history, build wasm, retrain, job polling), in-browser WASM inference cards + overlay.
*Not yet exercised against a live EI project — needs a real API key (user).*

**Platform** — dark/light theme, URL presets (`?mode= ?seed= ?camera= ?apiKey=` etc.),
embed/minimal chrome flags, localStorage persistence (v1), hidden-tab-safe capture.

## Known gaps (tracked in TODO.md)

- `.spz` import (needs SpzParser + zstd wasm); image→splat; splat paint-tint; exporting *edited
  imported* scans (needs GPU stream readback)
- Physics engine + conveyor (objects instant-settle for now); hand tracking (MediaPipe); USDZ
- Env preset skyboxes (warehouse/outdoor), custom floor/wall textures
- Entity click-selection/gizmos in viewport; iframe height messaging; deploy
- Minor: robot zip filename index uses buildFileName timestamp counter (name said `_3` on a
  2-count run — check `robotRunner` zip naming against contract)

## Architecture cheat-sheet (details in docs/ARCHITECTURE.md)

- `src/lib/` renderer-agnostic + fully tested (the EI wire formats are locked by ported tests)
- `StudioEngine` facade owns managers (splats/models/objects/capture/editor); store↔engine sync
  lives in `EngineContext` (never call `engine.objects.sync` from UI)
- Mode runners (`src/modes/*.ts`) are pure orchestration over the facade; panels only trigger them
- Dev handles: `window.__studio` (engine), `window.__useStore` (store — survives HMR forks)

## Session 1 stats

~90 files of source + tests written; 399 tests green; 4 workflows / 18 subagents used
(feature-mapping, lib porting, docs, UI build-out); every mode verified live in the browser.
