import { describe, expect, it } from "vitest";
import type { RunRecord, SystemInfo, WorkflowSummary } from "../../src/renderer/lib/api";
import {
  DEFAULT_CHATGPT_SEQUENCE_SETUP_SUFFIX,
  buildDuplicateRunConfiguration,
  collectRunInputFilePaths
} from "../../src/renderer/lib/duplicateRunConfiguration";

type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];
const chatGptWorkflow = {
  manifest: { uiCapabilities: ["extension.tabRouting"] }
} as WorkflowSummary;
const hunyuanWorkflow = {
  manifest: { uiCapabilities: ["browser.profile"] }
} as WorkflowSummary;

function run(input: Partial<RunRecord> & { workflowId: string; input: unknown }): RunRecord {
  return {
    id: "run-1",
    workflowId: input.workflowId,
    origin: input.origin ?? { source: "ui" },
    runNumber: input.runNumber ?? 1,
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
    protocolVersion: input.protocolVersion ?? 4,
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
          extensionTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "tab-1" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      workflowId: "based-blink.chatgpt.extension-image-transform",
      name: "Source run (1)",
      referenceFiles: ["C:\\runs\\inputs\\reference.png"],
      subjectFiles: ["C:\\runs\\inputs\\subject-a.png", "C:\\runs\\inputs\\subject-b.png"],
      masterPrompt: "Setup prompt",
      subjectInstruction: "Change the hands.",
      extensionTabSelection: "tab-1"
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
          extensionTab: { mode: "existing", clientId: "missing-tab" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "other-tab" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate.extensionTabSelection).toBe("__new__");
  });

  it("uses the first available resubmit suffix when a copied name exists", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-transform",
        input: { subjectImages: ["C:\\runs\\inputs\\subject.png"] }
      }),
      {
        workflow: chatGptWorkflow,
        compatibleClients: [],
        existingRuns: [
          run({ workflowId: "based-blink.chatgpt.extension-image-transform", name: "Source run", input: {} }),
          run({ workflowId: "based-blink.chatgpt.extension-image-transform", name: "Source run (1)", input: {} })
        ],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate.name).toBe("Source run (2)");
  });

  it("resubmits an already suffixed run from the base name", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-transform",
        name: "Source run (1)",
        input: { subjectImages: ["C:\\runs\\inputs\\subject.png"] }
      }),
      {
        workflow: chatGptWorkflow,
        compatibleClients: [],
        existingRuns: [
          run({ workflowId: "based-blink.chatgpt.extension-image-transform", name: "Source run", input: {} }),
          run({ workflowId: "based-blink.chatgpt.extension-image-transform", name: "Source run (1)", input: {} })
        ],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate.name).toBe("Source run (2)");
  });

  it("reuses the first suffix gap instead of the highest suffix", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-transform",
        input: { subjectImages: ["C:\\runs\\inputs\\subject.png"] }
      }),
      {
        workflow: chatGptWorkflow,
        compatibleClients: [],
        existingRuns: [
          run({ workflowId: "based-blink.chatgpt.extension-image-transform", name: "Source run", input: {} }),
          run({ workflowId: "based-blink.chatgpt.extension-image-transform", name: "Source run (2)", input: {} })
        ],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate.name).toBe("Source run (1)");
  });

  it("keeps blank source run names blank", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-transform",
        name: "   ",
        input: { subjectImages: ["C:\\runs\\inputs\\subject.png"] }
      }),
      {
        workflow: chatGptWorkflow,
        compatibleClients: [],
        existingRuns: [run({ workflowId: "based-blink.chatgpt.extension-image-transform", name: "Untitled (1)", input: {} })],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate.name).toBe("");
  });

  it("copies ChatGPT sequence source image, prompts, setup, and target tab", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-sequence",
        input: {
          sourceImages: ["C:\\runs\\inputs\\source.png"],
          prompts: ["Back view", "Side view"],
          masterPrompt: "Keep the same character.",
          masterPromptSuffix: "Only images.",
          extensionTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "tab-1" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      workflowId: "based-blink.chatgpt.extension-image-sequence",
      sourceFiles: ["C:\\runs\\inputs\\source.png"],
      sequencePrompts: ["Back view", "Side view"],
      masterPrompt: "Keep the same character.",
      masterPromptSuffix: "Only images.",
      extensionTabSelection: "tab-1"
    });
    expect(duplicate.filePaths).toEqual(["C:\\runs\\inputs\\source.png"]);
  });

  it("copies ChatGPT single prompt runs", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-prompt",
        input: {
          prompt: "Generate a small brass key.",
          extensionTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "tab-1" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate).toMatchObject({
      workflowId: "based-blink.chatgpt.extension-image-prompt",
      prompt: "Generate a small brass key.",
      extensionTabSelection: "tab-1"
    });
    expect(duplicate.filePaths).toEqual([]);
  });

  it("prefills the ChatGPT sequence setup suffix when old runs did not store one", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-sequence",
        input: {
          sourceImages: ["C:\\runs\\inputs\\source.png"],
          prompts: ["Back view"],
          masterPrompt: "Keep the same character.",
          extensionTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "tab-1" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate.masterPromptSuffix).toBe(DEFAULT_CHATGPT_SEQUENCE_SETUP_SUFFIX);
  });

  it("preserves a cleared ChatGPT sequence setup suffix on resubmit", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.chatgpt.extension-image-sequence",
        input: {
          sourceImages: ["C:\\runs\\inputs\\source.png"],
          prompts: ["Back view"],
          masterPrompt: "Keep the same character.",
          masterPromptSuffix: "",
          extensionTab: { mode: "existing", clientId: "tab-1" }
        }
      }),
      { workflow: chatGptWorkflow, compatibleClients: [client({ id: "tab-1" })], newExtensionTabValue: "__new__" }
    );

    expect(duplicate.masterPromptSuffix).toBe("");
  });

  it("copies Hunyuan view images, prompt, profile, settings, selectors, and defaults export back to OBJ", () => {
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
          selectors: { generateButton: "button.generate" }
        }
      }),
      { workflow: hunyuanWorkflow, compatibleClients: [], newExtensionTabValue: "__new__" }
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
      hunyuanExportFormat: "obj"
    });
    expect(JSON.parse(duplicate.hunyuanSelectorsJson)).toMatchObject({ generateButton: "button.generate" });
  });

  it("copies Hunyuan Global view images, settings, selectors, and routed tab selection", () => {
    const duplicate = buildDuplicateRunConfiguration(
      run({
        workflowId: "based-blink.hunyuan.global.image-to-model",
        input: {
          frontImage: "C:\\runs\\inputs\\front.png",
          backImage: "C:\\runs\\inputs\\back.png",
          modelFaceCount: "50k",
          retopologyType: "quad",
          generateTexture: true,
          autoRig: false,
          exportFormat: "obj",
          selectors: { loginStartText: "Start Using" },
          extensionTab: {
            mode: "new",
            routingToken: "global-route",
            url: "https://3d.hunyuanglobal.com/#based-blink-tab=global-route"
          }
        }
      }),
      {
        workflow: chatGptWorkflow,
        compatibleClients: [client({ id: "hunyuan-global-tab", routingToken: "global-route", url: "https://3d.hunyuanglobal.com/" })],
        newExtensionTabValue: "__new__"
      }
    );

    expect(duplicate).toMatchObject({
      hunyuanViewFiles: {
        frontImage: ["C:\\runs\\inputs\\front.png"],
        backImage: ["C:\\runs\\inputs\\back.png"]
      },
      hunyuanModelFaceCount: "50k",
      hunyuanRetopologyType: "quad",
      hunyuanGenerateTexture: true,
      hunyuanAutoRig: false,
      hunyuanExportFormat: "obj",
      extensionTabSelection: "hunyuan-global-tab",
      referenceFiles: [],
      subjectFiles: []
    });
    expect(JSON.parse(duplicate.hunyuanSelectorsJson)).toMatchObject({ loginStartText: "Start Using" });
  });

  it("collects unique input file paths across supported file fields", () => {
    expect(
      collectRunInputFilePaths({
        images: ["C:\\a.png", "C:\\b.png"],
        referenceImages: ["C:\\a.png"],
        subjectImages: ["C:\\c.png"],
        sourceImages: ["C:\\d.png"],
        frontImage: "C:\\e.png",
        right45Image: "C:\\f.png"
      })
    ).toEqual(["C:\\a.png", "C:\\b.png", "C:\\c.png", "C:\\d.png", "C:\\e.png", "C:\\f.png"]);
  });
});
