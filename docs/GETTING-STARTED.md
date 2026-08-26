# Getting started

The studio runs entirely in the browser: **<https://canvas.jennyspeelman.dev>** — or locally:

```bash
npm install
npm run dev   # http://localhost:5173
```

## Your first synthetic dataset (2 minutes)

1. **Load an environment.** Say yes to the first-load prompt (or open the
   **Sample gallery** and add *Apartment*). A photoreal gaussian-splat scan becomes
   your backdrop — its floor sits at `y = 0`.
2. **Add labeled objects.** From the gallery, `+` a few props (splat scans like
   *Guitar* / *Biker*, or GLB meshes like *Damaged Helmet*) — each arrives with a
   detection label. Or drop in your own `.glb` / `.ply` / `.compressed.ply` / `.sog`.
3. **Arrange the scene.** Click an object → drag to move, `⇧` height, `⌥` rotate,
   `⌘/Ctrl` scale. `Esc` deselects. Numeric controls live in each library card.
4. **Frame the virtual camera.** The orange frustum is the capture camera and the
   pink cross its target — drag either in the viewport, or press **🎯 Use current
   view**. The bottom-right PiP shows exactly what a capture will see.
5. **Capture.** *📸 Capture* for one labeled frame, or pick a **Camera path**
   (circle, figure-8, arc, spiral, orbit dome — draggable teal scaffold, optional
   camera lock + scrub) and run *⚡ Batch*. Batches download as a ZIP of PNGs +
   `bounding_boxes.labels` (Edge Impulse's uploader format), with optional
   domain randomization (camera / lighting / objects) and the Photo FX realism pass.
6. **Upload to Edge Impulse.** Paste a project API key in *Edge Impulse · auth*
   (kept in memory only) and *⤴ Upload* — detection boxes travel in the
   `x-bounding-boxes` header. Load a built WebAssembly deployment in the
   *Inference* card to watch your model run live over the preview.

## The other modes

- **Visual anomaly** — same pipeline, batch-labeled images without boxes.
- **Motion** — procedural drop/throw/push/shake gestures with an LSM6DSO-style
  IMU noise model; upload or ZIP as Edge Impulse acquisition JSON.
- **Robotics** — kinematic rover (IMU + lidar ring, cruise/collision/stuck) and
  Braccio arm (five trajectories, pick-and-place outcomes), POV camera captures,
  ROS 2 JSONL export.

## Keyboard controls

Fly the viewport camera with **W A S D** (+ **Q**/**E** down/up, arrow keys work
too) — hold `⇧` for fast, `Ctrl` for slow. Left-drag still orbits, middle/⇧-drag
pans, scroll zooms. With something selected: **[** / **]** rotate ∓15°, **-** /
**=** scale, **F** frames it, **Delete** removes it. **C** captures a frame
(vision modes), **H** toggles the sidebar, **?** toggles the in-app controls
help. Shortcuts pause automatically while you type in a text field.

## Splat editing

Enable ⛭ on a splat: move/rotate/scale, **right-drag erases** with a brush
(non-destructive, reset anytime), **⌖ Ground here** re-centers a scan's floor to
`y = 0`, and in-app-created splats (mesh→splat conversions, primitives) export to
standard 3DGS `.ply`.

Power-user surface: [URL parameters](url-parameters.md) ·
[architecture](ARCHITECTURE.md) · [feature parity vs the original](FEATURE-PARITY.md).
