import { describe, expect, it } from "vitest";
import type { RunRecord, SystemInfo, WorkflowSummary } from "../../src/renderer/lib/api";
import { buildDuplicateRunConfiguration, collectRunInputFilePaths } from "../../src/renderer/lib/duplicateRunConfiguration";

type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];

const browserWorkflow = workflow({
  id: "vendor.example.browser-transform",
  uiCapabilities: ["extension.tabRouting"],
  inputFields: [
    { name: "referenceFiles", label: "Reference files", type: "fileList" },
    { name: "subjectFiles", label: "Subject files", type: "fileList", required: true },
    { name: "instruction", label: "Instruction", type: "textarea", defaultValue: "Default instruction" },
    { name: "settings", label: "Settings", type: "json", defaultValue: { quality: "draft" } }
  ]
});

const profileWorkflow = workflow({
  id: "vendor.example.profile-model",
  uiCapabilities: ["browser.profile"],
  inputFields: [
    { name: "primaryFile", label: "Primary file", type: "fileList", fileValue: "single", required: true },
    { name: "secondaryFiles", label: "Secondary files", type: "fileList" },
    { name: "mode", label: "Mode", type: "select", defaultValue: "fast", options: [{ label: "Fast", value: "fast" }] }
  ]
});

function workflow(input: Pick<WorkflowSummary["manifest"], "id" | "inputFields" | "uiCapabilities">): WorkflowSummary {
  return {
    manifest: {
      id: input.id,
      title: "Example Workflow",
      description: "Example workflow for duplicate-run tests.",
      category: "utility",
      version: "0.0.0",
      concurrency: 1,
      requiresBrowser: false,
      outputKinds: ["json"],
      inputFields: input.inputFields,
      uiCapabilities: input.uiCapabilities
    },
    plugin: {
      id: "vendor.example",
      name: "Example Plugin",
      version: "0.0.0",
      source: "user",
      apiVersion: "1",
      capabilities: []
    },
    availability: { status: "available" }
  };
}

