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
| Splat import: .ply / .compressed.ply / .sog | File picker/drag&drop → `gsplat` asset → entity | ✅ | `src/engine/splats/SplatManager.ts` (`SPLAT_EXTENSIONS`, `importFile`/`importUrl`, `unified: true`); imports auto-persist to IndexedDB |
| Splat import: .spz | Same path; needs zstd wasm decoder wired | ❌ | Not in `SPLAT_EXTENSIONS` yet; see TODO Phase 2 + STATUS.md gotcha |
| Splat library card | List imported splats; use as backdrop/environment or object | ✅ | `src/ui/SplatLibrary.tsx`: import, create-primitive, per-splat role select (backdrop/object) + bbox label + erase/export controls. A backdrop splat hides the procedural ground (`src/engine/EngineContext.tsx` → `setGroundVisible`) |
| Create: procedural splat primitives | Box/sphere/plane point clouds → GSplatContainer | ✅ | `src/engine/splats/splatCreate.ts` (`buildSplatContainer`, `primitiveSplatPoints`, `splatEntityFromContainer`) |
| Create: mesh→splat converter | Sample GLB mesh surfaces → splat points → container | ✅ | `src/engine/splats/meshToSplat.ts` (`meshEntityToSplatPoints`); wired to the "→ splat" button in `src/ui/ModelLibrary.tsx` (hides the mesh original) |
| Create: image→splat plane | Image pixels → colored splat plane | ❌ | |
| Edit: crop box | GSplatProcessor pipeline, work-buffer modifiers | ✅ | `src/engine/splats/SplatEditor.ts` (`cropToBox`/`eraseBox` via a `splatVisible` instance stream + work-buffer scale-zeroing, GLSL+WGSL). Works on imported scans too; non-destructive, `resetVisibility` restores |
| Edit: sphere-delete | Delete splats inside a sphere | ✅ | `SplatEditor.eraseSphere` — GPU erase brush, right-drag in scene with radius slider (`src/ui/SplatLibrary.tsx`, `engine.setEraseMode`). Verified in-browser 2026-08-20 (erase → export round-trip) |
| Edit: paint tint | Paint color tint onto splats | ❌ | |
| Export edited/created splats to .ply | Serialize container → .ply download | ✅ | Created splats: `src/engine/splats/splatExport.ts` (`pointsToPly`, 3DGS layout, + test) via the library card's export button. Exporting *edited imported scans* is still ❌ — GPU edits are visibility streams, no destructive re-serialize of scan data |
| Persist splat assets in IndexedDB | Same UX as original's imported USDZ assets (§7.2) | ✅ | `src/lib/assetStore.ts` (`SPLAT_STORE`) + `src/engine/rehydrateAssets.ts` (restores role/label/transform, prunes missing blobs); created splats persist as their PLY serialization. Verified across reloads |

## Phase 0 — Foundation

| Feature | Original behavior | Status | Notes |
|---|---|---|---|
| Project scaffold | (n/a — rebuild infra) | ✅ | Vite + React + TS; playcanvas 2.21.4, zustand, jszip, vitest |
| ORIGINAL-FEATURES.md contract | (n/a) | ✅ | |
| FEATURE-PARITY.md matrix | (n/a) | ✅ | This file |
| LICENSE / README / package metadata | Original is Apache-2.0, author yennster / Jenny Speelman | ✅ | LICENSE + README.md at root; package.json: `@yennster/synthetic-data-studio-playcanvas`, Apache-2.0, author "Jenny Speelman <jenny@edgeimpulse.com>" |
| GitHub repo + initial push | (n/a) | ✅ | `yennster/synthetic-data-studio-playcanvas` — origin/main pushed |

