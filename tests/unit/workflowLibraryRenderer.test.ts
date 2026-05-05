import { describe, expect, it } from "vitest";
import { savedLibrarySourceRunIds } from "../../src/renderer/lib/workflowLibrary";
import type { WorkflowLibraryEntry } from "../../src/renderer/lib/api";

describe("renderer workflow library helpers", () => {
  it("tracks saved source run ids and ignores entries without a source run", () => {
    expect(
      savedLibrarySourceRunIds([
        entry({ id: "entry-1", sourceRunId: "run-1" }),
        entry({ id: "entry-2", sourceRunId: null }),
        entry({ id: "entry-3", sourceRunId: "run-2" }),
        entry({ id: "entry-4", sourceRunId: "run-1" })
      ])
    ).toEqual(new Set(["run-1", "run-2"]));
  });
});

function entry(input: { id: string; sourceRunId: string | null }): WorkflowLibraryEntry {
  return {
    id: input.id,
    name: input.id,
    workflowId: "test.workflow",
    workflowVersion: "0.1.0",
    pluginId: "test.plugin",
    pluginVersion: "1.0.0",
    pluginApiVersion: "1",
    pluginSource: "user",
    sourceRunId: input.sourceRunId,
    input: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