function run(input: Partial<RunRecord> & { workflowId: string; input: unknown }): RunRecord {
  return {
    id: "run-1",
    workflowId: input.workflowId,
    origin: input.origin ?? { source: "ui" },
    runNumber: input.runNumber ?? 1,
    name: input.name ?? "Source run",
    runDir: null,
    status: "completed",
    currentStep: null,
    progress: 100,
    input: input.input,
    output: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function client(input: Partial<ExtensionClient> & { id: string }): ExtensionClient {
  return {
    id: input.id,
    url: input.url ?? "https://example.test/",
    title: input.title ?? "Example",
    status: input.status ?? "ready",
    protocolVersion: input.protocolVersion ?? 1,
    extensionVersion: input.extensionVersion ?? "0.1.0",
    routingToken: input.routingToken,
    compatible: input.compatible ?? true,
    incompatibilityReason: input.incompatibilityReason,
    lastSeenAt: input.lastSeenAt ?? "2026-01-01T00:00:00.000Z"
  };
}

describe("duplicate run configuration", () => {
  it("copies manifest-declared values and a still-connected target tab", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: browserWorkflow.manifest.id,
        input: {
          referenceFiles: ["C:\\runs\\inputs\\reference.png"],
          subjectFiles: ["C:\\runs\\inputs\\subject-a.png", "C:\\runs\\inputs\\subject-b.png"],
          instruction: "Apply the requested change.",
          settings: { quality: "final" },
          extensionTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: browserWorkflow, compatibleClients: [client({ id: "tab-1" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      workflowId: browserWorkflow.manifest.id,
      name: "Source run (1)",
      values: {
        referenceFiles: ["C:\\runs\\inputs\\reference.png"],
        subjectFiles: ["C:\\runs\\inputs\\subject-a.png", "C:\\runs\\inputs\\subject-b.png"],
        instruction: "Apply the requested change.",
        settings: { quality: "final" }
      },
      extensionTabSelection: "tab-1"
    });
    expect(duplicate.filePaths).toEqual([
      "C:\\runs\\inputs\\reference.png",
      "C:\\runs\\inputs\\subject-a.png",
      "C:\\runs\\inputs\\subject-b.png"
    ]);
  });

  it("restores manifest default values when old runs do not contain a field", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: browserWorkflow.manifest.id,
        input: {
          subjectFiles: ["C:\\runs\\inputs\\subject.png"]
        }
      }),
      { workflow: browserWorkflow, compatibleClients: [], newExtensionTabValue: "__new__" }
    );

    expect(duplicate.values).toMatchObject({
      subjectFiles: ["C:\\runs\\inputs\\subject.png"],
      instruction: "Default instruction",
      settings: { quality: "draft" }
    });
  });

  it("falls back to a new routed tab when the recorded target is stale", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: browserWorkflow.manifest.id,
        input: {
          subjectFiles: ["C:\\runs\\inputs\\subject.png"],
          extensionTab: { mode: "existing", clientId: "missing-tab" }
        }
      }),
      { workflow: browserWorkflow, compatibleClients: [client({ id: "other-tab" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate.extensionTabSelection).toBe("__new__");
  });

  it("matches a routed new-tab run to a currently connected client", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: browserWorkflow.manifest.id,
        input: {
          subjectFiles: ["C:\\runs\\inputs\\subject.png"],
          extensionTab: { mode: "new", routingToken: "route-1", url: "https://example.test/#based-blink-tab=route-1" }
        }
      }),
      {
        workflow: browserWorkflow,
        compatibleClients: [client({ id: "routed-tab", routingToken: "route-1" })],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate.extensionTabSelection).toBe("routed-tab");
  });

  it("uses the first available resubmit suffix when a copied name exists", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({ workflowId: browserWorkflow.manifest.id, input: { subjectFiles: ["C:\\runs\\inputs\\subject.png"] } }),
      {
        workflow: browserWorkflow,
        compatibleClients: [],
        existingRuns: [
          run({ workflowId: browserWorkflow.manifest.id, name: "Source run", input: {} }),
          run({ workflowId: browserWorkflow.manifest.id, name: "Source run (1)", input: {} })
        ],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate.name).toBe("Source run (2)");
  });

  it("resubmits an already suffixed run from the base name", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({ workflowId: browserWorkflow.manifest.id, name: "Source run (1)", input: { subjectFiles: ["C:\\runs\\inputs\\subject.png"] } }),
      {
        workflow: browserWorkflow,
        compatibleClients: [],
        existingRuns: [
          run({ workflowId: browserWorkflow.manifest.id, name: "Source run", input: {} }),
          run({ workflowId: browserWorkflow.manifest.id, name: "Source run (1)", input: {} })
        ],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate.name).toBe("Source run (2)");
  });

  it("keeps blank source run names blank", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({ workflowId: browserWorkflow.manifest.id, name: "   ", input: { subjectFiles: ["C:\\runs\\inputs\\subject.png"] } }),
      { workflow: browserWorkflow, compatibleClients: [], existingRuns: [], newExtensionTabValue: "__new__" }
    );

    expect(duplicate.name).toBe("");
  });

  it("copies single-file and multi-file manifest fields for profile-backed workflows", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: profileWorkflow.manifest.id,
        input: {
          primaryFile: "C:\\runs\\inputs\\primary.png",
          secondaryFiles: ["C:\\runs\\inputs\\secondary.png"]
        }
      }),
      { workflow: profileWorkflow, compatibleClients: [], newExtensionTabValue: "__new__" }
    );

    expect(duplicate.values).toMatchObject({
      primaryFile: "C:\\runs\\inputs\\primary.png",
      secondaryFiles: ["C:\\runs\\inputs\\secondary.png"],
      mode: "fast"
    });
    expect(duplicate.filePaths).toEqual(["C:\\runs\\inputs\\primary.png", "C:\\runs\\inputs\\secondary.png"]);
  });

  it("collects unique input file paths across manifest file fields", () => {
    expect(
      collectRunInputFilePaths(
        {
          subjectFiles: ["C:\\a.png", "C:\\b.png"],
          referenceFiles: ["C:\\a.png"],
          ignoredText: "not-a-file",
          profile: { nested: "C:\\ignored.png" }
        },
        browserWorkflow
      )
    ).toEqual(["C:\\a.png", "C:\\b.png"]);
  });

  it("falls back to file-like top-level values when no manifest is available", () => {
    expect(
      collectRunInputFilePaths({
        first: ["C:\\a.png", "C:\\b.png"],
        second: "C:\\c.obj",
        ignored: "plain text"
      })
    ).toEqual(["C:\\a.png", "C:\\b.png", "C:\\c.obj"]);
  });
});