## Phase 1 — Engine core

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Engine bootstrap | three.js Canvas: shadows, ACES tonemap, exposure 1.0, per-env gradient bg (§1.4) | ✅ | `src/engine/createApp.ts` + `StudioEngine.ts` (AppBase, component systems, fill-window, resize) |
| Scene manager: ground + lighting | Env presets, procedural skyboxes, floor/walls, ambient+directional (§4.9) | 🚧 | `src/engine/sceneEnvironment.ts`: shadowed ground plane + two-light rig, intensity/angle hooks, theme-driven colors; splat backdrops hide the ground. Presets/skyboxes/custom textures not built |
| Environment presets (studio/warehouse/whitebox/outdoor) | 2048×1024 canvas skyboxes, per-preset floors, wall colliders (§4.9) | ❌ | `?env=` is parsed (`src/lib/urlParams.ts`) but nothing consumes it; splat backdrops may replace some presets (🔀 candidate) |
| Custom floor/wall textures (IndexedDB) | Two slots `floor`/`wall`, `sds-textures` db, 4× floor tile, equirect wall (§2.5, §7.2) | ❌ | |
| Camera rig: orbit controls | OrbitControls damping 0.1, min 0.3/max 20, target [0,0.7,0]; per-mode snap poses (§1.4) | ✅ | `StudioEngine` view camera + `CameraControls` script, double-click `focusOn()` |
| Virtual capture camera separate from view camera | Dedicated PerspectiveCamera + preview overlay + frustum gizmo (§4.3) | ✅ | `src/engine/capture/CaptureRig.ts` (dedicated offscreen camera) + live in-canvas PiP preview, bottom-right (`src/ui/useCaptureCameraSync.ts`). No frustum gizmo yet (see selection/gizmo rows) |
| Entity/selection framework | Click select, Cmd/Ctrl multi-select, Esc clear, Shift+drag move w/ depth+wheel, [/] rotate, Q/E orbit, arrow pan (§1.4, §4.10) | ❌ | No click-selection or drag gizmos; transforms are edited via panel number fields instead |
| Theme-aware clear color / theme system | `sds-theme` localStorage, pre-paint bootstrap, dark default, theme↔env sync in motion/robot only (§7.6, §1.1) | ✅ | `src/ui/ThemeToggle.tsx` (data-theme on root) + `ThemeSync.tsx` (engine clear color + ground swap). Dark default; persisted inside `sds-pc-store` (🔀 not `sds-theme`, no pre-paint script). Verified in-browser |
| Shared math helpers | clamp (NaN→lo), lerp, smoothstep, wrapAngle (§1.7) | ✅ | `src/lib/math.ts` + `math.test.ts` |
| Seeded RNG | mulberry32 via `?seed=`, single shared sequence (§4.8) | ✅ | `src/lib/rng.ts` (`mulberry32`, `rng`/`getRng`, `isSeeded`) + tests |

## Phase 2 — Gaussian splats

See the NEW table above — Phase 2 is entirely new-feature work.

Related original feature subsumed here:

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Asset persistence + rehydration pattern | `sds-assets` IDB blobs + persisted metadata + guarded rehydrate (§7.2) | ✅ | `src/lib/assetStore.ts` (SPLAT_STORE + MODEL_STORE blob db) + `src/engine/rehydrateAssets.ts` (StrictMode-guarded restore with transforms, prunes missing blobs) — used by splats and GLB alike |

