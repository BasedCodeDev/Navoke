import { describe, expect, it } from "vitest";
import { RuntimeEventBus } from "../../src/main/runtime/eventBus";
import { attachManualWaitNotifications } from "../../src/main/runtime/manualWaitNotifications";
import type { RunRecord } from "../../src/main/runtime/types";

describe("manual wait notifications", () => {
  it("notifies once per waiting_manual message and resets after the run leaves manual wait", () => {
    const eventBus = new RuntimeEventBus();
    let currentRun = run("running", "Starting");
    const notifications: RunRecord[] = [];
    const detach = attachManualWaitNotifications(
      eventBus,
      { getRun: () => currentRun },
      { notify: (nextRun) => notifications.push(nextRun) }
    );

    currentRun = run("waiting_manual", "Complete login");
    eventBus.publish({ kind: "run-updated", runId: currentRun.id });
    eventBus.publish({ kind: "run-updated", runId: currentRun.id });

    currentRun = run("waiting_manual", "Complete verification");
    eventBus.publish({ kind: "run-updated", runId: currentRun.id });

    currentRun = run("running", "Manual step completed");
    eventBus.publish({ kind: "run-updated", runId: currentRun.id });
    currentRun = run("waiting_manual", "Complete verification");
    eventBus.publish({ kind: "run-updated", runId: currentRun.id });

    detach();

    expect(notifications.map((item) => item.currentStep)).toEqual([
      "Complete login",
      "Complete verification",
      "Complete verification"
    ]);
  });
});

function run(status: RunRecord["status"], currentStep: string): RunRecord {
  return {
    id: "run-1",
    workflowId: "test.workflow",
    workflowVersion: "0.0.0",
    pluginId: null,
    pluginVersion: null,
    pluginApiVersion: null,
    pluginSource: null,
    origin: { source: "ui" },
    runNumber: 1,
    name: "Test run",
    runDir: null,
    status,
    currentStep,
    progress: 0,
    input: {},
    output: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
