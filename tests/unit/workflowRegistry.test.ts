import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createBuiltInWorkflowRegistry, createWorkflowRegistry } from "../../src/main/workflows";
import { productIdsMatch, uniqueWorkflowRegistrations } from "../../src/main/runtime/legacyCompatibility";
import type { PluginManager } from "../../src/main/plugins/pluginManager";
import type { WorkflowRegistration } from "../../src/main/runtime/types";

describe("workflow registry", () => {
  it("starts without built-in workflow registrations", () => {
    const registry = createBuiltInWorkflowRegistry();
    expect(registry.size).toBe(0);
  });

  it("creates a registry with unique IDs", () => {
    const registry = createWorkflowRegistry();
    expect(registry.size).toBe(new Set([...registry.keys()]).size);
  });

  it("resolves legacy workflow and plugin IDs without publishing duplicate workflows", () => {
    const registration: WorkflowRegistration = {
      definition: {
        manifest: {
          id: "navoke.example.run",
          title: "Example",
          description: "Example workflow",
          category: "utility",
          version: "0.1.0",
          concurrency: 1,
          inputFields: [],
          outputKinds: ["json"],
          requiresBrowser: false
        },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        async run() {
          return { ok: true };
        }
      },
      plugin: {
        id: "navoke.example",
        name: "Navoke Example",
        version: "0.1.0",
        source: "user",
        apiVersion: "1",
        capabilities: ["filesystem.artifacts"]
      }
    };
    const pluginManager = {
      listWorkflowRegistrations: () => [registration]
    } as unknown as PluginManager;

    const registry = createWorkflowRegistry(pluginManager);

    expect(registry.get("based-blink.example.run")).toBe(registration);
    expect(registry.get("navoke.example.run")).toBe(registration);
    expect(productIdsMatch("based-blink.example", "navoke.example")).toBe(true);
    expect(uniqueWorkflowRegistrations(registry)).toEqual([registration]);
  });
});
