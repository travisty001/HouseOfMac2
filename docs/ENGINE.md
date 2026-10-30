# Viewer engine

`src/engine/Viewer.jsx` exports the default React `Viewer`. It fills its parent; give the parent a nonzero height. It owns one canvas, WebGL2 context, scene, camera pair, and OrbitControls instance per mounted asset. Files stay local. The engine never revokes caller-owned asset URLs or changes uploaded geometry.

```jsx
<Viewer
  asset={{ url, name, kind: 'mesh' /* or 'splat', 'points' */ }}
  settings={settings}
  onReady={metadata => {}}
  onError={message => {}}
  onCameraChange={cameraState => {}}
  cameraCommand={{ id: commandId, action: 'reset' }}
  captureRef={captureRef}
/>
// After onReady:
const pngDataURL = await captureRef.current();
// The caller saves/downloads this PNG URL; capture does not trigger a second download.
```

All callbacks and settings are optional. `onReady` receives `{type, vertices, faces? , capabilities}`; Gaussian `vertices` is the native renderer's retained splat count after its alpha filtering. Mesh counts include rendered mesh instances. `onError` receives a string. Camera changes deliver `{position:[x,y,z], target:[x,y,z], up:[x,y,z], zoom, orthographic}` at up to 10 Hz while the view changes. This is observational output; automatic comparison synchronization is not implemented.

Camera commands use a new `id` for each request. Supported actions are `reset`, `fit` (alias), `front`, `back`, `left`, `right`, `top`, `bottom`, `step-left`, and `step-right`. Presets fit the asset's finite bounds and use Y-up; top/bottom have a stable Z up-vector. Steps orbit 15 degrees. Orbit, pan, wheel zoom and touch controls come from Three.js OrbitControls. Commands arriving during load apply when ready. Orthographic mode preserves framing when switching projections and is supported for meshes.

## Actual rendering controls

| Kind | Loader and controls |
| --- | --- |
| mesh | Three.js GLTFLoader for GLB/GLTF. `appearance`: original loaded materials, neutral rough clay, or true triangle wireframe. `raking` reduces hemisphere light and lowers the directional light. `lightAngle` is its azimuth in degrees. `clipEnabled` enables a world-X clipping plane; `clipOffset` runs from -1 to 1 across the bounds. `orthographic` changes projection. |
| splat | Lazy-loaded `@mkkellogg/gaussian-splats-3d` 0.4.7 native Viewer, with the engine's external renderer and camera. Native PLY/SPLAT/KSPLAT decoding, covariance-based Gaussian rendering and worker depth sorting. `splatScale` calls native `setSplatScale`; `pointCloud` calls native `setPointCloudModeEnabled`. `spin` orbits the camera. |
| points | Three.js PLYLoader and PointsMaterial. Optional vertex colors are preserved. `pointSize` is screen pixels, independent of distance. `spin` orbits the camera. Face-bearing ordinary PLY is deliberately displayed as points in this mode. Gaussian PLY properties produce an error asking for SPLAT mode. |

Defaults: original materials, ordinary lighting at 45 degrees, clipping off, point size 2 px, splat scale 1, point-cloud off, spin off, speed 1, perspective. Speed is signed and scales turntable rotation by 0.3 radians/second. No lighting or clipping is applied to splats or points. No measurement, alpha-threshold slider, splat relighting, or pretend feature is implemented. Capabilities in metadata state which controls are meaningful. Alpha filtering is fixed at native loader threshold 1/255, not exposed as an adjustable control. Splat scale is clamped to 0.05–5; point size to 0.1–30 px.

Blob URLs are supported. Splat format is explicit from the original name, with prefix sniffing when no recognized name exists. Keep the original filename for KSPLAT, whose binary format cannot be inferred by the PLY prefix fallback. The caller should detect scan kind before mounting; `.ply` alone does not imply Gaussian data. Self-contained GLB/GLTF works directly. GLTF external buffers/textures need reachable URLs with CORS, or caller-rewritten companion blob URLs; the engine cannot discover local companion files itself. Draco/KTX2 decoder plugins are not configured, so assets requiring them fail through `onError`.

## Resource budget and lifecycle

The engine targets modest integrated GPUs: pixel ratio 1, no multisampling or shadows, maximum 30 updates per second, render-on-change for stationary scenes, suspended rendering for hidden documents and zero-sized parents. Native splats use CPU sorting without SharedArrayBuffer or cross-origin isolation, half-precision GPU covariances, degree-0 spherical harmonics, compression level 1, freed intermediate arrays, and a 512 px maximum projected splat footprint. These settings trade some Gaussian precision and view-dependent color for memory and compatibility. They are not a guarantee that arbitrary captures fit Intel HD or 6 GB system RAM. The native library still keeps CPU data, a sorting worker, and GPU textures; two comparison panes multiply that cost. There is no silent point decimation, streaming LOD, or fabricated low-memory fallback.

ResizeObserver updates renderer size and projection. Capture renders immediately before PNG readback, avoiding a persistent drawing buffer. PNG readback can fail when external texture CORS policies taint the canvas.

On asset change/unmount, the engine cancels fetches and animation frames, disconnects observers and controls, removes context listeners and the canvas, disposes unique geometries/materials/textures/skeletons, closes image bitmaps, and asks the native Gaussian viewer to abort downloads and dispose workers. Native disposal waits for pending sorting before the engine releases its renderer/context. Late loader callbacks do not update a removed viewer. Context loss pauses rendering and reports an error; context restoration remounts and reloads the same asset from its URL. Shader/render failures are reported instead of repeatedly running a broken frame loop.

## Validation

`node --check src/engine/runtime.js` and `npm run build` pass. The production build includes the Gaussian library as a separate lazy chunk. Browser validation was attempted with local Chromium/Puppeteer, but this execution sandbox rejects both server listening (`listen EPERM`) and Chromium startup (`setsockopt: Operation not permitted`). Actual GPU rendering, screenshots, context restoration and visual correctness therefore still require a browser run outside that sandbox. No package, UI, or test files were changed for this implementation.

Native API reference: [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D). Installed 0.4.7 source was inspected for the external renderer/camera, settings and asynchronous disposal integration.
