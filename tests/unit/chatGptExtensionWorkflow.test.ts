import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChatGptPage,
  canResumeFailedChatGptRun,
  chatGptExtensionImageTransformWorkflow,
  normalizeChatGptExtensionOutputs
} from "../../src/main/workflows/chatGptExtensionWorkflow";
import { CHATGPT_EXTENSION_PROTOCOL_VERSION, extensionBridge, type ExtensionTaskPayload, type ExtensionTaskResult } from "../../src/main/extension/extensionBridge";
import type { ArtifactRecord, RunRecord, WorkflowContext } from "../../src/main/runtime/types";

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

function createWorkflowHarness(options: { subjectCount?: number; previousOutput?: unknown } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-chatgpt-workflow-"));
  const artifactDir = path.join(dir, "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  const subjectPaths = Array.from({ length: options.subjectCount ?? 1 }, (_unused, index) =>
    path.join(dir, `subject-${index + 1}.png`)
  );
  for (const [index, subjectPath] of subjectPaths.entries()) {
    fs.writeFileSync(subjectPath, `subject ${index + 1}`);
  }
  const artifacts: ArtifactRecord[] = [];
  const outputSnapshots: unknown[] = [];
  const manualActions: Array<{ message: string; data: unknown }> = [];
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const signal = new AbortController().signal;
  let pauseRequested = false;
  const ctx: WorkflowContext = {
    runId,
    paths: {
      projectDir: dir,
      internalDir: dir,
      runRootDir: dir,
      dataDir: dir,
      artifactDir,
      browserProfilesDir: dir,
      workflowLabDir: dir,
      logsDir: dir,
      dbPath: path.join(dir, "db.sqlite")
    },
    runDir: dir,
    inputDir: dir,
    artifactDir,
    signal,
    previousOutput: options.previousOutput ?? null,
    step: async () => undefined,
    event: async () => undefined,
    updateOutput: async (output) => {
      outputSnapshots.push(output);
    },
    isPauseRequested: () => pauseRequested,
    pauseIfRequested: async (message, data) => {
      if (!pauseRequested) return;
      manualActions.push({ message, data });
      pauseRequested = false;
    },
    waitForManualAction: async (message, data) => {
      manualActions.push({ message, data });
      pauseRequested = false;
    },
    addArtifact: async (input) => {
      const artifact: ArtifactRecord = {
        id: `artifact-${artifacts.length + 1}`,
        runId,
        kind: input.kind,
        name: input.name,
        path: input.path,
        mimeType: input.mimeType ?? null,
        size: fs.existsSync(input.path) ? fs.statSync(input.path).size : 0,
        metadata: input.metadata ?? null,
        createdAt: new Date().toISOString()
      };
      artifacts.push(artifact);
      return artifact;
    }
  };

  return {
    dir,
    artifactDir,
    subjectPath: subjectPaths[0],
    subjectPaths,
    artifacts,
    outputSnapshots,
    manualActions,
    runId,
    clientId,
    ctx,
    setPauseRequested(value: boolean) {
      pauseRequested = value;
    }
  };
}