## Phase 3 — Capture & export pipeline

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Offscreen capture at configurable resolution | Singleton offscreen renderer, 2× SSAA, high-quality downsample, PNG (§4.1) | ✅ | `src/engine/capture/CaptureRig.ts`: `SSAA_FACTOR = 2` render target, immediate readback (hidden-tab safe via manual `app.tick`), vertical flip, downsample to output res, PNG |
| 2D bounding-box computation | Project AABB corners, NDC z>1 behind-camera gate, clamp, round, drop <4px, label-root merging (§4.2) | ✅ | `src/engine/capture/projectBoxes.ts` (+tests): behind-camera skip, clamp+round, <4×4 px drop, `{label,x,y,width,height}` ints at output resolution; multi-AABB label targets |
| Single capture (detection) | PNG + bounding_boxes.labels in one zip; accumulate in store (§2.11, §4.3) | ✅ | `src/modes/visionRunner.ts`; verified in-browser 2026-08-20 (correct bbox + zip) |
| Single capture (anomaly) | Bare PNG, boxes [], label=anomalyLabel (§4.3) | ✅ | `visionRunner.ts` — anomaly saves the bare PNG, boxes `[]`, label = `anomalyLabel` |
| Batch capture | Snapshot/restore base pose; 2-rAF settle; per-shot randomization (§4.3) | ✅ | `visionRunner.ts` snapshots camera/lighting/object base pose and restores after; CaptureRig settles two frames per shot. Verified with circle trajectory |
| Camera randomization (jitter) | camPos ±0.6 xz, y half-amp floor 0.5; target ±0.2/0.1/0.2; fov ±5 (§4.3) | ✅ | `visionRunner.ts` — applied only when trajectory==='random' and randomizeCamera on |
| Camera trajectories | random/circle/figure8/arc/spiral/orbit_dome; t=index/total, total==1→t=0; snap camPos to sample 0 (§4.3) | ✅ | `src/lib/cameraTrajectory.ts` (+tests); camPos snapped to the path's first sample in `src/ui/VisionPanel.tsx` |
| Lighting randomization | intensity max(0.2, base±0.4); envRotation base+rng·2π (§4.3) | ✅ | `visionRunner.ts`: intensity `max(0.2, base ± 0.4)`; envRotation n/a until env skyboxes exist |
| Object randomization + conveyor settle | Drop volume x±0.6 y1.6–2.0 z±3; settle <0.15 m/s, 2500 ms timeout (§4.3) | 🚧 | Kinematic per-shot re-scatter (`visionRunner.ts`: xz ±0.3, y jitter floor 0.2, random yaw); no physics drop/settle or conveyor (no physics engine yet — see Phase 5) |
| Distractors / domain randomization extras | (original: objects+lighting+camera only) | ❌ | Any additions are 🔀 |
| Realism "Photo FX" pixel pass | CA→jitter→vignette→grain order, JPEG round-trip, randomize-per-capture, bbox-safe (§4.7, §2.10) | ✅ | `src/lib/realism.ts` (+tests): `applyRandomRealism` keeps CA→jitter→vignette→grain order + JPEG round-trip; internal mode string `'random'` kept (`src/ui/RealismCard.tsx`). Verified in-browser |
| Realism diffusion endpoint | Hidden mode; /api/realism-diffusion → HF pix2pix; budget 3/batch (§4.7, §7.9) | ❌ | `'diffusion'` mode + `DIFFUSION_BUDGET = 3` helpers exist in `realism.ts` but are deliberately unmounted in the UI; no endpoint |
| ZIP export | STORE-only writer, zeroed timestamps, off-thread worker, anchor-click save (§4.4) | ✅ | Custom STORE-only writer `src/lib/zip.ts` (+tests) + worker (`zipWorker.ts`/`zipWorkerClient.ts`) + anchor-click `saveBlob` (`captureFormats.ts`); jszip dep now unused |
| ZIP layouts (EI-compatible) | info.labels + bounding_boxes.labels sidecars, exact filename builders (§3.4, §3.5) | ✅ | `src/lib/captureFormats.ts` (`buildBoundingBoxLabelsFile`, `makeFilename`) + `src/lib/edgeImpulse.ts` (`buildInfoLabelsFile`, `buildFileName`) with ported tests |
| ZIP reader (EI deployment unpack) | EOCD scan, zip-slip guard, 128/256 MiB caps, deflate-raw (§4.4) | ✅ | `src/lib/zipReader.ts` (+tests): EOCD back-scan, 128 MiB/entry + 256 MiB total caps, STORE + DEFLATE via DecompressionStream |
| Seeded RNG wiring into capture | Batch jitter, realism, objectCount picks, arm randomize (§4.8) | ✅ | `getRng()`/`rng()` threaded through visionRunner (jitter/lighting/objects), realism, motionRunner, and RobotPanel |
| Preview overlay + readback | ~15 Hz RT readback, pooled buffers, vertical flip, DPR clamp 2, aspect-locked height (§1.1, §4.5) | 🔀 | Replaced by a live in-canvas PiP viewport (second camera via `StudioEngine.setPreviewRect` + `src/ui/useCaptureCameraSync.ts`, aspect-locked, bottom-right) — no readback loop needed |
| Gizmo layer exclusion | Gizmos on layer 1; capture camera layer 0; raycaster+camera both enable (§4.3) | ❌ | No gizmos built yet (`?gizmos=` flag parsed but nothing to hide) |

