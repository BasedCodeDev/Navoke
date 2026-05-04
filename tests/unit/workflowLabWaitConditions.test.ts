import { describe, expect, it } from "vitest";
import { defaultWaitTimeoutMs, evaluateWaitCondition, waitConditionLabel, type LabWaitPageState } from "../../src/main/lab/waitConditions";

function state(overrides: Partial<LabWaitPageState> = {}): LabWaitPageState {
  return {
    url: "https://example.test/app",
    readyState: "complete",
    bodyText: "Ready to continue",
    imageFingerprints: ["a|512x512"],
    ...overrides
  };
}

describe("Workflow Lab wait conditions", () => {
  it("evaluates element states", () => {
    expect(
      evaluateWaitCondition(
        { kind: "element", selector: "button.save", state: "enabled" },
        state({ element: { selector: "button.save", count: 1, visible: true, disabled: false } })
      )
    ).toMatchObject({ satisfied: true });

    expect(
      evaluateWaitCondition(
        { kind: "element", selector: "button.save", state: "hidden" },
        state({ element: { selector: "button.save", count: 1, visible: false, disabled: false } })
      )
    ).toMatchObject({ satisfied: true });
  });

  it("evaluates text, image, url, document, and network waits", () => {
    expect(evaluateWaitCondition({ kind: "text", text: "continue", state: "present" }, state())).toMatchObject({
      satisfied: true
    });
    expect(
      evaluateWaitCondition(
        { kind: "image-count", minCount: 1, previousFingerprints: ["old|512x512"] },
        state({ imageFingerprints: ["old|512x512", "new|512x512"] })
      )
    ).toMatchObject({ satisfied: true });
    expect(evaluateWaitCondition({ kind: "url", value: "/app", match: "contains" }, state())).toMatchObject({
      satisfied: true
    });
    expect(evaluateWaitCondition({ kind: "document-ready" }, state({ readyState: "interactive" }))).toMatchObject({
      satisfied: true
    });
    expect(evaluateWaitCondition({ kind: "network-idle" }, state({ networkIdle: true }))).toMatchObject({
      satisfied: true
    });
  });

  it("labels and defaults generic waits", () => {
    expect(waitConditionLabel({ kind: "url", value: "/login", match: "contains" })).toContain("URL");
    expect(defaultWaitTimeoutMs({ kind: "network-idle" })).toBe(15_000);
    expect(defaultWaitTimeoutMs({ kind: "document-ready" })).toBe(30_000);
  });
});
