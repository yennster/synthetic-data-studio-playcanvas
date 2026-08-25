# URL parameters

The full parameter surface of the
[original app](https://github.com/yennster/synthetic-data-studio/blob/main/docs/url-parameters.md)
is parsed by the ported `src/lib/urlParams.ts` (same names, aliases, bounds, and boolean
coercion — locked by its 154 ported tests). This page tracks what the PlayCanvas rebuild
**applies** today. Parameters parse-but-no-op only where their feature doesn't exist yet.

Example:
`https://canvas.jennyspeelman.dev/?mode=detection&objects=cube,sphere&batchCount=25&trajectory=circle&radius=3&seed=42&apiKey=ei_...&autoUpload=1`

## Applied

| Parameter | Values | Effect |
|---|---|---|
| `mode` | `motion`/`imu`/`accel` · `detection`/`object(s)`/`object-detection` · `anomaly`/`visual-anomaly` · `robot`/`robotics`/`rover`/`arm` | Active mode (aliases as in the original) |
| `robot` | `rover` \| `arm` | Robot rig |
| `onlyMode` | csv of modes | Hides other mode buttons (deep links / embeds) |
| `seed` | integer | Deterministic mulberry32 RNG for batch jitter + realism |
| `batchCount` | 1..500 | Batch size |
| `trajectory` | `random` `circle` `figure8` `arc` `spiral` `orbit_dome` | Camera path |
| `radius`, `height` | meters | Path dimensions |
| `fov` | 10..170 | Capture camera FOV |
| `resolution` | `WxH` (32..8192) | Capture resolution |
| `camera`, `target` | `x,y,z` | Capture camera pose |
| `lightIntensity` | 0..10 | Key light |
| `objects` | csv of kinds (`can` → soda_can) | Seeds spawned primitives |
| `objectCount` | 0..200 | How many to seed |
| `realism` | `off` \| `random` | Realism pass mode |
| `grain` `chromatic` `vignette` `jitter` `jpeg` | 0..1 | Realism knobs |
| `eiLabel`, `eiCategory` | label · `training`/`testing`/`split` | Edge Impulse defaults |
| `apiKey` | `ei_…` | Prefills the EI API key (memory only, never persisted) |
| `studioHost`, `ingestionHost` | host | EI host overrides (allowlisted: `*.edgeimpulse.com` HTTPS or loopback) |
| `sampleRate` | 20..500 | Motion IMU sample rate |
| `roverEvent` | `cruise` `collision` `stuck` | Rover event class |
| `theme` | `dark` \| `light` | UI theme |
| `embed=1` | flag | Strips ALL chrome (sidebar, HUD, prompts) |
| `ui=minimal` | flag | Strips the sidebar |
| `gizmos=0` | flag | Hides the camera/trajectory gizmos in the viewport |
| `autoUpload=1` | flag | Uploads a finished batch to Edge Impulse automatically (needs `apiKey`) |
| `clearStore=1` | flag | Wipes localStorage + IndexedDB, then reloads clean |

## Parsed but not applied yet (feature pending)

| Parameter | Blocked on |
|---|---|
| `env` (`studio`/`warehouse`/`whitebox`/`outdoor`) | Env presets — this edition uses splat backdrops + `Sky` presets instead (TODO) |
| `conveyor`, `conveyorSpeed` | Conveyor belt (physics phase, TODO.md) |
| `armPose` | Arm home pose lives in panel state, not the store yet |
| `eiProject` | Parse-only in the original as well |
| `debug`, `perf`, `camLog` | Dev overlays (use `window.__studio` / `window.__useStore`) |
| `bypassAuth` | Offline EI stubs |
