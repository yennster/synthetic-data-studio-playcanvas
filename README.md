# Synthetic Data Studio — PlayCanvas Edition

**Generate hyper-realistic, auto-labeled training data in your browser.**
Import photoreal gaussian-splat scans as scenes, drop in labeled props, and batch-capture
datasets that upload straight to [Edge Impulse](https://edgeimpulse.com/) — no real-world
data collection, no annotation pass.

**▶ Live: <https://canvas.jennyspeelman.dev>**

<!-- SCREENSHOT: hero — photoreal splat scene with auto-labeled bounding boxes.
     Drop the image at docs/media/hero.jpg and uncomment:
![Photoreal splat scene with auto-labeled bounding boxes](docs/media/hero.jpg)
-->

A ground-up rebuild of [synthetic-data-studio](https://github.com/yennster/synthetic-data-studio)
on the [PlayCanvas engine](https://playcanvas.com/), with 3D Gaussian Splatting as the
realism engine.

## Why splats?

Synthetic data is only as useful as its realism. Gaussian splats are photoreal
reconstructions of real places and objects — using them as backdrops and props closes most
of the sim-to-real gap up front, while keeping perfect, free ground-truth labels: bounding
boxes are computed from the actual splat centers and mesh vertices (percentile-trimmed
screen-space projection), so every capture ships pixel-tight annotations for free.

<!-- SCREENSHOTS: two-up — camera trajectory scaffold w/ PiP preview, and the splat
     erase brush. Drop images at docs/media/path.jpg + docs/media/edit.jpg and uncomment:
| | |
|---|---|
| ![Camera trajectory scaffold with virtual-camera preview](docs/media/path.jpg) | ![Erasing splats in-app with the brush](docs/media/edit.jpg) |
-->

## Features

**Vision datasets**
- **Object detection** — virtual camera with a draggable in-viewport frustum + target,
  deterministic camera paths (circle / figure-8 / arc / spiral / orbit dome, draggable
  scaffold, camera lock + scrub) or seeded domain randomization (camera / lighting /
  objects), 2× supersampled captures, tight auto-labels
- **Visual anomaly** — the same pipeline with batch labels, no boxes
- **Realism pass** — film grain, chromatic aberration, vignette, color jitter, JPEG
  round-trip; pixel-only, so labels stay valid

**Gaussian splats**
- Import `.ply` / `.compressed.ply` / `.sog` as environments or labeled objects
- One-click **Sample gallery** (photoreal scans + GLB props, credited — see
  [docs/SAMPLE-CREDITS.md](docs/SAMPLE-CREDITS.md))
- Create splats in-app: convert GLB meshes (with texture colors) or generate primitives
- Edit: erase brush, crop/erase boxes, floor re-grounding; export to standard 3DGS `.ply`
- Everything persists in IndexedDB across reloads

**Direct manipulation**
- Click-select anything, drag to move, `⇧` height, `⌥` rotate, `⌘/Ctrl` scale
- Draggable capture-camera and trajectory gizmos (never rendered into captures)

**Motion & robotics**
- Procedural IMU gestures (drop / throw / push / shake) with an LSM6DSO-style noise model
- Kinematic rover (IMU + lidar ring; cruise / collision / stuck) and Braccio arm
  (five trajectories, pick-and-place outcome labels), POV captures, ROS 2 JSONL export

**Edge Impulse, end to end**
- API-key auth (memory-only), direct ingestion uploads in the exact acquisition formats
  (`x-bounding-boxes`, HMAC-signed JSON, `bounding_boxes.labels` / `info.labels` sidecars)
- Build / fetch / retrain from the Studio API; run WebAssembly deployments live in-browser
  over the camera preview

## Getting started

**[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)** walks the first dataset in two
minutes. Deep links via [URL parameters](docs/url-parameters.md)
(`?mode=detection&objects=cube&trajectory=circle&seed=42&autoUpload=1`).

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 399 tests — the Edge Impulse wire formats are an executable spec
```

## Docs

| | |
|---|---|
| [GETTING-STARTED.md](docs/GETTING-STARTED.md) | First dataset, all four modes, splat editing |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engine/store layering, splat + capture pipelines |
| [url-parameters.md](docs/url-parameters.md) | Full deep-link surface |
| [ORIGINAL-FEATURES.md](docs/ORIGINAL-FEATURES.md) | Behavior contract inherited from the original app |
| [FEATURE-PARITY.md](docs/FEATURE-PARITY.md) | Rebuild status vs the original, feature by feature |
| [SAMPLE-CREDITS.md](docs/SAMPLE-CREDITS.md) | Sample asset authors & licenses |
| [STATUS.md](STATUS.md) / [TODO.md](TODO.md) | Live project state & roadmap (agent-handoff docs) |

Built with PlayCanvas engine 2.x, TypeScript, Vite, React, and zustand.
Deployed on Vercel.

## License

[Apache-2.0](LICENSE) — © 2026 Jenny Speelman.
Sample assets stream from their own sources under their own licenses
([credits](docs/SAMPLE-CREDITS.md)).
