import { describe, expect, it } from "vitest";
import { buildChatGptArtifactPairing, type ChatGptRunInputModel } from "../../src/renderer/lib/chatGptArtifactPairing";
import type { ArtifactRecord } from "../../src/renderer/lib/api";

const input: ChatGptRunInputModel = {
  referenceImages: [],
  subjectImages: ["C:\\tmp\\one.png", "C:\\tmp\\two.png", "C:\\tmp\\three.png", "C:\\tmp\\four.png"],
  masterPrompt: "Master",
  subjectInstruction: "Transform"
};

function artifact(id: string, subjectIndex: number, inputImage = input.subjectImages[subjectIndex]): ArtifactRecord {
  return {
    id,
    runId: "run-1",
    kind: "image",
    name: `${id}.png`,
    path: `C:\\tmp\\${id}.png`,
    mimeType: "image/png",
    size: 100,
    metadata: {
      source: "chatgpt-extension",
      subjectIndex,
      inputImage
    },
    createdAt: "2026-05-02T00:00:00.000Z"
  };
}

function manifestArtifact(): ArtifactRecord {
  return {
    id: "manifest",
    runId: "run-1",
    kind: "json",
    name: "chatgpt-extension-manifest.json",
    path: "C:\\tmp\\manifest.json",
    mimeType: "application/json",
    size: 10,
    metadata: null,
    createdAt: "2026-05-02T00:00:00.000Z"
  };
}

describe("ChatGPT artifact pairing", () => {
  it("renders four subjects with one output each", () => {
    const pairing = buildChatGptArtifactPairing(input, [
      artifact("out-1", 0),
      artifact("out-2", 1),
      artifact("out-3", 2),
      artifact("out-4", 3),
      manifestArtifact()
    ]);

    expect(pairing.pairs.map((pair) => pair.primaryOutput?.id)).toEqual(["out-1", "out-2", "out-3", "out-4"]);
    expect(pairing.otherArtifacts.map((item) => item.id)).toEqual(["manifest"]);
  });
});
