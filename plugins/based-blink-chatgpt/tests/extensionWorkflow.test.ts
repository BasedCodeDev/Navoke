import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkflows,
  normalizeChatGptExtensionOutputs,
  normalizeChatGptExtensionPromptImageOutputs,
  normalizeChatGptExtensionSequenceOutputs
} from "../src";
import { createWorkflowSdk } from "../../../src/main/workflowSdk";

type FakeFindCompatibleClientForTarget = ReturnType<typeof createWorkflowSdk>["extension"]["browser"]["findCompatibleClientForTarget"];

function output(subjectIndex: number, base64: string) {
  return { subjectIndex, mimeType: "image/png", base64 };
}

describe("ChatGPT plugin browser-extension workflows", () => {
  const workflows = createWorkflows(createWorkflowSdk());

  it("uses generic extension tab routing instead of site-specific extension capabilities", () => {
    const workflow = workflows.find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-transform");
    expect(workflow?.manifest.uiCapabilities).toEqual(["extension.tabRouting", "extension.focusTarget"]);
    expect(workflow?.manifest.inputFields.map((field) => field.name)).not.toContain("extensionTab");
  });

  it("defaults the extension tab target to a routed new window", () => {
    const workflow = workflows.find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-transform")!;
    const parsed = workflow.inputSchema.safeParse({
      subjectImages: ["C:\\tmp\\subject.png"],
      masterPrompt: "Transform this"
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const extensionTab = (parsed.data as { extensionTab: { mode: string; routingToken?: string; url?: string; openMode?: string } }).extensionTab;
    expect(extensionTab.mode).toBe("new");
    expect(extensionTab.openMode).toBe("window");
    expect(extensionTab.routingToken).toEqual(expect.any(String));
    expect(extensionTab.url).toContain("based-blink-tab=");
  });

  it("normalizes one output per subject", () => {
    const normalized = normalizeChatGptExtensionOutputs([output(0, "first"), output(1, "second")], [
      "C:\\tmp\\first.png",
      "C:\\tmp\\second.png"
    ]);
    expect(normalized.map((item) => item.pairId)).toEqual(["subject-1", "subject-2"]);
  });

  it("rejects missing or duplicate subject outputs", () => {
    expect(() => normalizeChatGptExtensionOutputs([output(0, "first")], ["C:\\tmp\\first.png", "C:\\tmp\\second.png"])).toThrow(
      /did not return/
    );
    expect(() => normalizeChatGptExtensionOutputs([output(0, "first"), output(0, "second")], ["C:\\tmp\\first.png"])).toThrow(
      /distinct output images/
    );
  });

  it("normalizes one output per sequence prompt", () => {
    const normalized = normalizeChatGptExtensionSequenceOutputs([output(0, "first"), output(1, "second")], [
      "Back view",
      "Side view"
    ]);
    expect(normalized.map((item) => item.pairId)).toEqual(["prompt-1", "prompt-2"]);
  });

  it("defaults the prompt-image workflow to a routed new window", () => {
    const workflow = workflows.find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-prompt")!;
    const parsed = workflow.inputSchema.safeParse({
      prompt: "Generate a small brass key on a white background."
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const extensionTab = (parsed.data as { extensionTab: { mode: string; routingToken?: string; url?: string; openMode?: string } }).extensionTab;
    expect(extensionTab.mode).toBe("new");
    expect(extensionTab.openMode).toBe("window");
    expect(extensionTab.routingToken).toEqual(expect.any(String));
    expect(extensionTab.url).toContain("based-blink-tab=");
  });

  it("normalizes one output for a single prompt image workflow", () => {
    expect(normalizeChatGptExtensionPromptImageOutputs([output(0, "first")]).base64).toBe("first");
    expect(() => normalizeChatGptExtensionPromptImageOutputs([])).toThrow(/did not return/);
    expect(() => normalizeChatGptExtensionPromptImageOutputs([output(0, "first"), output(0, "second")])).toThrow(
      /distinct output images/
    );
  });

  it("passes master and per-subject prompt text into generic browser fill actions", async () => {
    const { actions, run } = runTransformWithFakeBrowser({
      masterPrompt: "Master prompt that must reach the browser",
      subjectInstruction: "Subject instruction that must reach the browser"
    });
    await run;

    const fillValues = actions
      .filter((action): action is { kind: "fill"; value: string } => typeof action === "object" && action !== null && (action as { kind?: string }).kind === "fill")
      .map((action) => action.value);
    expect(fillValues).toEqual([
      "Master prompt that must reach the browser",
      "Subject instruction that must reach the browser"
    ]);
  });

  it("fails before submit when a non-empty prompt fill reports no observed text", async () => {
    const { actions, run } = runTransformWithFakeBrowser({
      masterPrompt: "Prompt should be verified",
      subjectInstruction: "Subject prompt",
      fillResults: [{ ok: true, action: "fill", observedLength: 0, valueLength: 25 }]
    });

    await expect(run).rejects.toThrow(/could not verify prompt text/i);
    expect(actions.find((action) => typeof action === "object" && action !== null && (action as { kind?: string }).kind === "click")).toBeUndefined();
  });

  it("keeps empty subject instruction as an image-only submission without a subject fill", async () => {
    const { actions, run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup prompt",
      subjectInstruction: ""
    });
    await run;

    const fillValues = actions
      .filter((action): action is { kind: "fill"; value: string } => typeof action === "object" && action !== null && (action as { kind?: string }).kind === "fill")
      .map((action) => action.value);
    expect(fillValues).toEqual(["Setup prompt"]);
    expect(actions.filter((action) => typeof action === "object" && action !== null && (action as { kind?: string }).kind === "click")).toHaveLength(2);
  });

  it("resumes a routed window checkpoint by captured extension client id", async () => {
    const targets: unknown[] = [];
    const { run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup was already completed",
      subjectInstruction: "",
      extensionTab: {
        mode: "new",
        routingToken: "route-token",
        url: "https://chatgpt.com/#based-blink-tab=route-token"
      },
      previousOutput: {
        artifactIds: [],
        summary: "Waiting for ChatGPT tab before subject 1.",
        chatGptPage: {
          url: "https://chatgpt.com/#based-blink-tab=route-token",
          title: "ChatGPT",
          clientId: "client-1",
          routingToken: "route-token",
          capturedAt: new Date().toISOString()
        },
        checkpoint: {
          setupCompleted: true,
          completedSubjectIndexes: [],
          outputMappings: [],
          pausedSubject: null
        }
      },
      findCompatibleClientForTarget: (target) => {
        targets.push(target);
        if (target.mode !== "new" || target.clientId !== "client-1") return undefined;
        return {
          id: "client-1",
          url: "https://chatgpt.com/c/test-conversation",
          title: "ChatGPT test conversation",
          status: "connected",
          protocolVersion: 1,
          extensionVersion: "0.1.0",
          compatible: true,
          routingToken: "route-token",
          controllerId: "controller-1",
          tabId: 42,
          windowId: 7,
          lastSeenAt: new Date().toISOString(),
          capabilities: ["inspect", "action", "extract"]
        };
      }
    });

    await run;

    expect(targets[0]).toMatchObject({ mode: "new", clientId: "client-1", routingToken: "route-token" });
  });

  it("resubmits the unfinished subject on failed-run resume when no explicit paused subject exists", async () => {
    const { actions, run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup was already completed",
      subjectInstruction: "",
      previousOutput: {
        artifactIds: [],
        summary: "Failed after setup.",
        chatGptPage: {
          url: "https://chatgpt.example/c/test-conversation",
          title: "ChatGPT test conversation",
          clientId: "client-1",
          capturedAt: new Date().toISOString()
        },
        checkpoint: {
          setupCompleted: true,
          completedSubjectIndexes: [],
          outputMappings: [],
          pausedSubject: null
        }
      }
    });

    await run;

    expect(actions.some((action) => typeof action === "object" && action !== null && (action as { kind?: string }).kind === "attach-file")).toBe(true);
    expect(actions.some((action) => typeof action === "object" && action !== null && (action as { kind?: string }).kind === "click")).toBe(true);
  });

  it("pauses for reconnect when an extension command times out after the target disconnects", async () => {
    let commandTimedOut = false;
    const manualMessages: string[] = [];
    const { run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup was already completed",
      subjectInstruction: "",
      previousOutput: {
        artifactIds: [],
        summary: "Failed after setup.",
        chatGptPage: {
          url: "https://chatgpt.example/c/test-conversation",
          title: "ChatGPT test conversation",
          clientId: "client-1",
          capturedAt: new Date().toISOString()
        },
        checkpoint: {
          setupCompleted: true,
          completedSubjectIndexes: [],
          outputMappings: [],
          pausedSubject: null
        }
      },
      findCompatibleClientForTarget: (target) =>
        commandTimedOut
          ? undefined
          : {
              id: target.mode === "existing" ? target.clientId : "client-1",
              url: "https://chatgpt.example/c/test-conversation",
              title: "ChatGPT test conversation",
              status: "connected",
              protocolVersion: 1,
              extensionVersion: "0.1.0",
              compatible: true,
              lastSeenAt: new Date().toISOString(),
              capabilities: ["inspect", "action", "extract"]
            },
      actionError: (action) => {
        if (action.kind !== "attach-file") return undefined;
        commandTimedOut = true;
        return new Error("Timed out waiting for browser extension command test-command.");
      },
      waitForManualAction: async (message) => {
        manualMessages.push(message);
        throw new Error("manual reconnect checkpoint");
      }
    });

    await expect(run).rejects.toThrow("manual reconnect checkpoint");
    expect(manualMessages[0]).toMatch(/controller/i);
  });

  it("recovers automatically when a routed ChatGPT tab closes and the controller can reopen it", async () => {
    let failedOnce = false;
    let disconnected = false;
    const manualMessages: string[] = [];
    const ensuredTargets: unknown[] = [];
    const { run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup was already completed",
      subjectInstruction: "",
      extensionTab: {
        mode: "new",
        routingToken: "route-token",
        url: "https://chatgpt.example/#based-blink-tab=route-token"
      },
      previousOutput: {
        artifactIds: [],
        summary: "Failed after setup.",
        chatGptPage: {
          url: "https://chatgpt.example/#based-blink-tab=route-token",
          title: "ChatGPT test conversation",
          clientId: "client-1",
          routingToken: "route-token",
          capturedAt: new Date().toISOString()
        },
        checkpoint: {
          setupCompleted: true,
          completedSubjectIndexes: [],
          outputMappings: [],
          pausedSubject: null
        }
      },
      findCompatibleClientForTarget: (target) =>
        disconnected
          ? undefined
          : {
              id: target.mode === "new" && target.clientId ? target.clientId : "client-1",
              url: "https://chatgpt.example/c/test-conversation",
              title: "ChatGPT test conversation",
              status: "connected",
              protocolVersion: 6,
              extensionVersion: "0.1.8",
              routingToken: target.mode === "new" ? target.routingToken : undefined,
              compatible: true,
              lastSeenAt: new Date().toISOString(),
              capabilities: ["inspect", "action", "extract"]
            },
      ensureRoutedTab: async (target) => {
        ensuredTargets.push(target);
        disconnected = false;
        return {
          id: "client-2",
          url: "https://chatgpt.example/c/recovered",
          title: "Recovered ChatGPT tab",
          status: "connected",
          protocolVersion: 6,
          extensionVersion: "0.1.8",
          routingToken: target.mode === "new" ? target.routingToken : undefined,
          compatible: true,
          lastSeenAt: new Date().toISOString(),
          capabilities: ["inspect", "action", "extract"]
        };
      },
      actionError: (action) => {
        if (failedOnce || action.kind !== "attach-file") return undefined;
        failedOnce = true;
        disconnected = true;
        return new Error("Timed out waiting for browser extension command test-command.");
      },
      waitForManualAction: async (message) => {
        manualMessages.push(message);
        throw new Error("manual reconnect checkpoint");
      }
    });

    await run;

    expect(manualMessages).toEqual([]);
    expect(ensuredTargets.some((target) => Boolean(target && typeof target === "object" && (target as { clientId?: string }).clientId === "client-1"))).toBe(true);
  });

  it("runs fresh routed tabs through the captured extension client id after connection", async () => {
    const { commandTargets, updates, run } = runTransformWithFakeBrowser({
      masterPrompt: "Fresh routed setup prompt",
      subjectInstruction: "",
      failOnNewBrowserCommand: true,
      extensionTab: {
        mode: "new",
        routingToken: "fresh-route-token",
        url: "https://chatgpt.com/#based-blink-tab=fresh-route-token"
      }
    });

    await run;

    expect(commandTargets.length).toBeGreaterThan(0);
    expect(commandTargets.every((target) => target.mode === "new" && target.clientId === "client-1")).toBe(true);
    expect(updates.some((update) => {
      const page = (update as { chatGptPage?: { controllerId?: string; tabId?: number; windowId?: number } })?.chatGptPage;
      return page?.controllerId === "controller-1" && page.tabId === 42 && page.windowId === 7;
    })).toBe(true);
  });

  it("submits the sequence source image during setup and sends the first prompt as text only", async () => {
    const { actions, run } = runSequenceWithFakeBrowser({
      masterPrompt: "Setup prompt",
      prompts: ["First prompt"]
    });

    await run;

    expect(attachFileNames(actions)).toEqual([["source.png"]]);
    expect(fillActionValues(actions)).toEqual(["Setup prompt", "First prompt"]);
  });

  it("submits a single prompt and captures one generated image", async () => {
    const generatedBase64 = Buffer.from("single prompt generated output").toString("base64");
    const { actions, artifacts, run } = runPromptImageWithFakeBrowser({
      prompt: "Generate a small brass key on a white background.",
      imageExtractResult: {
        images: [
          {
            src: "https://images.example.test/content?id=file_prompt_image",
            fingerprint: "https://images.example.test/content?id=file_prompt_image|512x512",
            stableSourceId: "id:file_prompt_image",
            alt: "Generated image",
            messageRole: "assistant",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: generatedBase64
          }
        ]
      }
    });

    await run;

    expect(attachFileNames(actions)).toEqual([]);
    expect(fillActionValues(actions)).toEqual(["Generate a small brass key on a white background."]);
    expect(clickActionCount(actions)).toBe(1);
    expect(artifacts.map((artifact) => artifact.base64)).toEqual([generatedBase64]);
  });

  it("captures an existing prompt image after a post-submit extension disconnect without resubmitting", async () => {
    const prompt = "Generate a small silver button on a plain white background.";
    const generatedBase64 = Buffer.from("single prompt generated output after disconnect").toString("base64");
    let failedClick = false;
    let failedCaptureExtract = false;
    const { actions, artifacts, run } = runPromptImageWithFakeBrowser({
      prompt,
      actionError: (action) => {
        if (failedClick || action.kind !== "click") return undefined;
        failedClick = true;
        return new Error("Timed out waiting for browser extension command test-command.");
      },
      extractError: (query) => {
        if (failedCaptureExtract || query.kind !== "images" || !query.includeBase64) return undefined;
        failedCaptureExtract = true;
        return new Error("Timed out waiting for browser extension command test-command.");
      },
      imageExtractResult: {
        images: [
          {
            src: "https://images.example.test/content?id=file_prompt_image_after_disconnect",
            fingerprint: "https://images.example.test/content?id=file_prompt_image_after_disconnect|512x512",
            stableSourceId: "id:file_prompt_image_after_disconnect",
            alt: "Generated image",
            messageRole: "assistant",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: generatedBase64
          }
        ]
      }
    });

    await run;

    expect(fillActionValues(actions)).toEqual([prompt]);
    expect(clickActionCount(actions)).toBe(1);
    expect(artifacts.map((artifact) => artifact.base64)).toEqual([generatedBase64]);
  });

  it("appends the sequence setup prompt suffix when it is provided", async () => {
    const { actions, run } = runSequenceWithFakeBrowser({
      masterPrompt: "Setup prompt",
      masterPromptSuffix: 'Only generate images. Respond "Ready".',
      prompts: ["First prompt"]
    });

    await run;

    expect(fillActionValues(actions)).toEqual(['Setup prompt\n\nOnly generate images. Respond "Ready".', "First prompt"]);
  });

  it("baselines text-only sequence prompts immediately before submit", async () => {
    const priorSetupBase64 = Buffer.from("lazy setup generated image").toString("base64");
    const prompt1Base64 = Buffer.from("prompt 1 generated back view").toString("base64");
    const { artifacts, run } = runSequenceWithFakeBrowser({
      masterPrompt: "Setup prompt",
      prompts: ["Back"],
      imageBaselineResults: [
        { images: [] },
        { images: [] },
        {
          images: [
            {
              fingerprint: "https://images.example.test/content?id=file_setup&sig=old|512x512",
              stableSourceId: "id:file_setup"
            }
          ]
        }
      ],
      imageExtractResults: [
        {
          images: [
            {
              src: "https://images.example.test/content?id=file_setup&sig=new",
              fingerprint: "https://images.example.test/content?id=file_setup&sig=new|512x512",
              stableSourceId: "id:file_setup",
              alt: "Generated image",
              messageRole: "assistant",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: priorSetupBase64
            },
            {
              src: "https://images.example.test/content?id=file_prompt_1",
              fingerprint: "https://images.example.test/content?id=file_prompt_1|512x512",
              stableSourceId: "id:file_prompt_1",
              alt: "Generated image",
              messageRole: "assistant",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: prompt1Base64
            }
          ]
        }
      ]
    });

    await run;

    expect(artifacts.map((artifact) => artifact.base64)).toEqual([prompt1Base64]);
  });

  it("submits an image-only sequence setup when no setup prompt is provided", async () => {
    const { actions, run } = runSequenceWithFakeBrowser({
      masterPrompt: "",
      prompts: ["First prompt"]
    });

    await run;

    expect(attachFileNames(actions)).toEqual([["source.png"]]);
    expect(fillActionValues(actions)).toEqual(["First prompt"]);
    expect(clickActionCount(actions)).toBe(2);
  });

  it("attaches the previous generated sequence result after the first prompt", async () => {
    const { actions, run } = runSequenceWithFakeBrowser({
      masterPrompt: "Setup prompt",
      prompts: ["First prompt", "Second prompt"]
    });

    await run;

    const attachedFiles = attachFileNames(actions);
    expect(attachedFiles).toHaveLength(2);
    expect(attachedFiles[0]).toEqual(["source.png"]);
    expect(attachedFiles[1][0]).toMatch(/source-prompt-01-chatgpt\.png$/);
    expect(fillActionValues(actions)).toEqual(["Setup prompt", "First prompt", "Second prompt"]);
  });

  it("captures the latest generated image instead of reversing image extraction order", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-output-capture-"));
    const subjectPath = path.join(tempDir, "subject.png");
    const uploadedBytes = Buffer.from("uploaded subject image bytes");
    fs.writeFileSync(subjectPath, uploadedBytes);
    const uploadedBase64 = uploadedBytes.toString("base64");
    const generatedBase64 = Buffer.from("generated output image bytes").toString("base64");

    try {
      const { artifacts, run } = runTransformWithFakeBrowser({
        masterPrompt: "Setup prompt",
        subjectInstruction: "",
        subjectImages: [subjectPath],
        imageExtractResult: {
          images: [
            {
              src: "blob:generated",
              fingerprint: "blob:generated|512x512",
              alt: "Generated image",
              messageRole: "assistant",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: generatedBase64
            },
            {
              src: "blob:uploaded",
              fingerprint: "blob:uploaded|512x512",
              messageRole: "user",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: uploadedBase64
            }
          ]
        }
      });

      await run;

      expect(artifacts.map((artifact) => artifact.base64)).toEqual([generatedBase64]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("derives ChatGPT image roles from generic ancestor attributes", async () => {
    const assistantBase64 = Buffer.from("assistant generated output image bytes").toString("base64");
    const ambiguousBase64 = Buffer.from("ambiguous page image bytes").toString("base64");
    const { artifacts, run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup prompt",
      subjectInstruction: "",
      imageExtractResult: {
        images: [
          {
            src: "blob:ambiguous",
            fingerprint: "blob:ambiguous|512x512",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: ambiguousBase64
          },
          {
            src: "blob:assistant-ancestor",
            fingerprint: "blob:assistant-ancestor|512x512",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: assistantBase64,
            ancestor: {
              attributes: {
                "data-message-author-role": "assistant"
              }
            }
          }
        ]
      }
    });

    await run;

    expect(artifacts.map((artifact) => artifact.base64)).toEqual([assistantBase64]);
  });

  it("deduplicates repeated DOM nodes for the same generated image", async () => {
    const generatedBase64 = Buffer.from("generated output image bytes").toString("base64");
    const { artifacts, run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup prompt",
      subjectInstruction: "",
      imageExtractResult: {
        images: [
          {
            src: "https://chatgpt.example/generated?id=file-1",
            fingerprint: "https://chatgpt.example/generated?id=file-1|512x512",
            stableSourceId: "id:file-1",
            alt: "Generated image",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: generatedBase64
          },
          {
            src: "https://chatgpt.example/generated?id=file-1",
            fingerprint: "https://chatgpt.example/generated?id=file-1|512x512",
            stableSourceId: "id:file-1",
            alt: "Generated image",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: generatedBase64
          },
          {
            src: "https://chatgpt.example/generated?id=file-1",
            fingerprint: "https://chatgpt.example/generated?id=file-1|512x512",
            stableSourceId: "id:file-1",
            alt: "",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: generatedBase64
          }
        ]
      }
    });

    await run;

    expect(artifacts.map((artifact) => artifact.base64)).toEqual([generatedBase64]);
  });

  it("skips a captured image when it is byte-identical to the uploaded subject", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-output-skip-upload-"));
    const subjectPath = path.join(tempDir, "subject.png");
    const uploadedBytes = Buffer.from("uploaded subject image bytes");
    fs.writeFileSync(subjectPath, uploadedBytes);
    const uploadedBase64 = uploadedBytes.toString("base64");
    const generatedBase64 = Buffer.from("generated output image bytes").toString("base64");

    try {
      const { artifacts, run } = runTransformWithFakeBrowser({
        masterPrompt: "Setup prompt",
        subjectInstruction: "",
        subjectImages: [subjectPath],
        imageExtractResult: {
          images: [
            {
              src: "blob:uploaded",
              fingerprint: "blob:uploaded|512x512",
              messageRole: "user",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: uploadedBase64
            },
            {
              src: "blob:generated",
              fingerprint: "blob:generated|512x512",
              alt: "Generated image",
              messageRole: "assistant",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: generatedBase64
            }
          ]
        }
      });

      await run;

      expect(artifacts.map((artifact) => artifact.base64)).toEqual([generatedBase64]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("captures the generated sequence result when a submitted upload preview appears first", async () => {
    const prompt1Base64 = Buffer.from("prompt 1 generated back view").toString("base64");
    const uploadedPreviewBase64 = Buffer.from("prompt 1 uploaded preview reencoded").toString("base64");
    const prompt2Base64 = Buffer.from("prompt 2 generated left view").toString("base64");
    const prompt3Base64 = Buffer.from("prompt 3 generated right view").toString("base64");
    const { actions, artifacts, run } = runSequenceWithFakeBrowser({
      masterPrompt: "Setup prompt",
      prompts: ["Back", "Left", "Right"],
      imageExtractResults: [
        {
          images: [
            {
              src: "https://images.example.test/content?id=file_prompt_1",
              fingerprint: "https://images.example.test/content?id=file_prompt_1|512x512",
              stableSourceId: "id:file_prompt_1",
              alt: "Generated image",
              messageRole: "assistant",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: prompt1Base64
            }
          ]
        },
        {
          images: [
            {
              src: "https://images.example.test/content?id=file_uploaded_preview_new",
              fingerprint: "https://images.example.test/content?id=file_uploaded_preview_new|512x512",
              stableSourceId: "id:file_uploaded_preview_new",
              alt: "Generated image",
              messageRole: "user",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: uploadedPreviewBase64
            },
            {
              src: "https://images.example.test/content?id=file_prompt_2",
              fingerprint: "https://images.example.test/content?id=file_prompt_2|512x512",
              stableSourceId: "id:file_prompt_2",
              alt: "Generated image",
              messageRole: "assistant",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: prompt2Base64
            }
          ]
        },
        {
          images: [
            {
              src: "https://images.example.test/content?id=file_prompt_3",
              fingerprint: "https://images.example.test/content?id=file_prompt_3|512x512",
              stableSourceId: "id:file_prompt_3",
              alt: "Generated image",
              messageRole: "assistant",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: prompt3Base64
            }
          ]
        }
      ]
    });

    await run;

    expect(artifacts.map((artifact) => artifact.base64)).toEqual([prompt1Base64, prompt2Base64, prompt3Base64]);
    const attachedFiles = attachFileNames(actions);
    expect(attachedFiles[1][0]).toMatch(/source-prompt-01-chatgpt\.png$/);
    expect(attachedFiles[2][0]).toMatch(/source-prompt-02-chatgpt\.png$/);
  });

  it("ignores a re-signed prior generated image with the same stable source id", async () => {
    const priorBase64 = Buffer.from("prior generated output").toString("base64");
    const currentBase64 = Buffer.from("current generated output").toString("base64");
    const { artifacts, run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup prompt",
      subjectInstruction: "",
      imageBaselineResults: [
        { images: [{ fingerprint: "old-signature|512x512", stableSourceId: "id:file_prior" }] },
        { images: [{ fingerprint: "old-signature|512x512", stableSourceId: "id:file_prior" }] },
        { images: [{ fingerprint: "old-signature|512x512", stableSourceId: "id:file_prior" }] }
      ],
      imageExtractResult: {
        images: [
          {
            src: "https://images.example.test/content?id=file_prior&sig=new",
            fingerprint: "new-signature|512x512",
            stableSourceId: "id:file_prior",
            alt: "Generated image",
            messageRole: "assistant",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: priorBase64
          },
          {
            src: "https://images.example.test/content?id=file_current",
            fingerprint: "current|512x512",
            stableSourceId: "id:file_current",
            alt: "Generated image",
            messageRole: "assistant",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: currentBase64
          }
        ]
      }
    });

    await run;

    expect(artifacts.map((artifact) => artifact.base64)).toEqual([currentBase64]);
  });

  it("times out instead of capturing a re-signed prior generated image as the current output", async () => {
    const priorBase64 = Buffer.from("prior generated output").toString("base64");
    const { run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup prompt",
      subjectInstruction: "",
      useFastTimeoutClock: true,
      imageBaselineResults: [
        { images: [{ fingerprint: "old-signature|512x512", stableSourceId: "id:file_prior" }] },
        { images: [{ fingerprint: "old-signature|512x512", stableSourceId: "id:file_prior" }] },
        { images: [{ fingerprint: "old-signature|512x512", stableSourceId: "id:file_prior" }] }
      ],
      imageExtractResult: {
        images: [
          {
            src: "https://images.example.test/content?id=file_prior&sig=new",
            fingerprint: "new-signature|512x512",
            stableSourceId: "id:file_prior",
            alt: "Generated image",
            messageRole: "assistant",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: priorBase64
          }
        ]
      }
    });

    await expect(run).rejects.toThrow(/Timed out waiting for a new ChatGPT output image/);
  });

  it("fails strictly when a response has multiple generated output images", async () => {
    const { run } = runTransformWithFakeBrowser({
      masterPrompt: "Setup prompt",
      subjectInstruction: "",
      imageExtractResult: {
        images: [
          {
            src: "blob:first-generated",
            fingerprint: "blob:first-generated|512x512",
            alt: "Generated image",
            messageRole: "assistant",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: Buffer.from("first generated").toString("base64")
          },
          {
            src: "blob:second-generated",
            fingerprint: "blob:second-generated|512x512",
            alt: "Generated image",
            messageRole: "assistant",
            width: 512,
            height: 512,
            mimeType: "image/png",
            base64: Buffer.from("second generated").toString("base64")
          }
        ]
      }
    });

    await expect(run).rejects.toThrow(/returned 2 distinct output image candidates/);
  });
});

function runTransformWithFakeBrowser(input: {
  masterPrompt: string;
  subjectInstruction: string;
  subjectImages?: string[];
  fillResults?: unknown[];
  imageExtractResult?: { images: Array<Record<string, unknown>> };
  imageExtractResults?: Array<{ images: Array<Record<string, unknown>> }>;
  imageBaselineResults?: Array<{ images: Array<Record<string, unknown>> }>;
  useFastTimeoutClock?: boolean;
  extensionTab?: unknown;
  previousOutput?: unknown;
  findCompatibleClientForTarget?: FakeFindCompatibleClientForTarget;
  ensureRoutedTab?: ReturnType<typeof createWorkflowSdk>["extension"]["browser"]["ensureRoutedTab"];
  failOnNewBrowserCommand?: boolean;
  actionError?: (action: { kind: string; [key: string]: unknown }) => Error | undefined;
  waitForManualAction?: (message: string) => Promise<void>;
}): {
  actions: unknown[];
  artifacts: Array<{ path: string; base64: string }>;
  commandTargets: Array<{ mode: string; clientId?: string; routingToken?: string }>;
  updates: unknown[];
  run: Promise<unknown>;
} {
  const sdk = createWorkflowSdk();
  const actions: unknown[] = [];
  const artifacts: Array<{ path: string; base64: string }> = [];
  const commandTargets: Array<{ mode: string; clientId?: string; routingToken?: string }> = [];
  const updates: unknown[] = [];
  let fillResultIndex = 0;
  let imageExtractIndex = 0;
  let imageBaselineIndex = 0;
  let fakeNow = Date.now();
  const nowSpy = input.useFastTimeoutClock ? vi.spyOn(Date, "now").mockImplementation(() => fakeNow) : undefined;
  const recordCommandTarget = (target: { mode: string; clientId?: string; routingToken?: string }) => {
    commandTargets.push(target);
    if (input.failOnNewBrowserCommand && target.mode === "new" && !target.clientId) {
      throw new Error("Browser command used stale routed new-tab target before client capture.");
    }
  };
  sdk.sleep = async (ms) => {
    if (input.useFastTimeoutClock) fakeNow += Math.max(ms, 3_600_000);
  };
  sdk.extension.browser = {
    protocolVersion: 6,
    findCompatibleClientForTarget:
      input.findCompatibleClientForTarget ??
      ((target) => ({
        id: target.mode === "existing" ? target.clientId : "client-1",
        url: target.mode === "new" ? (target.url ?? "https://chatgpt.example/#based-blink-tab=token") : "https://chatgpt.example/",
        title: "ChatGPT test tab",
        status: "connected",
        protocolVersion: 1,
        extensionVersion: "0.1.0",
        compatible: true,
        lastSeenAt: new Date().toISOString(),
        capabilities: ["inspect", "action", "extract"],
        controllerId: "controller-1",
        tabId: 42,
        windowId: 7,
        ...(target.mode === "new" ? { routingToken: target.routingToken } : {})
      })),
    ensureRoutedTab: async (target) => {
      if (input.ensureRoutedTab) return input.ensureRoutedTab(target);
      const client =
        (input.findCompatibleClientForTarget ??
          ((candidate) => ({
            id: candidate.mode === "existing" ? candidate.clientId : "client-1",
            url: candidate.mode === "new" ? (candidate.url ?? "https://chatgpt.example/#based-blink-tab=token") : "https://chatgpt.example/",
            title: "ChatGPT test tab",
            status: "connected",
            protocolVersion: 1,
            extensionVersion: "0.1.0",
            compatible: true,
            lastSeenAt: new Date().toISOString(),
            capabilities: ["inspect", "action", "extract"],
            controllerId: "controller-1",
            tabId: 42,
            windowId: 7,
            ...(candidate.mode === "new" ? { routingToken: candidate.routingToken } : {})
          })))(target);
      if (!client) throw new Error("No compatible BLINK browser controller is connected.");
      return client;
    },
    openTab: async () => ({ ok: true }),
    openWindow: async () => ({ ok: true }),
    closeTab: async () => ({ ok: true }),
    focusTarget: async () => ({ ok: true }),
    startDownloadWatch: () => ({ id: "download-watch-1", startedAt: new Date().toISOString() }),
    waitForDownload: async () => ({
      watchId: "download-watch-1",
      filename: "C:\\tmp\\unused-download.zip",
      state: "complete",
      completedAt: new Date().toISOString()
    }),
    stageFiles: (filePaths) =>
      filePaths.map((filePath, index) => ({
        id: `file-${index}`,
        name: path.basename(filePath),
        mimeType: "image/png",
        url: `/api/extension/files/file-${index}`
      })),
    executeCommand: async () => ({}),
    inspect: async (target) => {
      recordCommandTarget(target);
      return { url: "https://chatgpt.example/c/test-conversation", title: "ChatGPT test tab" };
    },
    action: async (target, action) => {
      recordCommandTarget(target);
      actions.push(action);
      const actionError = input.actionError?.(action as { kind: string; [key: string]: unknown });
      if (actionError) throw actionError;
      if (action.kind === "fill") {
        const fallback = { ok: true, action: "fill", observedLength: action.value.length, valueLength: action.value.length };
        return input.fillResults?.[fillResultIndex++] ?? fallback;
      }
      return { ok: true };
    },
    wait: async () => ({ satisfied: true }),
    extract: async (target, query) => {
      recordCommandTarget(target);
      if (query.kind === "element-state") {
        if (String(query.selector).toLowerCase().includes("remove file")) {
          return { count: 0, visible: false, disabled: false };
        }
        return String(query.selector).toLowerCase().includes("stop")
          ? { count: 0, visible: false, disabled: false }
          : { count: 1, visible: true, disabled: false };
      }
      if (query.kind === "images" && query.includeBase64) {
        const configured = input.imageExtractResults?.[imageExtractIndex];
        if (configured) {
          imageExtractIndex += 1;
          return configured;
        }
        if (input.imageExtractResult) return input.imageExtractResult;
        return {
          images: [
            {
              src: "blob:test-output",
              fingerprint: "blob:test-output|512x512",
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: Buffer.from("fake image").toString("base64")
            }
          ]
        };
      }
      if (query.kind === "images") {
        const configured = input.imageBaselineResults?.[imageBaselineIndex];
        if (configured) {
          imageBaselineIndex += 1;
          return configured;
        }
        return { images: [] };
      }
      return { images: [] };
    }
  };
  const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-transform")!;
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-fill-test-"));
  const run = workflow
    .run(
      workflow.inputSchema.parse({
        subjectImages: input.subjectImages ?? ["C:\\tmp\\subject.png"],
        masterPrompt: input.masterPrompt,
        subjectInstruction: input.subjectInstruction,
        extensionTab: input.extensionTab ?? { mode: "existing", clientId: "client-1" }
      }),
      {
        runId: "run-fill-test",
        artifactDir,
        signal: new AbortController().signal,
        previousOutput: input.previousOutput ?? null,
        step: async () => undefined,
        event: async () => undefined,
        updateOutput: async (output) => {
          updates.push(output);
        },
        isPauseRequested: () => false,
        pauseIfRequested: async () => undefined,
        waitForManualAction: input.waitForManualAction ?? (async () => {
          throw new Error("Manual action was not expected in this test.");
        }),
        addArtifact: async (artifact) => {
          if (artifact.kind === "image") {
            artifacts.push({ path: artifact.path, base64: fs.readFileSync(artifact.path).toString("base64") });
          }
          return ({
            id: `artifact-${path.basename(artifact.path)}`,
            runId: "run-fill-test",
            kind: artifact.kind,
            name: artifact.name,
            path: artifact.path,
            mimeType: artifact.mimeType ?? null,
            size: 1,
            metadata: artifact.metadata ?? null,
            createdAt: new Date().toISOString()
          }) as never;
        }
      }
    )
    .finally(() => {
      nowSpy?.mockRestore();
      fs.rmSync(artifactDir, { recursive: true, force: true });
    });
  return { actions, artifacts, commandTargets, updates, run };
}

function runPromptImageWithFakeBrowser(input: {
  prompt: string;
  imageExtractResult?: { images: Array<Record<string, unknown>> };
  actionError?: (action: { kind: string; [key: string]: unknown }) => Error | undefined;
  extractError?: (query: { kind: string; [key: string]: unknown }) => Error | undefined;
}): {
  actions: unknown[];
  artifacts: Array<{ path: string; base64: string }>;
  run: Promise<unknown>;
} {
  const sdk = createWorkflowSdk();
  const actions: unknown[] = [];
  const artifacts: Array<{ path: string; base64: string }> = [];

  sdk.sleep = async () => undefined;
  sdk.extension.browser = {
    protocolVersion: 6,
    status: () => ({
      requiredProtocolVersion: 6,
      connected: 1,
      compatible: 1,
      incompatible: 0,
      connectedClients: [],
      clients: [],
      connectedControllers: [],
      controllers: [],
      compatibleControllers: 1,
      incompatibleControllers: 0,
      controllerDiagnostics: {
        compatibleTabsWithController: 1,
        compatibleTabsWithoutController: 0,
        latestControllerHeartbeatAt: "",
        latestControllerHeartbeatOk: true,
        connectedTabDiagnostics: []
      },
      controllerCommandDiagnostics: {
        pendingCount: 0,
        runningCount: 0,
        lastPollAt: "",
        lastPollControllerId: "",
        lastPollResult: "none",
        lastCompletionAt: "",
        lastCompletionCommandId: "",
        lastCompletionStatus: "completed",
        recentCommands: []
      }
    }),
    findCompatibleClientForTarget: (target) => ({
      id: target.mode === "existing" ? target.clientId : "client-1",
      url: "https://chatgpt.example/c/test-conversation",
      title: "ChatGPT test tab",
      status: "connected",
      protocolVersion: 6,
      extensionVersion: "0.1.0",
      compatible: true,
      lastSeenAt: new Date().toISOString(),
      capabilities: ["inspect", "action", "extract"]
    }),
    ensureRoutedTab: async (target) => ({
      id: target.mode === "existing" ? target.clientId : "client-1",
      url: "https://chatgpt.example/c/test-conversation",
      title: "ChatGPT test tab",
      status: "connected",
      protocolVersion: 6,
      extensionVersion: "0.1.0",
      compatible: true,
      lastSeenAt: new Date().toISOString(),
      capabilities: ["inspect", "action", "extract"]
    }),
    openTab: async () => ({ ok: true }),
    openWindow: async () => ({ ok: true }),
    closeTab: async () => ({ ok: true }),
    focusTarget: async () => ({ ok: true }),
    stageFiles: (filePaths) =>
      filePaths.map((filePath, index) => ({
        id: `file-${index}`,
        name: path.basename(filePath),
        mimeType: "image/png",
        url: `/api/extension/files/file-${index}`
      })),
    startDownloadWatch: () => ({ id: "watch-1", startedAt: new Date().toISOString() }),
    waitForDownload: async () => ({
      watchId: "watch-1",
      filename: "C:\\tmp\\unused-download.zip",
      state: "complete",
      completedAt: new Date().toISOString()
    }),
    executeCommand: async () => ({}),
    inspect: async () => ({ url: "https://chatgpt.example/c/test-conversation", title: "ChatGPT test tab" }),
    action: async (_target, action) => {
      actions.push(action);
      const actionError = input.actionError?.(action as { kind: string; [key: string]: unknown });
      if (actionError) throw actionError;
      if (action.kind === "fill") {
        return { ok: true, action: "fill", observedLength: action.value.length, valueLength: action.value.length };
      }
      return { ok: true };
    },
    wait: async () => ({ satisfied: true }),
    extract: async (_target, query) => {
      const extractError = input.extractError?.(query as { kind: string; [key: string]: unknown });
      if (extractError) throw extractError;
      if (query.kind === "element-state") {
        if (String(query.selector).toLowerCase().includes("remove file")) {
          return { count: 0, visible: false, disabled: false };
        }
        return String(query.selector).toLowerCase().includes("stop")
          ? { count: 0, visible: false, disabled: false }
          : { count: 1, visible: true, disabled: false };
      }
      if (query.kind === "images" && query.includeBase64) {
        return (
          input.imageExtractResult ?? {
            images: [
              {
                src: "blob:prompt-output",
                fingerprint: "blob:prompt-output|512x512",
                alt: "Generated image",
                width: 512,
                height: 512,
                mimeType: "image/png",
                base64: Buffer.from("single prompt generated image").toString("base64")
              }
            ]
          }
        );
      }
      if (query.kind === "images") return { images: [] };
      return {};
    }
  };

  const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-prompt")!;
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-prompt-image-test-"));
  const run = workflow
    .run(
      workflow.inputSchema.parse({
        prompt: input.prompt,
        extensionTab: { mode: "existing", clientId: "client-1" }
      }),
      {
        runId: "run-prompt-image-test",
        artifactDir,
        signal: new AbortController().signal,
        previousOutput: null,
        step: async () => undefined,
        event: async () => undefined,
        updateOutput: async () => undefined,
        isPauseRequested: () => false,
        pauseIfRequested: async () => undefined,
        waitForManualAction: async () => {
          throw new Error("Manual action was not expected in this test.");
        },
        addArtifact: async (artifact) => {
          if (artifact.kind === "image") {
            artifacts.push({ path: artifact.path, base64: fs.readFileSync(artifact.path).toString("base64") });
          }
          return ({
            id: `artifact-${path.basename(artifact.path)}`,
            runId: "run-prompt-image-test",
            kind: artifact.kind,
            name: artifact.name,
            path: artifact.path,
            mimeType: artifact.mimeType ?? null,
            size: 1,
            metadata: artifact.metadata ?? null,
            createdAt: new Date().toISOString()
          }) as never;
        }
      }
    )
    .finally(() => fs.rmSync(artifactDir, { recursive: true, force: true }));
  return { actions, artifacts, run };
}

function runSequenceWithFakeBrowser(input: {
  masterPrompt: string;
  masterPromptSuffix?: string;
  prompts: string[];
  imageExtractResults?: Array<{ images: Array<Record<string, unknown>> }>;
  imageBaselineResults?: Array<{ images: Array<Record<string, unknown>> }>;
}): {
  actions: unknown[];
  artifacts: Array<{ path: string; base64: string }>;
  run: Promise<unknown>;
} {
  const sdk = createWorkflowSdk();
  const actions: unknown[] = [];
  const artifacts: Array<{ path: string; base64: string }> = [];
  let outputIndex = 0;
  let imageBaselineIndex = 0;

  sdk.sleep = async () => undefined;
  sdk.extension.browser = {
    protocolVersion: 6,
    findCompatibleClientForTarget: (target) => ({
      id: target.mode === "existing" ? target.clientId : "client-1",
      url: "https://chatgpt.example/c/test-conversation",
      title: "ChatGPT test tab",
      status: "connected",
      protocolVersion: 1,
      extensionVersion: "0.1.0",
      compatible: true,
      lastSeenAt: new Date().toISOString(),
      capabilities: ["inspect", "action", "extract"]
    }),
    ensureRoutedTab: async (target) => ({
      id: target.mode === "existing" ? target.clientId : "client-1",
      url: "https://chatgpt.example/c/test-conversation",
      title: "ChatGPT test tab",
      status: "connected",
      protocolVersion: 1,
      extensionVersion: "0.1.0",
      compatible: true,
      lastSeenAt: new Date().toISOString(),
      capabilities: ["inspect", "action", "extract"]
    }),
    openTab: async () => ({ ok: true }),
    openWindow: async () => ({ ok: true }),
    closeTab: async () => ({ ok: true }),
    focusTarget: async () => ({ ok: true }),
    startDownloadWatch: () => ({ id: "download-watch-1", startedAt: new Date().toISOString() }),
    waitForDownload: async () => ({
      watchId: "download-watch-1",
      filename: "C:\\tmp\\unused-download.zip",
      state: "complete",
      completedAt: new Date().toISOString()
    }),
    stageFiles: (filePaths) =>
      filePaths.map((filePath, index) => ({
        id: `file-${index}`,
        name: path.basename(filePath),
        mimeType: "image/png",
        url: `/api/extension/files/file-${index}`
      })),
    executeCommand: async () => ({}),
    inspect: async () => ({ url: "https://chatgpt.example/c/test-conversation", title: "ChatGPT test tab" }),
    action: async (_target, action) => {
      actions.push(action);
      if (action.kind === "fill") {
        return { ok: true, action: "fill", observedLength: action.value.length, valueLength: action.value.length };
      }
      return { ok: true };
    },
    wait: async () => ({ satisfied: true }),
    extract: async (_target, query) => {
      if (query.kind === "element-state") {
        if (String(query.selector).toLowerCase().includes("remove file")) {
          return { count: 0, visible: false, disabled: false };
        }
        return String(query.selector).toLowerCase().includes("stop")
          ? { count: 0, visible: false, disabled: false }
          : { count: 1, visible: true, disabled: false };
      }
      if (query.kind === "images" && query.includeBase64) {
        const configured = input.imageExtractResults?.[outputIndex];
        if (configured) {
          outputIndex += 1;
          return configured;
        }
        outputIndex += 1;
        return {
          images: [
            {
              src: `blob:sequence-output-${outputIndex}`,
              fingerprint: `blob:sequence-output-${outputIndex}|512x512`,
              width: 512,
              height: 512,
              mimeType: "image/png",
              base64: Buffer.from(`sequence generated image ${outputIndex}`).toString("base64")
            }
          ]
        };
      }
      if (query.kind === "images") {
        const configured = input.imageBaselineResults?.[imageBaselineIndex];
        if (configured) {
          imageBaselineIndex += 1;
          return configured;
        }
        return { images: [] };
      }
      return { images: [] };
    }
  };

  const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-sequence")!;
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-sequence-test-"));
  const run = workflow
    .run(
      workflow.inputSchema.parse({
        sourceImages: ["C:\\tmp\\source.png"],
        masterPrompt: input.masterPrompt,
        masterPromptSuffix: input.masterPromptSuffix,
        prompts: input.prompts,
        extensionTab: { mode: "existing", clientId: "client-1" }
      }),
      {
        runId: "run-sequence-test",
        artifactDir,
        signal: new AbortController().signal,
        previousOutput: null,
        step: async () => undefined,
        event: async () => undefined,
        updateOutput: async () => undefined,
        isPauseRequested: () => false,
        pauseIfRequested: async () => undefined,
        waitForManualAction: async () => {
          throw new Error("Manual action was not expected in this test.");
        },
        addArtifact: async (artifact) => {
          if (artifact.kind === "image") {
            artifacts.push({ path: artifact.path, base64: fs.readFileSync(artifact.path).toString("base64") });
          }
          return ({
            id: `artifact-${path.basename(artifact.path)}`,
            runId: "run-sequence-test",
            kind: artifact.kind,
            name: artifact.name,
            path: artifact.path,
            mimeType: artifact.mimeType ?? null,
            size: 1,
            metadata: artifact.metadata ?? null,
            createdAt: new Date().toISOString()
          }) as never;
        }
      }
    )
    .finally(() => fs.rmSync(artifactDir, { recursive: true, force: true }));
  return { actions, artifacts, run };
}

function fillActionValues(actions: unknown[]): string[] {
  return actions
    .filter((action): action is { kind: "fill"; value: string } => Boolean(action && typeof action === "object" && (action as { kind?: string }).kind === "fill"))
    .map((action) => action.value);
}

function attachFileNames(actions: unknown[]): string[][] {
  return actions
    .filter((action): action is { kind: "attach-file"; files: Array<{ name: string }> } =>
      Boolean(action && typeof action === "object" && (action as { kind?: string }).kind === "attach-file")
    )
    .map((action) => action.files.map((file) => file.name));
}

function clickActionCount(actions: unknown[]): number {
  return actions.filter((action) => Boolean(action && typeof action === "object" && (action as { kind?: string }).kind === "click")).length;
}
