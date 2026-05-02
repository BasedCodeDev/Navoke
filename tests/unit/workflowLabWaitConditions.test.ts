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

  it("waits for ChatGPT submit readiness after uploads finish", () => {
    const result = evaluateWaitCondition(
      { kind: "chatgpt-submit-ready" },
      {
        bodyText: "",
        imageFingerprints: [],
        stopButtonVisible: false,
        chatGptSubmit: {
          composerFound: true,
          composerVisible: true,
          submitFound: true,
          submitVisible: true,
          submitEnabled: true,
          stopButtonVisible: false,
          fileInputFound: true,
          visibleButtons: ["Send"],
          imageCount: 1
        }
      }
    );

    expect(result.satisfied).toBe(true);
    expect(result.reason).toMatch(/ready/i);
  });

  it("keeps waiting when ChatGPT submit is disabled during processing", () => {
    const result = evaluateWaitCondition(
      { kind: "chatgpt-submit-ready" },
      {
        bodyText: "",
        imageFingerprints: [],
        stopButtonVisible: false,
        chatGptSubmit: {
          composerFound: true,
          composerVisible: true,
          submitFound: true,
          submitVisible: true,
          submitEnabled: false,
          stopButtonVisible: false,
          fileInputFound: true,
          visibleButtons: ["Send"],
          imageCount: 1
        }
      }
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
    expect(result.diagnostics).toMatchObject({ submitEnabled: false });
  });

  it("keeps waiting while ChatGPT generation is active", () => {
    const result = evaluateWaitCondition(
      { kind: "chatgpt-submit-ready" },
      {
        bodyText: "",
        imageFingerprints: [],
        stopButtonVisible: true,
        chatGptSubmit: {
          composerFound: true,
          composerVisible: true,
          submitFound: true,
          submitVisible: true,
          submitEnabled: true,
          stopButtonVisible: true,
          fileInputFound: true,
          visibleButtons: ["Stop"],
          imageCount: 2
        }
      }
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/generation is still active/i);
  });

  it("reports useful diagnostics when ChatGPT submit is missing", () => {
    const result = evaluateWaitCondition(
      { kind: "chatgpt-submit-ready" },
      {
        bodyText: "",
        imageFingerprints: [],
        stopButtonVisible: false,
        chatGptSubmit: {
          composerFound: true,
          composerVisible: true,
          submitFound: false,
          submitVisible: false,
          submitEnabled: false,
          stopButtonVisible: false,
          fileInputFound: true,
          visibleButtons: ["Attach files"],
          imageCount: 0
        }
      }
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/submit button was not found/i);
    expect(result.diagnostics).toMatchObject({
      submitFound: false,
      visibleButtons: ["Attach files"],
      fileInputFound: true
    });
  });
});
