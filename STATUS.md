# Project Status

> **Purpose of this file**: living snapshot of where the project is, so any agent (or human)
> can pick up work without reading the whole git history. Update this file **every work session**:
> bump the date, move items between sections, and keep "Next steps" honest.
> Detailed task list lives in [TODO.md](TODO.md). Design rationale lives in
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Feature parity tracking lives in
> [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md).

**Last updated:** 2026-08-20 (session 1)

## What this project is

A ground-up reimplementation of [yennster/synthetic-data-studio](https://github.com/yennster/synthetic-data-studio)
(React + three.js) on the **PlayCanvas engine**, adding **gaussian splat import and in-app splat
creation/editing** for hyper-realistic synthetic data backdrops and objects. Target feature set =
everything the original does (motion IMU, object detection, visual anomaly, rover, robot arm modes;
Edge Impulse auth/ingestion/inference; USDZ/GLB import; ZIP export; realism pipeline) plus the new
splat capabilities. UI is a fresh design, not a port.

- Original repo clone (reference): was cloned to scratchpad during session 1; re-clone from
  `https://github.com/yennster/synthetic-data-studio` if you need it.
- Engine: `playcanvas` **2.21.4** (npm), TypeScript, Vite, React 18 UI shell, zustand state.

## Current state

- [x] Repo scaffolded (Vite + React + TS), deps installed (`playcanvas`, `zustand`, `jszip`, `vitest`)
- [ ] Feature map of original app (workflow running — results land in docs/ORIGINAL-FEATURES.md)
- [ ] PlayCanvas engine bootstrap + scene manager
- [ ] Splat import (.ply / .compressed.ply / .sog / .spz)
- [ ] In-app splat creation (mesh→splat, image→splat, primitives) + editing (crop/delete/paint)
- [ ] Capture pipeline (render targets, bbox labels, ZIP export)
- [ ] Edge Impulse integration (auth, ingestion upload, in-browser inference)
- [ ] Modes: detection / anomaly / motion / rover / arm
- [ ] GitHub repo created + pushed

## Key technical decisions so far

1. **Engine-direct, not @playcanvas/react**: the capture pipeline needs render-target control,
   readback, and custom passes; React wraps only the UI panels around one engine canvas.
2. **Splat creation in-app** uses engine 2.21 APIs verified against upstream examples:
   `GSplatFormat.createSimpleFormat(device)` → `GSplatContainer(device, count, format)` →
   write `dataCenter` (RGBA32F: x,y,z,size) + `dataColor` (RGBA16F half-float) textures +
   `centers` array → `container.update(count)`; component created with `unified: true`.
   Editing via `GSplatProcessor` (GPU) + work-buffer modifiers (see engine
   `examples/src/examples/gaussian-splatting/{paint,editor,crop}.example.mjs`).
3. **Splat import** is native: `new Asset('name', 'gsplat', { url })` handles
   `.ply`, `.compressed.ply`, `.sog`, `.spz` (spz needs the zstd wasm decoder).
4. Pure-logic libs from the original (IK, trajectories, IMU noise, RNG, zip, Edge Impulse client)
   are renderer-agnostic and get ported/adapted rather than rewritten from scratch.

## Next steps (in order)

1. Wait for feature-map workflow → write docs/ORIGINAL-FEATURES.md + docs/FEATURE-PARITY.md
2. Engine bootstrap (createApp.ts) + fresh UI shell
3. Splat subsystem (import + create + edit)
4. Capture pipeline + Edge Impulse
5. Modes, tests, push

## Gotchas / open questions

- Original uses MuJoCo WASM for robot physics + cross-origin isolation headers (COOP/COEP)
  for USDZ WASM SharedArrayBuffer. Decide: keep MuJoCo, or use simpler kinematic sim first.
- `.spz` import needs the zstd wasm module wired up (see engine examples/assets/wasm).
- Commit identity: yennster / jenny@edgeimpulse.com / "Jenny Speelman" (global git config, GPG-signed).
  Never set a local override.
