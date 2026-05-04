import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkflows, normalizeChatGptExtensionOutputs, normalizeChatGptExtensionSequenceOutputs } from "../../plugins/based-blink-chatgpt/src";
import { createWorkflowSdk } from "../../src/main/workflowSdk";

type FakeFindCompatibleClientForTarget = ReturnType<typeof createWorkflowSdk>["extension"]["browser"]["findCompatibleClientForTarget"];

function output(subjectIndex: number, base64: string) {
  return { subjectIndex, mimeType: "image/png", base64 };
}

describe("ChatGPT plugin browser-extension workflows", () => {
  const workflows = createWorkflows(createWorkflowSdk());

  it("uses generic extension tab routing instead of site-specific extension capabilities", () => {
    const workflow = workflows.find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-transform");
    expect(workflow?.manifest.uiCapabilities).toEqual(["extension.tabRouting", "extension.focusTarget"]);
    expect(workflow?.manifest.inputFields.map((field) => field.name)).toContain("extensionTab");
  });

  it("defaults the extension tab target to a routed new tab", () => {
    const workflow = workflows.find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-transform")!;
    const parsed = workflow.inputSchema.safeParse({
      subjectImages: ["C:\\tmp\\subject.png"],
      masterPrompt: "Transform this"
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const extensionTab = (parsed.data as { extensionTab: { mode: string; routingToken?: string; url?: string } }).extensionTab;
    expect(extensionTab.mode).toBe("new");
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

  it("resumes a routed new-tab checkpoint by captured extension client id", async () => {
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
        if (target.mode !== "existing" || target.clientId !== "client-1") return undefined;
        return {
          id: "client-1",
          url: "https://chatgpt.com/c/test-conversation",
          title: "ChatGPT test conversation",
          status: "connected",
          protocolVersion: 1,
          extensionVersion: "0.1.0",
          compatible: true,
          lastSeenAt: new Date().toISOString(),
          capabilities: ["inspect", "action", "extract"]
        };
      }
    });

    await run;

    expect(targets[0]).toMatchObject({ mode: "existing", clientId: "client-1" });
    expect(targets).not.toContainEqual(expect.objectContaining({ mode: "new", routingToken: "route-token" }));
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

  it("runs fresh routed tabs through the captured extension client id after connection", async () => {
    const { commandTargets, run } = runTransformWithFakeBrowser({
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
    expect(commandTargets.every((target) => target.mode === "existing" && target.clientId === "client-1")).toBe(true);
  });
});

function runTransformWithFakeBrowser(input: {
  masterPrompt: string;
  subjectInstruction: string;
  fillResults?: unknown[];
  extensionTab?: unknown;
  previousOutput?: unknown;
  findCompatibleClientForTarget?: FakeFindCompatibleClientForTarget;
  failOnNewBrowserCommand?: boolean;
  actionError?: (action: { kind: string; [key: string]: unknown }) => Error | undefined;
  waitForManualAction?: (message: string) => Promise<void>;
}): { actions: unknown[]; commandTargets: Array<{ mode: string; clientId?: string; routingToken?: string }>; run: Promise<unknown> } {
  const sdk = createWorkflowSdk();
  const actions: unknown[] = [];
  const commandTargets: Array<{ mode: string; clientId?: string; routingToken?: string }> = [];
  let fillResultIndex = 0;
  const recordCommandTarget = (target: { mode: string; clientId?: string; routingToken?: string }) => {
    commandTargets.push(target);
    if (input.failOnNewBrowserCommand && target.mode === "new") {
      throw new Error("Browser command used stale routed new-tab target.");
    }
  };
  sdk.sleep = async () => undefined;
  sdk.extension.browser = {
    protocolVersion: 1,
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
        ...(target.mode === "new" ? { routingToken: target.routingToken } : {})
      })),
    ensureRoutedTab: async (target) => {
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
            ...(candidate.mode === "new" ? { routingToken: candidate.routingToken } : {})
          })))(target);
      if (!client) throw new Error("No compatible BLINK browser controller is connected.");
      return client;
    },
    openTab: async () => ({ ok: true }),
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
      return { images: [] };
    }
  };
  const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === "based-blink.chatgpt.extension-image-transform")!;
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-fill-test-"));
  const run = workflow
    .run(
      workflow.inputSchema.parse({
        subjectImages: ["C:\\tmp\\subject.png"],
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
        updateOutput: async () => undefined,
        isPauseRequested: () => false,
        pauseIfRequested: async () => undefined,
        waitForManualAction: input.waitForManualAction ?? (async () => {
          throw new Error("Manual action was not expected in this test.");
        }),
        addArtifact: async (artifact) =>
          ({
            id: `artifact-${path.basename(artifact.path)}`,
            runId: "run-fill-test",
            kind: artifact.kind,
            name: artifact.name,
            path: artifact.path,
            mimeType: artifact.mimeType ?? null,
            size: 1,
            metadata: artifact.metadata ?? null,
            createdAt: new Date().toISOString()
          }) as never
      }
    )
    .finally(() => fs.rmSync(artifactDir, { recursive: true, force: true }));
  return { actions, commandTargets, run };
}
