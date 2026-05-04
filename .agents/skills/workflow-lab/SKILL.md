---
name: workflow-lab
description: Use when designing, debugging, or extending Workflow Lab in the Browser Workflow Automation repo, especially for inspecting browser pages, calibrating selectors, testing generic extension-backed browser tabs, adding Lab actions or wait conditions, or turning Lab observations into robust automation workflow code.
---

# Workflow Lab

Workflow Lab is the repo's interactive harness for learning a target site's DOM, testing selectors, and proving wait logic before changing a workflow. Use it when a browser workflow fails because the page state, selector, upload behavior, generation state, or output detection is unclear.

## Key Files

- `src/main/lab/workflowLab.ts`: session lifecycle, Playwright and extension Lab actions, staged files, wait execution.
- `src/main/lab/waitConditions.ts`: first-class wait condition types and shared predicate evaluation.
- `src/main/lab/pageInspection.ts`: DOM sanitization, interactive element modeling, selector candidate generation.
- `src/main/api/server.ts`: `/api/lab/*` routes and extension Lab command routes.
- `src/renderer/App.tsx`: Workflow Lab UI.
- `src/renderer/lib/api.ts`: renderer-side Lab types and API helpers.
- `src/main/extension/extensionBridge.ts`: extension Lab command queue and protocol version.
- `extension/content.js`: extension-side inspect/action/wait implementation.
- `tests/unit/workflowLab*.test.ts`: Lab inspection, waits, and staged-file coverage.
- `tests/unit/extensionBridge.test.ts`: extension command queue coverage.

## Lab Modes

- Use `extension` mode when the workflow must run in the user's normal browser account session.
- Use `playwright` mode when a separate automation profile is acceptable and Playwright can own the page.
- For extension mode, require a compatible connected tab. If protocol versions differ, bump/reload the unpacked extension and refresh the target tab instead of trying to work around stale content scripts.

## Investigation Loop

1. Start or select a Lab session for the target page.
2. Use Inspect to capture body text, interactive elements, image fingerprints, and selector candidates.
3. Probe one action at a time: click, fill, submit, or attach-file.
4. Use wait probes to model real transitions instead of adding fixed sleeps.
5. Capture before, during, and after states for long-running operations.
6. Translate proven selectors and wait predicates into plugin workflow/controller code.
7. Add unit coverage for the reusable wait/action logic before handing off.

## Pairing With BLINK CLI

Workflow Lab learns the page; the BLINK CLI proves the installed workflow. Use both for browser plugin calibration:

1. Run the workflow through `blink --project <project-dir> run ...` with real input files.
2. Watch progress until the run completes or fails.
3. On failure, use `blink --project <project-dir> get <runId>` to capture the exact step, error, screenshot artifacts, trace artifact, and selector key involved.
4. Use Workflow Lab against the live target page when it is still open. Match the workflow's browser profile owner/name when login or generated page state matters.
5. If the workflow closed the browser, inspect the Playwright trace snapshots from the failed run and reproduce the relevant state in Lab when possible.
6. Patch the workflow defaults/helpers and renderer preset, add focused tests, rebuild, reload the installed plugin, and rerun with BLINK CLI.

This loop should continue until a real run produces the intended artifact. A selector is not considered calibrated just because it matches once in isolation; it must work in the workflow phase where the automation uses it.

## Trace-Backed Calibration

When a run fails after the browser closes, use the trace as the page-state source of truth:

- Look at the snapshot immediately before the failed action.
- Find the actual visible, enabled, user-clickable element or its clickable ancestor.
- Compare similar controls; one part of the site may use `t-select` options while another uses `t-dropdown` items.
- Prefer selectors scoped by nearby headings, panels, or workflow phase containers.
- Avoid hidden duplicate text and inner spans unless the helper intentionally walks to a clickable ancestor.
- Capture the learned selector shape in tests and documentation.

Good failures include diagnostics: selector key, selector text, candidate count, visible count, enabled count, ancestor candidates, and a calibration screenshot when possible.

## Browser Plugin Calibration Patterns

- Use persistent Playwright profiles for workflows that need login/session reuse.
- Detect an already logged-in state and continue automatically, but pause for real account checks.
- For uploads, use Lab `attach-file` with the same input slots and file types as the workflow.
- For action buttons, handle disabled-but-visible controls explicitly.
- For generated phases, verify the click entered a running state before accepting a ready state. Some ready controls are visible before the action has been started.
- For downloads, inspect the export dropdown/menu in the final page state and wrap the final click with a Playwright download event.

## Wait Conditions

Supported wait kinds:

- `element`: visible, hidden, enabled, disabled.
- `text`: present or absent in visible body text.
- `image-count`: new image fingerprints compared with a previous baseline.
- `url`: URL matching for navigation checkpoints.
- `document-ready`: page readiness based on `document.readyState`.
- `network-idle`: coarse page readiness only; avoid using it as proof of generation completion.

Prefer semantic wait conditions over sleeps. A bounded poll with diagnostics is acceptable; an unbounded wait is not.

## File Attachment

For Playwright sessions, `attach-file` maps directly to `page.locator(selector).setInputFiles(filePaths)`.

For extension sessions, Electron stages selected files behind `/api/lab/sessions/:id/files/:fileId`; the extension fetches those blobs and assigns them to the target page file input. Keep this path aligned with the real workflow upload path so Lab probes exercise the same browser behavior.

## Site-Specific Plugin Controllers

Use Workflow Lab to validate target-site states before changing a plugin controller:

- logged-out and authenticated states
- upload controls and post-upload processing
- submit/generate controls
- running and ready states
- output extraction and download controls

Site-specific URLs, selectors, readiness rules, and output extraction belong in plugins. The browser extension should stay a generic command executor.

Never add logic intended to bypass human verification, CAPTCHA, account checks, or site access controls. Treat those as manual states.

## Adding Lab Capabilities

When adding a new action or wait condition:

1. Update shared renderer/main types in `src/renderer/lib/api.ts` and `src/main/lab/waitConditions.ts`.
2. Implement Playwright behavior in `src/main/lab/workflowLab.ts` when applicable.
3. Implement extension behavior in `extension/content.js` only when adding a generic browser primitive.
4. Wire the UI in `src/renderer/App.tsx`.
5. Add API routes in `src/main/api/server.ts` only if the capability needs new staged resources or transport.
6. Add focused unit tests for predicates, command payloads, staged resources, or inspection parsing.
7. If the extension protocol changes, bump `BLINK_EXTENSION_PROTOCOL_VERSION` in main, content, and popup scripts, and bump `extension/manifest.json`.

## Verification

Run the relevant subset, and run all of these before handing off Lab behavior changes:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --check extension\content.js
node --check extension\popup.js
node --check extension\background.js
```

If `npm.cmd test` or `npm.cmd run build` fails with `spawn EPERM` under sandboxing, rerun the same command with escalation so Vitest/Vite/esbuild can spawn their helper process.
