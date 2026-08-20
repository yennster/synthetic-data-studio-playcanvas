# Synthetic Data Studio — PlayCanvas Edition

A ground-up rebuild of [Synthetic Data Studio](https://github.com/yennster/synthetic-data-studio)
on the [PlayCanvas engine](https://playcanvas.com/), adding **3D Gaussian Splatting**: import
photoreal splat scans (`.ply`, `.compressed.ply`, `.sog`, `.spz`) as backdrops and objects, create
and edit splats in-app, and render hyper-realistic synthetic training data for
[Edge Impulse](https://edgeimpulse.com/) — no real-world data collection required.

**Status: work in progress.** See [STATUS.md](STATUS.md) for the live snapshot,
[TODO.md](TODO.md) for the task list, and [docs/](docs/) for architecture and feature-parity notes.

## Why splats?

Synthetic data is only as good as its realism. Gaussian splats are photoreal reconstructions of
real places and objects — using them as scene backdrops and props closes most of the sim-to-real
gap before any diffusion post-processing, while keeping perfect, free ground-truth labels.

## Planned feature set

Everything the original studio does, rebuilt fresh on PlayCanvas:

- **Object detection** — virtual camera captures with auto-labeled bounding boxes
- **Visual anomaly** — normal/anomalous scene variations
- **Motion / IMU** — procedural gestures with a realistic IMU noise model
- **Robotics rover & arm** — simulated sensors, trajectories, POV cameras
- **Edge Impulse integration** — API-key auth, direct ingestion uploads, in-browser inference
- **Import** — GLB/USDZ props, plus gaussian splat scans
- **Export** — labeled ZIP datasets

New in this edition:

- **Splat import** as environment backdrops or labeled foreground objects
- **In-app splat creation** — convert meshes to splats, image-to-splat, procedural primitives
- **Splat editing** — crop, erase, tint (GPU-accelerated)

## Development

```bash
npm install
npm run dev
```

Built with PlayCanvas engine 2.x, TypeScript, Vite, React, and zustand.

## License

[Apache-2.0](LICENSE) — © 2026 Jenny Speelman
