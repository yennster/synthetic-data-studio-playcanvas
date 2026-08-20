# Project Status

> **Purpose of this file**: living snapshot of where the project is, so any agent (or human)
> can pick up work without reading the whole git history. Update this file **every work session**:
> bump the date, move items between sections, and keep "Next steps" honest.
> Detailed task list lives in [TODO.md](TODO.md). Design rationale lives in
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The original app's behavior contract lives in
> [docs/ORIGINAL-FEATURES.md](docs/ORIGINAL-FEATURES.md); parity tracking in
> [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md).

**Last updated:** 2026-08-20 (session 1, mid-session)

## What this project is

A ground-up reimplementation of [yennster/synthetic-data-studio](https://github.com/yennster/synthetic-data-studio)
(React + three.js) on the **PlayCanvas engine**, adding **gaussian splat import and in-app splat
creation/editing** for hyper-realistic synthetic data. Repo:
`github.com/yennster/synthetic-data-studio-playcanvas` (private).

- Engine: `playcanvas` **2.21.4** (npm), TypeScript, Vite, React 18 UI shell, zustand state.
- Reference clone of the original lives in the session scratchpad; re-clone from GitHub if needed.

## Current state (done & verified)

- [x] Repo scaffolded, pushed to private GitHub repo (signed commits as Jenny Speelman)
- [x] Engine bootstrap: AppBase + GSplat systems, fill-window canvas, CameraControls orbit view
- [x] **Splat import**: .ply / .compressed.ply / .sog via drag-drop or picker (in-memory `Response`
      contents; parser keyed by `asset.file.filename`); role = backdrop | object; label editing
- [x] **In-app splat creation**: procedural primitives (plane/box/sphere point sampling) and
      **mesh→splat conversion** (area-weighted triangle sampling w/ diffuse texture lookup) via
      `GSplatFormat.createSimpleFormat` + `GSplatContainer` (verified rendering)
- [x] GLB import (ModelManager) with ground-rest placement and labels
- [x] **Capture pipeline** (verified live in browser): offscreen 2× SSAA render target, async
      readback (`texture.read` immediate), vertical flip + high-quality downsample, PNG encode;
      pure view-proj AABB→bbox projection (behind-camera skip, 4px min, clamp+round at output res);
      works in hidden tabs via manual `app.tick` pumping
- [x] **All pure libs ported from the original with their test suites — 335 tests green**:
      edgeImpulse (full ingestion + Studio API + sidecars), eiModel (WASM classifier loader),
      zip/zipReader/zipWorker, realism, imuNoise, proceduralMotion, urlParams/embed/cameraTrajectory,
      braccio/braccioIk/armTrajectories/armPickup*/rover/lidar/rosMessages/handMath, rng/math
- [x] Full zustand store with original state shape + defaults (persist v1; API keys never persisted)
- [x] Vision runner: single + batch capture with trajectories/jitter/restore, realism pass,
      zip packaging (PNG+bounding_boxes.labels), store bookkeeping (verified: 3-shot circle batch)
- [x] App shell: mode switcher sidebar, HUD pills, dark/light theme, URL preset application
      (`applyUrlPresets`), embed/minimal chrome flags

## In flight (background agents, may land after this snapshot)

- Workflow `build-ui-and-modes`: UI primitives (CollapsibleCard/ToggleSwitch/SliderRow/
  NumberField/RadioPills), VisionPanel + capture/realism/objects cards + PiP sync,
  EI auth/upload/inference cards + overlay, motion runner (analytic IMU synthesis) + MotionPanel,
  robot sims (kinematic rover + lidar, Braccio arm playback) + robotRunner + RobotPanel + rigs
- Agent writing docs/ORIGINAL-FEATURES.md + docs/FEATURE-PARITY.md from the 7-reader feature map

## Key technical decisions

1. **Engine-direct, not @playcanvas/react** — capture needs render-target control.
2. Splat creation via `GSplatContainer` writable textures (dataCenter RGBA32F xyz+size,
   dataColor RGBA16F); component `unified: true`; resource `.aabb` gives capture bboxes.
3. Physics: none yet. Spawned objects "instant-settle" onto the ground plane (rest-Y from kind
   dims). Real physics (Ammo or Rapier) + conveyor tracked in TODO Phase 5.
4. Motion IMU: analytic kinematic synthesis (no MuJoCo). Marked "changed by design" in parity.
5. Robot sims: pure-TS kinematic choreography + analytic ray-AABB lidar (no MuJoCo), engine only
   for visuals/POV camera. Fully unit-testable.
6. PiP preview = second camera with `camera.rect` viewport (no readback); offscreen CaptureRig is
   a separate camera; EI inference grabs pixels through CaptureRig when idle.
7. Hidden-tab robustness: `nextFrame()` pumps `app.tick` manually; readback `immediate: true`.

## Next steps (in order)

1. Integrate the UI workflow output: fix cross-agent seams, typecheck, run all tests
2. Visual verification pass in browser (all modes), fix bugs
3. Wire splat backdrop UX (hide ground when backdrop present), splat edit (crop/delete/paint) +
   .ply export
4. Update docs/FEATURE-PARITY.md against reality; refresh this file; push
5. Remaining Phase 6 platform work (see TODO.md): USDZ import, hand tracking, IndexedDB asset
   persistence, CI workflow, iframe height messaging

## Gotchas for the next agent

- `npx tsc --noEmit -p tsconfig.app.json` + `npx vitest run` must both stay clean.
- Never set a local git identity; global config signs as Jenny Speelman <jenny@edgeimpulse.com>.
- The engine mirrors `store.sceneObjects` via subscription in EngineContext; UI must never call
  `engine.objects.sync` directly.
- CaptureRig is single-flight (`capturing` guard) — EI live inference must skip ticks while a
  batch runs.
- Realism internal mode value must stay the string `'random'` (UI label "Photo FX").
- Dev-only `window.__studio` exposes the engine for console debugging.
