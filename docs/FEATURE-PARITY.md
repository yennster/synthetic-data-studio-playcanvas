# FEATURE-PARITY — PlayCanvas rebuild tracking matrix

> Tracks every feature of the original app (contract:
> [ORIGINAL-FEATURES.md](ORIGINAL-FEATURES.md)) against this PlayCanvas rebuild, plus the
> NEW gaussian-splat features that have no original counterpart. Grouped by the phases in
> [TODO.md](../TODO.md). Update the Status column as work lands; keep
> [STATUS.md](../STATUS.md) in sync.
>
> **Status legend**: ❌ not started · 🚧 in progress · ✅ done · 🔀 changed by design
>
> Section references (`§n.m`) point into ORIGINAL-FEATURES.md.

---

## NEW — Gaussian splats (no original counterpart) — TODO Phase 2

These are the headline additions of the rebuild; the original app has no splat support
at all (its only asset import is USDZ, [§4.6](ORIGINAL-FEATURES.md#46-usdz-import-pipeline-needle-tools-openusd-wasm--hydra)).

| Feature | Behavior (rebuild target) | Status | Notes |
|---|---|---|---|
| Splat import: .ply / .compressed.ply / .sog | File picker/drag&drop → `gsplat` asset → entity | ✅ | `src/engine/splats/SplatManager.ts` (`SPLAT_EXTENSIONS`, `importFromFile`/`importFromUrl`, `unified: true`) |
| Splat import: .spz | Same path; needs zstd wasm decoder wired | ❌ | Not in `SPLAT_EXTENSIONS` yet; see TODO Phase 2 + STATUS.md gotcha |
| Splat library card | List imported splats; use as backdrop/environment or object | 🚧 | `src/ui/SplatLibrary.tsx` exists; backdrop-vs-object roles not finalized |
| Create: procedural splat primitives | Box/sphere/plane point clouds → GSplatContainer | ✅ | `src/engine/splats/splatCreate.ts` (`buildSplatContainer`, `primitiveSplatPoints`, `splatEntityFromContainer`) |
| Create: mesh→splat converter | Sample GLB mesh surfaces → splat points → container | ✅ | `src/engine/splats/meshToSplat.ts` (`meshEntityToSplatPoints`) |
| Create: image→splat plane | Image pixels → colored splat plane | ❌ | |
| Edit: crop box | GSplatProcessor pipeline, work-buffer modifiers | ❌ | Engine `examples/gaussian-splatting/crop` is the reference |
| Edit: sphere-delete | Delete splats inside a sphere | ❌ | |
| Edit: paint tint | Paint color tint onto splats | ❌ | |
| Export edited/created splats to .ply | Serialize container → .ply download | ❌ | |
| Persist splat assets in IndexedDB | Same UX as original's imported USDZ assets (§7.2) | ❌ | Mirror `sds-assets` blob store + rehydrate pattern |

## Phase 0 — Foundation

| Feature | Original behavior | Status | Notes |
|---|---|---|---|
| Project scaffold | (n/a — rebuild infra) | ✅ | Vite + React + TS; playcanvas 2.21.4, zustand, jszip, vitest |
| ORIGINAL-FEATURES.md contract | (n/a) | ✅ | This session |
| FEATURE-PARITY.md matrix | (n/a) | ✅ | This file |
| LICENSE / README / package metadata | Original is Apache-2.0, author yennster / Jenny Speelman | ❌ | LICENSE file exists at root; README + package.json metadata pending |
| GitHub repo + initial push | (n/a) | ❌ | `yennster/synthetic-data-studio-playcanvas` (private) |

## Phase 1 — Engine core

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Engine bootstrap | three.js Canvas: shadows, ACES tonemap, exposure 1.0, per-env gradient bg (§1.4) | ✅ | `src/engine/createApp.ts` + `StudioEngine.ts` (AppBase, component systems, fill-window, resize) |
| Scene manager: ground + lighting | Env presets, procedural skyboxes, floor/walls, ambient+directional (§4.9) | 🚧 | `src/engine/sceneEnvironment.ts`: ground plane + two-light rig, light intensity/angle hooks; 4 presets/skyboxes/custom textures not built |
| Environment presets (studio/warehouse/whitebox/outdoor) | 2048×1024 canvas skyboxes, per-preset floors, wall colliders (§4.9) | ❌ | Splat backdrops may replace some presets (🔀 candidate) |
| Custom floor/wall textures (IndexedDB) | Two slots `floor`/`wall`, `sds-textures` db, 4× floor tile, equirect wall (§2.5, §7.2) | ❌ | |
| Camera rig: orbit controls | OrbitControls damping 0.1, min 0.3/max 20, target [0,0.7,0]; per-mode snap poses (§1.4) | ✅ | `StudioEngine` view camera + `CameraControls` script, `focusOn()` |
| Virtual capture camera separate from view camera | Dedicated PerspectiveCamera + preview overlay + frustum gizmo (§4.3) | ❌ | |
| Entity/selection framework | Click select, Cmd/Ctrl multi-select, Esc clear, Shift+drag move w/ depth+wheel, [/] rotate, Q/E orbit, arrow pan (§1.4, §4.10) | ❌ | |
| Theme-aware clear color / theme system | `sds-theme` localStorage, pre-paint bootstrap, dark default, theme↔env sync in motion/robot only (§7.6, §1.1) | 🚧 | `StudioEngine.setClearColor` exists; no theme store/bootstrap yet |
| Shared math helpers | clamp (NaN→lo), lerp, smoothstep, wrapAngle (§1.7) | ❌ | Port `lib/math.ts` + tests |
| Seeded RNG | mulberry32 via `?seed=`, single shared sequence (§4.8) | ❌ | Port `rng.ts` semantics exactly |

## Phase 2 — Gaussian splats

See the NEW table above — Phase 2 is entirely new-feature work.

Related original feature subsumed here:

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Asset persistence + rehydration pattern | `sds-assets` IDB blobs + persisted metadata + guarded rehydrate (§7.2) | ❌ | Reuse for splats and GLB/USDZ alike |

## Phase 3 — Capture & export pipeline

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Offscreen capture at configurable resolution | Singleton offscreen renderer, 2× SSAA, high-quality downsample, PNG (§4.1) | ❌ | PlayCanvas render target instead of second WebGL context; keep SSAA + output-res contract |
| 2D bounding-box computation | Project AABB corners, NDC z>1 behind-camera gate, clamp, round, drop <4px, label-root merging (§4.2) | ❌ | Format identical: `{label,x,y,width,height}` ints, top-left origin |
| Single capture (detection) | PNG + bounding_boxes.labels in one zip; accumulate in store (§2.11, §4.3) | ❌ | |
| Single capture (anomaly) | Bare PNG, boxes [], label=anomalyLabel (§4.3) | ❌ | |
| Batch capture | Snapshot/restore base pose; 2-rAF settle; per-shot randomization (§4.3) | ❌ | |
| Camera randomization (jitter) | camPos ±0.6 xz, y half-amp floor 0.5; target ±0.2/0.1/0.2; fov ±5 (§4.3) | ❌ | Only when trajectory==='random' |
| Camera trajectories | random/circle/figure8/arc/spiral/orbit_dome; t=index/total, total==1→t=0; snap camPos to sample 0 (§4.3) | ❌ | |
| Lighting randomization | intensity max(0.2, base±0.4); envRotation base+rng·2π (§4.3) | ❌ | |
| Object randomization + conveyor settle | Drop volume x±0.6 y1.6–2.0 z±3; settle <0.15 m/s, 2500 ms timeout (§4.3) | ❌ | |
| Distractors / domain randomization extras | (original: objects+lighting+camera only) | ❌ | Any additions are 🔀 |
| Realism "Photo FX" pixel pass | CA→jitter→vignette→grain order, JPEG round-trip, randomize-per-capture, bbox-safe (§4.7, §2.10) | ❌ | Keep internal mode string `'random'` |
| Realism diffusion endpoint | Hidden mode; /api/realism-diffusion → HF pix2pix; budget 3/batch (§4.7, §7.9) | ❌ | Decide whether to port (was hidden in original) |
| ZIP export | STORE-only writer, zeroed timestamps, off-thread worker, anchor-click save (§4.4) | ❌ | Rebuild has `jszip` dep — 🔀 acceptable if output layout matches exactly |
| ZIP layouts (EI-compatible) | info.labels + bounding_boxes.labels sidecars, exact filename builders (§3.4, §3.5) | ❌ | Byte-format contract — port original tests |
| ZIP reader (EI deployment unpack) | EOCD scan, zip-slip guard, 128/256 MiB caps, deflate-raw (§4.4) | ❌ | Needed for Phase 4 inference |
| Seeded RNG wiring into capture | Batch jitter, realism, objectCount picks, arm randomize (§4.8) | ❌ | |
| Preview overlay + readback | ~15 Hz RT readback, pooled buffers, vertical flip, DPR clamp 2, aspect-locked height (§1.1, §4.5) | ❌ | |
| Gizmo layer exclusion | Gizmos on layer 1; capture camera layer 0; raycaster+camera both enable (§4.3) | ❌ | PlayCanvas layers equivalent |

## Phase 4 — Edge Impulse

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Auth card (API key/HMAC/category) | Memory-only key, HMAC only for time-series panels, split 80:20 (§2.12) | ❌ | |
| Host overrides + allowlist | `?studioHost=`/`?ingestionHost=`, https *.edgeimpulse.com or loopback only (§3.1) | ❌ | Security-load-bearing |
| Time-series ingestion upload | Data-acquisition JSON envelope, HMAC ritual, inferred interval_ms, exact sensors/headers (§3.2) | ❌ | Port `edgeImpulse.ts` + its tests |
| Image ingestion upload | FormData field `data`, x-bounding-boxes omitted when empty, serial batch w/ progress (§3.3) | ❌ | |
| Metadata + sidecars | buildIngestionMetadata / info.labels / bounding_boxes.labels round-trip (§3.4) | ❌ | |
| Category split routing | resolveBucket, per-sample 0.8 roll, split_bucket metadata (§3.2) | ❌ | |
| Studio API client | /projects, project probe, deployment history+download, build/retrain jobs, 3s/10min polling (§3.6) | ❌ | |
| Project data-kind probe + routing | isComputerVisionProject first, structural raw-data signals, confirm dialogs (§3.6) | ❌ | Used by robot OD runner |
| In-browser WASM model loader | Emscripten MODULARIZE/preseed/ESM strategies, wasmBinary pre-read, Embind memory discipline (§3.7) | ❌ | Renderer-agnostic — port as-is |
| Classifier + feature packing | run_classifier(count), packed-int RGB / BT.601 gray features (§3.7) | ❌ | |
| Inference card UI | List/build/fetch/file flows, threshold 0.05–0.95, Run once / Live (§2.13) | ❌ | |
| Live inference loop + overlay | 5 Hz throttle, one-shot bypass, box/centroid/heatmap drawing, label hash colors (§3.8) | ❌ | |
| Retrain button flow | Single-project guard, jobs/retrain + poll (§2.4, §2.14) | ❌ | |
| URL auth prefill + autoUpload | ?apiKey, ?category aliases, ?autoUpload post-batch (§3.9) | ❌ | |

## Phase 5 — Modes (parity with original)

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| App shell: 4 modes + sidebar + panels | motion/detection/anomaly/robot; lazy panels; mode card + status bar (§1.1, §1.2) | ❌ | Rebuild UI is a fresh design (🔀 on looks, parity on capability) |
| HUD pills + shortcuts tip | Mode/objects/captures pills, REC pill, tip persistence `sds-hud-tip-open` (§1.3) | ❌ | |
| Object detection mode | Scene card, objects card, virtual camera, capture card, upload (§2.5–2.14) | ❌ | |
| Visual anomaly mode | Batch label, no boxes on upload, bare-PNG singles (§2.11, §4.3) | ❌ | |
| Scene objects card (7 primitive kinds) | Spawner/editor, color cycle, physics toggle, owner filtering, belt-safe spawn columns (§2.6) | ❌ | |
| Conveyor belt | 8 m belt, z-velocity transport hack, stripe-lock texture scroll, rails (§4.9) | ❌ | Physics engine choice open (Rapier→?); observable behavior is the contract |
| Motion mode: hand tracking | MediaPipe HandLandmarker, pinch hysteresis 0.65/0.45, yaw-only mapping, 350 ms grace (§6.3) | ❌ | |
| Motion mode: manipulated body sim | MuJoCo MotionSim weld-grab, per-shape geoms, release velocities (§6.1) | ❌ | MuJoCo-vs-alternative decision open (STATUS.md gotcha) — mark 🔀 if replaced |
| Motion mode: manual IMU recording | 20–500 Hz frame-capped sampler, actual-span duration readout (§2.2) | ❌ | |
| Motion mode: procedural motions | drop/throw/push/shake runners, pre-release window, angvel on release, cancel pattern (§6.2, §2.3) | ❌ | |
| IMU noise model | LSM6DSO defaults, bias walk→scale+noise→clamp→quantize order (§6.4) | ❌ | Pure lib — port + tests |
| Rover mode | 3-DOF planar sim, cruise/collision/stuck paths, MJCF obstacles, contact detection (§5.2, §5.3) | ❌ | |
| Lidar / ToF ring | Bin 0 forward, CCW, clamp-to-maxRange, 20 Hz, hideForCapture beams (§5.4) | ❌ | |
| Arm mode (Braccio) | Limits/links/rest pose, analytic IK, 5 trajectories, MJCF sim (§5.5–5.7) | ❌ | |
| Arm pick-and-place outcome | Lift ≥0.02 m success, tilt/drift rejection, open-gripper-on-reject, metadata (§5.7) | ❌ | Honest-failure behavior is product intent |
| Robot POV camera + OD capture | FOV 70 mounts, capture bridge w/ 2 s timeout, at-rest vs spaced mid-motion shots (§5.10, §2.21, §4.11) | ❌ | |
| Robotics runner + EI routing | Epoch bumps, 20 Hz windows, probe-driven stream routing, partial-zip on cancel (§2.22) | ❌ | |
| ROS 2 export | JSONL Imu/LaserScan/JointState shapes, exact topics/frames (§5.9) | ❌ | `/odom` was absent in practice — decide wire-or-drop |
| Realism card (robot OD) | Mounted only when objectDetection on (§2.21) | ❌ | |
| USDZ import | needle-tools OpenUSD WASM, .usdz-only gate, recenter-static-only, magenta heuristic (§4.6) | ❌ | Needs COI headers; GLB path (below) already exists |
| Imported assets card | Per-asset editor, owner placement rules, material override (§2.7) | ❌ | |
| Object Capture info card | Platform-gated links/steps (§2.8, §7.7) | ❌ | Docs-only card — cheap |
| Hand tracking priority decision | (TODO: decide after feature map) | ❌ | Depends on MediaPipe under PlayCanvas shell — no blocker found in map |

## Phase 6 — Platform

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| GLB import | **Not in original** (USDZ only, §4.6) | ✅ | NEW-adjacent: `src/engine/ModelManager.ts` (native ContainerHandler) — 🔀 addition; feeds mesh→splat |
| USDZ import wasm staging + COI headers | postinstall copy to /usdz-wasm/, COOP/COEP-credentialless/CORP trio on all surfaces (§7.5, §7.10) | ❌ | Check header needs for any wasm we ship (.spz zstd too) |
| Zustand store + persistence | `sds-store` v12 partialize/migrations; signal counters; transient buffers (§7.1) | 🚧 | `src/store/useStore.ts` exists (minimal); persistence/migrations not started. Decide: accept original v3–v12 payloads or new key (🔀 likely new key) |
| URL params + presets | Full preset/flag table, reject-not-clamp, aliases, applyUrlPresets order (§7.3) | ❌ | Drop or wire dead `?bypassAuth` (§8.1) |
| Iframe embed support | Outbound IFRAME_HEIGHT pings, embedOrigin/referrer targeting, embed/ui/gizmos flags (§7.4) | ❌ | |
| Theme toggle (light/dark) | §7.6 | ❌ | See Phase 1 theme row |
| clearStore bootstrap | Confirm-gated wipe of exact keys/dbs (§7.8) | ❌ | |
| Platform detection | UA-based Apple gating (§7.7) | ❌ | |
| Number-input UX | Draft-tolerant useNumberInput on all numeric fields (§1.5) | ❌ | |
| Accessibility + reduced motion | WCAG 2.1 AA targets, tabular-nums, prefers-reduced-motion kill-switch (§1.6) | ❌ | Fresh design must re-meet these |
| Privacy contract | Webcam-local, memory-only keys, no capture persistence (§7.11) | ❌ | Behavioral constraints on every phase |
| Unit tests ported + splat tests | Original vitest suite = executable wire-format spec (§7.10) | ❌ | vitest already a dep |
| CI (GitHub Actions) | test on push/PR; release on v* tags w/ artifact checks (§7.10) | ❌ | |
| Deployment (Vercel) + static server | vercel.json headers/caching; bin/serve.mjs npx server (§7.9, §7.10) | ❌ | Decide npm-package story for rebuild |
| Screenshot/blog/OG tooling | §8.7 | ❌ | Optional; not product surface |

---

**Snapshot totals** (2026-08-20): ✅ 7 · 🚧 4 · ❌ everything else. The rebuild currently
covers the engine substrate and the new splat import/create core; all original product
behavior (capture, EI, modes, config surface) is still to build against
[ORIGINAL-FEATURES.md](ORIGINAL-FEATURES.md).
