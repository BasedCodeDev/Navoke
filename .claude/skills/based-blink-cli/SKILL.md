---
name: based-blink-cli
description: Use when driving the Based BLINK browser workflow automation app from the command line with the `blink` CLI, including listing workflows, preparing JSON inputs, starting runs, watching progress, handling manual waits, resuming, cancelling, and locating artifacts.
---

# Based BLINK CLI

Use `blink` only when the Based BLINK desktop app is already running with a project open. The CLI talks to the app's local API and does not start a separate runtime.

## Runtime Discovery

Prefer this order:

1. Pass `--api-url <url>` when the user gives an app API URL.
2. Use `BASED_BLINK_API_URL` when already set.
3. Run inside the project folder or pass `--project <project-dir>` so `blink` can read `.blink/runtime.json`.
4. Fall back to the default app API at `http://127.0.0.1:39201` only for read-only discovery commands.

When a project folder is known, check connectivity with that project:

```powershell
blink --project <project-dir> status
```

All output is JSON. Parse stdout as JSON for normal commands and newline-delimited JSON for `blink watch` or `blink run --wait`.

Mutating or control commands must not rely on the default port fallback. For `run`, `plugin-install`, `pause`, `resume`, `cancel`, and `delete`, pass `--project <project-dir>`, pass `--api-url <url>`, or use `BASED_BLINK_API_URL`.

## Run Workflow

1. List available workflows:

```powershell
blink --project <project-dir> workflows
```

2. Inspect the chosen workflow manifest and input fields:

```powershell
blink --project <project-dir> workflow <workflowId>
```

3. Create an input JSON file that matches the workflow schema. Use absolute paths for file inputs unless the workflow documentation explicitly accepts relative paths.

4. Start and watch the run:

```powershell
blink --project <project-dir> run <workflowId> --input input.json --agent claude --wait
```

Use `--name <name>` when a human-readable run name helps identify the output in the UI. Use `--agent <name>` so the UI can show who is driving the run.

## ChatGPT Image Sequence Inputs

For `based-blink.chatgpt.extension-image-sequence`, build CLI JSON with one `sourceImages` entry, an optional `masterPrompt`, an optional `masterPromptSuffix`, and a non-empty `prompts` array.

`masterPromptSuffix` is a setup-prompt companion field. It is appended to `masterPrompt` only when both strings are non-empty; it is not a prompt row, and it must not be appended to each `prompts[]` item. The renderer pre-fills this field for UI-created runs, but CLI-created runs only receive the JSON you provide. When setting a non-empty `masterPrompt` and the user has not asked to clear or change the guardrail, include:

```json
{
  "sourceImages": ["C:\\path\\to\\source.png"],
  "masterPrompt": "Use the attached source image as the identity reference for the whole sequence.",
  "masterPromptSuffix": "Only generate images, one at a time, no text responses after the first response to this message. Respond \"Ready\" when you're ready to proceed.",
  "prompts": [
    "Change the perspective to back view. Do not change the character.",
    "Change the perspective to side view. Do not change the character."
  ]
}
```

If `masterPrompt` is blank, omit `masterPromptSuffix` or set it to an empty string because it has no effect. Prompt 1 uses the source image; each later prompt uses the previous prompt's saved output artifact as its input image.

## Plugin Calibration Loop

Use this loop with Workflow Lab when a browser plugin workflow is being built, calibrated, or fixed:

1. Confirm the runtime and workflow manifest with `status`, `workflows`, and `workflow`.
2. Create a stable input JSON file with real absolute file paths. Avoid BOM-encoded JSON when creating files from PowerShell.
3. Start a named run with `--project`, `--input`, `--agent claude`, and `--name`.
4. Watch in bounded chunks. If local `watch` times out, the run may still be active; call `get` or `watch` again.
5. On failure, call `get <runId>` and preserve the exact error, current step, events, artifacts, screenshots, and trace path.
6. Use Workflow Lab or trace snapshots to learn the real page state, then patch the plugin and tests.
7. Rebuild and reload the installed plugin before rerunning. The repo's built `dist` is not automatically the app's installed plugin copy.
8. Rerun from the beginning until the workflow reaches `completed` and the intended artifact is registered.

For plugin reloads, try `blink --project <project-dir> plugin-install <plugin-dir>` first. If the same plugin version is already installed and the app refuses to overwrite it, uninstall/reinstall through the app API or another supported reload path, then verify the installed plugin entrypoint contains the patched code.

## Monitor And Control

- Active runs: `blink --project <project-dir> runs --active`
- Run details, events, and artifacts: `blink --project <project-dir> get <runId>`
- Watch an existing run: `blink --project <project-dir> watch <runId>`
- Pause/resume/cancel/delete: `blink --project <project-dir> pause <runId>`, `blink --project <project-dir> resume <runId>`, `blink --project <project-dir> cancel <runId>`, `blink --project <project-dir> delete <runId>`
- Install a workflow plugin: `blink --project <project-dir> plugin-install <path>`

When a run reaches `waiting_manual`, report the current step to the user and wait for them to complete the browser action. After they confirm, call `blink --project <project-dir> resume <runId>` and continue watching.

## Artifacts

Use `blink --project <project-dir> get <runId>` after completion. Artifact records include the local artifact path, kind, MIME type, and metadata. Prefer returning artifact paths and a short summary rather than copying file contents.

For downloaded archives, inspect the archive listing when it matters to the user's goal:

```powershell
tar -tf <artifact.zip>
```

Report the model/download artifact id, local artifact path, and key contents such as `.obj`, `.mtl`, textures, or manifests.

## Safety

Do not automate around human verification, CAPTCHA, login checks, account checks, or target-site access controls. Treat those as manual states and use resume only after the user completes them.
