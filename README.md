# Based BLINK

Browser Linked Interaction Navigation Kit.

Local Electron app for durable browser-driven workflows. The first implementation includes:

- Electron + React + Vite + TypeScript desktop shell.
- Local API server with SSE progress events.
- SQLite-compatible local metadata store via `sql.js`.
- SQLite-backed local workflow runner.
- Playwright browser harness with persistent profiles, traces, screenshots, uploads, downloads, and manual-resume checkpoints.
- Code-first workflow registry with Playwright workflows and generic browser-extension-backed plugin workflows using configurable selectors.

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

If `blink` is not recognized after linking, add npm's global prefix to your user `PATH`, then open a new terminal:

```powershell
$npmGlobal = npm.cmd prefix -g
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";$npmGlobal",
  "User"
)
```

For one-off use without linking or changing `PATH`, run `node .\dist\cli\index.js workflows` after `npm.cmd run build:cli`.

Runtime discovery uses this order:

1. `--api-url <url>`
2. `BASED_BLINK_API_URL`
3. `.blink/runtime.json` from `--project <project-dir>` or the nearest parent project folder
4. `http://127.0.0.1:39201`

Read-only commands may use the default port fallback. Commands that start or control work (`run`, `plugin-install`, `pause`, `resume`, `cancel`, and `delete`) require an explicit target runtime through `--project <project-dir>`, `--api-url <url>`, or `BASED_BLINK_API_URL`. Agents should prefer `--project <project-dir>` so runs attach to the BLINK app that opened that project.

Common commands:

```powershell
blink workflows
blink workflow <workflowId>
blink --project <project-dir> run <workflowId> --input input.json --name "Run name" --agent codex --wait
blink runs --active
blink get <runId>
blink watch <runId>
blink --project <project-dir> pause <runId>
blink --project <project-dir> resume <runId>
blink --project <project-dir> cancel <runId>
blink --project <project-dir> delete <runId>
blink plugins
blink --project <project-dir> plugin-install C:\path\to\plugin
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

For `based-blink.chatgpt.extension-image-sequence`, the CLI input should treat `masterPromptSuffix` as part of the optional setup prompt, not as a sequence prompt. The renderer pre-fills this value when a setup prompt is entered, but CLI runs only receive what is present in the JSON input. When `masterPrompt` is non-empty and you want image-only sequence behavior, include the suffix explicitly:

```json
{
  "sourceImages": ["C:\\path\\to\\character.png"],
  "masterPrompt": "Use the attached source image as the identity reference for the whole sequence.",
  "masterPromptSuffix": "Only generate images, one at a time, no text responses after the first response to this message. Respond \"Ready\" when you're ready to proceed.",
  "prompts": [
    "Change the perspective to back view. Do not change the character.",
    "Change the perspective to side view. Do not change the character."
  ],
  "extensionTab": { "mode": "new", "routingToken": "replace-with-a-stable-routing-token" }
}
```

The workflow appends `masterPromptSuffix` to `masterPrompt` only when both are non-empty. It does not append the suffix to each item in `prompts`, and it has no effect when the setup prompt is blank.

If a run reaches `waiting_manual`, complete the requested browser action in the app or target browser, then run `blink --project <project-dir> resume <runId>` and continue watching.

### Agent Skill

The repo includes agent skill copies at `.agents/skills/based-blink-cli` and `.claude/skills/based-blink-cli`. To make the skill available from another project, copy the appropriate folder into that repo's agent skill directory. For Claude Code, use `.claude/skills/based-blink-cli`; for other agent environments, use their supported project or global skills directory.

For per-user global install across projects:

```powershell
# Codex: use CODEX_HOME when set; otherwise use ~/.codex
$codexSkills = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME "skills" } else { Join-Path $HOME ".codex\skills" }
New-Item -ItemType Directory -Force $codexSkills | Out-Null
Copy-Item -Recurse -Force ".agents\skills\based-blink-cli" (Join-Path $codexSkills "based-blink-cli")

# Claude Code: personal skills live under ~/.claude/skills
$claudeSkills = Join-Path $HOME ".claude\skills"
New-Item -ItemType Directory -Force $claudeSkills | Out-Null
Copy-Item -Recurse -Force ".claude\skills\based-blink-cli" (Join-Path $claudeSkills "based-blink-cli")
```

The skill only teaches agents how to use the CLI. The `blink` command itself must still be built and linked or otherwise available on `PATH`.

## Selector Calibration

Browser workflow selectors should be calibrated with Workflow Lab and proven through the installed app runtime with the BLINK CLI. The repeatable loop is documented in [Workflow Lab And BLINK CLI Plugin Calibration Loop](Docs/workflow-lab-cli-plugin-calibration.md).

```powershell
blink --project <project-dir> run <workflowId> --input input.json --agent codex --name "Selector calibration"
blink --project <project-dir> watch <runId>
blink --project <project-dir> get <runId>
```

Use Workflow Lab or the run trace to inspect the exact failed page state, update plugin defaults and tests, reload the installed plugin, then rerun until the workflow produces the intended artifact. Account-session work can use the generic Chrome extension described below rather than Playwright.

## Adding Workflows

See `AGENTS.md` for the workflow authoring contract, registration steps, artifact rules, extension bridge pattern, and verification checklist.

## Browser Controller Extension

For workflows that need the user's normal Chrome account session, install the companion browser-controller extension into that Chrome profile:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repo's `extension` folder.
5. Run the Electron app with `npm.cmd run dev`.
6. Open or let BLINK route the target site in that Chrome profile.
7. In the app, choose a workflow that declares the generic browser-extension capability.

The extension is site-agnostic. Plugins own target URLs, selectors, waits, upload sequencing, extraction rules, and manual-action handling, then drive the page through generic browser commands.

The extension defaults to `http://127.0.0.1:39201`. If the app falls back to another API port, copy the API URL shown in the app's Local Runtime panel into the extension popup.

This extension does not bypass human verification. If a site asks you to verify, complete that manually in the same Chrome tab and retry or resume the workflow.
