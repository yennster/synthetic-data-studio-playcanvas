# Synthetic Data Studio — PlayCanvas Edition

A ground-up rebuild of [Synthetic Data Studio](https://github.com/yennster/synthetic-data-studio)
on the [PlayCanvas engine](https://playcanvas.com/), adding **3D Gaussian Splatting**: import
photoreal splat scans (`.ply`, `.compressed.ply`, `.sog`, `.spz`) as backdrops and objects, create
and edit splats in-app, and render hyper-realistic synthetic training data for
[Edge Impulse](https://edgeimpulse.com/) — no real-world data collection required.

**Status: functional across all four modes; see [STATUS.md](STATUS.md)** for the live snapshot,
[TODO.md](TODO.md) for the task list, and [docs/](docs/) for architecture and feature-parity notes.

## Why splats?

Synthetic data is only as good as its realism. Gaussian splats are photoreal reconstructions of
real places and objects — using them as scene backdrops and props closes most of the sim-to-real
gap before any diffusion post-processing, while keeping perfect, free ground-truth labels.

## Features

Everything the original studio does, rebuilt fresh on PlayCanvas:

- **Object detection** — virtual camera captures with auto-labeled bounding boxes, batch
  runs over deterministic camera trajectories (circle / figure-8 / arc / spiral / orbit dome)
  or seeded domain randomization, plus a realism pixel pass (grain/chromatic/vignette/jitter/JPEG)
- **Visual anomaly** — same pipeline with batch labels, no boxes
- **Motion / IMU** — procedural drop/throw/push/shake gestures with an LSM6DSO-style noise model
- **Robotics rover & arm** — kinematic rover with lidar/ToF ring (cruise/collision/stuck events),
  Braccio arm with IK trajectories and pick-and-place outcome labeling, POV cameras, ROS 2 export
- **Edge Impulse integration** — API-key auth, direct ingestion uploads (exact acquisition-JSON /
  bounding-box header formats, HMAC signing), Studio API (build/retrain/fetch deployments),
  in-browser WASM model inference with live overlay
- **Export** — labeled ZIP datasets in Edge Impulse's uploader layout (`bounding_boxes.labels`,
  `info.labels`)

New in this edition:

- **Splat import** (`.ply`, `.compressed.ply`, `.sog`) as photoreal environment backdrops or
  labeled foreground objects
- **In-app splat creation** — convert GLB meshes to splats (with texture colors), procedural
  splat primitives
- **Splat editing** — GPU erase brush (right-drag) and crop/erase boxes, non-destructive
- **Splat export** — created splats serialize to standard 3DGS `.ply`
- **Reload persistence** — splats and models survive refreshes via IndexedDB

## Development

```bash
npm install
npm run dev
```

Built with PlayCanvas engine 2.x, TypeScript, Vite, React, and zustand.

## License

[Apache-2.0](LICENSE) — © 2026 Jenny Speelman