## Phase 4 — Edge Impulse

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| Auth card (API key/HMAC/category) | Memory-only key, HMAC only for time-series panels, split 80:20 (§2.12) | ✅ | `src/ui/EiAuthCard.tsx` — `ei` excluded from persist partialize (memory-only); HMAC field only where `showHmac` (motion/robot); split via `resolveBucket` |
| Host overrides + allowlist | `?studioHost=`/`?ingestionHost=`, https *.edgeimpulse.com or loopback only (§3.1) | ✅ | `src/lib/edgeImpulse.ts` (`normalizeHost`, `isAllowedEiHost`, `setEdgeImpulseHosts`) wired at boot in `src/lib/applyUrlPresets.ts`; tested |
| Time-series ingestion upload | Data-acquisition JSON envelope, HMAC ritual, inferred interval_ms, exact sensors/headers (§3.2) | ✅ | `edgeImpulse.ts`: `buildDataAcquisitionPayload` + HMAC-SHA256 signing, `inferIntervalMs`, `uploadSample` (+ rover/lidar payload variants); ported tests in `edgeImpulse.test.ts` |
| Image ingestion upload | FormData field `data`, x-bounding-boxes omitted when empty, serial batch w/ progress (§3.3) | ✅ | `edgeImpulse.ts` `uploadImage` / `uploadCaptures` (serial, progress callback). Not yet exercised against a live EI project |
| Metadata + sidecars | buildIngestionMetadata / info.labels / bounding_boxes.labels round-trip (§3.4) | ✅ | `edgeImpulse.ts`: `buildIngestionMetadata`, `buildInfoLabelsEntry/File` (+tests) |
| Category split routing | resolveBucket, per-sample 0.8 roll, split_bucket metadata (§3.2) | ✅ | `edgeImpulse.ts` `resolveBucket` (0.8 training roll per sample) |
| Studio API client | /projects, project probe, deployment history+download, build/retrain jobs, 3s/10min polling (§3.6) | ✅ | `edgeImpulse.ts`: `listEiProjects`, `listEiDeploymentHistory`, `downloadEiHistoricDeployment`, `buildEiDeployment`, `retrainEiModel`, `getEiJobStatus`, `waitForEiJob` (3 s poll / 10 min timeout) |
| Project data-kind probe + routing | isComputerVisionProject first, structural raw-data signals, confirm dialogs (§3.6) | ✅ | `edgeImpulse.ts` `getEiProjectDataKinds` + confirm-gated stream routing in `src/modes/robotRunner.ts` |
| In-browser WASM model loader | Emscripten MODULARIZE/preseed/ESM strategies, wasmBinary pre-read, Embind memory discipline (§3.7) | ✅ | `src/lib/eiModel.ts` (`loadEiModelFromZip`, `loadEiModel`) — module-level model handle (wasm instance kept out of the store) |
| Classifier + feature packing | run_classifier(count), packed-int RGB / BT.601 gray features (§3.7) | ✅ | `eiModel.ts` `canvasToFeatures` + classifier plumbing |
| Inference card UI | List/build/fetch/file flows, threshold 0.05–0.95, Run once / Live (§2.13) | ✅ | `src/ui/EiInferenceCard.tsx`: deployment-history fetch, build-then-download, load-from-file, threshold slider, Run once / Live |
| Live inference loop + overlay | 5 Hz throttle, one-shot bypass, box/centroid/heatmap drawing, label hash colors (§3.8) | ✅ | 5 Hz (`INFERENCE_INTERVAL_MS = 200`) in `EiInferenceCard.tsx`; `src/ui/InferenceOverlay.tsx` draws boxes/FOMO centroids/anomaly heatmap with stable label→color hashing |
| Retrain button flow | Single-project guard, jobs/retrain + poll (§2.4, §2.14) | ✅ | `src/ui/EiUploadCard.tsx` → `retrainEiModel` + `waitForEiJob` |
| URL auth prefill + autoUpload | ?apiKey, ?category aliases, ?autoUpload post-batch (§3.9) | 🚧 | `?apiKey`/`?category` (+theme) wired via `src/lib/embed.ts` + `applyUrlPresets.ts`; `?autoUpload` parsed (`urlParams.ts`) but not acted on |

