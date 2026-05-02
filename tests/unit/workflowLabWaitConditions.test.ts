import { describe, expect, it } from "vitest";
import { evaluateWaitCondition } from "../../src/main/lab/waitConditions";

describe("Workflow Lab wait predicates", () => {
  it("reports enabled element waits with diagnostics", () => {
    const result = evaluateWaitCondition(
      { kind: "element", selector: "button.send", state: "enabled" },
      {
        bodyText: "",
        element: { selector: "button.send", count: 1, visible: true, disabled: false },
        imageFingerprints: [],
        stopButtonVisible: false
      }
    );

    expect(result.satisfied).toBe(true);
    expect(result.diagnostics).toMatchObject({ count: 1, visible: true, disabled: false });
  });

  it("detects new image fingerprints against a baseline", () => {
    const result = evaluateWaitCondition(
      { kind: "image-count", minCount: 1, previousFingerprints: ["old.png|100x100"] },
      {
        bodyText: "",
        imageFingerprints: ["old.png|100x100", "new.png|1024x1024"],
        stopButtonVisible: false
      }
    );

    expect(result.satisfied).toBe(true);
    expect(result.reason).toMatch(/Found 1 new image/);
  });

  it("handles two-phase stop-button completion checks", () => {
    expect(
      evaluateWaitCondition(
        { kind: "stop-button", state: "visible" },
        { bodyText: "", imageFingerprints: [], stopButtonVisible: true }
      ).satisfied
    ).toBe(true);
    expect(
      evaluateWaitCondition(
        { kind: "stop-button", state: "hidden" },
        { bodyText: "", imageFingerprints: [], stopButtonVisible: false }
      ).satisfied
    ).toBe(true);
  });
});
