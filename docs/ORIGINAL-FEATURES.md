# ORIGINAL-FEATURES — Synthetic Data Studio (three.js original)

> **What this is.** A single-file implementation contract documenting **every feature, data
> format, state shape, and must-preserve constraint** of the ORIGINAL
> [yennster/synthetic-data-studio](https://github.com/yennster/synthetic-data-studio)
> (React 18 + three.js + @react-three/fiber). The PlayCanvas rebuild in this repo implements
> against this document. Where the rebuild deliberately diverges, that divergence is recorded
> in [FEATURE-PARITY.md](FEATURE-PARITY.md) — this file describes the original, verbatim.
>
> Generated **2026-08-20** from the original repo at version **0.14.0**
> (`@yennster/synthetic-data-studio`, Apache-2.0). Stack of the original: Vite 5, React 18,
> three 0.169, @react-three/fiber 8, @react-three/rapier 1.5 (vision physics),
> MuJoCo WASM (`@mujoco/mujoco` 3.8) for motion/robot dynamics, MediaPipe tasks-vision
> 0.10.35 (hand tracking), `@needle-tools/usd` (USDZ import), zustand 5 (persist), Vitest 4.
> Production deployment: <https://synthetic.jennyspeelman.dev/>.
>
> Sections: [1 App shell & modes](#1-app-shell--modes) ·
> [2 UI cards per mode](#2-ui-cards-per-mode) ·
> [3 Edge Impulse integration](#3-edge-impulse-integration) ·
> [4 Capture & export pipeline](#4-capture--export-pipeline) ·
> [5 Robotics](#5-robotics) ·
> [6 Motion & realism](#6-motion--realism) ·
> [7 Config, URL params & platform](#7-config-url-params--platform) ·
> [8 Known discrepancies & dead surface](#8-known-discrepancies--dead-surface)

---

## 1. App shell & modes

### 1.1 Layout

Single-page app: full-viewport 3D scene (lazy-loaded `Scene` component) on the left, fixed
right **Sidebar** with mode-specific control cards, **HUD** pills overlaid top-left of the
scene, and a resizable **preview overlay** bottom-left for camera-based modes. Mobile:
sidebar becomes a swipe-dismissable right drawer behind a hamburger toggle. `ErrorBoundary`
wraps both the whole App (in `main.tsx`) and the Scene subtree (`scope='Scene'`).

Key files (original): `src/App.tsx`, `src/main.tsx`, `src/components/Sidebar.tsx`,
`src/components/ErrorBoundary.tsx`, `src/components/TouchResizeHandle.tsx`.

**Modes.** 4 modes: `'motion' | 'detection' | 'anomaly' | 'robot'`. Panel routing:
`motion` → MotionPanel, `robot` → RobotPanel, `detection`/`anomaly` share VisionPanel
(anomaly differences: batch-label field in Capture card, uploads without boxes,
label = `anomalyLabel`). Panels are lazy-loaded with a `'Loading controls...'` fallback.

**Preview overlay** (`.cam-overlay.resizable`):
- Mounts only for detection/anomaly (label `Virtual camera · drag ↗`) and robot
  (label `Robot POV · drag ↗`). Motion mode instead mounts `CameraFeed` when
  `handTrackingEnabled`.
- Width starts at **240 px**, user-resizable; height derived from capture aspect
  (`capture.width / capture.height`) — the canvas must never distort.
- Canvas backing store = CSS px × devicePixelRatio clamped to **[1, 2]** (`MAX_PREVIEW_DPR = 2`).
- Contains `InferenceOverlay` (draws EI detection boxes) and `TouchResizeHandle`.
- App.tsx has a `ResizeObserver` on the overlay mirroring its width into React state.

**TouchResizeHandle** (`src/components/TouchResizeHandle.tsx`): Pointer-Events resize
handle in the **top-right** corner of the overlay, replacing native CSS `resize:horizontal`
(bottom-right-only, ignores touch). Renders
`<div class='cam-resize-handle' role='separator' aria-label='Resize preview'>`. On
pointerdown: stopPropagation, setPointerCapture, snapshot startX/`parent.offsetWidth`;
window-level pointermove/pointerup/pointercancel so the gesture survives leaving handle
bounds. New width = `clamp(startW + dx, MIN_W=120, window.innerWidth*0.9)` — drag right
grows. It mutates `parent.style.width` directly; App's ResizeObserver syncs React state.
CSS: cursor `nesw-resize`; desktop overlay clamps min-width 160px / max-width 720px;
mobile (≤768px) 120px / 90vw.

**Mobile drawer**: fixed right drawer width `min(86vw, 360px)`, `translateX(100%)` closed,
240ms `cubic-bezier(0.2,0.8,0.2,1)` slide, backdrop shadow. Swipe-close: horizontal
axis-lock after 10 px deadzone, right-swipe only, commits when dx > 30% of drawer width OR
velocity > 0.5 px/ms.

**Chrome-hiding**: `?embed=1` or `?ui=minimal` strips sidebar + drawer toggle
(`app--no-chrome`); `?embed=1` additionally strips the HUD entirely. `embed=1` wins over
any `ui=` value.

**Startup order contract** (see §7 for details):
index.html inline scripts (`?clearStore` wipe → theme pre-paint) → module load parses
`URL_FLAGS`/`URL_PRESETS` singletons → App.tsx module scope applies
`?studioHost=`/`?ingestionHost=` (allowlisted, §3.1) → main.tsx applies legacy helpers
(`?apiKey`, `?category`, `?theme`) → `applyUrlPresets()` (full docs/url-parameters.md
surface: env, objects, batch, EI label, realism, robotics, motion sample rate, camera pose,
seed, onlyMode) → ReactDOM render → `initPostContentHeight()` for iframe embeds.
`@vercel/analytics` `<Analytics/>` is mounted in App.

**One-time URL mode sync**: `?mode=` accepts aliases
(motion/imu/accel → motion; detection/object/objects/object-detection/objectdetection →
detection; anomaly/visual-anomaly → anomaly; robot/robotics/rover/arm → robot);
`?robot=arm|rover` (or mode alias arm/rover) sets `robot.kind`.

**Theme ↔ env auto-sync** (`useThemedSceneEnv` in App.tsx): only in **motion + robot**
modes: light theme flips envPreset studio→whitebox, dark flips whitebox→studio; deliberate
warehouse/outdoor choices are never clobbered; no-op in detection/anomaly. `ThemeToggle`
itself never touches the scene env.

### 1.2 Mode card (sidebar header)

First sidebar card: `Mode` heading with ThemeToggle button beside it, then a 2-column grid
of 4 mode buttons with a hint line under the grid showing the active mode's hint.

| Button label | Tooltip hint |
|---|---|
| Motion | `Accelerometer` |
| Object detection | `Images + bboxes` |
| Visual anomaly | `Images, batch label` |
| Robotics | `Rover & Arm telemetry` |

Active button gets className `primary`. `?onlyMode=` filters the list (a single mode
collapses the card to one button; if the persisted mode is excluded, the app snaps to the
first allowed mode). Below the cards, a **status bar** renders at sidebar bottom when
`status.msg` is set: kind label map idle→`Status`, busy→`Working`, ok→`Done`, err→`Issue`;
`aria-live` assertive for err, polite otherwise.

### 1.3 HUD

Overlay pills at the top of the scene (`src/components/Hud.tsx`). Hidden entirely when
`?embed=1`.

- **Motion pills**: `Hand: tracked|—` (`live` class when tracked), `Pinch: NN%`
  (`pinchStrength*100` toFixed(0)), `Grabbed`/`Released` (`live` when grabbed),
  `● REC · N` pill while `isRecording` (N = samples.length).
- **All non-motion modes**: `Mode: {object detection|visual anomaly|robotics}`,
  `Objects: N` (sceneObjects.length + assets.length, unfiltered),
  `Captures: N` (`live` class when >0; **robot mode reads the `robotCaptures` counter** —
  the vision `captures` array stays empty in robotics).
- **TipPill** lists 8 shortcuts: Click=select object; Cmd/Ctrl-click=multi-select;
  Esc=clear selection; `[` / `]`=rotate selection (or all); Q / E=rotate camera around
  target; arrows=pan the framed view; Shift+drag=move object (Alt/Cmd = depth);
  Right-drag=pan camera (mouse). Open state persists in localStorage key
  **`sds-hud-tip-open`** (`'1'`/`'0'`, default open); closed renders a tiny `?` button.
- **Restore pills** (all modes): `⟳ Restoring done/total…` while
  `restoringAssets.phase==='busy'`, `✓ Success!` briefly on `phase==='success'`.

Numeric readouts (HUD pills, cam-overlay label, `.check-row`) use
`font-variant-numeric: tabular-nums`.

### 1.4 Scene canvas, camera & interactions (Scene.tsx)

`src/components/Scene.tsx` (~1073 lines).

**Canvas**: shadows on, default camera position `[4,3,6]` fov 50,
gl `{antialias:true, ACESFilmicToneMapping, exposure 1.0}`. Canvas CSS background is a
per-env-preset gradient (`backgroundForPreset`): studio `#0b0d10→#14181d`, whitebox
`#f5f5f2→#e8e8e3`, outdoor `#87b9d8→#c4d9e8`, warehouse `#2a2620→#1a1612`.
Physics gravity `[0, -9.81, 0]`. `SoftShadows(size 20, samples 12)`.

**Helpers**: drei `Grid` at y=0.001, 30×30, cellSize 0.5, sectionSize 2, colors
`#2a313a`/`#3d4651`, fadeDistance 30, infiniteGrid. `ContactShadows` y=0.005 opacity 0.5
scale 20 blur 2.5 far 10.

**OrbitControls**: makeDefault, enableDamping dampingFactor 0.1, minDistance 0.3,
maxDistance 20, enablePan + screenSpacePanning, target `[0, 0.7, 0]`.

**CameraRig**: snaps camera+target when mode/robot.kind changes — arm → camera
`(0.55, 0.45, 0.65)`, target `(0, 0.25, 0)` (the Braccio is ~30 cm tall); all other
modes → `(4,3,6)` / `(0,0.7,0)`. Also enables `GIZMO_LAYER` (=1) on **both**
`camera.layers` **and** `raycaster.layers` (the recorded bug was enabling only the render
layer, which made handles visible but unclickable). Computes
`handMappingScale = clamp(cameraDistanceFromOrigin / hypot(4,3,6), 1, 3)`, pushed to store
only when |Δ| > 0.01 (motion mode only).

**Keyboard input** (`CameraKeyboardInput`, window keydown, suppressed when the event
target is INPUT/TEXTAREA/SELECT/contentEditable):
- Q / E rotate camera azimuth ±5° (Shift: 10°) around `controls.target` via spherical
  coords, polar clamped `[0.05, π−0.05]`.
- `[` / `]` rotate selection (or ALL sceneObjects+assets when `selectedIds` is empty)
  about Y by ±10° (Shift: 20°).
- Arrow keys pan camera+target along camera local X/Y axes by 0.2 m (Shift: 0.5 m).
- Escape clears selection (preventDefault only if selection non-empty).
- Former R/F polar-tilt keys were **deliberately removed** (Cmd+R conflict).

**Selection semantics** (`useSelectClickHandler` in `SpawnedObjects.tsx`):
- Shift+click and Alt+click return early **without** stopPropagation (those modifiers
  belong to `useDragMove` translate/depth modes — selection must not fire).
- Otherwise `e.stopPropagation()`, then Cmd/Ctrl+click → `toggleSelectedId(id)`
  (multi-select toggle), plain click → `setSelectedIds([id])` (replace).
- Note: the HUD tip says "Cmd/Ctrl-click=multi-select" — **Shift+click is NOT a selection
  modifier**; the code checks `e.metaKey || e.ctrlKey` only.
- Selected visual: `meshStandardMaterial` emissive `#22d3ee`, emissiveIntensity 0.55
  (unselected `#000000`/0).

**Spawned object physics** (`SpawnedObjects.tsx`):
- Physics-off objects render via `StaticSpawnedMesh` — plain mesh at store
  position/rotation/scale, still Shift+draggable and selectable, no RigidBody/belt
  registration.
- Physics-on `SpawnedMesh`: Rapier body type driven by React state `isDragging` →
  `type='kinematicPosition'` while dragging else `'dynamic'` — the type must flow through
  the RigidBody **prop** (not an imperative `setBodyType`) because
  `@react-three/rapier`'s `useUpdateRigidBodyOptions` re-applies all mutable props on every
  position change and would clobber an imperative call back to dynamic. `onDragStart` also
  zeroes lin/ang velocities.
- Remount key = `` `${id}-${scale.toFixed(3)}-${physics?'p':'s'}` `` so resizing recomputes
  the auto-collider and physics toggling swaps the whole branch.
- `colliderForKind`: cube/phone → `'cuboid'`, sphere → `'ball'`, everything else
  (including soda_can) → `'hull'` — hull's contact margin makes thin slabs like `phone`
  hover, so exact primitives are used where possible.
- Settle-sync two-gate filter: writes body pose to store at most every 250 ms AND only
  when moved ≥ 1 cm (distSq ≥ 1e-4). The `[obj.position]` effect recognizes its own writes
  when the body is already within 5 cm (distSq < 0.0025) of target and skips the
  teleport + velocity-zero (loop terminator), else teleports and zeroes velocities.
- `FLOOR_RESCUE_Y = −3`, `RESPAWN_Y = 5` (respawn keeps store x/z, zeroed velocities).
- Owner filtering: `'vision'` matches `owner == null`; an `excludeIds` prop hides the
  arm's active pickup target.

**Motion-mode manipulated object** (`ManipulatedObject`): see §6.1/§6.3 for the sim and
hand mapping. Visual mesh dims (distinct from SpawnedObjects primitives): cube box 0.8³,
sphere r 0.5, phone 0.7×1.4×0.1, capsule 0.35/0.8, cylinder 0.4/0.9, torus 0.4/0.15,
soda_can cylinder 0.27/0.8; material roughness 0.4 metalness 0.2, color `#f59e0b` idle /
`#5eead4` grabbed with emissive `#3d2706`/`#0d4d44`. PinchMarker: 0.06 sphere, basic
material `#38bdf8` (pinching-off) / `#5eead4` (grabbed), opacity 0.7.

**Hand-target mapping** (`pinchTargetToWorld`): applies a **yaw-only** camera basis around
`HAND_ANCHOR=[0,0,0]` — `back = normalize(cameraXZ − anchorXZ)` (fallback `(0,0,1)` when
degenerate), `right = up×back`, then
`handMath.cameraRelativeToWorld(target, anchor, right, [0,1,0], back)`. This keeps
hand-low-in-frame ⇒ object-at-ground and makes orbiting the camera re-map hand axes.
Held-object orientation = `yawQuat(atan2(dx,dz) from anchor) × pinchRotation`, identity
until the tracker produces a rotation.

**Mode sub-scenes**: `RoverScene` wraps SpawnedObjects(ownerFilter='rover') +
ImportedAssets(rover, physicsMode='visual') inside one `obstaclesRef` group that the
rover's lidar raycasts against. `ArmScene` excludes the active `armTargetId` from
SpawnedObjects/ImportedAssets so BraccioArm's `ArmTargetMesh` draws it solo at MuJoCo's
settled pose.

**TrajectoryGizmo**: tube uses 256 CatmullRom samples independent of batchCount, radius
0.03, closed only for circle/figure8; markers = `clamp(batchCount,1,64)` spheres r 0.06,
index 0 amber `#fbbf24`, rest `#38bdf8`; tube `#5eead4` opacity 0.9; all
`depthTest:false`, renderOrder 998/999. Invisible 0.35 m drag sphere on camTarget
re-samples camPos at index 0 on drag; pink target marker r 0.04 `#f472b6`. Entire subtree
pinned to layer 1 via `traverse(o => o.layers.set(1))`, re-run on tube/marker changes.
Visible only in detection/anomaly with non-random trajectory and `URL_FLAGS.gizmos`.

### 1.5 Shared UI primitives

- **CollapsibleCard**: heading button with rotating chevron SVG (0°→90° when open; custom
  SVG because font triangles rotate off-center); optional accent badge shown only while
  collapsed; open state persisted in `store.cardOpen` keyed by `storageKey ?? heading`
  string (unkeyed cards fall back to local state); `defaultOpen` only seeds first render.
  **Must preserve**: cards with live counts in the heading MUST pass an explicit
  `storageKey` (e.g. `scene-objects:{owner}:{title}`, `imported-assets:{owner}:{title}`)
  or open-state persistence breaks on every count change.
- **ToggleSwitch**: title (span or h3 via `titleAs`), On/Off state pill (customizable via
  `stateLabels`), help text, `role='switch'` button with `aria-checked` and aria-label
  `Turn {title} on/off`.
- **SliderRow**: `<label>{label} {fmt(value)}<input type=range>` with formatValue default
  `toFixed(2)`, optional hint→title tooltip, disabled plumbing.
- **ThemeToggle**: moon icon in dark, sun in light; `toggleTheme` persists; never modifies
  scene env directly.
- **DebugOverlay** (inside Canvas): renders nothing unless URL flags — `?debug=1` adds a
  5 m AxesHelper at origin, fixed bottom-left FPS div id `__sds-fps` updated at 1 Hz, and
  `window.__sds_debug={scene,camera}`; `?perf=1` logs `[sds:perf] dt=…ms` at 1 Hz;
  `?camLog=1` logs `[sds:cam] pos=(x, y, z)` at max 4 Hz on movement > 1e-6 distSq.
- **ErrorBoundary**: class component; catches, logs `[ErrorBoundary:scope]`, renders
  `role='alert'` fallback with scene-specific WebGL/memory copy for `scope==='Scene'`,
  Reload (`location.reload`) + Dismiss (reset) buttons; supports custom
  `fallback(error, reset)`.
- **useNumberInput / NumberField** (`src/lib/useNumberInput.tsx`): draft-tolerant
  controlled `<input type=number>`. `decideOnChange`: `''` or `'-'` → keep draft, commit
  null; non-finite → keep draft, commit null; finite → clamp to min/max and commit only
  when the clamped value differs from the upstream value. `decideOnBlur`:
  `''`/`'-'`/non-finite → draft snaps to `String(value)`; finite → clamp, draft becomes
  `String(clamped)` only if clamping changed it, commit only if ≠ value. External value
  changes sync into the draft via effect, skipped when the draft already parses to the
  same number. `NumberField` is a component wrapper for use inside `.map()` loops
  (rules-of-hooks), forwarding min/max/step/disabled/placeholder/style/className/title/
  aria-label. Used for **all** count/duration/resolution fields so transient empty/partial
  typing doesn't snap back.

### 1.6 Design tokens & responsive/a11y CSS

`src/styles.css` (~1480 lines), oklch token system:

- **Dark is the default theme**, defined on bare `:root, :root[data-theme="dark"]`; light
  overrides under `:root[data-theme="light"]`. **No `prefers-color-scheme` media query** —
  theme is purely the `data-theme` attribute set by `useTheme` / the index.html bootstrap.
- Core tokens: `--bg` `oklch(0.14 0.003 230)` dark / `oklch(0.985 0.002 230)` light;
  `--text`/`-muted`/`-dim` triad; **UI accent is indigo-violet hue 277** — `--accent`
  `oklch(0.66 0.19 277)` dark / `oklch(0.52 0.20 277)` light, with
  `-soft/-line/-on/-hover/-hover-soft` variants.
- **Important distinction**: PRODUCT.md's "one teal accent" refers to **in-scene 3D
  accents** (`#5eead4` teal used for live/grab/gizmo states); the sidebar UI accent is the
  277-hue token. Do not conflate them.
- Legacy alias tokens kept for compat: `--panel`→`--surface-1`, `--panel-2`→`--surface-2`,
  `--muted`→`--text-muted`, `--accent-2`→`--accent`.
- Layout uses `dvh` (not `vh`) so iOS Safari's bottom toolbar doesn't clip the cam-overlay.
- `@media (prefers-reduced-motion: reduce)`: all animation/transition durations forced to
  0.01ms; REC pill pulse animation removed.
- Mobile breakpoint is exactly `max-width: 768px`: one grid column; drawer (see §1.1);
  HUD wraps horizontally with `right:64px` clearance; cam-overlay gets
  `bottom/left: max(12px, env(safe-area-inset-*))` so the resize handle clears the iOS
  home indicator; larger tap targets (accepting iOS's <16px focus-zoom tradeoff).
- Design intent (PRODUCT.md): instrument-grade, scene-is-the-document, no decorative AI
  theatrics; WCAG 2.1 AA, keyboard reachability, no color-only status.

### 1.7 Shared math helpers (`src/lib/math.ts`)

Centralized helpers used across components, lib/, and mujoco/ (tested by
`math.test.ts`). None throw; non-finite inputs coerce to a sensible default:

- `clamp(v, lo, hi)` — **NaN/Infinity collapse to `lo`** (the lower bound), not passed
  through. Render loops rely on this to stop NaN propagation (TrajectoryGizmo marker
  count, camera polar clamp, TouchResizeHandle width all route through it).
- `clamp01(v) = clamp(v, 0, 1)`.
- `lerp(a, b, t) = a + (b−a)*t` with t **not** clamped (callers clamp01 first if needed).
- `smoothstep(t) = u·u·(3−2u)` with `u = clamp01(t)`.
- `degToRad`/`radToDeg` via precomputed constants.
- `wrapAngle(rad)` wraps into `(−π, π]` (`a = rad % 2π; a>π → a−=2π; a<=−π → a+=2π`).

### 1.8 Per-mode workflows (docs/workflows.md summary)

- **Motion manual**: pick object → webcam on → pinch to grab, move, release → Record/Stop
  → paste API key + label → Upload → Retrain.
- **Motion procedural**: optionally webcam off → pick class/count/height/duration →
  Generate & upload|download (auto-disables hand tracking; per-sample
  lift-random-pose→motion→record; label = motion class; no key → zip with info.labels);
  run once per class for balanced datasets.
- **Detection**: pick env (+conveyor) → add labelled objects (+USDZ imports) → position
  virtual camera (orange frustum gizmo; Shift+drag camera body; drag preview corner to
  resize; pink orbit-center marker Shift+drag for non-random trajectories) → optional
  Photo FX → 📸 single or ⚡ batch (both produce zips; single zip = PNG +
  bounding_boxes.labels; batch zip = PNGs + one shared sidecar) → or direct Upload N
  images (boxes via `x-bounding-boxes` header) → Retrain.
- **Inference**: Studio Deployment→WebAssembly build → List projects → Fetch & load →
  ▶ Live (~5 Hz) or Run once → threshold filter; or upload standalone .js+.wasm pair.
- **Anomaly**: same scene/camera; type batch label; captures carry label, no boxes.
- **Robotics**: pick rig → add obstacles/pickups (Shift+drag; Reset scene) → rover: event
  + modality + optional ROS export; arm: trajectory (+ pickup targets for pick_place) →
  set count/duration → Generate & upload|download (20 Hz recording; POV overlay; MuJoCo
  contacts drive collision traces; pick_place records success/failure metadata) → Retrain.

---

## 2. UI cards per mode

**Card order per panel** (top to bottom):

- **Motion**: Object (open), Recording, Procedural motions, EI auth (with HMAC), Upload.
- **Vision** (detection/anomaly): Scene (open), Objects, Import (.usdz), Capture from
  real life, Virtual camera, Realism, Capture, EI auth (no HMAC),
  Inference (virtual-camera), Upload.
- **Robot**: Robot (open), Event|Trajectory (open), [arm: Arm home pose, POV camera
  mount, Pickup objects/Scene props, Imported pickups/props], Recording, [rover: Scene
  obstacles, Imported obstacles, Lidar/ToF ring, Sensor modality], Object detection card,
  [Realism + Inference (robot-pov) only when objectDetection on], EI auth (with HMAC),
  Generate.

### 2.1 Motion — Object card (default open)

- Object select, 7 kinds (value/label): cube/Cube, sphere/Sphere, cylinder/Cylinder,
  torus/Torus, capsule/Capsule, phone/`Phone slab`, soda_can/`Soda can`; default `cube`.
- ToggleSwitch **Webcam control** (default ON, disabled while `dropsRunning`) — ON help
  `Use hand tracking to pinch, grab, and throw.`, OFF help
  `Camera stays off; procedural drops still work.`; controls whether CameraFeed
  (MediaPipe) mounts. `handTrackingEnabled=false` unmounts CameraFeed entirely (camera
  light off, no permission prompt).
- Footer note: `IMU samples are 6-channel: accelerometer (m/s²) + gyroscope (rad/s).`

### 2.2 Motion — Recording card

- Label text input bound to `ei.label` (default `'idle'`, placeholder
  `e.g. shake, idle, drop`).
- Sample rate number input: min 20, max 500, step 10, default **100 Hz**, disabled while
  recording (uses useNumberInput).
- Buttons: `● Record` (primary) ↔ `■ Stop` (danger); `Clear` disabled while recording or
  when samples empty.
- Readout `{N} samples · {S.SS}s` where duration = `(last.t − first.t)/1000` when ≥2
  samples else `N/sampleRateHz` — **actual span, not requested rate** (the sampler is
  frame-rate capped).
- **ImuNoiseToggle**: `Realistic IMU noise` switch bound to `imuNoise.enabled` (default
  true); help `On: LSM6DSO-style bias drift, scale-factor error, quantization, and range
  clipping. Off: clean MuJoCo sensor output.` Defaults in §6.4.

### 2.3 Motion — Procedural motions card

No-webcam batch generator; full runner algorithm in §6.2.

- Motion-class radio pills: `drop | throw | push | shake` (default drop); selecting also
  sets `ei.label` to the class name. (`MotionKind` is exactly these four — there is **no
  wave/circle gesture**.)
- Count input: min 1, max 500, step 1, default 10.
- `Per-{motion} ms` input: min 300, max 6000, step 100, default 1500.
- Conditional sliders:
  - drop/throw/shake: `Drop height min`/`Center height min` 0.3–4 m step 0.05 default
    1.0 (clamped ≤ heightMax−0.05) and matching max slider default 2.5 (clamped ≥
    heightMin+0.05) — the sliders clamp against each other with a **0.05 m gap**.
  - throw only: `Throw speed` 1–10 m/s step 0.1 default 4.
  - push only: `Push speed` 0.5–8 m/s step 0.1 default 3.
  - shake only: `Shake frequency` 1–10 Hz step 0.1 default 4.5; `Shake amplitude`
    0.02–0.5 m step 0.01 default 0.2 (displayed in cm).
- Run button label: `⚡ Generate & upload N samples` when API key set else
  `⚡ Generate & download N samples`; while running becomes danger `■ Stop` (sets
  `dropsCancelRequested`, polled every ≤50 ms via CancelledError).
- Upload path metadata: `{mode:'motion', shape, sample_rate_hz, generator:'procedural',
  motion, motion_index, motion_total, per-motion params (height_min_m/height_max_m for
  drop|throw|shake, throw_speed_mps, push_speed_mps, shake_freq_hz, shake_amp_m),
  duration_ms}`; label = motion class. Filenames `buildFileName(\`${motion}_${i+1}\`)`.
- Download path: each payload as pretty-printed JSON zip entry + `info.labels`; zip named
  `buildFileName(\`motions_${count}\`)` with `.json`→`.zip`; zipped off-thread; Stop
  mid-run still packages partial data. Empty-sample iterations count as failed and don't
  abort the batch.

### 2.4 Motion — Upload to Edge Impulse card

- Hint when no API key: `Set your API key in the Edge Impulse · auth card above.`
- `⤴ Upload N samples` (primary) disabled while recording, when samples empty, no apiKey,
  or status busy; on success clears samples and shows `Uploaded N samples ({status}).`;
  metadata `{mode:'motion', shape: objectKind, sample_rate_hz, hand_tracking}`.
- `↻ Retrain model` disabled without apiKey or while busy: lists projects via
  `listEiProjects`; errors if 0 projects or >1 (`use a project API key`); otherwise
  POST `/jobs/retrain` and polls `waitForEiJob` with elapsed-seconds progress status.
- Error explainer maps fetch/network→CORS hint, 401→`API key rejected`, 403→`no access`.
- EiAuthCard rendered above with `showHmac=true` (motion is the time-series JSON path).

### 2.5 Vision — Scene card (default open)

- Environment select: studio/`Studio (dark, no walls)` (default),
  warehouse/`Warehouse (concrete + walls)`, whitebox/`White box (cyclorama)`,
  outdoor/`Outdoor (grass + sky)`.
- **Custom textures** inner section toggle (chevron rotates 90°; collapsed badge shows
  `floor`, `wall`, or `floor + wall` when set; auto-opens if a texture exists). Help:
  `Floor: tileable image (4× tile). Skybox: 2:1 equirectangular panorama (e.g. 2048×1024)
  that wraps around the scene.` Two `CustomTextureField` rows (`Floor texture`,
  `Skybox panorama`), each a file input `accept='image/*'` that writes bytes to IndexedDB
  via `putCustomTexture(kind)` and stores only `{name}` in the store, with a Clear button
  and `Using: {name}` caption; input value reset after pick so re-picking the same file
  fires. **There are exactly two slots: `'floor' | 'wall'`** (the README's
  "Floor / Wall / Object" claim is stale — no object-texture slot exists anywhere).
- ToggleSwitch **Conveyor belt** (default OFF): ON help `Spawned objects ride the belt —
  adjust speed below.`, OFF `No belt — objects fall onto the floor at spawn position.`;
  when ON shows `Belt speed` SliderRow −2 to 2 m/s, step 0.05, default 0.5, formatted
  `{v.toFixed(2)} m/s`.
- `↺ Reset scene` button disabled when nothing to reset (no vision objects, no vision
  assets, no custom textures, capture settings at defaults); `window.confirm` listing
  exactly what resets (`N object(s)`, `N imported asset(s)`, `N custom texture(s)`,
  `capture camera / trajectory settings`); on confirm disposes vision-owned USDZ, removes
  vision objects, prunes pendingAssets to `owner != null`, sets envPreset `'studio'`,
  clears both custom textures (store + IDB), `resetCapture()`, status ok `Scene reset`.

### 2.6 Shared — Scene objects card (SceneObjectsCard)

Object spawner/editor shared by vision modes and robotics (owner-filtered).

- Heading `{title} ({count})` with count badge when collapsed; storageKey
  `` `scene-objects:{ownerFilter??'vision'}:{title}` ``.
- Kind options: cube, sphere, cylinder, torus, capsule, phone, soda_can. Label input
  placeholder `label`; Add uses `label || kind`.
- Props per caller:
  - vision — title `Objects`, sizeRange 0.1–5 step 0.05, defaultLabel `''`.
  - robot arm — title `Pickup objects` (pick_place) or `Scene props`, sizeRange
    0.02–0.2 step 0.005, defaultLabel `'pickup'`/`'prop'`, addCustom routes to
    `addArmPickupTarget`.
  - robot rover — title `Scene obstacles`, sizeRange 0.05–1.5 step 0.05, defaultLabel
    `'obstacle'`.
- ownerFilter `'vision'` matches `owner == null`; per-owner Clear removes only the
  filtered subset. Row list max-height 200 px scroll.
- Per-row: color input (defaults cycle `#f59e0b`/`#38bdf8`/`#a78bfa`/`#34d399`/`#f472b6`;
  soda_can fixed `#dc2626` metalness 0.85 roughness 0.25, others metalness 0.2 roughness
  0.5), editable label, kind text, `×` remove, Size range+NumberField bound to
  `obj.scale`, checkbox `Physics (falls, collides)` default true.
- `defaultObject` spawns at `[(idx%2)*0.8−0.4, 1.2, floor(idx/2)*−0.9]` (**two columns at
  x=±0.4 keep spawns within the ±0.8 belt inner rails** — wider spreads previously dropped
  objects beside the belt looking like a physics bug), random yaw, scale 1.
- `addArmPickupTarget` spawns a 3 cm cube (scale 0.05 of the 0.6 m base cube) on a 0.14 m
  ring at angle `(idx*0.5+0.4)%2π`, y 0.015, color `#5eead4`, physics true, owner
  `'arm'`, returns id.
- Arm pick_place variant renders footer ToggleSwitch `Randomize pickup position`
  (`robot.armRandomizeTarget`, default false) which immediately calls
  `randomizeArmPickupPositions()` when flipped on — re-samples each arm-owned
  object/asset to radius 0.11–0.22 m, angle 0–π half-circle (x=sin(a)·r, z=cos(a)·r;
  primitives y 0.015, imported assets y 0). The annulus derives from the 0.08 m
  base-plate clearance and the ≈0.238 m floor-level IK reach.

### 2.7 Shared — Imported assets card (ImportedAssetsCard)

USDZ import + per-asset editor, owner-filtered per mode. Titles: vision `Import (.usdz)`;
arm `Imported pickups`/`Imported props`; rover `Imported obstacles`.

- File input `accept='.usdz'` multiple; non-.usdz rejected with message
  `{file}: only .usdz files are supported (see README for .usd conversion).`
- `Default label` input (placeholder `(uses filename if blank)`); label falls back to file
  basename.
- Import stores original bytes in IndexedDB (`putAssetBlob`) keyed by asset id for reload
  rehydration; status reports meshes/tris/maxDim and auto-enables material override when
  >50% of meshes use the default (placeholder) material (see §4.6).
- Placement per caller: vision default position `[assetIndex−1.5, 0, 0]` with scale
  `3/maxDim` if maxDim>3 or `0.1/maxDim` if <0.05; arm: 0.14 m ring, scale `0.05/maxDim`,
  physics false; rover: 1.2 m ring, scale `1.2/maxDim` if >1.2 else `0.3/maxDim` if <0.2.
- sizeRange per caller: vision 0.001–5 step 0.01; arm 0.005–0.2 step 0.005; rover 0.02–3
  step 0.01.
- Per-asset row: name + `· anim` tag, Play/Pause button for animated assets, `x` remove
  (disposes three.js objects), label input, Scale range+number, X/Y/Z number inputs step
  0.1, Yaw slider −π..π step 0.05 (degrees readout),
  `Physics (falls, collides, rides belt)` checkbox (hidden for robot modes,
  showPhysics=false), `Override material (use if it's pink)` checkbox revealing color
  picker (default `#a78bfa`) + Rough/Metal sliders 0–1 step 0.05 (defaults 0.5/0.1).
- Heading count + badge; storageKey `` `imported-assets:{ownerFilter}:{title}` ``.
- Default help: `Drop in .usdz files (zipped USD). For .usd/.usda/.usdc, convert first via
  Blender, Omniverse, or usdcat.`

### 2.8 Vision — Capture from real life card (ObjectCaptureCard)

Informational card (no controls), collapsed by default, heading `Capture from real life`.
Vision panel only (not robotics).

- Links: Apple Object Capture docs, RealityScan App Store (id **1584832280**),
  HelloPhotogrammetry CLI docs (Mac only, shown when `platform.supportsObjectCaptureMac`).
- 3-step ordered list (install RealityScan on iOS 17+, take ~50–200 overlapping photos,
  export USDZ and drop/AirDrop into the import box).
- PlatformBadge: green `✓` when capture-capable (detected iPhone/iPad iOS17+ or Mac),
  else `ℹ` with requirement text
  (`Object Capture requires iOS 17+ (iPhone/iPad Pro) or macOS 12+.`).
- This is docs-only: there is **no in-app photogrammetry**; CameraFeed's webcam feeds
  MediaPipe hand tracking only, never dataset images.

### 2.9 Vision — Virtual camera card (collapsed by default)

- Width/Height number inputs: HTML min 64 max 2048 step 32 (useNumberInput clamps
  64–4096); defaults **640×480**.
- FOV SliderRow 20–90° step 1 default 45, formatted `NN°`.
- `Light intensity` SliderRow 0.2–2.5 step 0.05 default 1.1.
- `Cam X / Y / Z` three number inputs step 0.1, default camPos `[3.5, 3, 3.5]`
  (camTarget default `[0, 0.5, 0]` — not exposed here; retargeted by Shift+dragging the
  pink orbit-center marker in-scene).

### 2.10 Shared — Realism card (RealismCard)

Post-capture "Photo FX" pixel-transform pass applied to every captured PNG before
upload/zip. Shown in detection/anomaly always; robotics only when objectDetection is on.
Full pipeline algorithms in §4.7.

- Mode radio pills: `Off` (default; `Raw synthetic render.`) and `Photo FX` (**internal
  value `'random'`** — must stay `'random'` for persistence + `realism_mode` metadata
  compat). A hidden third mode `'diffusion'` exists in types/API
  (`api/realism-diffusion.ts`, Vercel Function → Hugging Face) but is deliberately not in
  the picker; persisted `'diffusion'` migrates to `'random'`.
- When active, five SliderRows each 0–1 step 0.05 shown as % — `Film grain` default 0.5,
  `Chromatic aberration` 0.5, `Vignette` 0.3, `Color jitter` 0.5, `JPEG artifacts` 0.5
  (0% skips the JPEG round-trip) — each with a tooltip hint.
- ToggleSwitch `Randomize per capture` (default false): ON re-samples each capture's
  effective intensity uniformly in [0, slider value].
- Collapsed-header badge `random` only when active AND randomize on.
- Geometry never moves so bounding boxes stay valid.
- `realismAverage` = mean of the five knobs (used as `realism_intensity` metadata).

### 2.11 Vision — Capture card

- Anomaly mode only: `Batch label` input bound to `anomalyLabel` (default `'normal'`,
  placeholder `normal | anomaly`).
- `📸 Capture frame` primary button → `triggerCapture()`; single shots download a zip
  containing the PNG + `bounding_boxes.labels` sidecar (detection) or save the bare PNG
  (anomaly) AND accumulate in the captures store for EI upload.
- Batch section: `Batch count` input min 1 max 500 step 1 default 10; `⚡ Batch (N)`
  primary button → `triggerBatch()`; batch zips all PNGs + one shared
  `bounding_boxes.labels`.
- `Randomize` fieldset, three checkboxes: Camera (default true; **disabled unless
  trajectory === 'random'**), Lighting (default true), Objects (default false).
- `Camera trajectory` select: random/`Random (jitter base pose)` (default),
  circle/`Circular fly-around`, figure8/`Figure-eight`, arc/`Front arc (180°)`,
  spiral/`Ascending spiral`, orbit_dome/`Orbit dome (hemisphere)`. Picking a non-random
  path immediately snaps camPos to the trajectory's first sample (index 0,
  total=batchCount, around camTarget).
- Non-random trajectories reveal `Radius` slider 0.5–15 m step 0.1 default 4 and `Height`
  slider 0–10 m step 0.1 default 2, both live-snapping camPos to sample 0 while dragged.
  The `'random'` trajectory must NOT overwrite the user's base pose.
- Footer `{N} captures` + Clear button (disabled at 0).

### 2.12 Shared — Edge Impulse auth card (EiAuthCard)

Collapsed by default with `set` badge when key present.

- API Key password input placeholder `ei_...`, autoComplete off, **held in memory only**
  (never persisted — `ei` is excluded from the persist partialize).
- HMAC field rendered only when `showHmac=true` (MotionPanel and RobotPanel pass it;
  VisionPanel doesn't, since images don't use the acquisition envelope), placeholder
  `leave blank for unsigned`.
- Category select: training/`Training` (default), testing/`Testing`,
  split/`Split 80:20 (training:testing)` — split rolls 80/20 per upload client-side and
  adds `split_bucket` to metadata.
- Placement: after Capture in vision, before Upload in motion, before Generate in robot.

### 2.13 Shared — Inference card (EiInferenceCard)

Heading `Inference (Edge Impulse model)`; badge `live` when `eiLive` else `loaded` when a
model is loaded. Full loader/classifier contract in §3.7–3.8.

- No-model state: note `Object detection (YOLO/MobileNet) and FOMO models are supported.`
- `From your project` fieldset: `🔑 List projects` (→ `↻ Refresh projects`),
  single-project shows the name (auto-selects), multi-project select with `(pick one)`;
  `🔨 Build browser deployment` (POST `/jobs/build-ondevice-model?type=wasm` with
  `{engine:'tflite', modelType:'int8'}`, waits for the job, downloads + loads);
  `⤓ Fetch & load model` (primary) scans deployment history newest-first for a
  wasm/browser target (fmt==='wasm' or target name contains 'webassembly'/'browser',
  skipping deleted impulses), downloads that version's zip, loads in-browser; actionable
  errors (`No deployments built yet. In the Studio: Deployment → Build with target
  "WebAssembly".`).
- `From file` fieldset: file input `accept='.js,.wasm'` multiple; needs BOTH; js picked
  preferring `edge-impulse-standalone`.
- Loaded state: model name + `{W}×{H} · RGB|GRAY · obj-det · anomaly` info + label count
  (lists labels when ≤6); `Threshold NN%` slider 0.05–0.95 step 0.05 default 0.5;
  `Run once` (primary) / `▶ Live` ↔ `■ Stop live` (danger); result line
  `{N} boxes · top: {label} NN% · anomaly X.XX`; `Unload model` button.
- `previewSource` prop only changes the hint text (virtual-camera vs robot-pov preview).
- Inline status row with spinner mirrors to the global status bar. Project list resets
  when the API key changes.

### 2.14 Vision — Upload to Edge Impulse card

- Hints: no API key → `Set your API key in the Edge Impulse · auth card.`; anomaly →
  `Each capture is uploaded with the batch label above. Bounding boxes are not attached.`;
  detection → `Each capture is uploaded with bounding boxes (N total).`
- `⤴ Upload N images` (primary) disabled when captures empty, no apiKey, or busy.
  `includeBoxes` only in detection; default label = anomalyLabel (anomaly) or `ei.label`
  (detection).
- Batch metadata: `{mode, env_preset, conveyor, conveyor_speed (only when conveyor on),
  ...realismMeta}` plus per-capture width/height/capture_ts ISO/shapes csv/asset_files
  csv/asset_labels csv/asset_count.
- Progress status `Uploading done/total · N failed`; result `Uploaded N images` or
  `N ok / M failed: {lastError}`.
- `↻ Retrain model` — same single-project flow as motion; success message adds
  `Build a browser deployment to refresh the in-browser model.`

### 2.15 Robot — Robot card (default open)

- 2-button rig grid: rover/`Rover` hint `Chassis IMU + lidar / ToF ring` (default),
  arm/`Arm (Arduino Braccio)` hint `End-effector IMU, optional pick-and-place`. Hint of
  active kind shown below.
- `↺ Reset scene` (tooltip `Regenerate the obstacle field, clear the rover pose and any
  in-flight recording.`) disposes current-kind USDZ assets, then store `resetRobotScene`:
  removes only current-kind-owned sceneObjects, resets armHomePose to BRACCIO_REST_RAD
  when kind==='arm', clears roverPose/lidarSamples/robotImuSamples/armJoints/armTargetId/
  armPickupObservation/roverInContact/robotCaptures.
- All rig-affecting controls disabled while `robotRunning`.

### 2.16 Robot — Event card (rover) / Trajectory card (arm) (default open)

Radio-pill class picker; the selection becomes the EI label for the batch.

- Rover `Event` pills: cruise (default) `Drive cleanly through the obstacle field, no
  contact.`; collision `Aim straight at an obstacle; bumper-style impact mid-window.`;
  stuck `Pin a wheel against an obstacle; vibrate without translation.`
- Arm `Trajectory` pills (underscores displayed as spaces): pick_place (default)
  `Approach a scene object, grasp, lift, place at a destination.`; sweep `Base servo
  sweeps left/right at a fixed shoulder/elbow.`; wave `Wrist-pitch oscillation; clean
  gyro signature.`; random_pose `Interpolate between two random reachable joint
  vectors.`; draw_circle `End-effector traces a horizontal circle via planar IK.`
- pick_place keyframe timing: t=0 rest, 0.25 above target, 0.40 on target, 0.50 close
  gripper, 0.65 lift, 0.85 destination, 1.00 open+return.

### 2.17 Robot (arm) — Arm home pose card

Collapsed-by-default per-joint home pose editor with `custom` badge when off-default.
This is a hand-rolled collapsible (local useState, not persisted), unlike CollapsibleCard.

- Joints 0–4 in degrees (labels `M1 base`, `M2 shoulder`, `M3 elbow`, `M4 wrist pitch`,
  `M5 wrist roll`), each slider min/max = `radToDeg(BRACCIO_LIMITS_RAD[i])` shown as
  `(lo–hi°)` next to the value, step 1°.
- M6 gripper as normalized 0–1 slider step 0.01 displayed as % `(0 = closed, 100 = open)`.
- Default = BRACCIO_REST_RAD (§5.5). `↺ Reset to home` restores spec defaults.
- `custom` accent badge on the collapsed header when any joint differs >0.01 rad from rest.

### 2.18 Robot (arm) — POV camera mount card

Radio pills choosing which arm point the POV camera attaches to. Options
(value/label/hint): base/`Base`/`Top of the base column, looking up the arm.`;
shoulder/`Shoulder`/`Eye on the shoulder joint, looking forward.`; elbow/`Elbow`/`Eye on
the elbow joint, looking down the forearm.`; wrist/`Wrist`/`Wrist roll, looking past the
gripper carrier.` (**default**); gripper/`Gripper`/`Between the fingers, looking at the
grasp point.` The POV component resolves scene-graph anchors named
`` `arm-pov-${mount}` `` and `` `arm-pov-${mount}-look` `` each frame.

### 2.19 Robot — Recording card

- Count: min 1, max 200, step 1, default 10.
- `Per-iteration ms`: min 500, max 15000, step 100, default 3000.
- Info line while running: rover `Capturing… N IMU · M lidar this window`, arm
  `Capturing… N IMU samples this window`; idle: rover `6-channel IMU + N-channel lidar
  per sample.`, arm `6-channel end-effector IMU per sample.`
- Sampling runs at nominal **20 Hz** (sampleRateHz hardcoded 20 in payloads).
- ImuNoiseToggle shared with motion mode.

### 2.20 Robot (rover) — Lidar / ToF ring + Sensor modality cards

- `Lidar / ToF ring` card: `Beams N` range slider 4–64 step 1 default 16;
  `Max range N.N m` range slider 1–20 step 0.5 default 6 (out-of-range returns clamp to
  max, matching real ToF).
- `Sensor modality` card radio pills: fused/`Fused (IMU+lidar)` (default) hint `One
  sample, 6 IMU + N lidar channels. Best for sensor-fusion classifiers.`; imu/`IMU only`
  `Chassis IMU only. Useful for collision detection without lidar.`; lidar/`Lidar only`
  `Lidar only. Useful for environment-classification models.`
- Iterations lacking the chosen modality's samples count as failed.

### 2.21 Robot — Object detection card

Plain (non-collapsible) card whose master ToggleSwitch (h3 title) expands sub-controls for
layering POV image capture with auto-projected bboxes onto the sensor run.

- `Object detection` switch default OFF. ON help: `Snap {N} POV-camera image(s) per
  iteration with 2D bounding boxes. EI accepts only one data type per project — the
  runner probes the project and routes the other to a local zip.`
- Sub-controls when ON:
  - `Capture at rest` switch (default OFF; help `Snap before motion begins instead of
    mid-motion. Same one image per iteration.`) — when at-rest, images/iteration is
    **pinned to 1** and the count field hides (a stationary robot yields identical shots).
  - Otherwise `Images per iteration` number input min 1 max 20 step 1 default 1 — the
    runner spaces N shots evenly using `duration/(N+1)` slices so none land at t=0 or
    t=duration.
  - `Image width`/`Image height` number inputs min 128 max 1920 step 32, defaults
    640×480 (fallbacks on NaN: 640/480).
- Turning objectDetection on also mounts RealismCard and
  EiInferenceCard(previewSource='robot-pov') in the panel.
- Frame capture goes through a signal/promise bridge (`triggerRobotCapture` +
  `awaitRobotCapture`) with a **2000 ms timeout → null counts as failed** (never hangs
  the runner). Realism pass applied per image via `applyRealismToBlob` (no-op when off).

### 2.22 Robot — Generate card and run pipeline

- Summary: rover `Each iteration drives the rover through one {event} event and records
  the IMU + lidar window.`; arm `Each iteration runs one {trajectory} motion and records
  the end-effector IMU.`; plus an image-count sentence when objectDetection is on.
- `ROS 2 export` switch default OFF: rover help mentions sensor_msgs/Imu + LaserScan
  JSONL, arm sensor_msgs/Imu + per-tick sensor_msgs/JointState. JSONL always goes into
  the zip (no upload endpoint exists).
- Button `⚡ Generate & upload|download N samples` by API-key presence; running shows
  danger `■ Stop` (sets `robotCancelRequested`, polled ≤50 ms).
- Pre-run when objectDetection && uploading: probes project data kinds (project-info
  flags first, then raw-data sample classification over training+testing, limit 30) and
  shows `window.confirm` when the project is image-only (sensor→local zip) or
  time-series-only (images→local zip); cancel aborts with status `Run cancelled`; empty
  project or mixed → upload both. (Full probe algorithm §3.6.)
- Per iteration: resets buffers, bumps rover/armEpoch to start a fresh path, sleeps
  durationMs (interleaving image captures when mid-motion OD), snapshots IMU
  (+lidar / +armJointSamples), uploads or zips.
- Metadata: rover sensor `{mode:'robot', robot_kind:'rover', event, event_index (1-based),
  event_total, modality, lidar_bins, lidar_max_range_m, duration_ms}`; image
  `{mode:'robot', robot_kind:'rover'|'arm', event|trajectory (+_index/_total),
  capture_phase:'rest'|'motion', capture_width, capture_height, ...realismMeta}`; arm
  sensor `{mode:'robot', robot_kind:'arm', trajectory, trajectory_index,
  trajectory_total, duration_ms, arm_target_id, ...buildArmPickupMetadata(...)}`.
  pick_place randomly picks an arm-owned object or asset as IK anchor per iteration
  (null → stock fallback point).
- Filenames: sensor `buildFileName(\`${event}_${modality}_${i+1}\`)` (rover) /
  `` (`${trajectory}_${i+1}`) `` (arm); images `{stem}_{phase}.{ts}.{idx4}.png` via
  `imageFileName` (stem `rover_${event}` / `arm_${trajectory}`, phase rest|motion, idx
  1-based zero-padded 4); ROS `{sensorName}.rosbag.jsonl`; final zip
  `rover_{event}_{n}` / `arm_{trajectory}_{n}` `.zip`.
- Zip contents: sensor JSONs (pretty-printed), `info.labels`, image PNGs,
  `bounding_boxes.labels`, rosbag.jsonl files.
- Status line during run joins `N sensor up · N sensor zip · N img up · N img zip ·
  N failed`. Stop still finalizes and saves the partial zip. Finally-block clears
  running/cancel flags and (rover) roverPose=null, (arm) armJoints/armTargetId/pickup
  observation.

---

## 3. Edge Impulse integration

### 3.1 Hosts + anti-phishing allowlist

Defaults: `INGESTION_BASE = https://ingestion.edgeimpulse.com/api`,
`STUDIO_BASE = https://studio.edgeimpulse.com/v1/api`.

`App.tsx` calls `setEdgeImpulseHosts({studioHost, ingestionHost})` **at module scope**
(before any request) from `?studioHost=` / `?ingestionHost=`.
`normalizeHost(host)`: trims, strips trailing slashes, prepends `https://` if no scheme,
then validates with `isAllowedEiHost`:

- allowed = hostname `edgeimpulse.com` or `*.edgeimpulse.com` over **HTTPS only**, or
  loopback (`localhost`, `127.0.0.1`, `::1`, `*.localhost`) over http OR https;
- anything else throws `refusing untrusted Edge Impulse host: <host>`;
  `setEdgeImpulseHosts` catches and `console.warn`s, keeping defaults (no throw to
  caller).
- Ingestion base = normalized + `/api`; Studio base = normalized + `/v1/api`.

**Must preserve**: this allowlist is a phishing defense for the typed-in `x-api-key` —
never drop it while supporting the host-override params.

### 3.2 Time-series ingestion upload (IMU / lidar / fused)

`POST {INGESTION_BASE}/{bucket}/files` where bucket = `resolveBucket(cfg.category)`:
`'training'`/`'testing'` pass through; `'split'` rolls `Math.random() < 0.8` →
training else testing, **per call (per sample)** (`SPLIT_TRAINING_RATIO = 0.8`), and the
chosen bucket is written into `x-metadata` as `split_bucket` for auditability. There is
no `split` endpoint — the URL is always `/api/training/files` or `/api/testing/files`.

Body = `FormData` with exactly **one field named `data`** =
`Blob(JSON.stringify(body), type 'application/json')` with a filename from
`buildFileName(label)`. **Never set Content-Type manually** (FormData owns the multipart
boundary). Headers:

```
x-api-key:               <EI api key>
x-label:                 <cfg.label || 'unlabeled'>
x-disallow-duplicates:   0
x-add-date-id:           1
x-metadata:              <JSON string, see §3.4>
```

Data-acquisition JSON body (exact shape; uploaded as `.json`, **not CBOR**, through the
generic `/files` path precisely so header handling matches image uploads):

```json
{
  "protected": { "ver": "v1", "alg": "HS256" | "none", "iat": <unix seconds> },
  "signature": "<64 hex chars; '0'.repeat(64) when unsigned>",
  "payload": {
    "device_name": "<cfg.device || 'synthetic-hand-3d'>",   // 'synthetic-rover' for lidar/fused builders
    "device_type": "WEB_SIMULATOR",
    "interval_ms": <inferred, see below>,
    "sensors": [
      {"name":"accX","units":"m/s2"}, {"name":"accY","units":"m/s2"}, {"name":"accZ","units":"m/s2"},
      {"name":"gyrX","units":"rad/s"}, {"name":"gyrY","units":"rad/s"}, {"name":"gyrZ","units":"rad/s"}
      // lidar payloads: {"name":"r0".."r{N-1}","units":"m"}; fused: 6 IMU sensors THEN rN lidar sensors
    ],
    "values": [[ax,ay,az,gx,gy,gz /*, ...ranges*/], ...]
  }
}
```

- **interval_ms** = `inferIntervalMs`: `(last.t − first.t)/(n−1)` from
  `performance.now()` timestamps; fallback `1000/sampleRateHz` only when <2 samples or
  the span is non-positive/non-finite. **Must preserve** — the sampler is frame-rate
  capped, and EI renders duration as `samples × interval_ms`; reporting the requested
  rate shrinks a 2.0 s trace to 1.2 s at 100 Hz requested / 60 fps actual.
- **HMAC signing ritual (order matters)**: signature initialized to `'0'.repeat(64)`; if
  hmacKey set, HMAC-SHA256 (WebCrypto, key = utf8 hmacKey) over `JSON.stringify` of the
  whole body **with the zero placeholder**, hex-lowercase result replaces `signature`;
  `alg` is `'HS256'` iff hmacKey truthy, else `'none'` with the 64-zero signature kept.
- Lidar sensors: `r0..r{N-1}`, `N = samples[0].ranges.length`; **short rows right-padded
  with maxRange**. Fused rover: 6 IMU sensors then `r0..r{N-1}`; rows
  `[ax,ay,az,gx,gy,gz,...ranges]` trimmed to `min(imu.length, lidar.length)`; throws
  `Rover fused payload requires both IMU and lidar samples` if either is empty. Rows must
  stay rectangular.
- Sensor channel names and units are load-bearing for EI. `device_type` is
  `'WEB_SIMULATOR'`.
- `uploadSample`/`uploadLidarSample`/`uploadRoverSample` →
  `uploadDataAcquisitionJson`; returns `{ok, status, body}`; **refuses locally (status 0,
  no fetch)** on empty samples or missing apiKey.
- Robotics sampleRateHz is 20; motion default 100. Robotics upload cfg overrides label
  per sample (`{...ei, label: event/motion class}`).

### 3.3 Image + bounding-box ingestion upload

`uploadImage(cfg, blob, filename, label, boxes, metadataExtras)`: same
`POST {INGESTION_BASE}/{bucket}/files`, FormData field `data` = image blob with filename.
Headers: `x-api-key`, `x-label: label || 'unlabeled'`, `x-add-date-id: '1'`,
`x-disallow-duplicates: '0'`, `x-metadata`, and:

- `x-bounding-boxes: JSON.stringify(boxes)` **only when boxes is non-null AND
  length > 0** — the header is omitted entirely for an empty array or null (anomaly mode
  passes `null`). Never send `'[]'`.
- Box shape: `{label, x, y, width, height}` — rounded ints, **output-resolution pixel
  space, top-left origin**, computed by projecting mesh AABB corners through the capture
  camera, clipped to the image rect, boxes <4×4 px dropped (§4.2).

`uploadCaptures(cfg, captures, defaultLabel, includeBoxes, onProgress?, metadataExtras?)`:
serial loop; per-capture label = `c.label || defaultLabel`; boxes passed only when
`includeBoxes`; per-capture metadata merges batch extras with width, height, capture_ts
(ISO), shapes (comma-joined, only if present), asset_files/asset_labels (comma-joined
names/labels) + asset_count (only when assetSnapshot non-empty). `onProgress` called
before each upload with `{total, done, failed, current: filename}` and once after with
`{total, done, failed}`. Returns `{done, failed, lastError}` where lastError =
`` `${status}: ${body.slice(0,200)}` `` or the thrown message; failures don't stop the
batch.

### 3.4 x-metadata header + label sidecars

`buildIngestionMetadata(extras)`: always `{source: 'Synthetic Data Studio'}`; adds
`source_url = window.location.origin + pathname` when window exists; extras coerced with
`String(v)`, entries skipped when undefined/null/`''` — numbers and booleans arrive at EI
as strings (`'100'`, `'false'`).

Metadata field vocabulary by path:
- vision images: `mode, env_preset, conveyor, conveyor_speed?` (only when conveyor on),
  `realism_mode, realism_intensity` (= average of the 5 knobs), `realism_grain,
  realism_chromatic, realism_vignette, realism_jitter, realism_jpeg, realism_randomize`
  (off mode = `{realism_mode:'off', realism_intensity:0}`), `width, height, capture_ts`
  (ISO), `shapes` (csv), `asset_files` (csv), `asset_labels` (csv), `asset_count`.
- motion: `mode:'motion', shape, sample_rate_hz, hand_tracking` (manual) or
  `generator:'procedural', motion, motion_index, motion_total,
  height_min_m/height_max_m/throw_speed_mps/push_speed_mps/shake_freq_hz/shake_amp_m,
  duration_ms`.
- rover sensor: `mode:'robot', robot_kind:'rover', event, event_index, event_total,
  modality, lidar_bins, lidar_max_range_m, duration_ms`.
- rover/arm image: `capture_phase ('rest'|'motion'), capture_width, capture_height,
  robot_kind, event|trajectory (+_index/_total), realism_*`.
- arm sensor: `trajectory, trajectory_index, trajectory_total, duration_ms,
  arm_target_id`, plus `buildArmPickupMetadata` fields (§5.7).
- `split_bucket: 'training'|'testing'` only when category === `'split'`.

**info.labels** sidecar (time-series download zips), pretty-printed 2-space:

```json
{ "version": 1, "files": [ {
    "path": "<file>.json",
    "category": "training" | "testing" | "split",
    "label": { "type": "label", "label": "<l>" } | { "type": "unlabeled" },
    "metadata": { ...same object as the x-metadata JSON... }
} ] }
```

`buildInfoLabelsEntry` round-trips through `buildIngestionMetadata` so **offline zips
import identically to direct uploads**; the file is only added to a zip when entries
exist. (Uploading bare JSONs out of a zip without info.labels loses metadata
irrecoverably — user-facing contract from docs/troubleshooting.md.)

**bounding_boxes.labels** sidecar (image zips), pretty-printed 2-space:

```json
{ "version": 1, "type": "bounding-box-labels",
  "boundingBoxes": { "<filename.png>": [ {"label":"cube","x":120,"y":80,"width":56,"height":56}, ... ] } }
```

Files with **zero boxes are omitted from the map** entirely. Saved beside the PNGs in
single and batch zips (the EI uploader expects the sidecar adjacent to the images).

### 3.5 Filename builders

- Time-series: `buildFileName(label)` =
  `` `${label sanitized [^a-zA-Z0-9_-]→_, empty → 'sample'}.${ISO ts with [:.]→'-', 'T'→'_', 'Z' stripped}.json` ``.
- Images: `makeFilename`/`imageFileName` =
  `` `${stem}[_{phase}].${ISO ts [:.]→'-', Z stripped}.${idx padStart(4,'0')}.png` ``.
- Zips replace `.json`→`.zip` on names like `motions_{n}`, `rover_{event}_{n}`,
  `arm_{trajectory}_{n}`; single-frame vision capture zip = png filename with
  `.png`→`.zip`.
- The bounding_boxes.labels sidecar is keyed by these exact filenames.

### 3.6 Studio API client

All requests: headers `{'x-api-key': apiKey, accept: 'application/json'}`, plus
`'content-type': 'application/json'` only when a body is sent; non-OK → throw
`` `${status} ${statusText}: ${text.slice(0,200)}` ``; bad JSON →
`` `Bad JSON from Studio: ...` ``. Endpoints relative to STUDIO_BASE:

| Endpoint | Notes |
|---|---|
| `GET /projects` | → `{success, error?, projects:[{id,name,owner:{username?}}]}` mapped to `{id,name,owner:username}`; `!success` throws `error \|\| 'Studio rejected the API key'` |
| `GET /{projectId}` | project info; kind inference: `isComputerVisionProject===true` → image; else regex over `` `${dataAcquisitionType} ${labelingMethod} ${type}` ``.toLowerCase(): `/image\|vision\|bounding\|object-detection/` → image, `/time.?series\|audio\|accelerometer\|imu/` → time-series; null otherwise |
| `GET /{projectId}/raw-data?category={training\|testing}&limit=30&offset=0` | sample probe; per-sample classify priority: `chartType` 'image'/'time-series' → that; `intervalMs>0 \|\| frequency>0 \|\| length>0 \|\| valuesCount>1` → time-series; `thumbnailUrl` truthy → image; filename matching `/\.(png\|jpe?g\|webp\|bmp\|gif)$/i` → image; else skipped (not counted in totalChecked) |
| `GET /{projectId}/deployment/history[?impulseId=&limit=]` | → `{success, deployments:[{created, deploymentVersion, deploymentFormat, engine, modelType?, impulseId, impulseName?, impulseIsDeleted?, deploymentTarget:{format?,name?}}], totalDeploymentCount?}`; **client sorts newest-first** by `created` desc (API order not guaranteed) |
| `GET /{projectId}/deployment/history/{deploymentVersion}/download` | → zip Blob |
| `POST /{projectId}/jobs/build-ondevice-model?type=wasm` body `{engine:'tflite', modelType:'int8'}` | → `{success, id}` |
| `POST /{projectId}/jobs/retrain` (no body) | → `{success, id}` |
| `GET /{projectId}/jobs/{jobId}/status` | → `{success, job:{finished, finishedSuccessful}}` mapped to booleans |

- `waitForEiJob`: poll every **3000 ms**, timeout **600000 ms (10 min)**,
  `onProgress(elapsedMs)` each poll, throws on timeout or finished-with-failure.
- **Deployment discovery must use the history endpoints** — the singular `/deployment`
  endpoint silently reports `hasDeployment:false` unless engine+modelType+impulseId all
  match, and `/deployment/download` is deprecated. WASM-browser matcher:
  `deploymentFormat=='wasm' || deploymentTarget.format=='wasm' ||
  deploymentTarget.name contains 'webassembly'/'browser'` (lowercased), skipping
  `impulseIsDeleted` entries.
- `getEiProjectDataKinds`: project-info flags short-circuit first (totalChecked=1, no
  raw-data fetch); otherwise probes training then testing, stopping early once both flags
  set; returns `{hasImages, hasTimeSeries, totalChecked}` — totalChecked 0 means
  empty/accepts-either. **Structural signals must be preferred over filename extension**
  because EI stores ingested images under `.cbor` filenames internally.
- `decideObjectDetectionRouting` (robotics): unresolvable project, probe error, or empty
  project → upload both streams. Images-only project → `window.confirm`, then images
  upload + sensor data forced to local zip. Time-series-only → inverse. User cancel →
  abort (null).
- There is **no OAuth** — auth is purely the project API key in `x-api-key`, entered in
  EiAuthCard or prefilled via `?apiKey=`.

### 3.7 In-browser WASM model loader (eiModel.ts)

Runtime is the EI Emscripten/Embind WebAssembly deployment (no tfjs/onnx): zip contains
`edge-impulse-standalone.js` + `edge-impulse-standalone.wasm`;
`run-impulse.js` / `run-classifier.js` / `index.js` are Node-only and must be excluded
(`/^run-impulse|^run-classifier|^index\.js$/i`).

- `loadEiModelFromZip`: reads the zip in-browser (§4.4), picks .wasm + .js preferring
  names containing `edge-impulse-standalone`, excluding the Node basenames, else
  largest-by-size.
- `loadEiModel(js, wasm)`: rejects early if the first executable statement is a top-level
  `require()` (Node harness) with a user-facing error suggesting
  edge-impulse-standalone.js or the Build-browser-deployment button — but does **not**
  reject on `require('fs')` appearing anywhere (guarded ENVIRONMENT_IS_NODE blocks exist
  in valid browser builds).
- Load strategies in order:
  - **(A) MODULARIZE factory** — regex-rewrites the first top-level
    `var|let|const Name = (function|(|async function|class` binding **within the first
    4096 chars only** to also assign `` globalThis[`__ei_module_${n}`] ``, injects as a
    classic `<script>` blob, calls the factory with `{wasmBinary: pre-read bytes,
    locateFile: path.endsWith('.wasm') ? blobUrl : path, print: noop, printErr
    filtered}`. (The 4096-char cap exists because a `var lang = ...` ~240 KB into
    non-MODULARIZE builds would otherwise be corrupted.)
  - **(B) non-MODULARIZE** — pre-seed `globalThis.Module` with the same hooks plus
    onRuntimeInitialized/onAbort, wrap source in
    `(function(Module){...})(globalThis[seedKey])`, inject, await
    onRuntimeInitialized with **15000 ms timeout**, restore the prior
    `globalThis.Module` afterward, and in onRuntimeInitialized call
    `Module.asm.__wasm_call_ctors()` manually iff `run_classifier` is missing (some
    builds never run Embind static ctors).
  - **(C) ESM dynamic import** fallback using `ns.default ?? ns.Module`.
- `wasmBinary` is always pre-read via arrayBuffer — Emscripten's own blob-URL fetch fails
  under COEP credentialless.
- Classifier contract: `mod.init()` must return 0 (non-number ok). `classify(features)`:
  Float32Array → `_malloc(len*4)` → HEAPU8 copy → `run_classifier(ptr, featureCount, false)`
  — **feature COUNT, not byte count**; `ret.result !== 0` throws; Embind vectors iterated
  via `.size()`/`.get(i)`; **every element and the result must be `.delete()`d** and the
  malloc'd buffer `_free`d.
- Struct props read by walking getter descriptors on
  `emcc_classification_properties_t.prototype` (`getProject` may be a JSON string or
  struct). Embind surface used: `Module.init()`, `Module.run_classifier(ptr, count,
  debug)`, `Module.get_properties()` (model_type, image_input_width/height,
  image_input_frames, image_channel_count, input_features_count, has_anomaly,
  has_visual_anomaly_detection, has_object_tracking), `Module.get_project()`,
  `Module._malloc/_free/HEAPU8`, result struct `{result, anomaly, size(), get(i){label,
  value, x, y, width, height, delete()}, visual_ad_max, visual_ad_mean,
  visual_ad_grid_cells_size()/_get(i), delete()}`.
- Result mapping: model_type `'object_detection'` or `'constrained_object_detection'`
  (FOMO) → entries go to `bounding_boxes[{label,value,x,y,width,height}]` (**coords in
  MODEL INPUT pixel space, origin top-left**); otherwise `classification[{label,value}]`;
  anomaly float if numeric; if has_visual_anomaly_detection: visual_ad_max/visual_ad_mean
  plus grid cells.
- `buildModelInfo`: inputWidth/Height from image_input_width/height (camelCase fallbacks,
  default 96); channels from image_channel_count, else
  `round(input_features_count/(w*h*frames))` accepting only 1 or 3, else 3;
  `isRgb = channels>=3`; hasAnomaly from has_anomaly; labels from
  `project.labels ?? project.label_names ?? props.labels` (array or comma-string).
- `canvasToFeatures(source, w, h, rgb)`: draw to an offscreen canvas at model dims; per
  pixel, feature = `(r<<16)|(g<<8)|b` for RGB (**packed int, one feature per pixel, not
  3**), else BT.601 luma `(0.299r+0.587g+0.114b)|0`; row-major; passed to wasm as
  Float32.

### 3.8 Live inference loop + overlay

- Both preview cameras (VirtualCamera, RobotPovCamera): `INFERENCE_HZ = 5` (200 ms
  interval), throttled independently of the ~15 Hz preview repaint so a slow model can't
  drag preview FPS. Runs when `(eiModel && eiModelInfo)` and (`eiLive` OR a one-shot
  `triggerInference()` signal counter changed — one-shot bypasses the throttle).
- Pipeline: `canvasToFeatures(previewCanvas, info.inputWidth, info.inputHeight,
  info.isRgb)` → `classifier.classify` → `setEiResult(res)`; errors →
  `` setStatus('err', `Inference: ...`) ``.
- **InferenceOverlay**: absolute-positioned canvas (zIndex 3, pointerEvents none) sized
  `width*pixelRatio`; scales model-input coords by `sx=width/inputWidth`,
  `sy=height/inputHeight`. Draws boxes with `value >= threshold` only: 4 px black halo
  stroke + 2 px hue stroke + 15%-alpha fill; centroid dot radius 6 when FOMO-sized
  (`b.width <= inputWidth/8 && b.height <= inputHeight/8`) else 4; label pill
  `` `${label} ${(value*100).toFixed(0)}%` `` above the box (below if clipped), 12 px
  bold, pill height 18, padX 6, text color `#0b0d10`. Visual-anomaly cells with
  `value >= threshold` filled `rgba(248,113,113, min(0.7, value))`. Colors: deterministic
  label hash `h = h*31 + charCode >>> 0`, `hue = h % 360`, `hsl(hue 80% 60%)`.

### 3.9 URL auth prefill (embed.ts)

- `?apiKey=ei_…` → trimmed, applied to `ei.apiKey` when non-empty.
- `?category=` accepts training|train → `'training'`, testing|test → `'testing'`,
  split → `'split'`; anything else ignored.
- `?theme=dark|light` case-insensitive.
- Applied once at boot; the apiKey is never written back to the URL.
- `?autoUpload=1` + apiKey: after a batch, if `URL_FLAGS.autoUpload &&
  batchCaptures.length > 0`, upload (detection sends boxes, anomaly label only); errors
  `autoUpload: no EI API key set (?apiKey= or use auth card)` when the key is missing.

The vitest suite of the original (`edgeImpulse.test.ts` and friends) locks header names,
URL substrings, payload shapes, split behavior, and probe semantics — porting those tests
is the cheapest way to keep a reimplementation honest.

---

## 4. Capture & export pipeline

### 4.1 Offscreen frame capture with 2× SSAA (`capture.ts`)

`captureFrame()` renders the scene from a dedicated PerspectiveCamera into a **singleton
offscreen `THREE.WebGLRenderer`** at `SSAA_FACTOR = 2` × the requested resolution,
downsamples via a 2D-canvas blit to the exact user resolution, and returns
`{blob: PNG Blob, boxes: BoundingBox[]}`.

- Singleton renderer created once and reused forever — Chromium kills the oldest WebGL
  context past ~16 live contexts; a fresh renderer per capture previously blanked the
  main canvas after a couple of batch runs. **Must preserve.**
- Renderer config: antialias:true, preserveDrawingBuffer:true, alpha:false,
  outputColorSpace SRGB, toneMapping ACESFilmic, exposure 1.0, pixelRatio 1, shadowMap
  PCFSoft.
- Render at `width*2 × height*2`, then drawImage onto a 2D canvas of `width × height`
  with `imageSmoothingQuality:'high'`, `toBlob('image/png')`. Camera aspect temporarily
  set to width/height and restored in `finally`.
- Boxes are computed against the **output** resolution (never the supersampled buffer) so
  SSAA is invisible downstream. Fallback: if a 2D context is unavailable, emit the
  supersampled canvas as-is (boxes still valid in output space).

### 4.2 2D bounding-box projection (`computeBoundingBoxes`)

- Label roots: an object with `userData.label` is skipped if ANY ancestor carries the
  SAME label string (that ancestor becomes the root); different labels nest
  independently. SpawnedObjects sets `userData={label, sceneObjectId}` on the mesh;
  ImportedAssets tags EVERY descendant of a USDZ group with `userData.label=asset.label`
  + `userData.assetId` so the whole import is one box.
- Per root: traverse descendant meshes, `computeBoundingBox()` if missing, transform the
  8 AABB corners by `mesh.matrixWorld`, `.project(camera)`. Corners with NDC z > 1 are
  behind-camera; the whole box is dropped if **no** corner projects in front.
- Screen mapping: `sx=(x*0.5+0.5)*width`, `sy=(1−(y*0.5+0.5))*height` (y flipped,
  top-left origin). Box = min/max over corners, clamped to `[0,width]×[0,height]`,
  `w/h = Math.round(max−min)`; **boxes with w<4 or h<4 px are dropped**; all output
  values `Math.round()`ed integers. `BoundingBox = {label, x, y, width, height}`.

### 4.3 VirtualCamera: single/batch capture + domain randomization

Detection/anomaly mount VirtualCamera: PerspectiveCamera(45°, 4:3, 0.05..100) driven by
store capture settings, ~15 Hz live preview via WebGLRenderTarget readback, and
captureSignal/batchSignal counters triggering `doCapture()`/`doBatch()`.

**Batch loop** (i in 0..batchCount−1), snapshotting base
camPos/camTarget/fov/lightIntensity/envRotation/object positions first, restoring all
after the loop:

- Camera: if `cameraTrajectory !== 'random'` use `sampleCameraTrajectory`
  (deterministic; skips jitter even if randomizeCamera on); else if randomizeCamera:
  `camPos += (rng()−0.5)*1.2` on x/z, `y = max(0.5, y+(rng()−0.5)*0.6)`;
  `camTarget += (rng()−0.5)*0.4` x/z, `*0.2` y; `fov += (rng()−0.5)*10`.
- randomizeLighting: `lightIntensity = max(0.2, base+(rng()−0.5)*0.8)`,
  `envRotation = base + rng()*2π`.
- randomizeObjects: with conveyor → drop from
  `[(rng()−0.5)*1.2, 1.6+rng()*0.4, (rng()−0.5)*6]` with random full-sphere rotation,
  then `waitForObjectsToSettle` (poll per rAF; settled = every belt body linear speed
  < 0.15 m/s and either on-belt or y ≤ 0.4; **2500 ms timeout**); without conveyor →
  jitter around base ±0.3 x/z, `y = max(0.2, base±0.1)`, random rotation.
- Two requestAnimationFrame waits before each capture so matrices update.

**Trajectory sampler** (`sampleCameraTrajectory({trajectory, index, total, target,
radius, height})` → `[x,y,z]`): `t = index/total` with the **total==1 → t=0 special
case** (single shot lands at path start, not phase 0.5).

- circle: full ring `target + (cos/sin(2πt)·radius, height)`.
- figure8 (Gerono lemniscate): `x = r·sin(2θ)/2`, `z = r·sinθ`.
- arc: θ from −π/2 to +π/2 (front 180°).
- spiral: 2-turn helix, y rises linearly `ty..ty+height`.
- orbit_dome: 3 azimuth turns, polar from π/2 down to 0.2, `r = radius·sin(polar)`,
  `y = ty + max(0.1, cos(polar)·max(height, 0.1))`.
- `'random'` fallback returns `[tx, ty+height, tz+radius]`.

**Capture record**: filename prefix `'frame'` (detection) or `anomalyLabel||'sample'`
(anomaly); in anomaly mode boxes are emptied and label set to anomalyLabel; in detection
label `''` and boxes populated. Filename per §3.5 with idx = captures.length at capture
time. Anomaly single capture saves the bare PNG (no zip, no boxes); detection single
capture ships PNG + sidecar in one zip.

**Gizmo exclusion**: editor gizmos (CameraHelper frustum, trajectory tube, camera handle)
live on render layer 1 (`GIZMO_LAYER`); capture cameras stay on layer 0 so gizmos never
appear in PNGs; `helper.visible` is additionally toggled off during capture as
belt-and-braces. `GIZMO_LAYER=1` is deliberately duplicated in Scene.tsx and
VirtualCamera.tsx (avoids a cyclic import); there is no gizmoLayer.ts source file — only
`gizmoLayer.test.ts` locking the invariant.

**VirtualCameraHandle**: invisible (`visible=false`) 0.5 m sphere hit-target that still
raycasts (three.js Raycaster ignores `visible`) fronting a 0.28×0.20×0.18 camera-body
icon with depthTest:false materials, renderOrder 1001–1003; per-frame glued to
`capture.camPos` and lookAt(camTarget) (+Z = lens side); drag writes `capture.camPos`.

### 4.4 ZIP writer + reader

**Writer** (`zip.ts` / `zipWorker.ts` / `zipWorkerClient.ts`): hand-rolled PKZIP,
**STORE only** (method 0), CRC32, little-endian local headers + central directory + EOCD;
version 20, flags 0, **mod time/date zeroed** (deterministic output).
`ZipEntry = {name, data: Uint8Array|Blob|string}`. Worker protocol: postMessage
`{id, entries}` → `{id, ok:true, blob}` | `{id, ok:false, error}`; worker created with
`new Worker(new URL('./zipWorker.ts', import.meta.url), {type:'module',
name:'zip-packager'})`; on worker error all pending reject and the worker is
terminated/recreated. `buildZipOffThread` falls back to synchronous `buildZip` when
Worker is undefined or construction throws.

**Saving**: `saveBlob()` = object URL + `<a download>` click + revoke after 1 s (browser
Downloads folder; the File System Access API was **deliberately removed** — Chrome blocks
system folders with a confusing dialog).

**Reader** (`zipReader.ts`, used to unpack EI deployment zips): scans backwards up to
22+65535 bytes for EOCD sig `0x06054b50`; walks central directory (sig `0x02014b50`).
Skips dirs (name ends `/`) and zero-uncompSize entries. **Zip-slip guard**: reject names
starting `/`, containing `..`, or matching `/^[a-zA-Z]:[\\/]/`. Caps:
`MAX_ENTRY_DECOMPRESSED = 128 MiB`, `MAX_TOTAL_DECOMPRESSED = 256 MiB`; streaming inflate
aborts early past the per-entry cap. DEFLATE via
`DecompressionStream('deflate-raw')` (zip DEFLATE has no zlib header). Data offset
computed from the **local** header's own name/extra lengths (not the central copy).
Methods other than 0/8 throw. Returns `{name, data: Uint8Array, method}`.

### 4.5 Preview readback (`readbackBlit.ts`)

Pooled-buffer helper for the ~15 Hz preview readback (VirtualCamera and RobotPovCamera).
`ReadbackBlitState = {pixels: Uint8Array|null, image: ImageData|null, rowViews:
Uint8Array[], width, height}`.

- `ensureReadbackBlitState(state, ctx, width, height)`: floors dims at 1; reallocates
  pixels (`w*h*4` bytes) and rebuilds `rowViews` — an array of h subarray views,
  `rowViews[y] = pixels.subarray(y*rowBytes, (y+1)*rowBytes)` — only when byteLength or
  dims changed; separately (re)creates `ctx.createImageData(w,h)` on dim mismatch;
  returns the pixels buffer for `gl.readRenderTargetPixels`.
- `putFlippedReadback(ctx, state)`: **vertical flip** (WebGL bottom-left origin → canvas
  top-left) by copying `rowViews[height−1−y]` into `image.data` at `y*rowBytes` per row,
  then one `putImageData`. Zero per-frame allocation in steady state.
- `resetReadbackBlitState` nulls everything — called on canvas/context/size change.

### 4.6 USDZ import pipeline (needle-tools OpenUSD WASM + Hydra)

`loadUsdz(file)` loads **.usdz only** (zipped USD) through `@needle-tools/usd`'s OpenUSD
WebAssembly runtime + three.js Hydra delegate — chosen over three-usdz-loader because its
WASM bundles **UsdSkel** (needed for Apple's animated AR Quick Look samples, which render
invisibly without it). There is **no GLB/GLTF import path** in the original app.

- File-type gate: filename must end `.usdz` (case-insensitive); .usd/.usda/.usdc rejected
  with a convert-first message.
- WASM served from `/usdz-wasm/emHdBindings.js` (+`.wasm`/`.data`/`.worker.js`, copied by
  `scripts/setup-usdz-wasm.mjs` postinstall); ~16 MB, lazily loaded; `prewarmUsdz()`
  warms it when the import card mounts; **requires COEP:credentialless for
  SharedArrayBuffer** (§7.5). The JS self-fetches its siblings at the same URL prefix, so
  all 4 files must be co-located.
- The File gets `.path = file.name` attached (no byte copy) and goes to
  `createThreeHydra({USD, files:[file], scene: wrapper})`; wrapper Group has
  `userData.usdzWrapper = true`.
- `isAnimated = stage.GetEndTimeCode() > GetStartTimeCode() + 0.0001`.
- Diagnostics: meshCount, triangleCount (`index.count/3` else `position.count/3`),
  defaultMaterialMeshes counted by heuristic — material unnamed AND no
  map/normalMap/roughnessMap AND color magenta-ish (r>0.85, g<0.4, b>0.5 — the OpenUSD
  "no MDL translator" placeholder); if >50% placeholder, overrideMaterial auto-enables
  with color `#a78bfa`, roughness 0.5, metalness 0.1 (Omniverse MDL exports otherwise
  render flat pink).
- **Re-centering: static assets only** — children reparented into an inner group offset
  by `(−centerX, −minY, −centerZ)` so the XZ center is at origin and the bottom rests on
  y=0. **Never recenter animated stages** — Hydra stamps absolute world matrices with
  `matrixAutoUpdate=false`, and a recenter offset drags the animated pose off-screen.
  Robotics pickup math relies on this floor-origin convention
  (`getImportedAssetCenter` adds half the scaled height).
- All meshes get castShadow/receiveShadow = true and `envMapIntensity = 1.0` if
  undefined.
- Animation playback: per-frame `handle.update(dt)` only when
  `isAnimated && animationPlaying`.
- Dispose: `handle.dispose()` first, then per-mesh geometry.dispose + every
  texture-valued material property disposed + material.dispose.
- Physics wrapper (vision): RigidBody colliders `'hull'`, restitution 0.2, friction 0.7,
  ccd, remounted on scale change via key `` `phys-${id}-${scale.toFixed(3)}` ``; floor
  rescue below y=−3 respawns at y=5.

### 4.7 Realism post-process (sim-to-real pixel pass)

`applyRealismToBlob` runs after every capture, before saving/upload. Modes:
`off | random | diffusion` ('random' is the UI's "Photo FX"; diffusion hidden, §2.10).
Mode `off` or all five knobs 0 → return the input blob untouched.

**Effect order is load-bearing**: chromatic aberration (on clean source) → color jitter
(multiplicative) → vignette → film grain **last** (so noise survives), then optional JPEG
round-trip. All transforms mutate RGBA in place, alpha untouched — pure pixel ops, so
bounding boxes remain byte-valid.

- Film grain: per-RGB-channel gaussian (Box–Muller), `sigma = intensity*10` LSB.
- Chromatic aberration: radial; R sampled at +shift, B at −shift, G/A untouched,
  edge-clamped; magnitude = `cornerShift · r²/rmax²` along the outward unit vector,
  `cornerShift = max(1, rng()*intensity*5)` px (1 px floor).
- Vignette: `fall = 1 − intensity·min(1,r)²` on normalized radius (cos⁴-ish), multiplies
  RGB.
- Color jitter: per-channel gain `1+(rng()−0.5)*intensity*0.4`, offset
  `(rng()−0.5)*intensity*24` LSB. (Deliberately halved from an earlier
  `1±i*0.5` / `±i*20`-style pass to stop highlight clipping — keep the 0.4/24
  constants.)
- JPEG round-trip (blob level): `jpeg<=0` skips; `quality = 0.95 − jpeg*0.4` (slider 1 →
  q=0.55); encode JPEG → decode → re-encode **PNG** (content-type contract stays
  image/png).
- `randomize: true` → each effective intensity re-drawn uniformly in [0, slider] per
  capture (5 independent `rng()` draws).

**Diffusion mode** (hidden): `POST /api/realism-diffusion` with headers
`Content-Type: image/png` and `x-realism-intensity: String((grain+chromatic+vignette+jitter)/4)`,
body = raw PNG blob. `DIFFUSION_BUDGET = 3` per batch, **decremented before the attempt**
(failed calls still spend the slot); `resetDiffusionBudget()` at every single-capture and
batch start; any error / non-2xx / non-image/* response → silent fallback to the random
pass. Server details in §7.9.

### 4.8 Seeded RNG (`rng.ts`)

App-wide `rng()`/`getRng()` returning uniform [0,1): deterministic **mulberry32** when
the URL has `?seed=N` (integer, `Math.round`ed), otherwise `Math.random`.

Exact algorithm (constants are contract):

```js
a = (a + 0x6d2b79f5) >>> 0;
t = a;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
```

Lazy singleton initialized from `URL_PRESETS.seed` on first call; `isSeeded()` for UI
badges; `_resetRngForTest()` for tests. **One shared sequence — call order matters for
reproducibility.** Seeds batch jitter (camera/lighting/objects), realism pass,
`?objectCount` random-kind picks, and arm-pickup randomization. Documented NOT seeded:
motion-mode procedural drops, MuJoCo physics.

### 4.9 Scene content: environment, lighting, conveyor, spawned primitives

**Skybox** (SceneEnvironment): 2048×1024 canvas per preset (outdoor sky + clouds +
horizon haze; warehouse ceiling band + 8 radial lights + weathered wall band + floor
fade; studio dark cyclorama gradient; whitebox off-white gradient),
EquirectangularReflectionMapping + SRGB, installed on `scene.background` so captures see
the same backdrop; a custom wall upload replaces it 1:1 (no tiling).

**Floors**: warehouse concrete (512 px canvas, repeat 12), outdoor grass (repeat 20),
studio/whitebox flat material (`#1c2128` rough .95 / `#f1f1ee` rough .6); floor mesh box
40×0.1×40 at y=−0.05 with 20×0.5×20 half-extent collider; invisible wall colliders at ±20
when preset is warehouse/whitebox or a custom wall is set. A non-null custom
floor/wall texture forces walls to render even on presets that normally hide them.

**Lighting**: ambient 0.35 + directional at `[5cos(envRot), 8, 5sin(envRot)]` with
intensity = `capture.lightIntensity`, 1536 px shadow map; plus drei Environment HDR
(`empty_warehouse_01_1k.hdr`) **pinned to jsdelivr commit
`456060a26bbeb8fdf79326f224b6d99b8bcce736`** because raw.githubusercontent.com lacks CORP
under COEP:credentialless; environmentIntensity 0.7.

**Conveyor** (`Conveyor.tsx` + `beltDynamics.ts`): `BELT_LENGTH=8` (Z axis),
`BELT_WIDTH=1.6`, `BELT_HEIGHT=0.1`, `BELT_TOP_Y=0.5`, `BELT_COLLIDER_DEPTH=0.4`
(collider extends below the surface to prevent tunneling).

- `isOnBelt(t)`: `|x|<0.8 && |z|<4 && 0.45 < y < 1.3` (i.e. BELT_TOP_Y−0.05 to
  BELT_TOP_Y+0.8).
- Per-frame transport (Rapier lacks native surface velocity): skip when
  `|speed| < 1e-4`; for each registered body (module-level `BELT_TRANSPORTABLES` set) on
  the belt: `setLinvel({x: lv.x*0.4 (damped), y: lv.y (untouched — gravity/bounce),
  z: speed}, true)`. Positive speed moves +Z. **Only Z is overridden; X damped ×0.4;
  Y left alone.**
- Texture: 64×256 canvas, 8 stripes, RepeatWrapping, repeat `(1, TEXTURE_REPEAT_Y=6)`;
  scroll `texture.offset.y += speed*dt*repeat/length` (+Z flow = increasing offset.y
  because the box top-face V axis runs along −Z) so stripes track bodies exactly —
  unscaled offset was a historical 1.33×-too-fast stripe bug (repeat 6 / length 8).
- Belt collider: friction 0.9, restitution 0.1, cuboid half-extents `[0.8, 0.2, 4]` at
  y=0.3. Side rails: colliders half `[0.06, 0.22, 4]` at x=±0.86, y=0.66, friction 0.4,
  restitution 0.05 (inner face flush with the belt edge, sealing the tip-over gap).

**Spawned primitive dims** (vision pool; distinct from motion-mode manipulated dims):
cube 0.6³, sphere r 0.4, phone 0.5×1.0×0.08, capsule 0.3/0.6, cylinder 0.35/0.7, torus
0.35/0.12, soda_can 0.22/0.62; collider auto-shape cuboid (cube/phone), ball (sphere),
hull otherwise; restitution 0.2 friction 0.7 ccd.

### 4.10 Drag-move (`useDragMove`)

Shared pointer-handler hook for Shift+drag translation of any scene object (spawned
objects, imported assets, virtual camera handle, trajectory target) on a camera-facing
plane:

- **Shift+drag** = translate in the plane through the object perpendicular to camera
  gaze (plane set at drag start; ray-plane intersect each move; offset preserved so no
  jump).
- **Shift+(Alt|Ctrl|Cmd)+drag** = depth mode — cursor vertical delta × **0.01 m/px**
  along camera gaze (up = closer), with snap-free re-anchoring on both modifier press
  (snapshot clientY, skip transition frame) and release (re-anchor plane+offset at
  current position). All three modifiers accepted (Mac Option ambiguity).
- **Shift+drag+wheel** = push/pull along gaze with `WHEEL_STEP = 0.008` per pixel
  (deltaMode 1 → ×16, deltaMode 2 → ×100 normalization; window-level wheel listener,
  passive:false, only during drag; the plane point advances in lockstep).
- Drag start requires `e.shiftKey`; disables OrbitControls for the drag;
  setPointerCapture on target; onDragStart/onDragEnd callbacks let physics bodies flip
  kinematic during drag. Cleanup on unmount/pointerup/pointercancel restores controls,
  removes the wheel listener, releases capture.

### 4.11 Robot POV capture bridge (`robotCapture.ts`)

Promise-based handoff between the out-of-canvas runner and the in-canvas RobotPovCamera:

- Runner calls `awaitRobotCapture()` (resolves any stale pending promise with null first
  — **only one capture in flight**), then bumps store `robotCaptureSignal`.
- Bridge polls the counter in useFrame (non-subscribing; **watermark initialized to the
  current store value at mount** so stale bumps aren't replayed), renders `captureFrame`
  at `robot.objectDetectionWidth/Height` (default 640×480), and
  `resolveRobotCapture({blob, boxes, width, height})` or null on error.
- Before capture, every scene node with `userData.hideForCapture` (e.g. the lidar beam
  overlay) is hidden, restored after toBlob settles; the capture promise is NOT awaited
  inside useFrame.
- Runner races a **2000 ms timeout → null counts as failed** rather than hanging.

---

## 5. Robotics

### 5.1 MuJoCo WASM runtime

All physics (rover, Braccio arm, motion-mode free body) runs on MuJoCo compiled to
WebAssembly (`@mujoco/mujoco`). `loadMujocoModule()` caches a single Promise; wasm URL
resolved via a Vite `?url` import passed to Emscripten locateFile. Each robot has a thin
sim class owning one MjModel+MjData pair compiled from a generated MJCF XML string
(`mujoco.MjModel.from_xml_string`).

- Stepping: `step(dtSec)` runs `Math.min(Math.ceil(dtSec/model.opt.timestep), 25)` calls
  of `mj_step` — **hard cap 25 steps per call** (≈50 ms catch-up at the arm's 2 ms
  timestep) to avoid multi-second physics bursts when a backgrounded tab resumes.
- Sensor readout: sensor addresses cached once via
  `model.sensor_adr[model.sensor(name).id]`, then read from `data.sensordata`
  (Float64Array) by offset (accel 3 floats, gyro 3, framequat 4 in **(w,x,y,z)** order,
  framepos 3).
- Joint qpos addresses via `model.jnt_qposadr[model.jnt(name).id]`; free joints occupy 7
  qpos slots (x,y,z,qw,qx,qy,qz) and 6 qvel DOFs at `model.jnt_dofadr`.
- `snapToPose` writes qpos directly, zeroes qvel (and `qfrc_applied` for the rover),
  writes matching ctrl targets, then `mj_forward` so derived xpos/sensordata are
  consistent. Controllers must seed targets at t=0 — otherwise the first IMU sample of
  each recording carries a PD-chase velocity spike.
- Embind memory: `data.delete()` then `model.delete()` on dispose/recompile — never
  GC'd. `data.contact` is a copy-on-access vector whose **elements and container must
  each be `.delete()`d** after use.
- All MJCF worlds are **Y-up** (`gravity="0 -9.81 0"`) to match three.js;
  `integrator="implicitfast"`; `<compiler angle="radian" autolimits="true"/>` so radian
  limit constants paste in unchanged.
- **MuJoCo quaternions are (w,x,y,z) everywhere; three.js consumers repack to (x,y,z,w)
  at the boundary** (e.g. `g.quaternion.set(q1,q2,q3,q0)`).

### 5.2 Rover model + MJCF

`ROVER_DIMS = {chassis: {w:0.5, h:0.18, d:0.7}, wheelR:0.12, wheelT:0.07,
rideHeight:0.05, headSize:0.18}` (meters) — shared by the visual rig and the MJCF;
chassis body sits at `y = wheelR + rideHeight = 0.17`. The rover is differential-drive
**visually only** — physics is a planar 3-DOF (x-slide, z-slide, yaw hinge)
position-actuated rigid chassis, no wheel joints.

- MJCF: timestep 0.005; joint defaults armature=0.05 damping=5; position actuator
  defaults kp=200 kv=30 forcerange ±200; slides range ±10 m `limited=false`; yaw
  actuator ctrlrange ±31.4, kp=80 kv=10. Chassis geom box mass=2.5, friction
  `"0.8 0.05 0.005"`; floor plane 20×20 `zaxis="0 1 0"`.
- IMU `<site name="imu" pos="0 0 0"/>` at chassis center; sensors `accelerometer
  imu_accel`, `gyro imu_gyro`, `framequat imu_quat`, `framepos imu_pos`.
- Obstacles baked as static bodies, recompiled when the set changes: body name `'obs_'+id`
  **sanitized to [a-zA-Z0-9]**, pos `(x, height, z)`, geom cylinder `size="r h"`
  `quat="0.7071 0.7071 0 0"` (h is half-extent; the cylinder spans floor to 2h).
- Scene objects map to obstacles with `r = max(0.05, scale*0.32)` (the 0.32 factor keeps
  MuJoCo contact distances matched to the legacy disc-circle math and the trajectory
  planner), height 0.2; imported USDZ assets `r = max(0.05, hypot(w,d)/2)`,
  `height = max(0.02, h/2)`.
- `RoverSim.rebuildWithObstacles` **diffs structurally** (id/x/z/r/height) and skips
  recompile when equal — drag edits must not recompile every frame.
- `setTargets` writes (x, z, heading) into ctrl; `chassisInContact()` scans `data.ncon`
  + the contact list for the chassis geom id.
- Controller: on epoch bump, rebuild MJCF obstacles, build path,
  `snapToPose(path.sample(0))`; each frame
  `setTargets(path.sample(clamp01(elapsed/durationMs)))`.

### 5.3 Rover event trajectory generators (`rover.ts`)

`buildEventPath(event, obstacles: {x,z,r}[], rng=Math.random)` →
`{sample(t): {x, z, heading}}`. Heading convention: 0 faces world +Z, CCW about +Y
(`heading = atan2(dx, dz)`).

- **cruise**: up to 80 tries sampling start/end on a spawn disc (`SPAWN_R = 4.0`, radii
  0.7–1.0×, end angle = start + π ± 0.3 rad) accepting only segments clearing every
  obstacle by `r + 0.55` (CLEARANCE = chassis half-diagonal + margin, point-to-segment
  distance); fallback: circular orbit at radius ≥ `max(dist + r + clearance)` over all
  obstacles, sweep 90°–270°, random CCW/CW, heading tangent.
- **collision**: random obstacle, random approach angle, launch 2.5–3.3 m out, end 0.6 m
  past center so contact trips ~60% through the window; constant heading at target.
- **stuck**: random obstacle, pin center at `r + 0.26` from the obstacle center (≈0.05 m
  static overlap for the 0.36 m chassis radius — keeps the chassis disc overlapping
  through the 3 cm vibration so contact never breaks mid-window), oscillate
  `x = sin(phase)*0.03`, `z = cos(phase*1.13)*0.03`, heading jitter
  `sin(phase*0.7)*0.05`, freq 5–8 Hz where `phase = t*2π*freq`.
- Empty obstacle list: collision/stuck fall back to cruise.

### 5.4 Lidar / ToF ring (`lidar.ts`)

`scanLidar({origin, heading, bins, maxRange, target})` returns `number[bins]`: for bin i,
`theta = heading + (i/bins)*2π`, direction `(sin θ, 0, cos θ)` — **bin 0 along rover
forward (+Z local), sweeping CCW**; ray.near = 0.01, far = maxRange; miss or hit beyond
maxRange **clamps to maxRange** (real ToF "no return" semantics — never 0/Infinity).
Raycast with THREE.Raycaster against the three.js obstacle group (NOT MuJoCo
rangefinders); rover meshes must not be inside the target group.

- Scan origin: rover head at local `y = wheelR + rideHeight + 0.18 + headSize/2 = 0.44`,
  converted by `rig.localToWorld`.
- Defaults: lidarBins=16 (UI 4–64), lidarMaxRange=6 m (UI 1–20 step 0.5).
- Both visual scan and record scan run at 20 Hz via dt accumulators; recorded only while
  `robotRunning` as `{t: performance.now(), ranges}`.
- Beam LineSegments named `rover-lidar-fan` with `userData.hideForCapture = true` — POV
  capture hides them during the capture render, keeping beams out of training PNGs while
  the live preview keeps them.

### 5.5 Braccio arm spec + IK (`braccio.ts`, `braccioIk.ts`)

Arduino TinkerKit Braccio 6-servo constants:

- `BRACCIO_LIMITS_RAD` (in degrees): M1 base 0–180, M2 shoulder 15–165, M3 elbow 0–180,
  M4 wrist pitch 0–180, M5 wrist roll 0–180, M6 gripper 10–73 (10=closed, 73=open).
- Joint vector convention everywhere: `[0..4]` servo radians, `[5]` normalized aperture
  0..1. Gripper servo↔aperture is a linear map over 10°–73°.
- `BRACCIO_REST_RAD = [70°, 15°, 50°, 90°, 180°, 1]`. (A legacy all-π/2
  `OLD_BRACCIO_REST_RAD` is reset by store migration v4, tolerance 1e-9.)
- `BRACCIO_LINKS` (m): plateRadius .08, plateThickness .015, base .071, shoulder .125,
  elbow .125, wristPitch .06, wristRoll .05, gripperWidth .06, fingerLength .05.
- `solveBraccioIk(target, {aperture=0.5})`: `yaw = atan2(x, z)`;
  `wristToTip = wristPitch + wristRoll + fingerLength = 0.16`; planar target
  `(radial, y − (plateThickness+base) + wristToTip)`; r clamped to the annulus
  `[|a−b|+1e-3, a+b−1e-3]`; `elbowJoint = π − acos((a²+b²−r²)/2ab)`;
  `shoulderJoint = atan2(wristR, wristH) − acos((a²+r²−b²)/2ar)`;
  `wristPitchJoint = π − (shoulderJoint + elbowJoint)` (keeps the gripper
  vertical/tip-down); wristRoll fixed π/2; all clamped to limits (**saturate, never
  throw** — "Target unreachable" is explained to users; floor-level reach is ≈0.238 m).
- `lerpJoints(a, b, t)`: per-component cosine ease `e = (1−cos(uπ))/2`.

### 5.6 Braccio MJCF + BraccioSim

Hand-authored MJCF mirroring the visual rig joint-for-joint:

- Joints: `j_base` hinge +Y, `j_shoulder`/`j_elbow`/`j_wrist_pitch` hinge +X,
  `j_wrist_roll` hinge +Y, `j_grip_l` slide −X / `j_grip_r` slide +X range
  `[0, gripperWidth/2 = 0.03]`; ranges pasted from BRACCIO_LIMITS_RAD.
- Option: timestep **0.002** (arm; rover/motion use 0.005), gravity 0 −9.81 0. Defaults:
  joint armature=0.01 damping=0.5; position kp=50 kv=2 forcerange ±5; grip actuators
  kp=100.
- Link masses: base 0.15, upper 0.12, fore 0.1, wristPitch 0.05, wristRoll 0.05, carrier
  0.02, fingers 0.005 each.
- Finger geoms friction `"2.0 0.1 0.01"` — **grasp is pure friction (no weld/attach
  constraint)**; high-friction pads + grip kp=100 are the grasp mechanism.
- Pickup target: body `'target'` with freejoint `'j_target'`, box geom default
  halfExtents `[0.015]³`, spawn pos `(0.18, halfY, 0.12)`, friction `"2.0 0.1 0.01"`,
  `mass = clamp(0.015 * volume/0.03³, 0.005, 0.12)`; halfExtents floor 0.003 per axis.
  `rebuildTargetBox` recompiles only when any half-extent differs > 1e-5 (and requires
  re-snapping the home pose after recompile).
- Sensors at site `'imu'` on the end_effector body: imu_accel, imu_gyro, imu_quat,
  framepos `'ee_pos'`.
- `setJointTargets` maps aperture via `apertureToFingerSlide(a) = clamp01(a)*0.03` to
  both grip actuators; `readJointPositions` reconstructs aperture from the actual
  `jnt_range` so MJCF edits stay correct. `placeTarget` writes 7 qpos slots (pos +
  identity quat 1,0,0,0), zeroes 6 dof qvel, `mj_forward`. `readTargetPose` reads
  `data.xpos`/`xquat` by body id (quat w,x,y,z; three.js repacks).

### 5.7 Arm trajectories + pick-and-place outcome

**Trajectory generators** (`armTrajectories.ts`), parametric joint-space paths
`t∈[0,1]` → 6-vector; `buildArmTrajectory` dispatches; the `home` option is consumed by
pick_place/sweep/wave:

- **pick_place** keyframe schedule (constant across the batch so classifiers can lock
  phase): until t=0.25 above(pickup+6 cm, aperture 1 open) → 0.4 onTarget(open) →
  0.5 grasped(closed 0) → 0.65 lifted(+6 cm, closed) → 0.85 aboveDrop(+6 cm, closed) →
  0.95 released(open) → 1.0 rest(home); piecewise `lerpJoints` with cosine ease per
  segment; default pickup `(0.18, 0.05, 0.12)`, drop `(−0.18, 0.05, 0.12)` when no
  target.
- **sweep**: base yaw = `center + sin(2πt)*0.4*(range width)`, other joints pinned at
  the **home pose** (not π/2 — all-π/2 folds the forearm through the floor).
- **wave**: wrist pitch = `center + sin(4πt)*0.4*width` (two full cycles), others at
  home.
- **random_pose**: cosine-lerp between two uniform-random in-limit joint vectors
  (aperture = rng()).
- **draw_circle**: `solveBraccioIk` over a horizontal circle, default cx=0 cz=0.18
  height=0.18 radius=0.08, aperture 0.5, phase φ=±2πt.

**Pick-and-place outcome** (`armPickupOutcome.ts`, `armPickupGeometry.ts`,
`BraccioArm.tsx`):

- Constants: success lift ≥ **0.02 m** (`ARM_PICKUP_SUCCESS_LIFT_M`); max tilt **40°**;
  drift tolerance = `clamp(max(halfX, halfZ) + 0.03, 0.03, 0.08)` m.
- Grasp check window `t∈[0.38, 0.62]` each frame: tilt from quat via
  `localUpDotWorldUp = 1 − 2(x²+z²)`, `tiltDeg = acos(clamp(dot,−1,1))`; horizontal
  drift = `hypot(dx, dz)` from the start center. Reason `'target_tipped'` if tilt>40°
  else `'target_drifted'` if drift>tolerance.
- Once rejected: `guard.rejected=true` and the controller **overrides the commanded
  aperture to 1 (gripper kept open — never pretends the grasp worked)**; failureReason
  forces success=false permanently. Recording `pickup_success=false` with a reason is
  intentional product behavior, not a bug.
- Lift observed per frame from target bottom-Y delta (`pose.y − halfY` vs start),
  monotone max; success latches when `maxLift ≥ 0.02` with no failureReason.
- Floor safety: IK tip Y = `max(0.023, targetBottomY)` where 0.023 = 0.02 pad overhang +
  0.003 margin (`BRACCIO_GRIPPER_MIN_TIP_Y`) so finger geometry can't be IK'd through
  the floor; the drop point mirrors pickup to `(−x, +z)`, same tipY.
- Target selection per iteration: random arm-owned scene object or USDZ asset (fallback
  placeholder point if none); optional `armRandomizeTarget` re-samples per §2.6.
- Metadata (pick_place only) via `buildArmPickupMetadata`: `arm_target_type`
  ('primitive'|'asset'|'fallback'|'unknown'), `arm_target_kind/label/name`,
  `pickup_attempted`, `pickup_success`, `pickup_max_lift_m` (4 dp),
  `pickup_success_threshold_m`, `pickup_graspable`, `pickup_failure_reason`,
  `pickup_max_tilt_deg` (1 dp), `pickup_max_horizontal_drift_m`.

### 5.8 IMU sampling pipeline

`sampleImu(source, noiseStateRef, cfg, sampleDt)` (`mujoco/imuSensor.ts`) wraps
`source.readImu()` → `applyImuNoise` (§6.4) → `AccelSample {t: performance.now(), ax,
ay, az, gx, gy, gz}` in the body's local frame. Noise state is lazily created (bias walk
persists across samples within a recording; reset to null on body/shape remount so each
recording gets its own drift trajectory). MuJoCo accelerometer is body-frame **proper
acceleration including gravity** (stationary reads +9.81 up); gyro body-frame rad/s.
Rover and arm both record at **20 Hz** (`RECORD_HZ`) via dt accumulators inside useFrame;
samples pushed to store only while `robotRunning`. The arm snapshots
`readJointPositions()` in the **same 20 Hz tick** so IMU and JointState series pair 1:1.

### 5.9 ROS 2 export (`rosMessages.ts`)

Canonical ROS 2 message shapes serialized one JSON object per line as `{topic, msg}`;
output = `lines.join('\n')` + trailing `'\n'`. Time:
`performanceNowToRosTime(ms)` → `{sec: floor(ms/1000), nanosec: round(frac*1e6)}`. All
headers `{stamp: {sec, nanosec}, frame_id}`.

- **Imu**: orientation identity (0,0,0,1), `orientation_covariance [−1, 0×8]` (−1 =
  unknown per spec), angular_velocity from g*, linear_acceleration from a*, other
  covariances all-zero. Rover topic `/imu/data` frame `imu_link`; arm topic
  `/end_effector/imu` frame `end_effector`.
- **LaserScan** (topic `/scan`, frame `laser_link`): angle_min 0,
  angle_increment 2π/bins, angle_max 2π−increment, time_increment 0, scan_time 0,
  range_min 0.01, range_max = lidarMaxRange, intensities [].
- **JointState** (topic `/joint_states`, frame `braccio_base`): name =
  `['M1_base','M2_shoulder','M3_elbow','M4_wrist_pitch','M5_wrist_roll','M6_gripper']`,
  position = raw 6-vector (radians ×5 + normalized aperture), velocity/effort empty.
- **Odometry** (topic `/odom`, frame `odom`, child `base_link`): yaw→quat about Y; twist
  finite-differenced from the previous pose projected to body frame
  (`forward = dx·sin h + dz·cos h`, `left = dx·cos h − dz·sin h`, yaw-rate on z), zeros
  on the first sample. **Note**: the RobotPanel runner does not pass poses, so `/odom`
  lines are currently absent from real exports (docs/robotics.md's mention of Odometry is
  aspirational).
- File layout: rover rosbag = all Imu lines then all LaserScan lines; arm = all Imu then
  all JointState lines.

### 5.10 Robot POV camera

PerspectiveCamera **FOV 70°, near 0.02, far 50**. Mount anchors: rover
`'rover-pov-mount'`/`'rover-pov-look'` (front of chassis; look anchor 1 m ahead); arm
`` `arm-pov-${mount}` `` + `-look` with mount ∈ {base, shoulder, elbow, wrist, gripper}
(default `'wrist'`) — the camera copies the mount world position and
`lookAt(look world position)` each tick; no FK math. Preview 15 Hz render-target readback
with vertical flip (§4.5). Live EI inference throttled to 5 Hz, one-shot via
inferenceSignal. Capture handoff per §4.11.

---

## 6. Motion & realism

### 6.1 MotionSim (MuJoCo free-body + weld grab)

MJCF (`motionMjcf.ts`): timestep 0.005; geom default `solref="0.005 1"`
`solimp="0.95 0.99 0.001"`; object body at (0,2,0) with freejoint `'j_obj'` and an IMU
site; mocap hand body (tiny sphere, contype=0 conaffinity=0, invisible).

- Weld: `<weld body1=hand body2=object active=false solref="0.015 1"
  relpose="0 0 0 1 0 0 0"/>` — the **explicit identity relpose is load-bearing**:
  MuJoCo's default all-zeros relpose means "enforce the qpos0 relative pose", which
  leaves the object hovering 1 m above the hand.
- Grab = `eq_active[0]=1` + per-frame mocap pose writes; release = `eq_active[0]=0` with
  optional throw velocities written into qvel.
- Per-shape geoms (mass): sphere r 0.5 (0.12); phone box 0.35×0.7×0.05 (0.15); capsule
  0.35/0.4 `quat 0.7071 0.7071 0 0` (Z-long → Y-long fix, 0.12); cylinder 0.4/0.45 same
  quat (0.12); torus ≈ flat cylinder 0.55/0.15 **no quat** (three.js torus lies in XY
  like MuJoCo's cylinder default) (0.12); soda_can cylinder 0.27/0.4 quat (0.15); cube
  box 0.4³ (0.12).
- `loadShape` recompiles on kind change (raw Float64Array views become dangling);
  `resetToSpawn` = `mj_resetData` + clear weld + `mj_forward`. Implements the same
  ImuSource/readImu contract as the robots.
- Scene integration (`ManipulatedObject`): MotionSim loaded once (empty deps; loadShape
  hot-swaps kinds and resets noise state); load/init failures surface via
  `setStatus('err', 'Physics load/init failed: …')`. Per frame: on the first grab frame
  `prevHandPos` is seeded at the target (zero first-frame velocity) and `sim.grab()`
  called; subsequent frames `sim.setHandPose` with `PINCH_LERP = 0.35` smoothing;
  `releaseLinvel` tracked per-frame with dt floored at 1e-3; on release
  `sim.release({linvel, angvel: nextReleaseAngVel})` and the one-shot angvel cleared;
  then `sim.step(dt)`, pose mirrored to the mesh (w,x,y,z → x,y,z,w repack), IMU
  accumulator sampled (**drained even when not recording** so a new recording starts
  phase-aligned).

### 6.2 Procedural motion generation

`MotionKind = 'drop' | 'throw' | 'push' | 'shake'` (exactly four).
`randomPreReleaseMs(durationMs, rng) = 40 + rng() * max(0, min(160, durationMs*0.15))` —
pre-release baseline ≥ 40 ms (with durationMs=1500: uniform [40, 200]); the 40 ms floor
guarantees baseline samples, the cap keeps the release inside the window.

Runner (MotionPanel): disables hand tracking for the run (restores after), **80 ms
settle** for CameraFeed unmount, then per iteration: lift body kinematically to a random
pose (Shoemake-1992 uniform random quaternion; 600 ms lerp-convergence wait, sized to
PINCH_LERP=0.35), start recording, sleep `randomPreReleaseMs(durationMs)`, perform the
motion, sleep until `t0+durationMs`, snapshot + clear samples.

- **DROP**: liftTo(xyRange 1.2, y in [heightMin, heightMax]); release with random angular
  velocity magnitude **3** rad/s (uniform per-axis in [−3, 3]).
- **THROW**: liftTo(xyRange 0.8); release velocity
  `[cos(a)*speed, upKick, sin(a)*speed]` with `a = U(0,2π)`,
  `speed = throwSpeed*(0.85+U*0.3)`, `upKick = 0.4+U*0.8`; driven by
  `accelerateAndRelease` over **8 steps of 16 ms** (kinematic target advanced by
  `v*0.016` per step); angVelMag **5**.
- **PUSH**: liftTo(xyRange 1.2, y in [0.25, 0.4]); horizontal velocity
  `pushSpeed*(0.85+U*0.3)`, no vertical kick, 8 steps; angVelMag **2**.
- **SHAKE**: liftTo(xyRange 0.6); horizontal sinusoid along a random axis:
  `offset = sin(2π·freq·t)*amp` with `freq = shakeFreq*(0.85+U*0.3)`,
  `amp = shakeAmp*(0.85+U*0.3)`, target updated every 16 ms for durationMs; release with
  **no** angvel.
- Release linvel comes from the per-frame kinematic delta (`(next−prev)/dt`, dt floored
  1e-3); `nextReleaseAngVel` is one-shot and cleared after Scene applies it. The random
  angular velocity on release keeps the gyro channel from being flat.
- **Finally-block must stopRecording/clearSamples/releaseBody** — a Stop press can land
  between startRecording and snapshot and would otherwise leave the recorder running.
- Sample emission is capped at 1 sample per render frame via an accumulator
  (`period = 1/sampleRateHz`); the accumulator is drained even when not recording.
- Cancellation: `sleepCancellable` polls `dropsCancelRequested` every ≤50 ms and throws
  `CancelledError`; the partial zip is still saved on cancel.

### 6.3 MediaPipe hand tracking

Model: HandLandmarker task from
`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
WASM from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm`, options
`{delegate:'GPU', runningMode:'VIDEO', numHands:1, minHandDetectionConfidence:0.5,
minHandPresenceConfidence:0.5, minTrackingConfidence:0.5}`; `detectForVideo` per
requestAnimationFrame; camera getUserMedia 640×480 facingMode `'user'`. The webcam
stream never leaves the browser (privacy contract, §7.11).

- `computePinchStrength`: `dist(thumb tip 4, index tip 8)/handSize` → `v = 1 −
  (ratio−0.15)/0.45`, clamped [0,1] (ratio ~1.0 open / ~0.2 pinched). **Precision
  note**: the tip distance AND the handSize normalizer inside it are **3D** (include
  landmark z with `?? 0` fallback), whereas the standalone `handSize()` depth-proxy
  export is **2D-only** (hypot of x,y between wrist 0 and middle MCP 9, `|| 0.1`
  fallback) — different quantities, must not be unified.
- Grab hysteresis: `PINCH_ON = 0.65`, `PINCH_OFF = 0.45`.
- Screen→scene mapping (CameraFeed): `rawX = (1−cx−0.5)*6*mapScale` (x mirrored),
  `rawY = (0.85−cy)*5*mapScale`,
  `rawZ = clamp(((handSize−0.13)/0.06)*2.5, ±2.5)*mapScale` with `H_NEUTRAL = 0.13`,
  `H_RANGE = 0.06` (hand depth uses handSize, **not** MediaPipe z; typical 0.06
  arm-extended … 0.22 near lens); `mapScale = handMappingScale` from CameraRig =
  `clamp(orbitCamDistance/hypot(4,3,6), 1, 3)`. Exponential smoothing `A_XY = 0.35`,
  `A_Z = 0.3`.
- Orientation: `handOrientation(lm)` builds a palm basis — +Y wrist0→MCP9, +X
  pinkyMCP17→indexMCP5 Gram-Schmidt-orthogonalized against up, +Z = right×up; **all
  landmark components negated** for MediaPipe→camera space (mirrored render, y-down
  image, z-toward-camera); returns null on degenerate landmarks (axis length < 1e-8 or
  missing points). `quatFromBasis(right, up, forward)` = columns-of-rotation-matrix →
  `[x,y,z,w]` with the branch-by-largest-trace-component algorithm. Slerp-smoothed at
  0.25 with hemisphere flip (dot<0 → negate target).
- `cameraRelativeToWorld(target, anchor, right, up, back)` =
  `anchor + right*tx + up*ty + back*tz` componentwise (the pure function behind Scene's
  orbit-aware hand mapping; unit-tested because it drives the manipulated body).
- Dropout handling: `HAND_LOST_GRACE_MS = 350` — within grace the grab and target are
  frozen; beyond it everything is released/nulled. Unmount hard-releases all pinch state.
- Skeleton overlay drawn in video pixel coords with the 21-landmark HAND_CONNECTIONS;
  stroke `#5eead4` when pinching else `#38bdf8`; pinch circle radius `10 + pinch*14`.
- `handMath.ts` is deliberately MediaPipe-free (runs under Node for tests); landmark type
  is the minimal `{x, y, z?}` shape.

### 6.4 IMU noise model (`imuNoise.ts`)

LSM6DSO-calibrated synthetic sensor-noise pass (modeled after MATLAB `imuSensor`),
applied to every clean IMU reading from all MuJoCo sims. `DEFAULT_IMU_NOISE`:

| Field | Value |
|---|---|
| enabled | `true` |
| accelRange | `39.24` m/s² (±4 g) |
| gyroRange | `34.9` rad/s (±2000 dps) |
| accelNoiseDensity | `5.9e-4` m/s²/√Hz |
| gyroNoiseDensity | `1.2e-4` rad/s/√Hz |
| accelBiasInstability | `1e-4` |
| gyroBiasInstability | `5e-6` |
| scaleFactorError | `0.005` |
| adcBits | `16` |

Per-tick order per axis (**order is contract**):
1. bias random walk: `bias += gauss()*biasInstability*√dt`, clamped to ±5% of range;
2. `y = x*scale + bias + gauss()*sigma` where `sigma = noiseDensity/√dt` (density per
   √Hz; dt floored at 1e-6 s);
3. saturate to ±range;
4. quantize: `round(y/LSB)*LSB` with `LSB = 2*range/2^adcBits`.

Per-sensor state (`makeImuNoiseState`): biases start [0,0,0]; per-axis scale factor =
`1 + (rng()−0.5)*2*scaleFactorError`, sampled **once at construction** (constant for the
sensor lifetime, not per sample). `gauss()` is Box–Muller with u1 clamped ≥ 1e-12.
`enabled: false` passes readings through untouched.

### 6.5 Conveyor & spawned-object physics

See §4.9 (belt constants, transport hack, texture-scroll lock, rails) — the conveyor is
part of the vision scene but its dynamics contract lives with beltDynamics.ts.

---

## 7. Config, URL params & platform

### 7.1 Zustand store: persistence + migrations

Single flat store (`create + persist`), name **`sds-store`**, version **12**,
`createJSONStorage(() => localStorage)`. Dev handle `window.__useStore` assigned at
module load.

**Persisted keys (partialize)**: mode, objectKind, sceneObjects, showConveyor,
conveyorSpeed, envPreset, customFloorTexture, customWallTexture, capture, anomalyLabel,
sampleRateHz, drops, robot, imuNoise, realism, eiThreshold, cardOpen, pendingAssets
(assets mapped to `PersistedAsset`:
id/name/label/position/rotation/scale/physics/overrideMaterial/overrideColor/
overrideRoughness/overrideMetalness/isAnimated/animationPlaying/bounds/owner — live
three.js Group and needle handle excluded).

**NOT persisted**: `ei` (API keys memory-only — privacy contract), captures, samples,
all live/transient robot state, eiModel.

**Migration chain** (`migrate()`, v3→v12; a reimplementation reading existing users'
localStorage must accept v3–v12 payloads or lose users' scenes):

| From | Change |
|---|---|
| v<4 | reset armHomePose if it equals OLD_BRACCIO_REST_RAD (`[π/2 ×5, 0.5]`, tolerance 1e-9) |
| v<5 | backfill `armRandomizeTarget=false` |
| v<6 | backfill `objectDetection=false, captureAtRest=false, objectDetectionWidth=640, objectDetectionHeight=480` |
| v<7 | backfill `objectDetectionImagesPerIteration=1` |
| v<8 | add `realism {mode:'off', intensity:0.5}` |
| v<9 | coerce `realism.mode 'diffusion'→'random'` |
| v<10 | split intensity into 5 knobs (grain/chromatic/jitter/jpeg = old intensity, **vignette = intensity*0.6**, randomize=false) |
| v<11 | backfill `realism.randomize=false` |
| v<12 | backfill `capture.cameraTrajectory='random', trajectoryRadius=4, trajectoryHeight=2` |

**Store defaults** (full):

```
mode:'motion'; objectKind:'cube'; sampleRateHz:100; handTrackingEnabled:true;
isGrabbed:false; pinchTarget:null; pinchRotation:null; isRecording:false; samples:[];
handDetected:false; pinchStrength:0; handMappingScale:1; nextReleaseAngVel:null;
drops:{count:10, heightMin:1.0, heightMax:2.5, durationMs:1500, motion:'drop',
       throwSpeed:4, pushSpeed:3, shakeFreq:4.5, shakeAmp:0.2};
dropsRunning:false; dropsCancelRequested:false;
robot:{kind:'rover', roverEvent:'cruise', armTrajectory:'pick_place', count:10,
       durationMs:3000, lidarBins:16, lidarMaxRange:6, uploadModality:'fused',
       rosExport:false, armHomePose:[...BRACCIO_REST_RAD], armCameraMount:'wrist',
       armRandomizeTarget:false, objectDetection:false, captureAtRest:false,
       objectDetectionWidth:640, objectDetectionHeight:480,
       objectDetectionImagesPerIteration:1};
robotRunning:false; robotCancelRequested:false; robotCaptures:0; lidarSamples:[];
roverPose:null; roverEpoch:0; robotImuSamples:[]; armJointSamples:[];
armPickupObservation:null; roverInContact:false; armJoints:null; armEpoch:0;
robotCaptureSignal:0; armTargetId:null;
selectedIds:[]; sceneObjects:[]; showConveyor:false; conveyorSpeed:0.5;
envPreset:'studio'; customFloorTexture:null; customWallTexture:null; assets:[];
pendingAssets:[]; restoringAssets:{done:0,total:0,phase:'idle'};
capture:{width:640, height:480, camPos:[3.5,3,3.5], camTarget:[0,0.5,0], fov:45,
         randomizeCamera:true, randomizeLighting:true, randomizeObjects:false,
         batchCount:10, lightIntensity:1.1, envRotation:0, cameraTrajectory:'random',
         trajectoryRadius:4, trajectoryHeight:2};
captures:[]; captureSignal:0; batchSignal:0; anomalyLabel:'normal';
imuNoise:{...DEFAULT_IMU_NOISE};
realism:{mode:'off', grain:0.5, chromatic:0.5, vignette:0.3, jitter:0.5, jpeg:0.5,
         randomize:false};
ei:{apiKey:'', hmacKey:'', category:'training', label:'idle',
    device:'synthetic-hand-3d'};
status:{kind:'idle', msg:''}; cardOpen:{};
eiModel:null; eiModelInfo:null; eiModelName:null; eiThreshold:0.5; eiLive:false;
eiResult:null; inferenceSignal:0
```

**Key types**:
- `SceneObject {id, kind:ObjectKind, label, position[3], rotation[3], scale, color,
  metalness, roughness, physics, owner?:'rover'|'arm'}` (undefined owner = vision pool).
- `ImportedAsset` adds `object:THREE.Group, bounds?:{size:[x,y,z],maxDim}, handle?
  (needle hydra), overrideMaterial/Color/Roughness/Metalness, isAnimated,
  animationPlaying`.
- `Capture {id:uuid, filename, blob, boxes:BoundingBox[], label ('' = detection,
  anomalyLabel in anomaly), width, height, ts, shapes?:string[],
  assetSnapshot?:{name,label}[]}`.
- `AccelSample {t, ax, ay, az, gx, gy, gz}`; `LidarSample {t, ranges:number[]}`.
- Signal counters (increment-to-trigger pattern): captureSignal, batchSignal,
  robotCaptureSignal, inferenceSignal, roverEpoch, armEpoch.
- Transient buffers gated on flags: `samples` (pushSample only while isRecording),
  lidarSamples/robotImuSamples/armJointSamples (only while robotRunning) — pushes return
  the same state otherwise.
- `setEiModel(m, name)` also resets eiResult; `triggerInference()` bumps
  inferenceSignal.

### 7.2 IndexedDB stores

- db **`sds-assets`** v1, object store `usdz`, key = asset uuid (`crypto.randomUUID()`),
  value = original .usdz File/Blob bytes.
- db **`sds-textures`** v1, store `textures`, key = `'floor' | 'wall'`, value = image
  Blob.
- Both DBs are version 1, single keyless object store, blobs put/get/delete by key.
- `removeAsset`/`clearAssets` also delete the IDB blobs.

**Rehydration** (`rehydrateAssets.ts`): module-level `rehydrateStarted` boolean guard —
**not a useRef** (React StrictMode's synthetic remount would race two loadUsdz calls into
the one OpenUSD WASM singleton). For each pendingAsset: `getAssetBlob(id)` →
`` new File([blob], `${name}.usdz`, {type:'model/vnd.usdz+zip'}) `` → loadUsdz →
addAsset with persisted transforms; missing blob = warn + deleteAssetBlob + skip; the
loader's isAnimated is authoritative over the persisted flag
(`animationPlaying = meta.animationPlaying && isAnimated`); bounds fall back to
`boundsFromBox(localBox)`. Progress via `restoringAssets {done, total, phase}`; success
pill held 1000 ms; `'Restored N asset(s)'` status auto-cleared after 3000 ms only if
still prefixed `'Restored '`.

**useCustomTexture**: effect depends on `[kind, name, repeat, anisotropy]` — NOT blob
bytes. Loads blob via getCustomTexture(kind), object URL, THREE.TextureLoader;
wrapS=wrapT=RepeatWrapping, repeat.set(repeat, repeat) (default 1), colorSpace SRGB,
anisotropy default 4. Cleanup disposes the texture and revokes the URL; a cancelled flag
prevents setState after unmount.

### 7.3 URL parameter system

`parseUrlParams(URLSearchParams)` is a pure function returning `{presets, flags}`;
parsed once at module load into `URL_PRESETS`/`URL_FLAGS` singletons
(`refreshUrlParams()` mutates them in place). Param **keys are case-sensitive**; enum
**values are lowercased**. Bool parsing: 1/true/yes/on → true, 0/false/no/off → false
(case-insensitive, trimmed), else undefined. Numbers **outside bounds are rejected
(dropped), not clamped**. Empty tuple components (`target=,,`) are rejected
(`Number('') === 0` guard).

**Presets** (applied once at startup):

| Param | Validation |
|---|---|
| `mode` | aliases per §1.1; arm/rover also set robotKind |
| `robot` | `arm\|rover` (independent of mode) |
| `onlyMode` | comma list of mode aliases, collapsed to canonical, deduped preserving first-seen order |
| `env` | studio\|warehouse\|whitebox\|outdoor |
| `objects` | comma list of the 7 kinds; alias `can`→soda_can; unknown dropped; empty result dropped |
| `objectCount` | int 0–200 |
| `theme` | dark\|light |
| `seed` | any finite int (rounded) |
| `batchCount` | int 1–500 |
| `trajectory` | random\|circle\|figure8\|arc\|spiral\|orbit_dome |
| `radius` | float 0.1–50 → trajectoryRadius |
| `height` | float −20–50 → trajectoryHeight |
| `fov` | 10–170 |
| `resolution` | regex `/^(\d+)\s*[x×]\s*(\d+)$/i`, each 32–8192 |
| `camera`, `target` | 3 comma floats |
| `conveyor` | bool |
| `conveyorSpeed` | −5–5 |
| `lightIntensity` | 0–10 |
| `eiLabel` | nonempty trimmed string |
| `eiCategory` | training\|testing\|split |
| `eiProject` | int ≥1 — **parsed but intentionally never written to the store**; components read `URL_PRESETS.eiProject` directly |
| `realism` | off\|random\|diffusion |
| `grain`/`chromatic`/`vignette`/`jitter`/`jpeg` | floats 0–1 |
| `armPose` | 6 comma floats |
| `roverEvent` | cruise\|collision\|stuck |
| `sampleRate` | int 1–2000 |

**Flags** (defaults): `embed=false`, `ui='default'` ('minimal' only), `gizmos=true`
(**only a false-y value flips it off**), `debug=false`, `perf=false`, `camLog=false`,
`bypassAuth=false` (**dead — parsed, documented, never consumed**; see §8),
`autoUpload=false`, `clearStore=false`.

Handled elsewhere: `apiKey`/`theme`/`category` (embed.ts legacy helpers),
`studioHost`/`ingestionHost` (App.tsx module scope), `clearStore`+`theme` (index.html
inline bootstrap).

**applyUrlPresets** (called in main.tsx after store import — persist already rehydrated
— but before ReactDOM.render, so deep links don't flash persisted defaults). No-op when
presets is empty. Order: mode → robotKind → onlyMode snap (if current mode not allowed,
`setMode(onlyMode[0])`, re-reading getState() after the mode set) →
env/conveyor/conveyorSpeed → object spawning (each explicit `?objects=` kind first, then
`?objectCount=N` tops up with `max(0, N − explicit.length)` random kinds via the seeded
rng) → single setCapture patch (batchCount, cameraTrajectory, trajectoryRadius,
trajectoryHeight, fov, width+height, camPos, camTarget, lightIntensity) → setEi patch
(label, category) → setRealism patch → setSampleRateHz → setRobot patch (armHomePose,
roverEvent).

### 7.4 Iframe embedding

Outbound-only postMessage channel — there is **no inbound postMessage API** (all inbound
configuration is URL params):

- Message: `{type:'IFRAME_HEIGHT', height: document.body.scrollHeight}`.
- Target origin priority: (1) `?embedOrigin=` parsed to protocol//host, (2)
  `document.referrer` origin, (3) null → `initPostContentHeight` becomes a complete
  no-op. **Never broadcasts to `'*'` implicitly** — `'*'` must be passed explicitly.
- Posts fire: once immediately, on window `load`, on window `resize`, and on every
  ResizeObserver callback observing document.body; returns a teardown.
- Chrome flags per §1.1; `gizmos=0` hides trajectory tube/orbit marker/camera handle
  from the live view only (captures already exclude gizmos via the render layer).

### 7.5 Cross-origin isolation headers

USDZ import (OpenUSD WASM) requires SharedArrayBuffer, hence crossOriginIsolated. The
exact trio, on every serving surface:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Resource-Policy: cross-origin
```

- COEP must be **credentialless**, NOT require-corp — the MediaPipe CDN doesn't send
  CORP headers; require-corp breaks hand tracking. CORP cross-origin lets a strict-COEP
  parent iframe this app. These are **functional requirements, not defensive hardening**
  (the defensive stack is deliberately parked in `drafts/security-hardening/` — see §8).
- Sent by: Vite dev server (`server.headers`), `vercel.json` (**Vercel ignores
  `public/_headers`** — that file exists only for Netlify/Cloudflare Pages self-hosters),
  and `bin/serve.mjs` (skippable with `--no-coep`, which keeps only CORP).
- Iframe USDZ chain (all three or SharedArrayBuffer fails): (1) app response sends the
  trio, (2) parent page is itself cross-origin-isolated, (3) parent delegates via
  `<iframe allow="cross-origin-isolated; camera; autoplay; fullscreen">`. Everything
  except USDZ import works without COI. Sandboxed embeds need
  `sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"`.
- A vitest trip-wire test (`cross-origin-isolation.test.ts`) reads vercel.json,
  vite.config.ts source text, and bin/serve.mjs to assert the trio stays in sync on all
  three surfaces.

### 7.6 Theming

- localStorage key **`sds-theme`**; values `'dark'|'light'`; anything else (or read
  failure) → `'dark'` default.
- `setTheme` writes storage (errors swallowed), sets
  `document.documentElement.dataset.theme`, notifies listeners. `useTheme()` =
  useSyncExternalStore over a module-level singleton (server snapshot 'dark'), with a
  mount effect that re-applies the attribute to repair external clobbering.
- index.html inline script (runs before module load, pre-paint): `?theme=` override wins
  over localStorage, else stored value, else dark.
- Theme↔env auto-sync rules per §1.1.

### 7.7 Apple platform detection (`platform.ts`)

`detectPlatform(ua, maxTouchPoints)` → `{os:'iphone'|'ipad'|'mac'|'other', iosMajor,
macosMajor, supportsObjectCaptureMobile, supportsObjectCaptureMac, isMobile}`.

- iPhone: `/iPhone|iPod/`. iPad: `/iPad/` OR (`/Macintosh/` AND maxTouchPoints>1) —
  iPadOS 13+ masquerades as Mac. Mac: `/Macintosh/` and not iPad.
- iosMajor from `/OS (\d+)[_\.](\d+)/`. macosMajor: the UA is frozen at 10_15_7 since
  Big Sur, so 10.15+ maps to 12 (and a missing match on Mac defaults to 12).
- `supportsObjectCaptureMobile = (iphone|ipad) && iosMajor>=17`;
  `supportsObjectCaptureMac = mac && macosMajor>=12`.

### 7.8 clearStore bootstrap (`?clearStore=1`)

Inline index.html script that wipes persisted state synchronously before any module
loads:

- Accepts values `'1'|'true'|'yes'` (this inline script does NOT accept 'on', unlike
  parseBool).
- Shows `window.confirm('Reset Synthetic Data Studio?...')` first — a declined or
  throwing confirm aborts (phishing-link guard).
- On confirm: `localStorage.removeItem` for exactly `'sds-store'` and `'sds-theme'`;
  `indexedDB.deleteDatabase` for exactly `['sds-assets','sds-textures']` by name —
  **never enumerates `indexedDB.databases()`**. All wrapped in try/catch; runs before
  the theme bootstrap and the module script.

### 7.9 Vercel deployment + realism-diffusion serverless function

- `vercel.json`: `/(.*)` gets the COI trio; `/assets/(.*)` gets
  `Cache-Control: public, max-age=31536000, immutable`.
- `api/realism-diffusion.ts` (`export const config={runtime:'nodejs'}`): POST only
  (405 otherwise).
  - Origin gate: allowed origins from `ALLOWED_ORIGINS` env (comma-separated) falling
    back to `VERCEL_URL`; entries without http prefix get `https://` prepended; when the
    list is non-empty, a missing or non-matching Origin → 403 (match = same scheme +
    lowercased hostname + port).
  - Content-Type must match `/^image\//i` else 415. Body cap **10 MB** (10*1024*1024):
    declared content-length over cap → 413, and the stream read enforces it too
    (`req.destroy()` on overflow). Empty/bad body → 400.
  - `x-realism-intensity` clamped to [0.05, 1], default 0.5;
    `image_guidance_scale = 2.0 − intensity*0.8` (maps 0..1 → 2.0..1.2; higher slider =
    less guidance = more repaint).
  - Model from `HF_REALISM_MODEL` env (validated against
    `/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/`, invalid → 500), default
    `timbrooks/instruct-pix2pix`.
  - Upstream: `POST https://api-inference.huggingface.co/models/{model}`, headers
    `Content-Type: application/json`, `Accept: image/png`, optional
    `Authorization: Bearer ${HF_TOKEN}`; body
    `{"inputs": "<base64 image>", "parameters": {"prompt": "make this look like a real
    photograph: natural lighting, accurate materials, subtle film grain, soft shadows;
    keep every object in exactly the same position and shape.",
    "image_guidance_scale": <…>, "num_inference_steps": 20},
    "options": {"wait_for_model": true, "use_cache": false}}`.
  - Errors: fetch failure → 502 `hf network: …`; non-ok upstream → 503 if upstream 503
    else 502 with fixed `{error:"upstream <status>"}` (verbose text only logged
    server-side, first 500 chars); non-image content-type from HF → 502
    `upstream non-image response`. Success → 200 image/png, `Cache-Control: no-store`.
  - The client silently falls back to the local random pass on any error; the feature is
    wired but hidden from the Realism picker.

### 7.10 npm static server, build pipeline, tests & CI

**bin/serve.mjs** (`npx @yennster/synthetic-data-studio`): flags `--port` (default
$PORT or 5173), `--host` (default $HOST or **127.0.0.1** — loopback so npx doesn't
expose to LAN; pass 0.0.0.0 to share), `--no-coep`. Serves `../dist`; missing dist →
error + exit 1. Path traversal defense: path.join + prefix check with trailing
separator, then realpath re-check (symlink escape), plus a re-check after the
directory→index.html hop; violations → 403. Hashed assets matching
`/\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[^.]+$/` get immutable caching, everything else
`no-cache`. SPA fallback to index.html. MIME map includes `.wasm→application/wasm` and
`.data`/`.task`→`application/octet-stream` (USDZ + MediaPipe binaries).

**vite.config.ts**: server.host true, port `Number(process.env.PORT)||5173`;
`optimizeDeps.exclude ['@mediapipe/tasks-vision','@needle-tools/usd','@mujoco/mujoco']`
(needle uses `?url` imports of .data files esbuild can't pre-bundle; mujoco resolves its
wasm via `new URL` relative to import.meta.url which breaks under .vite/deps);
`resolve.dedupe ['three']`. Both excludes and the dedupe are **load-bearing**.

**postinstall** (`setup-usdz-wasm.mjs`): copies
emHdBindings.js/.data/.wasm/.worker.js from `node_modules/@needle-tools/usd/src/bindings`
to `public/usdz-wasm/`; no-ops when src/ is absent (npm consumer install). npm installs
need `NPM_CONFIG_LEGACY_PEER_DEPS=true` (three-usdz-loader peers three@^0.166 vs three
0.169 — benign at runtime).

**npm scripts**: dev=vite, build=`tsc -b && vite build`, preview, start=node
bin/serve.mjs, test=`vitest run`, test:coverage, test:iframe, screenshot. engines node
22.x (CI runs node 20). package files: bin, dist, README.md, LICENSE; publishConfig
registry `https://npm.pkg.github.com`.

**Tests**: Vitest inside vite.config.ts test block — environment `happy-dom`, globals
true, include `src/**/*.test.ts(x)`, `server.deps.external
['@mediapipe/tasks-vision','@needle-tools/usd']`. The unit suite is effectively an
executable spec for the wire formats (edgeImpulse.test.ts locks header names, URL
substrings, payload shapes, split behavior, probe semantics). `test-iframe-embed.mjs`
(needs dev server on :5173 + Chrome via CHROME_PATH): 6 scenarios (plain-parent,
coi-parent-delegates, coi-parent-no-delegation, studio-edgeimpulse-mimic with real
Studio CSP headers, studio-edgeimpulse-with-coi, sandboxed-iframe), parent servers on
ports 5181–5186 at 127.0.0.1 (cross-origin to localhost:5173), asserting
crossOriginIsolated / SharedArrayBuffer / canvas+HUD render per scenario; exit 1 on
divergence.

**CI**: test.yml — push to main + PRs + dispatch; node 20, npm ci with
NPM_CONFIG_LEGACY_PEER_DEPS=true, `npx tsc --noEmit`, `npm test`. release.yml — on v*
tag or dispatch; builds, **verifies dist/usdz-wasm/{emHdBindings.wasm,.js,.data,
.worker.js} exist**, zips dist as `synthetic-data-studio-<tag>.zip`, attaches to a
GitHub release (softprops/action-gh-release@v2, generate_release_notes), publishes to
GitHub Packages (@yennster scope).

### 7.11 Privacy contract (README "Privacy notes")

Commitments a port must uphold:

1. The webcam stream never leaves the browser in any mode — MediaPipe runs locally; only
   explicitly captured/uploaded data is transmitted.
2. API keys live in JavaScript memory only (no localStorage/sessionStorage/cookies/
   files; reload wipes them) — `ei` excluded from persist.
3. Image saves go to local disk; only EI uploads leave the machine, over HTTPS to
   ingestion.edgeimpulse.com.
4. Scene state persists locally (localStorage + IndexedDB), per-browser/per-origin,
   clearable via browser site-data settings, per-asset removal, or the Clear controls.
5. Captures (rendered images and IMU samples) are deliberately **not** persisted —
   memory-only until saved/uploaded. Do not add capture or key persistence "for
   convenience".
6. Stated legal rationale: local persistence is "strictly necessary" under the ePrivacy
   Directive, so no consent banner is shipped (explicitly flagged as not legal advice).

---

## 8. Known discrepancies & dead surface

Corrections and drift found while mapping (fold-in from the gaps review):

1. **`?bypassAuth` is dead.** `urlParams.ts` parses it into URL_FLAGS (default false),
   the test asserts the default, and docs/url-parameters.md documents it ("Skip EI auth
   checks. Offline UI testing.") — but **no component or lib ever reads
   `URL_FLAGS.bypassAuth`**. It is the only documented URL parameter with zero runtime
   effect. The rebuild should either wire it or drop it from docs; porting it
   parse-only silently reproduces the dead flag.
2. **README custom-texture claim is stale.** README says "per-slot custom textures
   (Floor / Wall / Object)" but `textureStore.ts` defines
   `TextureKind = 'floor' | 'wall'` only; there is no object-texture slot anywhere in
   src/. The feature map (two slots) is correct.
3. **docs/troubleshooting.md drift**: it says the ROS export toggle lives in "the Sensor
   modality card"; the actual toggle is in the Generate card. The rest of that doc pins
   real support-facing contracts (bounding boxes clipped at edges + small/occluded
   dropped; Vercel ignoring public/_headers — verify with `curl -I`; HMAC signs the JSON
   envelope and vision modes deliberately show no HMAC field; Studio shows metadata on
   the sample details pane, not as a dataset-table column; retrain auto-selects only
   with exactly one accessible project; run-impulse.js/run-classifier.js/index.js are
   Node-only; arm "Target unreachable" = IK clamps + ~11–22 cm reachable annulus; arm
   pickup failure is intentional; rover cruise needs a clear straight path — Reset scene
   regenerates the layout).
4. **docs/robotics.md drift**: arm IMU actually exports on topic `/end_effector/imu`
   with frame_id `end_effector` (docs show `/imu/data` + `imu_link`); `/odom` lines are
   absent from real exports (runner never passes poses); "default 16 beams" — store
   default 16, UI range 4–64.
5. **RoverSim comment drift**: comments describe a `qfrc_applied`-based impulse story,
   but current code relies purely on MJCF obstacle contacts inside `mj_step`
   (`qfrc_applied` only cleared in snapToPose).
6. **drafts/security-hardening/** (README.md, csp.test.ts, serve-headers.mjs,
   vercel-headers.json): a deliberately shelved CSP + hardened-header stack, authored
   but intentionally NOT shipped — the shipped COI trio exists for SharedArrayBuffer
   functionality, not defense. These files are not wired into build/tests/deploy and
   must not be promoted without revisiting the MediaPipe-CDN and iframe-embedding
   constraints that kept them parked.
7. **Docs/marketing tooling** (not app features, for completeness):
   `scripts/screenshot.mjs` (puppeteer-core headless screenshots against :5173; targets
   motion|detection|anomaly|robotics|rover|arm|all → docs/screenshots/
   screenshot-<target>.png; can import a USDZ first), `scripts/screenshot-cards.mjs`
   (per-card close-ups → card-<mode>-<slug>.png; finds cards by heading text, exact then
   prefix match, opens collapsed cards), `blog/` (two markdown posts; launch post
   frontmatter author "Jenny Speelman", dated 2026-05-07),
   `scripts/render-blog.mjs` (purpose-built minimal markdown→HTML renderer),
   `scripts/build-og-card.sh` (og-card.svg → public/og-card.png 1200×630 via headless
   Chrome, macOS-only), `public/favicon.svg`.
8. **HUD tip vs code**: the useDragMove docstring mentions Shift as a select modifier;
   in code Shift+click never selects (see §1.4).

---

*End of contract. The parity tracker lives in [FEATURE-PARITY.md](FEATURE-PARITY.md).*
