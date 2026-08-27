---
name: navoke
description: Use when driving the Navoke browser workflow automation app from the command line with the `navoke` CLI, including listing workflows, preparing JSON inputs, starting runs, watching progress, handling manual waits, resuming, cancelling, and locating artifacts.
---

# Navoke CLI

Use `navoke` only when the Navoke desktop app is already running with a project open. The CLI talks to the app's local API and does not start a separate runtime.

If `navoke` is not on `PATH`, build the CLI and invoke it directly from the repo:

```powershell
npm.cmd run build:cli
node .\dist\cli\index.js <command> ...
```

## Runtime Discovery

Prefer this order:

1. Pass `--api-url <url>` when the user gives an app API URL.
2. Use `NAVOKE_API_URL` when already set.
3. Run inside the project folder or pass `--project <project-dir>` so `navoke` can read `.navoke/runtime.json`.
4. Fall back to the default app API at `http://127.0.0.1:39201` only for read-only discovery commands.

When a project folder is known, check connectivity with that project:

```powershell
navoke --project <project-dir> status
```

All output is JSON. Parse stdout as JSON for normal commands and newline-delimited JSON for `navoke watch`, `navoke run --wait`, or `navoke library run --wait`.

Successful command output includes `runtimeSource` and may include `runtimeFile` or `staleRuntimeFile`. If output shows `runtimeSource: "default"` or a `staleRuntimeFile`, treat the target as ambiguous. Mutating or control commands must not rely on the default port fallback; the CLI refuses `run`, `library run`, `plugin-install`, `pause`, `resume`, `cancel`, and `delete` unless you pass `--project <project-dir>`, pass `--api-url <url>`, or use `NAVOKE_API_URL`.

Exit codes:

- `0`: command succeeded, or a watched run completed.
- `1`: command failed, or a watched run ended in a non-completed state.
- `2`: CLI usage error, including unsafe default-runtime mutation attempts.

## Command Surface

Current commands:

- `navoke help`
- `navoke status`
- `navoke workflows`
- `navoke workflow <workflowId>`
- `navoke run <workflowId> --input <json-file> [--name <name>] [--agent <name>] [--wait]`
- `navoke library`
- `navoke library get <entryId>`
- `navoke library run <entryId> [--name <name>] [--input-overrides <json-file>] [--agent <name>] [--wait]`
- `navoke runs [--active]`
- `navoke get <runId>`
- `navoke watch <runId>`
- `navoke pause <runId>`
- `navoke resume <runId>`
- `navoke cancel <runId>`
- `navoke delete <runId>`
- `navoke plugins`
- `navoke plugin-install <path>`

## Run Workflow

1. List available workflows:

```powershell
navoke --project <project-dir> workflows
```

2. Inspect the chosen workflow manifest and input fields:

```powershell
navoke --project <project-dir> workflow <workflowId>
```

3. Create an input JSON file that matches the workflow schema. The `--input` file path is resolved relative to the shell's current directory, not the Navoke project directory. Use absolute paths for file inputs unless the workflow documentation explicitly accepts relative paths.

4. Start and watch the run:

```powershell
navoke --project <project-dir> run <workflowId> --input input.json --agent codex --wait
```

Use `--name <name>` when a human-readable run name helps identify the output in the UI. Use `--agent <name>` so the UI can show who is driving the run.

## ChatGPT Single Prompt Inputs

For `navoke.chatgpt.extension-image-prompt`, build CLI JSON with a single non-empty `prompt` string. For `navoke.chatgpt.extension-image-prompt-transform`, build CLI JSON with one source image path in `image` plus a single non-empty `prompt` string.

Current extension-backed workflows use `extensionTab`, not the older `chatGptTab` field name. Include `extensionTab` when you need an explicit tab mode or stable routing token. Omitted `extensionTab` defaults to a routed new ChatGPT window.

```json
{
  "image": "C:\\path\\to\\source.png",
  "prompt": "Use the attached source image and generate the requested variation.",
  "extensionTab": { "mode": "new", "routingToken": "replace-with-a-stable-routing-token" }
}
```

The image-plus-prompt workflow uses `image` as a single file path string, not `images` or `sourceImages`. It submits the source image and prompt together once, then expects exactly one generated output image.

## ChatGPT Image Sequence Inputs

For `navoke.chatgpt.extension-image-sequence`, build CLI JSON with one `sourceImages` entry, an optional `masterPrompt`, an optional `masterPromptSuffix`, and a non-empty `prompts` array.

`masterPromptSuffix` is a setup-prompt companion field. It is appended to `masterPrompt` only when both strings are non-empty; it is not a prompt row, and it must not be appended to each `prompts[]` item. The renderer pre-fills this field for UI-created runs, but CLI-created runs only receive the JSON you provide. When setting a non-empty `masterPrompt` and the user has not asked to clear or change the guardrail, include:

```json
{
  "sourceImages": ["C:\\path\\to\\source.png"],
  "masterPrompt": "Use the attached source image as the identity reference for the whole sequence.",
  "masterPromptSuffix": "Only generate images, one at a time, no text responses after the first response to this message. Respond \"Ready\" when you're ready to proceed.",
  "prompts": [
    "Change the perspective to back view. Do not change the character.",
    "Change the perspective to side view. Do not change the character."
  ],
  "extensionTab": { "mode": "new", "routingToken": "replace-with-a-stable-routing-token" }
}
```