describe("ChatGPT extension workflow output normalization", () => {
  it("marks failed ChatGPT runs recoverable only when they have a checkpoint, page, or target URL", () => {
    const baseRun: RunRecord = {
      id: "run-1",
      workflowId: "chatgpt.extension-image-transform",
      name: "ChatGPT run",
      runDir: null,
      status: "failed",
      currentStep: "Failed",
      progress: 50,
      input: {
        referenceImages: [],
        subjectImages: ["C:\\tmp\\subject.png"],
        masterPrompt: "Transform",
        subjectInstruction: "",
        chatGptTab: { mode: "existing", clientId: "tab-1" }
      },
      output: null,
      error: "App exited before this run finished.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    expect(canResumeFailedChatGptRun(baseRun)).toBe(false);
    expect(
      canResumeFailedChatGptRun({
        ...baseRun,
        input: {
          ...(baseRun.input as Record<string, unknown>),
          chatGptTab: { mode: "existing", clientId: "tab-1", url: "https://chatgpt.com/c/abc" }
        }
      })
    ).toBe(true);
    expect(
      canResumeFailedChatGptRun({
        ...baseRun,
        output: {
          artifactIds: [],
          summary: "Checkpoint",
          checkpoint: { setupCompleted: true, completedSubjectIndexes: [], outputMappings: [] }
        }
      })
    ).toBe(true);
    expect(canResumeFailedChatGptRun({ ...baseRun, status: "cancelled" })).toBe(false);
  });

  it("promotes extension completion metadata into a durable ChatGPT page target", () => {
    const page = buildChatGptPage(
      { mode: "new", routingToken: "run-token-1", url: "https://chatgpt.com/" },
      { url: "https://chatgpt.com/c/abc", title: "ChatGPT conversation" },
      {
        id: "tab-1",
        url: "https://chatgpt.com/",
        title: "Initial ChatGPT",
        status: "busy",
        protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
        extensionVersion: "0.8.0",
        routingToken: "run-token-1",
        compatible: true,
        lastSeenAt: "2026-01-01T00:00:00.000Z"
      }
    );

    expect(page).toMatchObject({
      url: "https://chatgpt.com/c/abc",
      title: "ChatGPT conversation",
      clientId: "tab-1",
      routingToken: "run-token-1"
    });
    expect(page?.capturedAt).toEqual(expect.any(String));
  });

  it("falls back to the selected tab URL when completion metadata has no page URL", () => {
    const page = buildChatGptPage(
      { mode: "existing", clientId: "tab-1", url: "https://chatgpt.com/c/input", title: "Input title" },
      {},
      undefined
    );

    expect(page).toMatchObject({
      url: "https://chatgpt.com/c/input",
      title: "Input title",
      clientId: "tab-1"
    });
  });

  it("runs setup and subject phases and records checkpoint page metadata", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-chatgpt-workflow-"));
    const artifactDir = path.join(dir, "artifacts");
    fs.mkdirSync(artifactDir, { recursive: true });
    const subjectPath = path.join(dir, "subject.png");
    fs.writeFileSync(subjectPath, "subject");
    const artifacts: ArtifactRecord[] = [];
    const outputSnapshots: unknown[] = [];
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const signal = new AbortController().signal;
    const ctx: WorkflowContext = {
      runId,
      paths: {
        projectDir: dir,
        internalDir: dir,
        runRootDir: dir,
        dataDir: dir,
        artifactDir,
        browserProfilesDir: dir,
        workflowLabDir: dir,
        logsDir: dir,
        dbPath: path.join(dir, "db.sqlite")
      },
      runDir: dir,
      inputDir: dir,
      artifactDir,
      signal,
      previousOutput: null,
      step: async () => undefined,
      event: async () => undefined,
      updateOutput: async (output) => {
        outputSnapshots.push(output);
      },
      isPauseRequested: () => false,
      pauseIfRequested: async () => undefined,
      waitForManualAction: async () => {
        throw new Error("Manual action should not be requested in this test.");
      },
      addArtifact: async (input) => {
        const artifact: ArtifactRecord = {
          id: `artifact-${artifacts.length + 1}`,
          runId,
          kind: input.kind,
          name: input.name,
          path: input.path,
          mimeType: input.mimeType ?? null,
          size: fs.existsSync(input.path) ? fs.statSync(input.path).size : 0,
          metadata: input.metadata ?? null,
          createdAt: new Date().toISOString()
        };
        artifacts.push(artifact);
        return artifact;
      }
    };

    extensionBridge.heartbeat({
      id: clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.8.0",
      url: "https://chatgpt.com/c/start"
    });

    const run = chatGptExtensionImageTransformWorkflow.run(
      {
        referenceImages: [],
        subjectImages: [subjectPath],
        masterPrompt: "Transform this.",
        subjectInstruction: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId, url: "https://chatgpt.com/c/start" },
        selectors: {}
      },
      ctx
    );

    const setupTask = await waitForLeasedTask(clientId, "setup");
    extensionBridge.completeTask(setupTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/recovered", title: "Recovered conversation" }
    });

    extensionBridge.heartbeat({
      id: clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.8.0",
      url: "https://chatgpt.com/c/recovered"
    });
    const subjectTask = await waitForLeasedTask(clientId, "subject");
    extensionBridge.addTaskOutput(subjectTask.id, output(0, "subject-output"));
    extensionBridge.completeTask(subjectTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/recovered", title: "Recovered conversation" }
    });

    const result = await run;
    expect(result).toMatchObject({
      chatGptPage: { url: "https://chatgpt.com/c/recovered", clientId },
      checkpoint: { setupCompleted: true, completedSubjectIndexes: [0] }
    });
    expect(result.artifactIds).toContain("artifact-1");
    expect(outputSnapshots.some((snapshot) => JSON.stringify(snapshot).includes("https://chatgpt.com/c/recovered"))).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("pauses active subject tasks immediately and resumes by inspecting the current page first", async () => {
    const harness = createWorkflowHarness();
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/start"
    });

    const run = chatGptExtensionImageTransformWorkflow.run(
      {
        referenceImages: [],
        subjectImages: [harness.subjectPath],
        masterPrompt: "Transform this.",
        subjectInstruction: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/start" },
        selectors: {}
      },
      harness.ctx
    );

    const setupTask = await waitForLeasedTask(harness.clientId, "setup");
    extensionBridge.completeTask(setupTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/recovered", title: "Recovered conversation" }
    });

    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/recovered"
    });
    const subjectTask = await waitForLeasedTask(harness.clientId, "subject", (task) => task.subjectMode !== "capture-existing");
    harness.setPauseRequested(true);
    await waitForCondition(() => extensionBridge.taskControl(subjectTask.id, harness.clientId).cancelled);

    const captureTask = await waitForLeasedTask(harness.clientId, "subject", (task) => task.subjectMode === "capture-existing");
    expect(captureTask.subjectBaseline).toBeUndefined();
    extensionBridge.addTaskOutput(captureTask.id, output(0, "captured-existing"));
    extensionBridge.completeTask(captureTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/recovered", title: "Recovered conversation" }
    });

    const result = await run;
    expect(harness.manualActions).toHaveLength(1);
    expect(harness.manualActions[0].message).toContain("Refresh the ChatGPT page if needed");
    expect(result.checkpoint).toMatchObject({
      completedSubjectIndexes: [0],
      pausedSubject: null
    });
    expect(result.artifactIds).toContain("artifact-1");

    fs.rmSync(harness.dir, { recursive: true, force: true });
  });

  it("restores completed checkpoint subjects and captures the first unfinished subject before resubmitting", async () => {
    const harness = createWorkflowHarness({ subjectCount: 2 });
    const restoredOutputPath = path.join(harness.artifactDir, "restored-subject-1.png");
    fs.writeFileSync(restoredOutputPath, Buffer.from("restored subject 1"));
    harness.ctx.previousOutput = {
      artifactIds: ["restored-artifact-1"],
      summary: "Processed 1 of 2 ChatGPT subject image(s).",
      chatGptPage: {
        url: "https://chatgpt.com/c/recovered",
        title: "Recovered conversation",
        clientId: harness.clientId,
        capturedAt: new Date().toISOString()
      },
      checkpoint: {
        setupCompleted: true,
        completedSubjectIndexes: [0],
        outputMappings: [
          {
            subjectIndex: 0,
            subjectImage: harness.subjectPaths[0],
            pairId: "subject-1",
            artifactId: "restored-artifact-1",
            outputPath: restoredOutputPath
          }
        ],
        pausedSubject: null
      }
    };
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/recovered"
    });

    const run = chatGptExtensionImageTransformWorkflow.run(
      {
        referenceImages: [],
        subjectImages: harness.subjectPaths,
        masterPrompt: "Transform this.",
        subjectInstruction: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/recovered" },
        selectors: {}
      },
      harness.ctx
    );

    const captureTask = await waitForLeasedTask(harness.clientId, "subject", (task) => task.subjectMode === "capture-existing");
    expect(captureTask.subjectImage?.index).toBe(1);
    extensionBridge.addTaskOutput(captureTask.id, output(1, "captured-subject-2"));
    extensionBridge.completeTask(captureTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/recovered", title: "Recovered conversation" }
    });

    const result = await run;
    expect(result.checkpoint).toMatchObject({
      setupCompleted: true,
      completedSubjectIndexes: [0, 1],
      pausedSubject: null
    });
    expect(result.artifactIds).toContain("restored-artifact-1");
    expect(result.artifactIds).toContain("artifact-1");

    fs.rmSync(harness.dir, { recursive: true, force: true });
  });

  it("falls back to submit-and-capture when failed-run resume cannot capture existing output", async () => {
    const harness = createWorkflowHarness();
    harness.ctx.previousOutput = {
      artifactIds: [],
      summary: "ChatGPT setup completed.",
      chatGptPage: {
        url: "https://chatgpt.com/c/recovered",
        title: "Recovered conversation",
        clientId: harness.clientId,
        capturedAt: new Date().toISOString()
      },
      checkpoint: {
        setupCompleted: true,
        completedSubjectIndexes: [],
        outputMappings: [],
        pausedSubject: null
      }
    };
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/recovered"
    });

    const run = chatGptExtensionImageTransformWorkflow.run(
      {
        referenceImages: [],
        subjectImages: [harness.subjectPath],
        masterPrompt: "Transform this.",
        subjectInstruction: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/recovered" },
        selectors: {}
      },
      harness.ctx
    );

    const captureTask = await waitForLeasedTask(harness.clientId, "subject", (task) => task.subjectMode === "capture-existing");
    extensionBridge.completeTask(captureTask.id, {
      outputs: [],
      metadata: {
        captureAttempted: true,
        captureSucceeded: false,
        captureError: "No unique output image was visible.",
        url: "https://chatgpt.com/c/recovered",
        title: "Recovered conversation"
      }
    });
    const submitTask = await waitForLeasedTask(harness.clientId, "subject", (task) => task.subjectMode !== "capture-existing");
    expect(submitTask.subjectImage?.index).toBe(0);
    extensionBridge.addTaskOutput(submitTask.id, output(0, "resubmitted-subject-1"));
    extensionBridge.completeTask(submitTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/recovered", title: "Recovered conversation" }
    });

    const result = await run;
    expect(result.checkpoint).toMatchObject({
      completedSubjectIndexes: [0],
      pausedSubject: null
    });
    expect(harness.outputSnapshots.some((snapshot) => JSON.stringify(snapshot).includes("setup restored"))).toBe(true);

    fs.rmSync(harness.dir, { recursive: true, force: true });
  });

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

async function waitForLeasedTask(
  clientId: string,
  phase: "setup" | "subject",
  predicate: (task: ExtensionTaskPayload) => boolean = () => true
): Promise<ExtensionTaskPayload> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const task = extensionBridge.nextTask(clientId);
    if (task?.phase === phase && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${phase} task.`);
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition.");
}
