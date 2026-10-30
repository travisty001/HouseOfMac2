# KIRI Pro → House of Mac

Checked against official documentation on 2026-10-29. This is an exported-file workflow. Connection status: **not connected**. No KIRI account, entitlement, API token, remote job, or Blender installation was accessed or verified during QA.

## Pro subscription and local provenance

Use your existing KIRI account to finish a 3DGS capture and save its Gaussian PLY export locally. Exact capture/export menus and subscription entitlements must be confirmed in your installed KIRI version. A mesh GLB and an ordinary point-cloud PLY are different outputs; renaming either cannot create a Gaussian scan.

Keep the original export unchanged. For research provenance, record KIRI as the source, project/capture identifier, export date, app version if known, original filename, and any Blender processing in a separate note. Mark scale as unknown unless independently calibrated. Import the exported file through House of Mac's file picker; retain the external original even after a browser session ends. These are workflow recommendations, not a claim that persistent provenance editing or storage is implemented.

## Installed Blender add-on

The official [3DGS Render guide](https://www.kiriengine.app/3d-tools/3dgs-render) describes the following:

1. Open the **3DGS Render** N-panel; choose **Edit → Import → Verts**. For rendering a full scene, retain **Create Proxy Object**, then **Import PLY**.
2. Use **Rotate Active To Blender Axis** when orientation needs correction. Keep updates disabled or use **Show as Point Cloud** while positioning.
3. Switch to **Render** and test one frame before animation. This Blender render workflow is separate from this browser viewer.
4. For an external-viewer editing workflow, the guide instead disables **Create Proxy Object** on import. Work on a copy; use the add-on's **Apply 3DGS Transforms and Colour** for rotation/scale. Export through **Export → Output Directory → Export PLY**. Export applies current rotations/scales.

The guide accepts Gaussian PLY only; ordinary PLY can fail on missing `f_dc_0`. Orthographic face updates in Edit mode are unsupported. Large scans can exhaust resources; advanced rigging/light baking are experimental. Check add-on/Blender compatibility before upgrading. Preserve spherical harmonics; removing SH attributes is destructive. The add-on is offered free, independently of Pro support.

Reimport the derivative into House of Mac and visually compare orientation, color and extent with your preserved export. Gaussian appearance is not calibrated photometric relighting; Blender lighting operations do not establish physical material properties.

## Optional developer API

The official [API quickstart](https://docs.kiriengine.app/quickstart/) explicitly requires a KIRI Engine **Developer account** and an API token. Do not infer developer access or an API key from a regular Pro subscription or installed Blender add-on. Confirm your own developer account and billing/entitlements separately.

[API overview](https://docs.kiriengine.app/) gives the REST base `https://api.kiriengine.app/api/`. [Creating API Keys](https://docs.kiriengine.app/authentication/creating-api-keys/) describes secure key creation; [Using API Token](https://docs.kiriengine.app/authentication/using-api-token/) documents bearer authorization. The API exists, but this application has no authenticated integration. Opening official documentation or importing a KIRI export does not connect an account.

No adapter, placeholder login, simulated queue, invented upload endpoint, or fake API result is supplied here. A future integration needs an actual server, a separately provisioned secret, explicit upload consent, and verification against current official endpoints. Never put tokens in client code, browser storage, screenshots, committed files or `VITE_*` variables. No credentials are needed for the local export/import workflow.
