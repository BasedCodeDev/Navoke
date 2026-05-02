# Workflow Automation Agent Guide

This repo is a local Electron app for browser-based automation workflows. New automations should be code-first TypeScript workflow modules that expose a typed manifest, typed input/output schemas, and a single `run()` function.

## Architecture

- Electron main process owns the local API server, SQLite-compatible metadata store, workflow runner, Playwright harness, and Chrome extension bridge.
- React renderer displays workflow forms, run progress, events, and artifacts.
- Workflows live in `src/main/workflows`.
- Shared workflow contracts live in `src/main/runtime/types.ts`.
- Artifacts are files on disk registered through `ctx.addArtifact()`.
- The unpacked ChatGPT Chrome extension lives in `extension/chatgpt-controller` and communicates with Electron through `http://127.0.0.1:39201` by default.

## Adding a Workflow

1. Create `src/main/workflows/<name>Workflow.ts`.
2. Define a Zod `inputSchema` and `outputSchema`.
3. Export a `WorkflowDefinition<TInput, TOutput>`.
4. Register it in `src/main/workflows/index.ts`.
5. Update renderer form routing in `src/renderer/App.tsx` only if the workflow needs fields not already covered by the generic form.
6. Add or update unit tests in `tests/unit/workflowRegistry.test.ts` and add focused tests for reusable helpers.

Minimum workflow shape:

```ts
import { z } from "zod";
import type { WorkflowDefinition } from "../runtime/types";

const inputSchema = z.object({
  images: z.array(z.string()).min(1),
  prompt: z.string().min(1)
});

const outputSchema = z.object({
  artifactIds: z.array(z.string()),
  summary: z.string()
});

export const exampleWorkflow: WorkflowDefinition<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  manifest: {
    id: "provider.example",
    title: "Provider Example",
    description: "Short user-facing description.",
    category: "utility",
    version: "0.1.0",
    concurrency: 1,
    requiresBrowser: false,
    outputKinds: ["image", "json"],
    inputFields: [
      { name: "images", label: "Input images", type: "fileList", required: true },
      { name: "prompt", label: "Prompt", type: "textarea", required: true }
    ]
  },
  inputSchema,
  outputSchema,
  async run(input, ctx) {
    await ctx.step("Starting", 5);
    await ctx.event("provider.example", "Useful event message");
    return { artifactIds: [], summary: "Done." };
  }
};
```

## Workflow Contract

- `manifest.id` must be stable and unique. Use a namespace like `chatgpt.extension-image-transform` or `hunyuan.image-to-model`.
- `manifest.title` is shown in the workflow dropdown.
- `manifest.concurrency` limits concurrent runs of that workflow.
- `inputSchema` is the source of truth for runtime validation.
- `outputSchema` must match the object returned by `run()`.
- Always check `ctx.signal` indirectly by passing it to long waits where possible.
- Use `ctx.step(message, progress, data)` for user-visible progress.
- Use `ctx.event(type, message, data)` for diagnostics and detailed automation milestones.
- Use `ctx.waitForManualAction(message, data)` for login, verification, CAPTCHA, account checks, or any step requiring the user.

## Artifacts

- Write workflow outputs under `getRunArtifactDir(ctx.paths, ctx.runId)`.
- Register every output the UI should show with `ctx.addArtifact()`.
- Use existing helpers in `src/main/utils/files.ts` for MIME detection, JSON writing, safe names, and copying files.
- Prefer artifact kinds already supported by the UI: `image`, `model`, `download`, `trace`, `screenshot`, `log`, `json`.
- Return `artifactIds` in the workflow output for traceability.

## Playwright Workflows

Use Playwright workflows for sites where a separate automation browser is acceptable.

- Start from `src/main/automation/browserHarness.ts`.
- Use persistent profiles for login/session reuse.
- Set `acceptDownloads: true` and capture downloads through Playwright download events.
- Capture traces with `startTrace()` / `stopTrace()`.
- Capture screenshots before throwing configuration errors.
- Prefer locators, visible text, download events, DOM state, and bounded polling over fixed sleeps.
- Do not bypass human verification, CAPTCHA, bot checks, or site access controls. Pause the workflow and ask the user to complete them.

## Chrome Extension Workflows

Use the Chrome extension path when the workflow must run inside the user's normal browser account session.

- Use `src/main/extension/extensionBridge.ts` for queued extension tasks.
- The extension polls `/api/extension/tasks/next`, fetches input images from `/api/extension/tasks/:id/images/:index`, then posts progress, completion, or failure back to the app.
- Main-process workflows should create extension tasks, subscribe to bridge events, wait for completion, and register returned files as artifacts.
- Extension scripts are plain JavaScript under `extension/chatgpt-controller`; run `node --check` on changed files.
- Keep extension selectors configurable where the target UI may change.
- Never add logic intended to evade human verification. If the site asks for verification, report it and let the user handle it manually in the normal browser tab.

## Workflow Lab

Detailed Workflow Lab guidance lives in `.agents/skills/workflow-lab/SKILL.md`. Use that skill when inspecting pages, calibrating selectors, debugging ChatGPT tab states, adding Lab actions, adding Lab wait conditions, or turning Lab observations into workflow code.

## Renderer Form Wiring

The current generic form supports:

- `images`
- `referenceImages`
- `subjectImages`
- `prompt`
- `masterPrompt`
- `subjectInstruction`
- `modelName`
- `profileName`
- `pauseForManualLogin`
- `selectors` JSON

If a new workflow can fit those fields, add its ID to the routing helpers in `src/renderer/App.tsx`. If it needs new fields, add the UI state, payload construction, and display rules there. Keep workflow-specific UI branching explicit by workflow ID.

## Tests And Verification

Run these before handing off changes:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --check extension\chatgpt-controller\content.js
node --check extension\chatgpt-controller\popup.js
```

When adding a workflow:

- Add registry coverage for the new workflow ID.
- Add schema validation tests for required inputs.
- Add helper tests for parsing, artifact naming, or bridge logic when behavior is non-trivial.
- For browser workflows, test reusable wait/parsing logic with local mocked HTML when possible.

## Safety And Scope

- This is a local-only tool; prefer SQLite/local filesystem over server infrastructure.
- Keep workflow changes scoped. Do not refactor unrelated workflows while adding a new one.
- Respect target sites' terms, rate limits, and account checks.
- If a workflow is blocked by login or verification, make it a manual workflow state rather than a bypass.