## Phase 5 — Modes (parity with original)

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| App shell: 4 modes + sidebar + panels | motion/detection/anomaly/robot; lazy panels; mode card + status bar (§1.1, §1.2) | ✅ | `src/App.tsx` + `src/ui/Sidebar.tsx`: 4-mode switcher, lazy panels (React.lazy/Suspense), status bar; fresh visual design (🔀 on looks, parity on capability) |
| HUD pills + shortcuts tip | Mode/objects/captures pills, REC pill, tip persistence `sds-hud-tip-open` (§1.3) | ✅ | `src/ui/Hud.tsx`: mode/objects/splats/captures pills + REC pill; hidden when `?embed=1`. Shortcuts tip intentionally absent until selection shortcuts exist |
| Object detection mode | Scene card, objects card, virtual camera, capture card, upload (§2.5–2.14) | ✅ | `src/ui/VisionPanel.tsx`: Scene / SceneObjects / VirtualCamera / Realism / Capture / EI auth+inference+upload cards. Verified single + batch in-browser 2026-08-20 |
| Visual anomaly mode | Batch label, no boxes on upload, bare-PNG singles (§2.11, §4.3) | ✅ | Shares `VisionPanel`; anomaly label, bare-PNG singles, `includeBoxes=false` on upload (`EiUploadCard.tsx`) |
| Scene objects card (7 primitive kinds) | Spawner/editor, color cycle, physics toggle, owner filtering, belt-safe spawn columns (§2.6) | ✅ | `src/ui/SceneObjectsCard.tsx` + store: all 7 kinds (cube/sphere/cylinder/torus/capsule/phone/soda_can), spawner/editor, owner filtering; physics toggle = instant ground rest (`ObjectManager.ts` — real physics tracked in TODO Phase 5) |
| Conveyor belt | 8 m belt, z-velocity transport hack, stripe-lock texture scroll, rails (§4.9) | ❌ | Blocked on physics engine decision |
| Motion mode: hand tracking | MediaPipe HandLandmarker, pinch hysteresis 0.65/0.45, yaw-only mapping, 350 ms grace (§6.3) | ❌ | Webcam toggle renders disabled in `MotionPanel.tsx`; `src/lib/handMath.ts` (+tests) already ported and waiting |
| Motion mode: manipulated body sim | MuJoCo MotionSim weld-grab, per-shape geoms, release velocities (§6.1) | 🔀 | Replaced by closed-form kinematic IMU synthesis (`src/modes/motionRunner.ts` `generateMotionTrace`) — no MuJoCo/physics; keeps original parameter semantics (per-class release spins, pre-release window). 12 tests in `motionRunner.test.ts` |
| Motion mode: manual IMU recording | 20–500 Hz frame-capped sampler, actual-span duration readout (§2.2) | 🔀 | Record → upload path works end-to-end, but samples come from a synthesized idle sampler (`createIdleSampler`) instead of a hand-driven body until hand tracking lands |
| Motion mode: procedural motions | drop/throw/push/shake runners, pre-release window, angvel on release, cancel pattern (§6.2, §2.3) | 🔀 | `motionRunner.ts` `runProceduralBatch`: all four classes, 0.85+rng·0.3 jitter, upload-or-zip routing, cancel → partial zip. Analytic instead of physics. Verified in-browser (3 drops → zip) |
| IMU noise model | LSM6DSO defaults, bias walk→scale+noise→clamp→quantize order (§6.4) | ✅ | `src/lib/imuNoise.ts` (+tests) — LSM6DSO-calibrated defaults, order preserved; applied by motion/rover/arm sims |
| Rover mode | 3-DOF planar sim, cruise/collision/stuck paths, MJCF obstacles, contact detection (§5.2, §5.3) | 🔀 | Kinematic, physics-free port: `src/lib/rover.ts` (ported path generators) + `src/modes/roverSim.ts` (AABB obstacles, penetration resolution, IMU from motion) + `src/engine/RoverRig.ts`; 14 tests. Verified cruise run (fused sensors → zip) in-browser |
| Lidar / ToF ring | Bin 0 forward, CCW, clamp-to-maxRange, 20 Hz, hideForCapture beams (§5.4) | 🚧 | Scan data ✅: `src/lib/lidar.ts` (+tests) + analytic ray-vs-AABB caster in `roverSim.ts`, 20 Hz, verified in fused uploads. Beam-fan visualization not drawn yet (`RoverRig.ts` TODO) |
| Arm mode (Braccio) | Limits/links/rest pose, analytic IK, 5 trajectories, MJCF sim (§5.5–5.7) | 🔀 | `src/lib/braccio.ts` / `braccioIk.ts` / `armTrajectories.ts` ported (+tests); `src/modes/armSim.ts` is kinematic joint-space playback with FK-derived end-effector IMU (+tests); `src/engine/ArmRig.ts` visuals; home-pose card in `RobotPanel.tsx` |
| Arm pick-and-place outcome | Lift ≥0.02 m success, tilt/drift rejection, open-gripper-on-reject, metadata (§5.7) | 🔀 | `src/lib/armPickupOutcome.ts` reducers ported (lift ≥0.02 m latch, drift rejection, open-gripper-on-reject); kinematic limitation: `target_tipped` can never fire (documented in `armSim.ts`), misgrasps surface as `target_drifted`. Verified pick_place run → zip |
| Robot POV camera + OD capture | FOV 70 mounts, capture bridge w/ 2 s timeout, at-rest vs spaced mid-motion shots (§5.10, §2.21, §4.11) | ✅ | `RobotPanel.tsx` (`POV_FOV = 70`, per-rig povMount/povLook, PiP POV preview) capturing directly through `CaptureRig` (no bridge/timeout needed); `robotRunner.ts`: at-rest = exactly one shot, in-motion = N spaced shots |
| Robotics runner + EI routing | Epoch bumps, 20 Hz windows, probe-driven stream routing, partial-zip on cancel (§2.22) | ✅ | `src/modes/robotRunner.ts`: injected-environment runner, 20 Hz windows, per-iteration sim callback (epoch analogue), probe-driven routing with confirm, ≤50 ms cancel polling → partial zip. Verified rover + arm runs → zips |
| ROS 2 export | JSONL Imu/LaserScan/JointState shapes, exact topics/frames (§5.9) | ✅ | `src/lib/rosMessages.ts` (+tests): sensor_msgs/Imu + LaserScan + JointState, one `rosbag.jsonl` per iteration in the zip (`robotRunner.ts`). 🔀 bonus: `/odom` is wired here via nav_msgs/Odometry (original dropped it) |
| Realism card (robot OD) | Mounted only when objectDetection on (§2.21) | ✅ | `RealismCard` mounted in `RobotPanel.tsx` for the object-detection flow; shared `realismMeta` shape with vision uploads (`EiUploadCard.tsx`) |
| USDZ import | needle-tools OpenUSD WASM, .usdz-only gate, recenter-static-only, magenta heuristic (§4.6) | ❌ | Needs COI headers; GLB path (Phase 6) covers mesh import meanwhile |
| Imported assets card | Per-asset editor, owner placement rules, material override (§2.7) | 🚧 | `src/ui/ModelLibrary.tsx`: GLB import, label edit, remove, →splat convert; transforms persist via rehydrate. No per-asset transform editor / material override UI yet |
| Object Capture info card | Platform-gated links/steps (§2.8, §7.7) | ❌ | Docs-only card — cheap |
| Hand tracking priority decision | (TODO: decide after feature map) | ❌ | Still open; MediaPipe not integrated (math layer ported, see hand-tracking row) |

