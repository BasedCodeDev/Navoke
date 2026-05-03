# Workflow Plugin Architecture

## Summary

Based BLINK will support trusted local workflow plugins installed per user. The Electron main process will discover installed plugin packages, load their workflow definitions into the runtime registry, and snapshot plugin identity onto every run so a project can report when a workflow plugin is missing or the installed version does not match the run.

This first version is a local developer/plugin-author model. Plugins are trusted JavaScript modules and run with the same process privileges as built-in workflows. Sandboxing, signing, marketplace distribution, and review workflows are out of scope for v1.

## Current Shape

The current workflow boundary is already close to a plugin contract:

- A workflow exposes a manifest, Zod input/output schemas, and one `run()` function.
- The local runner executes workflows through `WorkflowContext`.
- The API already lists workflows by manifest and runs are stored generically by `workflowId`.

The missing pieces are dynamic discovery, plugin metadata, stable public SDK boundaries, install/uninstall APIs, and UI states for unavailable workflow plugins.

## Target Model

Plugins are installed under the user's app data directory:

```text
<userData>/plugins/workflows/<pluginId>/<pluginVersion>/
```

Each installed plugin version contains a `plugin.json` manifest:

```json
{
  "id": "vendor.example",
  "name": "Vendor Example",
  "version": "0.1.0",
  "pluginApiVersion": "1",
  "entrypoint": "dist/index.js",
  "workflows": ["vendor.example.workflow"],
  "capabilities": ["filesystem.artifacts", "browser"]
}
```

The entrypoint must be a compiled CommonJS module. It can export a `workflows` array or a `createWorkflows(sdk)` factory. The factory receives the app-provided workflow SDK so plugin code can use stable helpers instead of importing app internals.

## Runtime And Registry

The registry is composed from two sources:

- built-in workflows shipped with the app
- user-installed workflow plugins

Every registered workflow has plugin metadata:

- `pluginId`
- `pluginName`
- `pluginVersion`
- `pluginSource`
- `pluginApiVersion`
- `capabilities`

When a run is created, the store snapshots:

- `workflowId`
- `workflowVersion`
- `pluginId`
- `pluginVersion`
- `pluginSource`
- `pluginApiVersion`

Resume and duplicate flows must check that the required workflow/plugin is available. If a project contains runs for a missing plugin, the UI should show a missing-plugin state and provide an acquire/install affordance.

## SDK Boundary

Workflow-facing APIs are exposed through a public workflow SDK module. New plugin workflows should use this SDK boundary instead of importing from `src/main/runtime`, `src/main/utils`, `src/main/automation`, or `src/main/extension`.

The SDK exposes:

- workflow contract types
- file/artifact helpers
- browser automation helpers
- extension capability handles
- common workflow errors
- abort-aware sleep

## Install And Uninstall

V1 installation accepts a local plugin folder path. The app validates `plugin.json`, copies the folder into the user plugin directory, reloads the workflow registry, and reports plugin load errors without preventing the project from opening.

Uninstall removes an installed plugin version from the user plugin directory and reloads the registry. Active runs are not migrated. Historical runs keep their snapshot metadata and can report the missing plugin later.

## UI Behavior

The renderer should show:

- installed plugins and load status
- plugin metadata in the workflow picker
- run-level workflow availability
- missing plugin or version mismatch messages in run details
- duplicate/resume blocking when the required workflow plugin is unavailable

The first install UI can use a local path field. A later distribution system can replace that with a catalog or package browser.

## Implementation Phases

1. Add this architecture document.
2. Add the workflow SDK module and plugin manifest schema.
3. Add user plugin discovery, dynamic loading, and registry composition.
4. Snapshot plugin metadata on run creation.
5. Add plugin API endpoints and renderer availability states.
6. Reduce workflow-ID-specific renderer branching where generic manifest fields are enough.
7. Migrate built-in workflows into bundled or installable plugin form in later phases.

## Complexity Score

Trusted local plugins are medium-high complexity and moderate difficulty:

- Complexity: 7/10
- Difficulty: 6/10

Sandboxed plugin hosting or marketplace-grade distribution would be a separate architecture track:

- Complexity: 9/10
- Difficulty: 9/10

## Assumptions

- V1 plugins are trusted local JavaScript modules.
- V1 install scope is user-only.
- Project runs store enough metadata to identify missing or mismatched plugins.
- Backward compatibility with historical run records is not required for this architecture change.
- Sandboxing, signing, permissions enforcement, and marketplace distribution are out of scope for v1.
