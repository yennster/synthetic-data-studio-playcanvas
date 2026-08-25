# Project Status

> **Purpose of this file**: living snapshot of where the project is, so any agent (or human)
> can pick up work without reading the whole git history. Update this file **every work session**:
> bump the date, move items between sections, and keep "Next steps" honest.
> Detailed task list: [TODO.md](TODO.md). Design rationale: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
> Original app's behavior contract: [docs/ORIGINAL-FEATURES.md](docs/ORIGINAL-FEATURES.md).
> Parity tracking: [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md).

**Last updated:** 2026-08-25 (session 2)

## What this project is

A ground-up reimplementation of [yennster/synthetic-data-studio](https://github.com/yennster/synthetic-data-studio)
(React + three.js) on the **PlayCanvas engine**, adding **gaussian splat import and in-app splat
creation/editing** for hyper-realistic synthetic data. Repo:
`github.com/yennster/synthetic-data-studio-playcanvas` (audited & prepped for public release).

- **Deployed: <https://canvas.jennyspeelman.dev>** (Vercel project
  `synthetic-data-studio-playcanvas`, GitHub-connected + `vercel deploy --prod` from the CLI).
- Engine: `playcanvas` **2.21.4** (npm), TypeScript, Vite, React, zustand.
- `npm run dev` → http://localhost:5173. `npx vitest run` → 399 tests. `npx tsc -b` clean. CI on push.

## Session 2 (2026-08-25): samples, UX from live feedback, deploy

- **Sample gallery** with +/− copy counters: Apartment + Community Hall splat scans (CC-BY-4.0,
  credits shown/linked) and Damaged Helmet / Avocado / Water Bottle / Lantern GLBs (CC-BY/CC0),
  streamed from public CDNs then persisted via the normal import path
- **World convention: scan floor = y 0.** Backdrop placement estimates the floor
  (5th-percentile world-Y near the scan's robust median center) so props/primitives rest ON
  splat floors; `robustSplatCenterWorld` in src/engine/splats/splatPlacement.ts
- **Transforms everywhere** (user feedback): models (move/rotate/resize/copy ⛭ panel),
  spawned objects (position/rotation fields), splats (move/rotate/scale in edit panel)
- **Draggable capture-camera gizmo**: frustum + grab octahedron + pink target cross + teal
  trajectory path; plane drag / Shift-height; Immediate layer excluded from capture & preview
  cameras (verified zero gizmo pixels in captures); "🎯 Use current view" button
- **Procedural skyboxes** (day/sunset/overcast/night) w/ IBL for props — Scene card select,
  persisted; sky verified through scan gaps
- **First-load prompt** (yes/no) offers the Apartment scan as default environment (once per
  browser, key `sds-welcome-choice`)
- HUD controls-help `?` pill; overflow/flex fixes; ModelManager gained
  setTransform/duplicate/normalizeSize; SplatManager gained setTransform
- **Direct manipulation**: SelectionController — click-select any prop/object/splat-object
  (yellow AABB + shortcut chip), drag to move, Shift=height, Alt=rotate, Cmd/Ctrl=scale,
  Esc deselects; trajectory path grabbable in the viewport; "Lock camera to path" + phase
  scrub; Capture card redesigned (chips/sections); sidebar collapse toggle; first-load
  yes/no prompt for the Apartment scan; URL flags wired (onlyMode/gizmos/clearStore/
  autoUpload) + docs/url-parameters.md
- **Media**: README carries commented placeholders for user-provided screenshots
  (docs/media/hero.jpg, path.jpg, edit.jpg); demo video dropped per user request.
  docs/GETTING-STARTED.md + docs/SAMPLE-CREDITS.md added; repo audited for public
  release (no secrets in tree or history, single signed identity, .vercel ignored)
- **Splat object samples**: Skull / Guitar / Biker from the PlayCanvas engine examples added
  to the gallery per the user's decision, attributed to PlayCanvas (docs/SAMPLE-CREDITS.md
  invites authors to request changes). Tight boxes via percentile screen-space projection of
  actual splat centers / mesh vertices; per-label palette colors

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

## Capture-pipeline root cause (session 2, from a user batch zip)

Blank/degraded batch frames traced to: CaptureRig disabled its camera after each
capture, and the unified gsplat director destroys a disabled camera's manager —
every capture rebuilt the splat work buffer + async sort worker from scratch with
the mesh hidden until the first sort returned. Fixed: the capture camera stays
enabled once used, and captures wait on the full sort/stream settle predicate
(engine frame:ready condition + sortNeeded/jobsInFlight/hasPendingSort/version
equality/buffer uploads). Verified: alternating-pose captures are byte-identical.
Aids that remain useful: '⌖ Ground here', blank-batch warning, real zip timestamps.

## Adversarial review (done end of session 1)

A 5-dimension review workflow (EI wire formats / capture / React-store lifecycle / engine
resources / sims) surfaced 36 findings; every confirmed one is fixed and pushed:
capture-rig serialization queue with per-request pose, owner-scoped label targets,
base-anchored (non-compounding) batch randomization, **specific-force IMU convention**
(+1 g at rest, 0 in free fall — was inverted), rehydrate/persistence hazards
(mid-restore snapshot wipe, blob deletion on transient errors, hidden-mesh state),
splat asset/processor/material lifecycle leaks, run-lock on mode switching, robot
zip naming, capture-at-rest pose ordering, stuck-event contact seeding, robot-POV
inference source + aspect handling, throttled localStorage persistence.
One finding rejected as a false positive (draw_circle direction — the original is
also always-CCW; the port is faithful).

## Known gaps (tracked in TODO.md)

- `.spz` import (needs SpzParser + zstd wasm); image→splat; splat paint-tint; exporting *edited
  imported* scans (needs GPU stream readback)
- Physics engine + conveyor (objects instant-settle for now); hand tracking (MediaPipe); USDZ
- Env preset skyboxes (warehouse/outdoor), custom floor/wall textures
- Iframe height messaging (embed flag works; height postMessage not ported)
- IndexedDB quota failures on huge scans are console-warned only — surface in UI
- Live EI upload not yet exercised against a real project (needs an API key — user)

## Architecture cheat-sheet (details in docs/ARCHITECTURE.md)

- `src/lib/` renderer-agnostic + fully tested (the EI wire formats are locked by ported tests)
- `StudioEngine` facade owns managers (splats/models/objects/capture/editor); store↔engine sync
  lives in `EngineContext` (never call `engine.objects.sync` from UI)
- Mode runners (`src/modes/*.ts`) are pure orchestration over the facade; panels only trigger them
- Dev handles: `window.__studio` (engine), `window.__useStore` (store — survives HMR forks)

## Session 1 stats

~90 files of source + tests written; 399 tests green; 4 workflows / 18 subagents used
(feature-mapping, lib porting, docs, UI build-out); every mode verified live in the browser.
