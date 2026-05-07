import { describe, expect, it } from "vitest";
import { runArtifactCountChips } from "../../src/renderer/lib/runArtifactSummary";
import type { RunArtifactSummary } from "../../src/renderer/lib/api";

describe("runArtifactSummary renderer helpers", () => {
  it("builds compact non-visual count chips", () => {
    const summary: RunArtifactSummary = {
      previews: [],
      visualTotal: 2,
      hiddenVisualCount: 0,
      total: 7,
      counts: {
        image: 2,
        json: 2,
        trace: 1,
        download: 1,
        log: 1
      }
    };

    expect(runArtifactCountChips(summary)).toEqual([
      { kind: "download", count: 1, label: "download 1" },
      { kind: "json", count: 2, label: "json 2" },
      { kind: "trace", count: 1, label: "trace 1" },
      { kind: "log", count: 1, label: "log 1" }
    ]);
  });

  it("omits count chips when artifacts are all visual", () => {
    const summary: RunArtifactSummary = {
      previews: [],
      visualTotal: 4,
      hiddenVisualCount: 1,
      total: 4,
      counts: {
        image: 2,
        model: 1,
        screenshot: 1
      }
    };

    expect(runArtifactCountChips(summary)).toEqual([]);
  });
});
