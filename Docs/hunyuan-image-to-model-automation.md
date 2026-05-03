# Hunyuan Image-To-Model OBJ Automation

## Goal

Automate the `based-blink.hunyuan.image-to-model` workflow end to end so BLINK can take a front image plus at least one additional view image, generate a Hunyuan 3D model, run the intended post-processing steps, and download the final OBJ artifact without manual selector intervention.

The target happy path is:

1. Open Hunyuan with the persistent `hunyuan/default` browser profile.
2. Reuse an existing login session when available, and pause only for real account checks.
3. Select Image-to-3D and Multiple Images.
4. Upload the provided images into explicit view slots: front, back, left, right, top, bottom, left 45, and right 45.
5. Select Hunyuan V3.1, `50k`, and the geometry/texture phased model type.
6. Start geometry generation and wait for geometry completion.
7. Select quad retopology and run smart retopology.
8. Generate texture by default.
9. Select OBJ by default and download the final model artifact.

## Achieved So Far

- Reworked the workflow around explicit multiview inputs instead of a generic image list.
- Added validation requiring `frontImage` plus at least one additional view image.
- Added defaults for `modelFaceCount = 50k`, `retopologyType = quad`, `generateTexture = true`, `autoRig = false`, and `exportFormat = obj`.
- Added Hunyuan selector defaults and a renderer-side selector preset for the run form.
- Added login-state detection so a reused Hunyuan session can skip the manual login pause.
- Calibrated the multiview modal close path. Hunyuan uses `.hy-multi-view-grid__header-close`, not a TDesign dialog close button.
- Calibrated settings controls. Face count and model type use custom segment controls under `.generation-type-select`, not TDesign radio labels.
- Added disabled-safe action-button handling so visible but disabled controls are not clicked as if they were active.
- Added start verification for geometry generation so the workflow fails with a calibration screenshot instead of waiting through the full generation timeout after a no-op click.
- Extended the same disabled-safe action handling to smart retopology, texture generation, optional auto-rig, and download.
- Updated downstream waits so retopology and texture must first enter a running state before accepting ready controls that may already be visible.
- Calibrated the retopology type picker. Quad/triangle selection uses the custom `.qaUJkqcCF813NIqHGF3U` segment controls inside the visible smart-retopology operation panel, not a button.
- Calibrated OBJ export. Hunyuan uses a TDesign dropdown menu: `button.download__dropdown__btn` opens `.download__dropdown li.t-dropdown__item` options.
- Added focused unit coverage for selector defaults and disabled-safe click behavior.
- Rebuilt and reloaded/copied the Hunyuan plugin bundle during calibration so the installed plugin tracked source changes.
- Completed an end-to-end BLINK CLI run that generated geometry, ran quad smart retopology, generated texture, selected OBJ, and downloaded the final artifact.

## Current Known State

The workflow has successfully completed with the real front/back calibration images.

This run is the case study for the reusable [Workflow Lab And BLINK CLI Plugin Calibration Loop](./workflow-lab-cli-plugin-calibration.md): every major selector fix was proven by a real BLINK CLI run, inspected through Workflow Lab or trace evidence, patched, reloaded into the installed plugin, and rerun until the OBJ artifact downloaded.

The verified selector shape for quad retopology is:

```text
.model-dialog__content__operation:has(.model-dialog__content__operation__heading:has-text(HUNYUAN_TEXT.smartRetopology)) .topology-panel .qaUJkqcCF813NIqHGF3U:visible:has-text(HUNYUAN_TEXT.quad)
```

The verified selector shape for OBJ export is:

```text
button.download__dropdown__btn
.download__dropdown li.t-dropdown__item:has-text("OBJ")
```

Successful run:

- Run id: `f01e49ef-c7ea-468e-9e6c-4901ee07d165`
- Model artifact id: `46b53072-447f-445e-b21b-2b4ca021f597`
- Download path: `C:\Work\Based.NotMonsters\Art\Pipeline\Codex-Hunyuan-OBJ-E2E-f01e49ef\artifacts\acd182719fb8be7d6cf0d38d9206caf9.zip`
- ZIP contents include `fd5deec0317ed3349afa71baf200546e.obj`, `material.mtl`, and PBR texture maps.

## Remaining Work

- Clean up and commit the Hunyuan workflow changes when ready.
- Consider adding a targeted export-dropdown helper if Hunyuan introduces another export menu variant.

## Verification Used During Calibration

The following checks have been run repeatedly after the Hunyuan workflow changes:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --check extension\chatgpt-controller\content.js
node --check extension\chatgpt-controller\popup.js
```

Additional local Playwright probes were used to confirm that calibrated selectors resolve and click against representative HTML before applying them back to the workflow.
