import { describe, expect, it } from "vitest";
import type { RunRecord, SystemInfo, WorkflowSummary } from "../../src/renderer/lib/api";
import { buildDuplicateRunConfiguration, collectRunInputFilePaths } from "../../src/renderer/lib/duplicateRunConfiguration";

type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];
const chatGptWorkflow = {
  manifest: { uiCapabilities: ["chatgpt.tabRouting"] }
} as WorkflowSummary;
const hunyuanWorkflow = {
  manifest: { uiCapabilities: ["browser.profile"] }
} as WorkflowSummary;

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
    protocolVersion: input.protocolVersion ?? 8,
    extensionVersion: input.extensionVersion ?? "0.8.0",
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
        workflowId: "based-blink.chatgpt.extension-image-transform",
        input: {
          referenceImages: ["C:\\runs\\inputs\\reference.png"],
          subjectImages: ["C:\\runs\\inputs\\subject-a.png", "C:\\runs\\inputs\\subject-b.png"],
          masterPrompt: "Setup prompt",
          subjectInstruction: "Change the hands.",
          chatGptTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "tab-1" })], newChatGptTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      workflowId: "based-blink.chatgpt.extension-image-transform",
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
        workflowId: "based-blink.chatgpt.extension-image-transform",
        input: {
          subjectImages: ["C:\\runs\\inputs\\subject.png"],
          masterPrompt: "Setup",
          chatGptTab: { mode: "existing", clientId: "missing-tab" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "other-tab" })], newChatGptTabValue: "__new__" }
    );

    expect(duplicate.chatGptTabSelection).toBe("__new__");
  });

  it("copies ChatGPT sequence source image, prompts, setup, and target tab", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-sequence",
        input: {
          sourceImages: ["C:\\runs\\inputs\\source.png"],
          prompts: ["Back view", "Side view"],
          masterPrompt: "Keep the same character.",
          chatGptTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "tab-1" })], newChatGptTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      workflowId: "based-blink.chatgpt.extension-image-sequence",
      sourceFiles: ["C:\\runs\\inputs\\source.png"],
      sequencePrompts: ["Back view", "Side view"],
      masterPrompt: "Keep the same character.",
      chatGptTabSelection: "tab-1"
    });
    expect(duplicate.filePaths).toEqual(["C:\\runs\\inputs\\source.png"]);
  });

  it("copies Hunyuan views, settings, profile, pause flag, and selectors", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.hunyuan.image-to-model",
        input: {
          frontImage: "C:\\runs\\inputs\\front.png",
          backImage: "C:\\runs\\inputs\\back.png",
          left45Image: "C:\\runs\\inputs\\left45.png",
          prompt: "Make a model",
          profileName: "artist",
          pauseForManualLogin: false,
          modelFaceCount: "500k",
          retopologyType: "triangle",
          generateTexture: false,
          autoRig: true,
          exportFormat: "glb",
          selectors: { imageTo3dTab: "button.image-to-3d" }
        }
      }),
      { workflow: hunyuanWorkflow, compatibleClients: [], newChatGptTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      hunyuanViewFiles: {
        frontImage: ["C:\\runs\\inputs\\front.png"],
        backImage: ["C:\\runs\\inputs\\back.png"],
        left45Image: ["C:\\runs\\inputs\\left45.png"]
      },
      prompt: "Make a model",
      profileName: "artist",
      pauseForManualLogin: false,
      hunyuanModelFaceCount: "500k",
      hunyuanRetopologyType: "triangle",
      hunyuanGenerateTexture: false,
      hunyuanAutoRig: true,
      hunyuanExportFormat: "glb"
    });
    expect(JSON.parse(duplicate.hunyuanSelectorsJson)).toEqual({ imageTo3dTab: "button.image-to-3d" });
    expect(duplicate.filePaths).toEqual([
      "C:\\runs\\inputs\\front.png",
      "C:\\runs\\inputs\\back.png",
      "C:\\runs\\inputs\\left45.png"
    ]);
  });

  it("collects unique input file paths across supported file fields", () => {
    expect(
      collectRunInputFilePaths({
        images: ["C:\\a.png", "C:\\b.png"],
        referenceImages: ["C:\\a.png"],
        subjectImages: ["C:\\c.png"],
        sourceImages: ["C:\\d.png"],
        frontImage: "C:\\front.png",
        backImage: "C:\\b.png"
      })
    ).toEqual(["C:\\a.png", "C:\\b.png", "C:\\c.png", "C:\\d.png", "C:\\front.png"]);
  });
});
