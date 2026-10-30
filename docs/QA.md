# QA runbook

Scope: `tests/*`, `scripts/*`, this file and `KIRI.md`. No UI, engine, dependencies or package scripts changed. The acceptance contract is [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md).

## Executable asset checks

```sh
npm test
./tests/assets.test.mjs
./scripts/inspect-assets.mjs
```

These dependency-free Node checks read the real bundled files. GLB validation checks `glTF` bytes, version 2, declared file size, aligned chunk bounds, JSON mesh metadata and a BIN payload. The PLY inspection checks a bounded header, vertex properties and sufficient binary vertex bytes. The bundled sample has 85,370 vertices and the full position, DC color, opacity, three scales and four quaternion components.

Negative cases cover HTML masquerading as model data, truncated data, incomplete Gaussian properties, misleading comments, and properties on a non-vertex element. `tests/fixtures/points.ply` is an explicitly synthetic four-point color fixture with no Gaussian attributes; it is test data, not a scan or API result. Gaussian classification uses the complete attribute set, independently of a filename extension.

Limit: `scripts/inspect-assets.mjs` is an independent QA oracle. These tests do **not** exercise the production importer or renderer. They do not establish finite binary values, valid quaternions, glTF semantic conformance, every PLY dialect, packed/compressed splats, or scientific calibration. A partial Gaussian schema is classified as points here; the UI should preserve that caveat or reject an unsupported capture rather than imply full Gaussian support.

## Browser smoke

Start the application in one terminal:

```sh
npm run dev
```

Run in another:

```sh
./scripts/browser-smoke.mjs
# Use installed Chromium if Puppeteer's browser download is absent:
CHROME_PATH=/usr/bin/chromium ./scripts/browser-smoke.mjs
```

The script discovers existing Puppeteer locally or under `~/.npm/_npx`; it never downloads packages or changes dependencies. If unavailable, it fails with instructions. Optional overrides: `BASE_URL`, `SMOKE_TIMEOUT` (milliseconds), `SMOKE_OUTPUT` (artifact directory), `HEADED=1`, and `PUPPETEER_MODULE` (existing ESM entry file). `NO_SANDBOX=1` is an explicit opt-in for isolated test containers that cannot launch Chromium normally.

At 1366×768 and 390×844, it uploads the real GLB, real Gaussian PLY, and ordinary points fixture through an actual file input. It requires the filename, expected mode text and a visible sized canvas without a loading/error overlay, exercises File/Analyze/Compare/Capture (also accepting the current Import/Inspect labels), checks document overflow, and fails on browser exceptions, console errors, failed requests or HTTP errors. Screenshots and `report.json` go to `/tmp/house-of-mac-smoke` by default, including failure evidence. Each context must be enabled by the product contract; disabling Compare with one asset will be reported and needs interpretation against intended behavior.

Mode text can also appear in mode selectors, so it is supporting evidence only. A nonempty canvas does not prove geometry rendered. Inspect images manually; software WebGL differs from a hardware GPU. This script does not replace renderer tests or confirm WebGL cleanup. It fails if boot, import or context selectors are missing; it never replaces missing behavior with mocks.

## Manual acceptance

- Import original GLB, Gaussian PLY, ordinary PLY, a renamed real GLB, and an HTML file renamed `.glb`. Verify detection follows bytes, errors are visible, and ordinary PLY stays POINTS. Check Gaussian controls are absent for ordinary points.
- Mesh: inspect texture/clay/wireframe, orbit, raking angle, clipping and orthographic toggle. Confirm scene changes in each case. Measurements require supplied scale; unscaled files must not display physical units as calibrated results.
- Splat: orbit, point-cloud toggle, splat size, turntable and speed. Only expose alpha threshold if supported. Verify SH/color and orientation against the source; no claim of physical relighting. Points: inspect size and orbit independently.
- Capture: download a PNG, open it and verify actual model pixels and framing. Confirm capture uses the active scene, not an empty canvas.
- Compare: load a second asset, check at most two views and a phone stack. A sync control must actually synchronize supported cameras. Remove/reload files repeatedly; watch for duplicate scenes, stale canvases, leaked memory and premature object-URL revocation.
- At both target sizes inspect all contexts for clipped text, overlap, horizontal/primary vertical scroll, reachable tools and readable labels. Check keyboard focus, orbit shortcuts, reset/views and discoverable tooltips.
- Follow [KIRI.md](KIRI.md). Verify official reference links, source attribution and original-file handling. Confirm status remains not connected without server credentials; local imports must not upload data or expose tokens.

## Recorded verification

On 2026-10-29 the Node asset suite and inspector passed against the bundled files (GLB: 3,901,144 bytes, one mesh; Gaussian PLY: 85,370 vertices). Browser acceptance is **unverified**: Vite could not bind `0.0.0.0:8766` (`listen EPERM`), and cached Puppeteer successfully resolved but Chromium launch failed with `setsockopt: Operation not permitted` from crashpad. This environment does not permit the required server/browser operations. Rerun the commands above in a normal local terminal. The failed launch produced `/tmp/house-of-mac-smoke/report.json`; no successful browser screenshots were produced.

Static review during implementation found that the UI importer used extension routing and an any-property Gaussian regex. The oracle's negative cases identify the acceptance requirement for that code: inspect actual magic and complete vertex attributes, not comments or a single Gaussian-like property. This is a review finding, not a failing production integration test or a fix in this QA scope. Recheck the current importer before release.

No KIRI account/API round trip, Blender operation, visual renderer correctness or phone hardware test has been verified.
