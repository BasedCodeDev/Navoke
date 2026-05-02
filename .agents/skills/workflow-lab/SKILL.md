---
name: workflow-lab
description: Use when designing, debugging, or extending Workflow Lab in the Browser Workflow Automation repo, especially for inspecting browser pages, calibrating selectors, testing extension-backed ChatGPT tabs, adding Lab actions or wait conditions, or turning Lab observations into robust automation workflow code.
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
- `extension/chatgpt-controller/content.js`: extension-side inspect/action/wait implementation.
- `tests/unit/workflowLab*.test.ts`: Lab inspection, waits, and staged-file coverage.
- `tests/unit/extensionBridge.test.ts`: extension command queue coverage.

## Lab Modes

- Use `extension` mode when the workflow must run in the user's normal browser account session, such as ChatGPT.
- Use `playwright` mode when a separate automation profile is acceptable and Playwright can own the page.
- For extension mode, require a compatible connected tab. If protocol versions differ, bump/reload the unpacked extension and refresh the target tab instead of trying to work around stale content scripts.

## Investigation Loop

1. Start or select a Lab session for the target page.
2. Use Inspect to capture body text, interactive elements, image fingerprints, and selector candidates.
3. Probe one action at a time: click, fill, submit, or attach-file.
4. Use wait probes to model real transitions instead of adding fixed sleeps.
5. Capture before, during, and after states for long-running operations.
6. Translate proven selectors and wait predicates into workflow or extension code.
7. Add unit coverage for the reusable wait/action logic before handing off.

## Wait Conditions

Supported wait kinds:

- `element`: visible, hidden, enabled, disabled.
- `text`: present or absent in visible body text.
- `image-count`: new image fingerprints compared with a previous baseline.
- `stop-button`: generation running/completed signal.
- `chatgpt-submit-ready`: ChatGPT-specific composer, submit, stop-button, file-input, image-count, and visible-button diagnostics.
- `network-idle`: coarse page readiness only; avoid using it as proof of generation completion.

Prefer semantic wait conditions over sleeps. A bounded poll with diagnostics is acceptable; an unbounded wait is not.

## File Attachment

For Playwright sessions, `attach-file` maps directly to `page.locator(selector).setInputFiles(filePaths)`.

For extension sessions, Electron stages selected files behind `/api/lab/sessions/:id/files/:fileId`; the extension fetches those blobs and assigns them to the target page file input. Keep this path aligned with the real workflow upload path so Lab probes exercise the same browser behavior.

## ChatGPT Sequential Image Workflows

Use Workflow Lab to validate these states before changing the ChatGPT extension workflow:

- idle composer state
- reference upload processing
- master-prompt submitted state
- subject upload processing
- generation running with stop button visible
- completed generation with stop button hidden and stable new image fingerprints

For ChatGPT submit readiness, do not fail just because the submit button remains disabled after upload. Wait through upload and processing states, report diagnostics after slow waits, and fail only after a longer bounded timeout. If ChatGPT refuses an image-only subject because submit never enables, surface a clear message suggesting a short per-subject instruction.

Never add logic intended to bypass human verification, CAPTCHA, account checks, or site access controls. Treat those as manual states.

## Adding Lab Capabilities

When adding a new action or wait condition:

1. Update shared renderer/main types in `src/renderer/lib/api.ts` and `src/main/lab/waitConditions.ts`.
2. Implement Playwright behavior in `src/main/lab/workflowLab.ts` when applicable.
3. Implement extension behavior in `extension/chatgpt-controller/content.js` when applicable.
4. Wire the UI in `src/renderer/App.tsx`.
5. Add API routes in `src/main/api/server.ts` only if the capability needs new staged resources or transport.
6. Add focused unit tests for predicates, command payloads, staged resources, or inspection parsing.
7. If the extension protocol changes, bump `CHATGPT_EXTENSION_PROTOCOL_VERSION` in main, content, and popup scripts, and bump `extension/chatgpt-controller/manifest.json`.

## Verification

Run the relevant subset, and run all of these before handing off Lab behavior changes:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --check extension\chatgpt-controller\content.js
node --check extension\chatgpt-controller\popup.js
```

If `npm.cmd test` or `npm.cmd run build` fails with `spawn EPERM` under sandboxing, rerun the same command with escalation so Vitest/Vite/esbuild can spawn their helper process.
