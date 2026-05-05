import { describe, expect, it } from "vitest";
import { isRecoverableFailedExtensionRun, resolveExtensionFocusTarget } from "../../src/renderer/lib/extensionTabFocus";
import type { RunRecord, WorkflowSummary } from "../../src/renderer/lib/api";

const workflow = {
  manifest: { uiCapabilities: ["extension.focusTarget"] }
} as unknown as WorkflowSummary;

function run(input: unknown, output: unknown = null, status: RunRecord["status"] = "running"): RunRecord {
  return {
    id: "run-1",
    workflowId: "workflow",
    origin: { source: "ui" },
    runNumber: 1,
    name: "Run",
    runDir: null,
    status,
    currentStep: null,
    progress: 0,
    input,
    output,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe("extension tab focus", () => {
  it("focuses a connected recorded client", () => {
    const target = resolveExtensionFocusTarget(
      run({ extensionTab: { mode: "existing", clientId: "tab-1" } }),
      [
        {
          id: "tab-1",
          url: "https://example.test/",
          title: "Example",
          status: "connected",
          protocolVersion: 1,
          extensionVersion: "0.1.0",
          compatible: true,
          lastSeenAt: new Date().toISOString()
        }
      ],
      workflow
    );
    expect(target).toMatchObject({ action: "focus", clientId: "tab-1" });
  });

  it("opens a tracked URL when the tab is disconnected", () => {
    const target = resolveExtensionFocusTarget(
      run({ extensionTab: { mode: "new", routingToken: "route-1", url: "https://example.test/#based-blink-tab=route-1" } }),
      [],
      workflow
    );
    expect(target).toMatchObject({ action: "open", url: expect.stringContaining("based-blink-tab=route-1") });
  });

  it("marks failed runs with extension state as recoverable", () => {
    expect(
      isRecoverableFailedExtensionRun(
        run({ extensionTab: { mode: "new", routingToken: "route-1", url: "https://example.test/" } }, null, "failed"),
        workflow
      )
    ).toBe(true);
  });
});