If `masterPrompt` is blank, omit `masterPromptSuffix` or set it to an empty string because it has no effect. Prompt 1 uses the source image; each later prompt uses the previous prompt's saved output artifact as its input image.

## Model Renderer Inputs

Install the repo-local model renderer plugin when it is not already listed:

```powershell
navoke --project <project-dir> plugin-install C:\Work\Based.WorkflowAutomation\plugins\navoke-model-renderer
```

For `navoke.model-renderer.render-image`, use a single `modelFile` path to `.obj`, `.fbx`, or `.zip`. Prefer a Hunyuan-style ZIP for textured OBJ assets because the ZIP preserves OBJ, MTL, and texture sidecar names.

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

Run it with:

```powershell
navoke --project <project-dir> run navoke.model-renderer.render-image --input render-model.json --agent codex --wait
```

For `navoke.model-renderer.geometry-bounds`, use:

```json
{
  "modelFile": "C:\\path\\to\\model.fbx"
}
```

The bounds output reports original model-coordinate `min`, `max`, `size`, `center`, `boundingSphere.radius`, `meshCount`, and `vertexCount`. The render workflow normalizes the model only for camera framing; its `distance` input is in normalized render-scene units.

## Plugin Calibration Loop

Use this loop with Workflow Lab when a browser plugin workflow is being built, calibrated, or fixed:

1. Confirm the runtime and workflow manifest with `status`, `workflows`, and `workflow`.
2. Create a stable input JSON file with real absolute file paths. Avoid BOM-encoded JSON when creating files from PowerShell.
3. Start a named run with `--project`, `--input`, `--agent codex`, and `--name`.
4. Watch in bounded chunks. If local `watch` times out, the run may still be active; call `get` or `watch` again.
5. On failure, call `get <runId>` and preserve the exact error, current step, events, artifacts, screenshots, and trace path.
6. Use Workflow Lab or trace snapshots to learn the real page state, then patch the plugin and tests.
7. Rebuild and reload the installed plugin before rerunning. The repo's built `dist` is not automatically the app's installed plugin copy.
8. Rerun from the beginning until the workflow reaches `completed` and the intended artifact is registered.

For plugin reloads, try `navoke --project <project-dir> plugin-install <plugin-dir>` first. If the same plugin version is already installed and the app refuses to overwrite it, uninstall/reinstall through the app API or another supported reload path, then verify the installed plugin entrypoint contains the patched code.

## Monitor And Control

- Active runs: `navoke --project <project-dir> runs --active`
- Run details, events, and artifacts: `navoke --project <project-dir> get <runId>`
- Library entries: `navoke --project <project-dir> library`
- Library entry detail: `navoke --project <project-dir> library get <entryId>`
- Run a library entry: `navoke --project <project-dir> library run <entryId> --agent codex --wait`
- Watch an existing run: `navoke --project <project-dir> watch <runId>`
- Pause/resume/cancel/delete: `navoke --project <project-dir> pause <runId>`, `navoke --project <project-dir> resume <runId>`, `navoke --project <project-dir> cancel <runId>`, `navoke --project <project-dir> delete <runId>`
- Installed plugins: `navoke --project <project-dir> plugins`
- Install a workflow plugin: `navoke --project <project-dir> plugin-install <path>`

`navoke watch` and `navoke run --wait` emit newline-delimited JSON. Event types agents should handle:

- `run.created`: the run was created by `run --wait`.
- `run.snapshot`: initial run, event, and artifact state for a watch stream.
- `event`: workflow event appended during execution.
- `artifact.added`: artifact registration notification.
- `run.updated`: run status, step, or progress changed.
- `manual_action.required`: run entered `waiting_manual` and needs user action.

When a run reaches `waiting_manual` or emits `manual_action.required`, report the current step to the user and wait for them to complete the browser action. After they confirm, call `navoke --project <project-dir> resume <runId>` and continue watching.

## Clean Up After Yourself

Treat browser windows opened during CLI-driven workflow testing as resources you own until the run reaches a terminal state.

- Prefer `navoke run ... --wait` or keep watching with `navoke watch <runId>` until the run is `completed`, `failed`, or `cancelled`.
- If you stop working on a queued, running, or waiting run, call `navoke --project <project-dir> cancel <runId>` before moving on.
- Workflows that open routed browser tabs through the Navoke controller should close their own run-owned tabs at terminal cleanup. Do not close user-selected existing tabs.
- If you manually open a browser window outside Navoke workflow control, close it manually once it is no longer needed.
- Do not close a window while the run is in `waiting_manual`; the user may need it for login, verification, account checks, or site access setup.
- After a cancelled or failed calibration run, call `navoke --project <project-dir> get <runId>` first if you still need artifacts, screenshots, events, or trace paths for debugging.

## Artifacts

Use `navoke --project <project-dir> get <runId>` after completion. Artifact records include the local artifact path, kind, MIME type, and metadata. Prefer returning artifact paths and a short summary rather than copying file contents.

For downloaded archives, inspect the archive listing when it matters to the user's goal:

```powershell
tar -tf <artifact.zip>
```

Report the model/download artifact id, local artifact path, and key contents such as `.obj`, `.mtl`, textures, or manifests.

## Safety

Do not automate around human verification, CAPTCHA, login checks, account checks, or target-site access controls. Treat those as manual states and use resume only after the user completes them.
