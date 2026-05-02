import { describe, expect, it } from "vitest";
import { normalizeChatGptExtensionOutputs } from "../../src/main/workflows/chatGptExtensionWorkflow";
import type { ExtensionTaskResult } from "../../src/main/extension/extensionBridge";

function output(subjectIndex: number, base64: string): ExtensionTaskResult["outputs"][number] {
  return {
    subjectIndex,
    mimeType: "image/png",
    base64,
    metadata: {
      url: `https://chatgpt.test/${base64}.png`,
      naturalWidth: 512,
      naturalHeight: 512
    }
  };
}

describe("ChatGPT extension workflow output normalization", () => {
  it("keeps one output per subject", () => {
    const normalized = normalizeChatGptExtensionOutputs([output(0, "first"), output(1, "second")], [
      "C:\\tmp\\first.png",
      "C:\\tmp\\second.png"
    ]);

    expect(normalized).toMatchObject([
      { subjectIndex: 0, subjectImage: "C:\\tmp\\first.png", pairId: "subject-1" },
      { subjectIndex: 1, subjectImage: "C:\\tmp\\second.png", pairId: "subject-2" }
    ]);
  });

  it("fails when a subject is missing an output", () => {
    expect(() => normalizeChatGptExtensionOutputs([output(0, "first")], ["C:\\tmp\\first.png", "C:\\tmp\\second.png"])).toThrow(
      "did not return an output image for subject 2"
    );
  });

  it("deduplicates exact duplicate outputs for a subject", () => {
    const normalized = normalizeChatGptExtensionOutputs([output(0, "same"), output(0, "same")], ["C:\\tmp\\first.png"]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].output.base64).toBe("same");
  });

  it("fails when one subject has multiple distinct outputs", () => {
    expect(() => normalizeChatGptExtensionOutputs([output(0, "first"), output(0, "second")], ["C:\\tmp\\first.png"])).toThrow(
      "distinct output images for subject 1"
    );
  });
});
