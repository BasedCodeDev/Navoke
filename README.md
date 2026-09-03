# Navoke

**Turn websites into reusable actions.**

Capture once. Reuse whenever. Click to run, or let an agent call it.

[navoke.basedcode.dev](https://navoke.basedcode.dev) · [GitHub](https://github.com/BasedCodeDev/Navoke)

Navoke is a local Electron app for durable browser-driven workflows. The current implementation includes:

- Electron + React + Vite + TypeScript desktop shell.
- Local API server with SSE progress events.
- SQLite-compatible local metadata store via `sql.js`.
- SQLite-backed local workflow runner.
- Playwright browser harness with persistent profiles, traces, screenshots, uploads, downloads, and manual-resume checkpoints.
- Code-first workflow registry with Playwright workflows and generic browser-extension-backed plugin workflows using configurable selectors.

## Run

```text
npm install
npm run dev
```

Project metadata is persisted locally in SQLite under `.navoke`, while each run keeps its own project-root folder and registered artifacts.

## Website

The public Navoke landing page lives in `website` and builds independently from the Electron renderer.

```text
npm run dev:site
npm run build:site
npm run preview:site
```

GitHub Actions deploys the production build to GitHub Pages from `master`. To publish at `navoke.basedcode.dev`:

1. In the repository's **Settings → Pages**, select **GitHub Actions** as the source.
2. Set the custom domain to `navoke.basedcode.dev`.
3. Add a DNS `CNAME` record from `navoke` to `basedcodedev.github.io`.
4. Enable HTTPS after GitHub validates the DNS record.

The Actions-based Pages deployment does not require a repository `CNAME` file.

## CLI

The app ships a JSON-only command line interface named `navoke`. It controls the currently running desktop app through the local API, so open the Electron app and a project before using CLI commands.

Build and link the local CLI once:

```text
npm install
npm run build:cli
npm link
```

Open a new terminal, then check the runtime:

```text
navoke status
```

If `navoke` is not recognized after linking, add npm's global prefix to your user `PATH`, then open a new terminal:

#### Linux

Add npm's global `bin` directory to your shell profile, then load the updated profile:

```bash
npmGlobal="$(npm prefix -g)"
printf '\nexport PATH="%s/bin:$PATH"\n' "$npmGlobal" >> "$HOME/.profile"
. "$HOME/.profile"
```

#### Windows (PowerShell)

```powershell
$npmGlobal = npm.cmd prefix -g
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";$npmGlobal",
  "User"
)
```

For one-off use without linking or changing `PATH`, build the CLI and invoke it directly:

```text
npm run build:cli
node ./dist/cli/index.js workflows
```

Runtime discovery uses this order:

1. `--api-url <url>`
2. `NAVOKE_API_URL`
3. `.navoke/runtime.json` from `--project <project-dir>` or the nearest parent project folder
4. `http://127.0.0.1:39201`

Read-only commands may use the default port fallback. Commands that start or control work (`run`, `plugin-install`, `pause`, `resume`, `cancel`, and `delete`) require an explicit target runtime through `--project <project-dir>`, `--api-url <url>`, or `NAVOKE_API_URL`. Agents should prefer `--project <project-dir>` so runs attach to the Navoke app that opened that project.

Common commands:

```text
navoke workflows
navoke workflow <workflowId>
navoke --project <project-dir> run <workflowId> --input input.json --name "Run name" --agent codex --wait
navoke runs --active
navoke get <runId>
navoke watch <runId>
navoke --project <project-dir> pause <runId>
navoke --project <project-dir> resume <runId>
navoke --project <project-dir> cancel <runId>
navoke --project <project-dir> delete <runId>
navoke plugins
```

Install a plugin from an absolute path:

#### Linux

```bash
navoke --project <project-dir> plugin-install /path/to/plugin
```

#### Windows (PowerShell)

```powershell
navoke --project <project-dir> plugin-install C:\path\to\plugin
```

Normal commands print one JSON object. `navoke run --wait` and `navoke watch` print newline-delimited JSON events so agents and scripts can stream progress. CLI-created runs are tagged with origin metadata, and the UI shows active CLI work in the CLI Agent Activity panel.

For workflow input, create a JSON file that matches the selected workflow's schema. Use `navoke workflow <workflowId>` to inspect available input fields, and prefer absolute paths for file inputs:

#### Linux

```json
{
  "images": ["/path/to/input.png"],
  "prompt": "Generate the requested output.",
  "profileName": "default",
  "pauseForManualLogin": true
}
```

#### Windows

```json
{
  "images": ["C:\\path\\to\\input.png"],
  "prompt": "Generate the requested output.",
  "profileName": "default",
  "pauseForManualLogin": true
}
```

For one-off ChatGPT image generation, `navoke.chatgpt.extension-image-prompt` accepts only `prompt`, while `navoke.chatgpt.extension-image-prompt-transform` accepts one source image path in `image` plus `prompt`:

#### Linux

```json
{
  "image": "/path/to/source.png",
  "prompt": "Use the attached source image and generate the requested variation.",
  "extensionTab": { "mode": "new", "routingToken": "replace-with-a-stable-routing-token" }
}
```

#### Windows

```json
{
  "image": "C:\\path\\to\\source.png",
  "prompt": "Use the attached source image and generate the requested variation.",
  "extensionTab": { "mode": "new", "routingToken": "replace-with-a-stable-routing-token" }
}
```

The `image` field is a single file path string. Use `sourceImages` only for the sequence workflow.

For `navoke.chatgpt.extension-image-sequence`, the CLI input should treat `masterPromptSuffix` as part of the optional setup prompt, not as a sequence prompt. The renderer pre-fills this value when a setup prompt is entered, but CLI runs only receive what is present in the JSON input. When `masterPrompt` is non-empty and you want image-only sequence behavior, include the suffix explicitly:

#### Linux

```json
{
  "sourceImages": ["/path/to/character.png"],
  "masterPrompt": "Use the attached source image as the identity reference for the whole sequence.",
  "masterPromptSuffix": "Only generate images, one at a time, no text responses after the first response to this message. Respond \"Ready\" when you're ready to proceed.",
  "prompts": [
    "Change the perspective to back view. Do not change the character.",
    "Change the perspective to side view. Do not change the character."
  ],
  "extensionTab": { "mode": "new", "routingToken": "replace-with-a-stable-routing-token" }
}
```

#### Windows

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

If a run reaches `waiting_manual`, complete the requested browser action in the app or target browser, then run `navoke --project <project-dir> resume <runId>` and continue watching.

### Agent Skill

The repo includes agent skill copies at `.agents/skills/navoke` and `.claude/skills/navoke`. To make the skill available from another project, copy the appropriate folder into that repo's agent skill directory. For Claude Code, use `.claude/skills/navoke`; for other agent environments, use their supported project or global skills directory.

For per-user global install across projects:

#### Linux

```bash
# Codex: use CODEX_HOME when set; otherwise use ~/.codex
codexHome="${CODEX_HOME:-$HOME/.codex}"
codexSkills="$codexHome/skills"
mkdir -p "$codexSkills"
cp -R ".agents/skills/navoke" "$codexSkills/"

# Claude Code: personal skills live under ~/.claude/skills
claudeSkills="$HOME/.claude/skills"
mkdir -p "$claudeSkills"
cp -R ".claude/skills/navoke" "$claudeSkills/"
```

#### Windows (PowerShell)

```powershell
# Codex: use CODEX_HOME when set; otherwise use ~/.codex
$codexSkills = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME "skills" } else { Join-Path $HOME ".codex\skills" }
New-Item -ItemType Directory -Force $codexSkills | Out-Null
Copy-Item -Recurse -Force ".agents\skills\navoke" (Join-Path $codexSkills "navoke")

# Claude Code: personal skills live under ~/.claude/skills
$claudeSkills = Join-Path $HOME ".claude\skills"
New-Item -ItemType Directory -Force $claudeSkills | Out-Null
Copy-Item -Recurse -Force ".claude\skills\navoke" (Join-Path $claudeSkills "navoke")
```

The skill only teaches agents how to use the CLI. The `navoke` command itself must still be built and linked or otherwise available on `PATH`.

## Selector Calibration

Browser workflow selectors should be calibrated with Workflow Lab and proven through the installed app runtime with the Navoke CLI. The repeatable loop is documented in [Workflow Lab And Navoke CLI Plugin Calibration Loop](Docs/workflow-lab-navoke-cli-plugin-calibration.md).

```text
navoke --project <project-dir> run <workflowId> --input input.json --agent codex --name "Selector calibration"
navoke --project <project-dir> watch <runId>
navoke --project <project-dir> get <runId>
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
5. Start the Electron app using the development command in [Run](#run).
6. Open or let Navoke route the target site in that Chrome profile.
7. In the app, choose a workflow that declares the generic browser-extension capability.

The extension is site-agnostic. Plugins own target URLs, selectors, waits, upload sequencing, extraction rules, and manual-action handling, then drive the page through generic browser commands.

The extension defaults to `http://127.0.0.1:39201`. If the app falls back to another API port, copy the API URL shown in the app's Local Runtime panel into the extension popup.

This extension does not bypass human verification. If a site asks you to verify, complete that manually in the same Chrome tab and retry or resume the workflow.
