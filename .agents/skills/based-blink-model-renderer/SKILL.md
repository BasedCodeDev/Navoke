---
name: based-blink-model-renderer
description: Use when working with the Based BLINK model renderer plugin, including rendering OBJ/FBX/Hunyuan ZIP model inputs to PNG images, extracting geometry bounds, preparing CLI inputs for `based-blink.model-renderer.render-image` or `based-blink.model-renderer.geometry-bounds`, and interpreting model render artifacts.
---

# Based BLINK Model Renderer

Use the BLINK CLI skill for runtime discovery, plugin installation, watching runs, and artifact lookup. This skill only covers the model renderer workflow inputs and artifact expectations.

## Workflows

- `based-blink.model-renderer.render-image`: render a model input to a PNG image artifact.
- `based-blink.model-renderer.geometry-bounds`: return original model-coordinate geometry bounds as JSON.

Both workflows accept `modelFile` as a single absolute path to `.obj`, `.fbx`, or `.zip`.

## Model Inputs

- Prefer `.zip` for textured OBJ assets. The ZIP should contain exactly one `.obj` plus sibling `.mtl` and texture files, matching the Hunyuan model archive shape.
- Use a single `.obj` only when sidecar materials/textures are not required.
- Use `.fbx` for single-file FBX assets. Embedded FBX materials are best; external FBX texture sidecars are not a v1 input shape.
- Reject archives with zero model files or multiple `.obj`/`.fbx` files.

## Render Image Input

Use degrees for Euler `XYZ` camera rotation. The model is centered and scaled for rendering, so `distance` is in normalized render-scene units rather than original model units.

```json
{
  "modelFile": "C:\\path\\to\\hunyuan-model.zip",
  "rotationX": 20,
  "rotationY": 35,
  "rotationZ": 0,
  "distance": 3.2,
  "width": 1024,
  "height": 1024,
  "backgroundColor": ""
}
```

Leave `backgroundColor` empty for transparent PNG output, or use a CSS color such as `#ffffff`.

The PNG renderer uses camera-attached studio lighting and applies a small preview normalization to near-black imported materials. This keeps models inspectable from any requested camera angle; it is not intended as a physically faithful material render.

## Bounds Input

```json
{
  "modelFile": "C:\\path\\to\\model.fbx"
}
```

The bounds workflow reports `min`, `max`, `size`, `center`, `boundingSphere.radius`, `meshCount`, `vertexCount`, and `modelFormat` in the model's original coordinate system.

## Artifacts

- Render runs produce a primary `image` artifact named `model-render.png`, a `json` metadata artifact, and a supporting prepared `model` artifact.
- Bounds runs produce a `json` artifact named `model-bounds.json` and a supporting prepared `model` artifact.
- For OBJ ZIP inputs, model artifact metadata follows the Hunyuan-compatible shape: `modelFormat`, `objFileName`, `mtlFileName`, `textureFileNames`, and `assetFileNames`.
