# Based BLINK

Browser Linked Interaction Navigation Kit.

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

## CLI

The app ships a JSON-only command line interface named `blink`. It controls the currently running desktop app through the local API, so open the Electron app and a project before using CLI commands.

Build and link the local CLI once:

```powershell
npm.cmd install
npm.cmd run build:cli
npm.cmd link
```

Open a new terminal, then check the runtime:

```powershell
blink status
```

For one-off use without linking, run `node .\dist\cli\index.js workflows` after `npm.cmd run build:cli`. If `blink` is not recognized after linking, add the npm global prefix from `npm.cmd prefix -g` to your user `PATH`.

Runtime discovery uses this order:

1. `--api-url <url>`
2. `BASED_BLINK_API_URL`
3. `.blink/runtime.json` from `--project <project-dir>` or the nearest parent project folder
4. `http://127.0.0.1:39201`

Common commands:

```powershell
blink workflows
blink workflow <workflowId>
blink run <workflowId> --input input.json --name "Run name" --agent codex --wait
blink runs --active
blink get <runId>
blink watch <runId>
blink pause <runId>
blink resume <runId>
blink cancel <runId>
blink plugins
blink plugin-install C:\path\to\plugin
```

Normal commands print one JSON object. `blink run --wait` and `blink watch` print newline-delimited JSON events so agents and scripts can stream progress. CLI-created runs are tagged with origin metadata, and the UI shows active CLI work in the CLI Agent Activity panel.

For workflow input, create a JSON file that matches the selected workflow's schema. Use `blink workflow <workflowId>` to inspect available input fields, and prefer absolute paths for file inputs:

```json
{
  "images": ["C:\\path\\to\\input.png"],
  "prompt": "Generate the requested output.",
  "profileName": "default",
  "pauseForManualLogin": true
}
```

If a run reaches `waiting_manual`, complete the requested browser action in the app or target browser, then run `blink resume <runId>` and continue watching.

### Agent Skill

The repo includes an agent skill at `.agents/skills/based-blink-cli`. To make it available from any project, copy that folder into your Codex skills directory, usually `~/.codex/skills/based-blink-cli`. For project-local use, copy it into another repo's `.agents/skills/based-blink-cli` folder instead.

The skill only teaches agents how to use the CLI. The `blink` command itself must still be built and linked or otherwise available on `PATH`.

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
4. Select this repo's `extension\chatgpt-controller` folder.
5. Run the Electron app with `npm.cmd run dev`.
6. Open `https://chatgpt.com/` in that Chrome profile and keep the tab open.
7. In the app, choose **ChatGPT Extension Image Transform**.

This workflow sends the master prompt and optional reference images once, waits for ChatGPT to respond, then sends subject images one at a time. Each subject image is saved as a separate output artifact using the subject filename.

The extension defaults to `http://127.0.0.1:39201`. If the app falls back to another API port, copy the API URL shown in the app's Local Runtime panel into the extension popup.

This extension does not bypass human verification. If ChatGPT asks you to verify, complete that manually in the same Chrome tab and retry or resume the workflow.
