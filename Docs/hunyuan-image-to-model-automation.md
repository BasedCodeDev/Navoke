# Hunyuan Sheng3D Image-To-Model Automation

## Goal

`navoke.hunyuan.image-to-model` automates Tencent Hunyuan's Sheng3D editor. It accepts a front image plus at least one additional view, generates one textured model, and downloads an OBJ or GLB artifact.

This document applies only to `https://3d.hunyuan.tencent.com/`. The separate `navoke.hunyuan.global.image-to-model` workflow retains its existing staged generation behavior.

## Sheng3D v0.2.0 Flow

1. Open Tencent Hunyuan with the persistent `hunyuan/default` Playwright profile.
2. Reuse an authenticated session or pause for login/account checks.
3. If Hunyuan opens its product landing page, click the **立即开始 / Start now** control and wait for the Sheng3D editor.
4. Select **图生3D / 3D graphics**, **多张图片 / Multiple images**, and the multi-view uploader.
5. Upload the front image and at least one additional named view. Wait for every slot to be accepted before closing the modal.
6. Select Sheng3D V3.1 and the requested face count (`50k` by default).
7. Start the single end-to-end generation operation and wait for the model download control.
8. Open the download panel and click OBJ or GLB. Selecting the format initiates the download, so the workflow starts listening for the Playwright download event before clicking the format.
9. Register the model, extracted OBJ sidecars/textures when supplied, manifest, and Playwright trace.

The Tencent v0.2.0 input contract no longer exposes prompt, retopology, texture-generation, or auto-rig settings. Those controls were part of the previous staged UI and are not present in the Sheng3D flow.

## Calibrated Page States and Selectors

- Login page: `button.login-btn` or the email input is visible.
- Authenticated product landing: `.v3-home` is visible and `.v3-home .start-but` enters the editor.
- Sheng3D editor: `.v3-sidebar-left` is visible.
- Multi-view uploader: `.hy-multiple-views-upload-v2` and the eight `.hy-upload-card--*` containers remain stable.
- Model picker: `.model-version-select:visible`; the visible TDesign popup contains the V3.1 option.
- Face count: the visible `.generation-type-select` segment controls under `.v3-sidebar-left` contain `1.5m`, `1m`, `500k`, and `50k`.
- Generate: `.sideBarLeft-generateBtn`, excluding disabled states.
- Generated result/download opener: `button.native-edit__viewport-actionBar-download`.
- Download formats: `.v3-download-panel__item` entries for OBJ, GLB, FBX, STL, USDZ, MP4, and GIF. The public workflow intentionally supports OBJ and GLB only.

Visible labels can be translated to English in the saved browser profile, so structural selectors are preferred where the site provides stable classes.

## Artifact Behavior

- A downloaded OBJ ZIP is extracted into the run's `model-assets` directory.
- The extracted OBJ is registered as the model artifact, with matching MTL and texture files recorded in metadata and the JSON manifest.
- A direct GLB download is registered without extraction.
- If extraction fails, the original download is retained as a download artifact with the error recorded.
- Every run records a manifest and Playwright trace. Selector failures also register a calibration screenshot.

## Release Verification

Use Workflow Lab to inspect live page states and the Navoke CLI to prove the installed plugin. The release proof uses the existing wooden-ladder front and left-45-degree images, Sheng3D V3.1, `50k`, OBJ export, and the `default` browser profile.

Run the focused plugin tests first, followed by:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --check extension\content.js
node --check extension\popup.js
node --check extension\background.js
```

Install the new package into the active project, verify `navoke.hunyuan@0.2.0` is loaded, then remove the legacy `based-blink.hunyuan@0.1.0` package. Historical runs and artifacts are not removed.

## v0.2.0 Release Proof

The installed `navoke.hunyuan@0.2.0` package completed the wooden-ladder proof on 27 August 2026:

- Run: `1621a94a-bf07-4edf-a566-6dd155980ce9`
- Model artifact: `1a83f663-b0ea-469e-9c73-06943b600656`
- Manifest artifact: `07485190-80c0-4c85-8aaa-475fe35b0bac`
- Trace artifact: `5d7d7a2c-fc20-4004-af53-209b8e3c52fa`
- Model: `c432980e19528a8ec4231e2806d1d956.obj` with `material.mtl` and base-color, metallic, normal, and roughness PBR textures.

Both input views were accepted on their first upload attempt. The generation completed through the new single-step flow, selecting OBJ directly triggered the Playwright download event, and the returned ZIP was extracted and registered successfully.
