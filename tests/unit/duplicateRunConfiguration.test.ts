import { describe, expect, it } from "vitest";
import type { RunRecord, SystemInfo } from "../../src/renderer/lib/api";
import { buildDuplicateRunConfiguration, collectRunInputFilePaths } from "../../src/renderer/lib/duplicateRunConfiguration";

type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];

function run(input: Partial<RunRecord> & { workflowId: string; input: unknown }): RunRecord {
  return {
    id: "run-1",
    workflowId: input.workflowId,
    name: input.name ?? "Source run",
    runDir: null,
    status: "completed",
    currentStep: null,
    progress: 100,
    input: input.input,
    output: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function client(input: Partial<ExtensionClient> & { id: string }): ExtensionClient {
  return {
    id: input.id,
    url: input.url ?? "https://chatgpt.com/",
    title: input.title ?? "ChatGPT",
    status: input.status ?? "ready",
    protocolVersion: input.protocolVersion ?? 7,
    extensionVersion: input.extensionVersion ?? "0.7.0",
    routingToken: input.routingToken,
    compatible: input.compatible ?? true,
    incompatibilityReason: input.incompatibilityReason,
    lastSeenAt: input.lastSeenAt ?? "2026-01-01T00:00:00.000Z"
  };
}

describe("duplicate run configuration", () => {
  it("copies ChatGPT prompts, images, and a still-connected target tab", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "chatgpt.extension-image-transform",
        input: {
          referenceImages: ["C:\\runs\\inputs\\reference.png"],
          subjectImages: ["C:\\runs\\inputs\\subject-a.png", "C:\\runs\\inputs\\subject-b.png"],
          masterPrompt: "Setup prompt",
          subjectInstruction: "Change the hands.",
          chatGptTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { compatibleClients: [client({ id: "tab-1" })], newChatGptTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      workflowId: "chatgpt.extension-image-transform",
      name: "Copy of Source run",
      referenceFiles: ["C:\\runs\\inputs\\reference.png"],
      subjectFiles: ["C:\\runs\\inputs\\subject-a.png", "C:\\runs\\inputs\\subject-b.png"],
      masterPrompt: "Setup prompt",
      subjectInstruction: "Change the hands.",
      chatGptTabSelection: "tab-1"
    });
    expect(duplicate.filePaths).toEqual([
      "C:\\runs\\inputs\\reference.png",
      "C:\\runs\\inputs\\subject-a.png",
      "C:\\runs\\inputs\\subject-b.png"
    ]);
  });

  it("falls back to a new ChatGPT tab when the recorded target is stale", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "chatgpt.extension-image-transform",
        input: {
          subjectImages: ["C:\\runs\\inputs\\subject.png"],
          masterPrompt: "Setup",
          chatGptTab: { mode: "existing", clientId: "missing-tab" }
        }
      }),
      { compatibleClients: [client({ id: "other-tab" })], newChatGptTabValue: "__new__" }
    );

    expect(duplicate.chatGptTabSelection).toBe("__new__");
  });

  it("copies Hunyuan image, prompt, and profile settings", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "hunyuan.image-to-model",
        input: {
          images: ["C:\\runs\\inputs\\model-source.png"],
          prompt: "Make a model",
          profileName: "artist",
          pauseForManualLogin: false
        }
      }),
      { compatibleClients: [], newChatGptTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      selectedFiles: ["C:\\runs\\inputs\\model-source.png"],
      prompt: "Make a model",
      profileName: "artist",
      pauseForManualLogin: false
    });
  });

  it("collects unique input file paths across supported file fields", () => {
    expect(
      collectRunInputFilePaths({
        images: ["C:\\a.png", "C:\\b.png"],
        referenceImages: ["C:\\a.png"],
        subjectImages: ["C:\\c.png"]
      })
    ).toEqual(["C:\\a.png", "C:\\b.png", "C:\\c.png"]);
  });
});
