# Hunyuan Global Studio props

`navoke.hunyuan@0.3.0` exposes one workflow: `navoke.hunyuan.global.image-to-model`.
It replaces the China workflow and old Global implementation with the calibrated Studio
pipeline from `Based.NotMonsters/Art/OrnamentalProps/navoke-studio` v0.3.10.

## Inputs and behavior

```json
{
  "frontImage": "C:\\art\\front.png",
  "backImage": "C:\\art\\rear.png",
  "topology": "Quads"
}
```

Both references are required. The form provides single PNG file pickers and a topology
dropdown: `Quads` (default), `Triangles`, or `Original`. Obsolete fields are rejected; update
saved inputs rather than assuming older generation/export options still apply.

The workflow opens an unfocused, run-owned window in the connected Chrome profile at
`https://hy3d.tencent.ai/studio/creation/prop/geo`. It uploads the verified Front View and Back
View slots, selects 50k geometry, and requires a running state before accepting completion.
Quads and Triangles run Medium retopology and upload the references again for Image-to-Texture.
Original skips retopology and verifies that both uploaded reference URLs remain in the texture
stage. All branches paint textures and export a GLB with embedded images.

No cursor movement or native desktop automation is used. Login, verification, and controller
disconnection pause for manual action. Resume continues the in-memory workflow at its current
stage. Restarting the app or retrying a failed run does not resume completed stages.

## Requirements and artifacts

- Navoke running with the intended project open and its `.navoke/runtime.json` present.
- Browser Controller 0.1.10 / protocol 7 connected in the authenticated Hunyuan Chrome profile.
- Three concurrent runs are supported; exports within this plugin are serialized.
- Do not overlap downloads with another loaded Hunyuan plugin/version: the download watcher
  is shared, while the export gate is local to this plugin module.

Outputs are registered beneath the run's artifact directory:

- `prop.glb`: validated GLB v2 mesh with embedded textures.
- `model-manifest.json`: references, selected topology, requested geometry setting, actual
  exported vertex/triangle counts, materials, image count, and file size. GLB triangles are
  measured from exported primitives even when Quads retopology was selected.
- `lab-*.json`: initial, before/running/complete, and export inspections.
- `workflow-lab-session.json`: Lab action/wait history, also saved on failure or cancellation.
- `last-ui-state.json`: best-effort failure inspection.

The output contains `artifactIds` and `summary`. Cleanup closes only the run-owned window
and Lab session. Keep the controller profile open across separate runs (an existing user
window is sufficient). Render downloaded models to check identity and visual quality;
structural validation cannot establish likeness.

## Upgrade and verification

Build and install `plugins/navoke-hunyuan` through the CLI for the confirmed project. Remove
the installed `navoke.hunyuan@0.2.0` package through the plugin API/UI when upgrading: two
versions declaring the same workflow ID cannot both load. Verify that version 0.3.0 registers
only `navoke.hunyuan.global.image-to-model`.

`navoke.hunyuan.image-to-model` is retired with no alias. Historical runs and artifacts remain;
saved configurations need the new workflow ID/input contract. The separate
`notmonsters.hunyuan-studio` source and installation are unchanged.

Regression coverage lives in the Hunyuan plugin tests and shared plugin package tests. Run
`npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, and `node --check` on all three
extension scripts before handoff. Use live Quads and Original runs with known references to
validate the installed package, registered GLBs, visual identity, diagnostics, and cleanup.

Live verification on 12 September 2026 completed both branches with the installed 0.3.0
package: Quads run `1c0684d4-a1d9-4606-bc8c-347f79a2f1fe` exported 3,388 triangles;
Original run `0e8ad412-697b-4a35-ae16-b2c50f9c7b5e` retained 50,000 triangles. Both exported
three embedded images and closed their windows and Lab sessions. Front/rear renders confirmed
the reference model's identity. Quads introduced gaps in thin shelf surfaces; use Original
when retopology damages thin geometry. These are workflow proofs, not acceptance of every
generated mesh as a production asset.
