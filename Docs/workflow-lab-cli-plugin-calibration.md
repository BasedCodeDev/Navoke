# Workflow Lab And BLINK CLI Plugin Calibration Loop

## Purpose

Use this loop when building or hardening a browser workflow plugin against a real target site. Workflow Lab is the microscope for learning page state, selectors, uploads, waits, and trace evidence. The BLINK CLI is the repeatable run harness that proves the installed plugin works in the real app runtime and produces artifacts.

The important pattern is not "try a selector and hope". It is:

1. Run the real workflow through BLINK CLI.
2. Capture the exact failure, trace, screenshot, run state, and artifact metadata.
3. Use Workflow Lab or trace snapshots to learn the actual DOM and transition state.
4. Patch the plugin, renderer preset, and focused tests.
5. Rebuild, reload the installed plugin, and rerun until the final artifact is produced.

The Hunyuan image-to-model automation notes in [Hunyuan Image-To-Model OBJ Automation](./hunyuan-image-to-model-automation.md) are the concrete case study this loop came from.

## When To Use This

Use this loop when:

- A plugin workflow depends on a browser UI that can change.
- The workflow is blocked by selector configuration, hidden duplicate controls, disabled controls, modal state, generation state, export menus, or downloads.
- A workflow succeeds manually but fails under automation.
- A plugin has been changed locally and must be proven against the installed app copy.

Do not use this loop to bypass login, CAPTCHA, bot checks, paid-account checks, or target-site access controls. Workflows should pause with `ctx.waitForManualAction()` for those states.

## Responsibilities

Workflow Lab owns discovery:

- Inspect live pages using the same profile as the workflow when session state matters.
- Probe individual actions: click, fill, attach-file, and waits.
- Capture body text, interactive elements, screenshots, and selector candidates.
- Use trace snapshots when a run failed after the browser was closed.
- Turn observations into selectors and semantic waits.

BLINK CLI owns proof:

- Confirm the app runtime and project with `blink --project <project-dir> status`.
- Inspect workflow manifests with `blink --project <project-dir> workflow <workflowId>`.
- Start named runs with concrete input JSON.
- Watch progress as newline-delimited JSON.
- Fetch run details, events, artifacts, and errors.
- Reload or reinstall the plugin before rerunning.
- Confirm the final artifact path and contents.

## Loop

1. Identify the project runtime:

```powershell
blink.cmd --project <project-dir> status
blink.cmd --project <project-dir> workflows
blink.cmd --project <project-dir> workflow <workflowId>
```

2. Create a concrete input JSON file.

Use real input files and absolute paths. Keep the input stable across reruns so selector and wait changes are the only variable. If PowerShell writes the JSON, use an encoding that does not add a BOM.

For `based-blink.chatgpt.extension-image-sequence`, remember that CLI input does not inherit renderer prefilled values. If you provide a non-empty `masterPrompt` and want the standard image-only setup guardrail, include `masterPromptSuffix` explicitly:

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

The suffix is appended only to `masterPrompt` during setup. It is not a `prompts[]` entry, and it has no effect when the setup prompt is blank.

For one-off ChatGPT image generation, use `based-blink.chatgpt.extension-image-prompt` with a single `prompt` string, or `based-blink.chatgpt.extension-image-prompt-transform` with a single image path in `image` plus `prompt`:

```json
{
  "image": "C:\\path\\to\\source.png",
  "prompt": "Use the attached source image and generate the requested variation.",
  "extensionTab": { "mode": "new", "routingToken": "replace-with-a-stable-routing-token" }
}
```

When debugging the image-plus-prompt workflow in Lab, verify the submitted upload preview and the generated assistant image separately; capture logic should register only the assistant output.

3. Run the installed plugin:

```powershell
blink.cmd --project <project-dir> run <workflowId> --input <input.json> --agent codex --name "<short calibration name>"
blink.cmd --project <project-dir> watch <runId>
```

Use `watch` in bounded chunks for long generations. If it times out locally, the workflow can still be running; call `get` or `watch` again.

4. On failure, collect evidence:

```powershell
blink.cmd --project <project-dir> get <runId>
```

Record:

- run id
- current step and progress
- full error text
- screenshot and trace artifact paths
- selectors involved
- the last successful workflow event

5. Learn the page state.

Prefer Workflow Lab for a live page. Use the same browser profile owner/name as the workflow if login state or target state matters. If the run already closed, inspect Playwright trace snapshots. Look for the actual visible, enabled, user-clickable element, not just matching text.

6. Patch narrowly.

Update:

- plugin source defaults and helpers
- renderer selector preset JSON, if the UI exposes those defaults
- unit tests for selector shape or helper behavior
- workflow documentation when a behavior is learned

Good selector fixes are scoped to a stable nearby panel or workflow phase. Avoid global `text=` selectors when the page has duplicate hidden text. Prefer selectors that encode the control type, panel, and visible/enabled state.

7. Verify locally:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --check extension\content.js
node --check extension\popup.js
node --check extension\background.js
```

If Vitest or Vite fails with `spawn EPERM` under sandboxing, rerun that same command with the required escalation so esbuild can spawn its helper process.

8. Reload the installed plugin.

Build output under the repo is not automatically the app's installed plugin copy. Prefer the app API or CLI install path that reloads the plugin registry. If an install command reports that the same version is already installed, uninstall/reinstall the version through the app API or another supported reload path, then verify the installed `dist/index.js` contains the patched selector or helper.

9. Rerun from the beginning.

Do not assume a downstream selector works because an upstream fix worked. Continue rerunning the real workflow until it reaches `completed` and produces the intended artifact.

10. Close the loop.

After success, fetch the run detail and record:

- final run id
- model/download artifact id
- local artifact path
- artifact MIME/kind
- important metadata, such as export format and phase timings
- archive contents when the download is a ZIP

## Selector Patterns That Survived Real Runs

- Target the clickable control or a clickable ancestor, not an inner text span.
- Count candidates, visible candidates, enabled candidates, disabled candidates, and clickable ancestors in failure diagnostics.
- Save a screenshot before throwing configuration errors when the page state is actionable.
- Scope repeated controls by nearby headings or panels.
- Treat a ready button that existed before a click as ambiguous. For generated phases, first verify that the action entered a running state, then wait for readiness.
- Keep default selectors mergeable with Workflow Lab overrides.
- Keep renderer presets synchronized with plugin defaults.

## Download Patterns

- Use Playwright download events around the final click.
- Select export format before creating the download promise.
- Some UI libraries use different components for similar dropdowns. Inspect the final menu: a model selector might use `li.t-select-option`, while export might use `li.t-dropdown__item`.
- Register both the downloaded artifact and a manifest JSON artifact when possible.

## Safety

Human verification and account checks are manual states. Detect an existing login session when possible, but do not add bypass logic. If the target page asks for verification, pause the workflow and let the user complete it.
