import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginManager } from "../../src/main/plugins/pluginManager";
import { WORKFLOW_PLUGIN_API_VERSION, pluginManifestSchema } from "../../src/main/plugins/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("PluginManager", () => {
  it("validates plugin manifests", () => {
    expect(
      pluginManifestSchema.safeParse({
        id: "vendor.example",
        name: "Vendor Example",
        version: "0.1.0",
        pluginApiVersion: WORKFLOW_PLUGIN_API_VERSION,
        entrypoint: "dist/index.js",
        workflows: ["vendor.example.workflow"],
        capabilities: ["filesystem.artifacts"]
      }).success
    ).toBe(true);

    expect(
      pluginManifestSchema.safeParse({
        id: "../bad",
        name: "Bad",
        version: "0.1.0",
        pluginApiVersion: WORKFLOW_PLUGIN_API_VERSION,
        entrypoint: "dist/index.js",
        workflows: ["bad.workflow"],
        capabilities: []
      }).success
    ).toBe(false);
  });

  it("installs and loads a trusted local workflow plugin", async () => {
    const userDataDir = tempDir("blink-user-data-");
    const sourceDir = createPluginSource("vendor.example", "0.1.0", "vendor.example.workflow");
    const manager = new PluginManager(userDataDir);

    const result = await manager.installFromPath(sourceDir);

    expect(result.plugin.status).toBe("loaded");
    expect(manager.listPlugins()).toHaveLength(1);
    expect(manager.listWorkflowRegistrations()).toHaveLength(1);
    expect(manager.listWorkflowRegistrations()[0].plugin.id).toBe("vendor.example");
    expect(manager.listWorkflowRegistrations()[0].definition.manifest.id).toBe("vendor.example.workflow");
  });

  it("keeps incompatible plugins installed but does not register their workflows", async () => {
    const userDataDir = tempDir("blink-user-data-");
    const sourceDir = createPluginSource("vendor.incompatible", "0.1.0", "vendor.incompatible.workflow", {
      pluginApiVersion: "999"
    });
    const manager = new PluginManager(userDataDir);

    await manager.installFromPath(sourceDir);

    expect(manager.listPlugins()[0].status).toBe("incompatible");
    expect(manager.listWorkflowRegistrations()).toHaveLength(0);
  });

  it("marks duplicate workflow ids as failed", async () => {
    const userDataDir = tempDir("blink-user-data-");
    const firstSource = createPluginSource("vendor.first", "0.1.0", "vendor.duplicate.workflow");
    const secondSource = createPluginSource("vendor.second", "0.1.0", "vendor.duplicate.workflow");
    const manager = new PluginManager(userDataDir);

    await manager.installFromPath(firstSource);
    await manager.installFromPath(secondSource);

    expect(manager.listPlugins().map((plugin) => plugin.status)).toEqual(["failed", "failed"]);
    expect(manager.listWorkflowRegistrations()).toHaveLength(0);
  });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createPluginSource(
  pluginId: string,
  version: string,
  workflowId: string,
  overrides: Partial<{ pluginApiVersion: string }> = {}
): string {
  const dir = tempDir("blink-plugin-source-");
  const distDir = path.join(dir, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    `${JSON.stringify(
      {
        id: pluginId,
        name: pluginId,
        version,
        pluginApiVersion: overrides.pluginApiVersion ?? WORKFLOW_PLUGIN_API_VERSION,
        entrypoint: "dist/index.js",
        workflows: [workflowId],
        capabilities: ["filesystem.artifacts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(distDir, "index.js"),
    `
const schema = {
  safeParse(value) {
    return { success: true, data: value };
  }
};

module.exports = {
  createWorkflows() {
    return [{
      manifest: {
        id: ${JSON.stringify(workflowId)},
        title: ${JSON.stringify(workflowId)},
        description: "Test plugin workflow",
        category: "utility",
        version: "0.1.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: schema,
      outputSchema: schema,
      async run() {
        return { ok: true };
      }
    }];
  }
};
`,
    "utf8"
  );
  return dir;
}