## Phase 6 — Platform

| Feature | Original behavior (§ref) | Status | Notes |
|---|---|---|---|
| GLB import | **Not in original** (USDZ only, §4.6) | ✅ | NEW-adjacent: `src/engine/ModelManager.ts` (native ContainerHandler) — 🔀 addition; feeds mesh→splat; persists via `MODEL_STORE` + rehydrate |
| USDZ import wasm staging + COI headers | postinstall copy to /usdz-wasm/, COOP/COEP-credentialless/CORP trio on all surfaces (§7.5, §7.10) | ❌ | Check header needs for any wasm we ship (.spz zstd too) |
| Zustand store + persistence | `sds-store` v12 partialize/migrations; signal counters; transient buffers (§7.1) | ✅ | `src/store/useStore.ts`: persist key `sds-pc-store` v1, partialize covers theme/mode/objects/capture/realism/robot/pending assets; `ei` keys + capture buffers deliberately transient. 🔀 new key — original v3–v12 payloads not accepted. Persistence verified across reloads |
| URL params + presets | Full preset/flag table, reject-not-clamp, aliases, applyUrlPresets order (§7.3) | 🚧 | `src/lib/urlParams.ts` parses the full table (+443-line test file); `src/lib/applyUrlPresets.ts` applies mode/theme/apiKey/category/robot/capture/realism/objects/seed. `onlyMode`/`autoUpload`/`armPose`/`bypassAuth`/`env` parsed but not yet wired to behavior |
| Iframe embed support | Outbound IFRAME_HEIGHT pings, embedOrigin/referrer targeting, embed/ui/gizmos flags (§7.4) | 🚧 | `src/lib/embed.ts` fully ported (+tests): IFRAME_HEIGHT message builders, `resolveEmbedTargetOrigin`, `initPostContentHeight`; `?embed=1`/`?ui=minimal` hide chrome (`App.tsx`/`Hud.tsx`). Height pings not yet called from the shell |
| Theme toggle (light/dark) | §7.6 | ✅ | See Phase 1 theme row (`ThemeToggle.tsx` + `ThemeSync.tsx`); verified in-browser |
| clearStore bootstrap | Confirm-gated wipe of exact keys/dbs (§7.8) | ❌ | `?clearStore` flag parsed (`urlParams.ts`) but no wipe implemented |
| Platform detection | UA-based Apple gating (§7.7) | ❌ | |
| Number-input UX | Draft-tolerant useNumberInput on all numeric fields (§1.5) | ✅ | `src/ui/primitives/NumberField.tsx` (draft-decision helpers unit-tested in `NumberField.test.ts`); used across all panels |
| Accessibility + reduced motion | WCAG 2.1 AA targets, tabular-nums, prefers-reduced-motion kill-switch (§1.6) | 🚧 | `prefers-reduced-motion` blocks, `tabular-nums`, and `:focus-visible` styles across `src/ui/*.css`; no full AA audit of the fresh design yet |
| Privacy contract | Webcam-local, memory-only keys, no capture persistence (§7.11) | ✅ | Holds so far: EI keys memory-only (partialize exclusion), captures/samples never persisted, no webcam use yet. Re-verify when hand tracking lands |
| Unit tests ported + splat tests | Original vitest suite = executable wire-format spec (§7.10) | ✅ | 25 files / 399 tests passing (`npx vitest run`, 2026-08-20): wire formats (zip/EI/ROS), math/rng/realism, sims (motion/rover/arm), projectBoxes, splat export |
| CI (GitHub Actions) | test on push/PR; release on v* tags w/ artifact checks (§7.10) | 🚧 | `.github/workflows/test.yml` (tsc -b + vitest + vite build on push/PR); no release workflow yet |
| Deployment (Vercel) + static server | vercel.json headers/caching; bin/serve.mjs npx server (§7.9, §7.10) | ❌ | No vercel.json / bin server yet; decide npm-package story for rebuild |
| Screenshot/blog/OG tooling | §8.7 | ❌ | Optional; not product surface |

---

**Snapshot totals** (2026-08-20, post-integration refresh): ✅ 62 · 🚧 9 · 🔀 7 · ❌ 19.
The rebuild now covers the full splat pipeline (import/create/edit/export/persist), the
capture + EI stack, and all four modes end-to-end — verified in-browser today: detection
single + batch (circle trajectory), motion procedural batch, rover cruise and arm
pick_place runs to zip, splat create/erase/export round-trip, theme, and reload
persistence. Remaining gaps are physics/conveyor, hand tracking, USDZ, env
presets/textures, selection gizmos, .spz, splat paint/image-plane, and platform polish
(deploy, clearStore, embed height pings, remaining URL flags).
