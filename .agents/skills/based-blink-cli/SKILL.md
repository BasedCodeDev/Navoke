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
4. Fall back to the default app API at `http://127.0.0.1:39201`.

Check connectivity first:

```powershell
blink status
```

All output is JSON. Parse stdout as JSON for normal commands and newline-delimited JSON for `blink watch` or `blink run --wait`.

## Run Workflow

1. List available workflows:

```powershell
blink workflows
```

2. Inspect the chosen workflow manifest and input fields:

```powershell
blink workflow <workflowId>
```

3. Create an input JSON file that matches the workflow schema. Use absolute paths for file inputs unless the workflow documentation explicitly accepts relative paths.

4. Start and watch the run:

```powershell
blink run <workflowId> --input input.json --agent codex --wait
```

Use `--name <name>` when a human-readable run name helps identify the output in the UI. Use `--agent <name>` so the UI can show who is driving the run.

## Monitor And Control

- Active runs: `blink runs --active`
- Run details, events, and artifacts: `blink get <runId>`
- Watch an existing run: `blink watch <runId>`
- Pause/resume/cancel/delete: `blink pause <runId>`, `blink resume <runId>`, `blink cancel <runId>`, `blink delete <runId>`

When a run reaches `waiting_manual`, report the current step to the user and wait for them to complete the browser action. After they confirm, call `blink resume <runId>` and continue watching.

## Artifacts

Use `blink get <runId>` after completion. Artifact records include the local artifact path, kind, MIME type, and metadata. Prefer returning artifact paths and a short summary rather than copying file contents.

## Safety

Do not automate around human verification, CAPTCHA, login checks, account checks, or target-site access controls. Treat those as manual states and use resume only after the user completes them.
