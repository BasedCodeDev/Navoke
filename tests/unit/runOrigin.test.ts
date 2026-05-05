import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../src/renderer/lib/api";
import { activeCliAgentRuns, isCliRun, runOriginCommand, runOriginLabel } from "../../src/renderer/lib/runOrigin";

describe("renderer run origin helpers", () => {
  it("labels UI and CLI runs", () => {
    expect(isCliRun(run({ source: "ui" }))).toBe(false);
    expect(runOriginLabel(run({ source: "ui" }))).toBe("UI");
    expect(isCliRun(run({ source: "cli", agentName: "codex", command: "blink run wf --wait" }))).toBe(true);
    expect(runOriginLabel(run({ source: "cli", agentName: "codex" }))).toBe("CLI: codex");
    expect(runOriginCommand(run({ source: "cli", command: "blink run wf --wait" }))).toBe("blink run wf --wait");
  });

  it("returns active CLI runs only", () => {
    const active = run({ source: "cli", agentName: "codex" }, "running");
    const waiting = run({ source: "cli" }, "waiting_manual");
    const completed = run({ source: "cli" }, "completed");
    const uiRunning = run({ source: "ui" }, "running");

    expect(activeCliAgentRuns([active, waiting, completed, uiRunning])).toEqual([active, waiting]);
  });
});

function run(origin: RunRecord["origin"], status: RunRecord["status"] = "queued"): RunRecord {
  return {
    id: `${origin.source}-${status}`,
    workflowId: "test.workflow",
    origin,
    runNumber: 1,
    name: "Run",
    runDir: null,
    status,
    currentStep: null,
    progress: 0,
    input: {},
    output: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
