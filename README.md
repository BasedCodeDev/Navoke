# Browser Workflow Automation

Local Electron app for durable browser-driven workflows. The first implementation includes:

- Electron + React + Vite + TypeScript desktop shell.
- Local API server with SSE progress events.
- SQLite-compatible local metadata store via `sql.js`.
- SQLite-backed local workflow runner.
- Playwright browser harness with persistent profiles, traces, screenshots, uploads, downloads, and manual-resume checkpoints.
- Code-first workflow registry with Hunyuan browser automation and ChatGPT Chrome-extension automation using configurable selectors.

## Run

```powershell
npm install
npm run dev
```

Runs are persisted locally in SQLite under the app data directory.

## Selector Calibration

The Hunyuan workflow intentionally takes selector JSON from the UI. Use Playwright codegen to capture stable selectors for the current site UI:

```powershell
npx playwright codegen https://3d.hunyuan.tencent.com/
```

Paste the resulting selectors into the workflow's selector config JSON. ChatGPT account-based work uses the Chrome extension described below rather than Playwright.

## Adding Workflows

See `AGENTS.md` for the workflow authoring contract, registration steps, artifact rules, extension bridge pattern, and verification checklist.

## ChatGPT Chrome Extension

For ChatGPT account-based workflows, install the companion extension into the Chrome profile where you normally use ChatGPT:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `C:\Work\Based.WorkflowAutomation\extension\chatgpt-controller`.
5. Run the Electron app with `npm.cmd run dev`.
6. Open `https://chatgpt.com/` in that Chrome profile and keep the tab open.
7. In the app, choose **ChatGPT Extension Image Transform**.

This workflow sends the master prompt and optional reference images once, waits for ChatGPT to respond, then sends subject images one at a time. Each subject image is saved as a separate output artifact using the subject filename.

The extension defaults to `http://127.0.0.1:39201`. If the app falls back to another API port, copy the API URL shown in the app's Local Runtime panel into the extension popup.

This extension does not bypass human verification. If ChatGPT asks you to verify, complete that manually in the same Chrome tab and retry or resume the workflow.
