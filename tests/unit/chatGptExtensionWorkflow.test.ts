import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChatGptPage,
  createWorkflows,
  normalizeChatGptExtensionOutputs,
  normalizeChatGptExtensionSequenceOutputs
} from "../../plugins/workflows/based-blink-chatgpt/src";
import { CHATGPT_EXTENSION_PROTOCOL_VERSION, extensionBridge, type ExtensionTaskPayload, type ExtensionTaskResult } from "../../src/main/extension/extensionBridge";
import type { ArtifactRecord, RunRecord, WorkflowContext, WorkflowDefinition } from "../../src/main/runtime/types";
import { createWorkflowSdk } from "../../src/main/workflowSdk";

const chatGptWorkflows = createWorkflows(createWorkflowSdk()) as Array<WorkflowDefinition<unknown, any>>;
const chatGptExtensionImageTransformWorkflow = chatGptWorkflows.find(
  (workflow) => workflow.manifest.id === "based-blink.chatgpt.extension-image-transform"
)!;
const chatGptExtensionImageSequenceWorkflow = chatGptWorkflows.find(
  (workflow) => workflow.manifest.id === "based-blink.chatgpt.extension-image-sequence"
)!;

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
      workflowId: "based-blink.chatgpt.extension-image-transform",
      origin: { source: "ui" },
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

    expect(chatGptExtensionImageTransformWorkflow.canResumeFailedRun!(baseRun)).toBe(false);
    expect(
      chatGptExtensionImageTransformWorkflow.canResumeFailedRun!({
        ...baseRun,
        input: {
          ...(baseRun.input as Record<string, unknown>),
          chatGptTab: { mode: "existing", clientId: "tab-1", url: "https://chatgpt.com/c/abc" }
        }
      })
    ).toBe(true);
    expect(
      chatGptExtensionImageTransformWorkflow.canResumeFailedRun!({
        ...baseRun,
        output: {
          artifactIds: [],
          summary: "Checkpoint",
          checkpoint: { setupCompleted: true, completedSubjectIndexes: [], outputMappings: [] }
        }
      })
    ).toBe(true);
    expect(chatGptExtensionImageTransformWorkflow.canResumeFailedRun!({ ...baseRun, status: "cancelled" })).toBe(false);
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

  it("runs sequence prompts without setup and chains each output into the next prompt", async () => {
    const harness = createWorkflowHarness();
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/start"
    });

    const run = chatGptExtensionImageSequenceWorkflow.run(
      {
        sourceImages: [harness.subjectPath],
        prompts: ["Back view", "Side view"],
        masterPrompt: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/start" },
        selectors: {}
      },
      harness.ctx
    );

    const firstTask = await waitForLeasedTask(harness.clientId, "subject");
    expect(firstTask.subjectImage).toMatchObject({ index: 0, name: "subject-1.png" });
    expect(firstTask.subjectInstruction).toBe("Back view");
    extensionBridge.addTaskOutput(firstTask.id, output(0, "back-output"));
    extensionBridge.completeTask(firstTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/sequence", title: "Sequence conversation" }
    });

    const secondTask = await waitForLeasedTask(harness.clientId, "subject");
    expect(secondTask.subjectImage).toMatchObject({ index: 1, name: "subject-1-prompt-01-chatgpt.png" });
    expect(secondTask.subjectInstruction).toBe("Side view");
    extensionBridge.addTaskOutput(secondTask.id, output(1, "side-output"));
    extensionBridge.completeTask(secondTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/sequence", title: "Sequence conversation" }
    });

    const result = await run;
    expect(result.checkpoint).toMatchObject({
      setupCompleted: true,
      completedPromptIndexes: [0, 1],
      pausedPrompt: null
    });
    expect(harness.artifacts.filter((artifact) => artifact.kind === "image").map((artifact) => artifact.name)).toEqual([
      "subject-1-prompt-01-chatgpt.png",
      "subject-1-prompt-02-chatgpt.png"
    ]);
    expect(harness.artifacts[0].metadata).toMatchObject({
      workflowKind: "image-sequence",
      promptIndex: 0,
      pairId: "prompt-1"
    });

    fs.rmSync(harness.dir, { recursive: true, force: true });
  });

  it("sends the source image as setup reference context when a sequence setup prompt is provided", async () => {
    const harness = createWorkflowHarness();
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/start"
    });

    const run = chatGptExtensionImageSequenceWorkflow.run(
      {
        sourceImages: [harness.subjectPath],
        prompts: ["Back view"],
        masterPrompt: "Keep the same character across every edit.",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/start" },
        selectors: {}
      },
      harness.ctx
    );

    const setupTask = await waitForLeasedTask(harness.clientId, "setup");
    expect(setupTask.masterPrompt).toBe("Keep the same character across every edit.");
    expect(setupTask.referenceImages?.[0]).toMatchObject({ index: 0, name: "subject-1.png" });
    extensionBridge.completeTask(setupTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/sequence", title: "Sequence conversation" }
    });

    const promptTask = await waitForLeasedTask(harness.clientId, "subject");
    expect(promptTask.subjectInstruction).toBe("Back view");
    extensionBridge.addTaskOutput(promptTask.id, output(0, "back-output"));
    extensionBridge.completeTask(promptTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/sequence", title: "Sequence conversation" }
    });

    const result = await run;
    expect(result.checkpoint).toMatchObject({
      setupCompleted: true,
      completedPromptIndexes: [0]
    });

    fs.rmSync(harness.dir, { recursive: true, force: true });
  });

  it("restores completed sequence prompt outputs and continues the chain from the latest artifact", async () => {
    const harness = createWorkflowHarness();
    const restoredOutputPath = path.join(harness.artifactDir, "restored-prompt-1.png");
    fs.writeFileSync(restoredOutputPath, Buffer.from("restored prompt 1"));
    harness.ctx.previousOutput = {
      artifactIds: ["restored-artifact-1"],
      summary: "Processed 1 of 2 ChatGPT prompt(s).",
      chatGptPage: {
        url: "https://chatgpt.com/c/recovered",
        title: "Recovered conversation",
        clientId: harness.clientId,
        capturedAt: new Date().toISOString()
      },
      checkpoint: {
        setupCompleted: true,
        completedPromptIndexes: [0],
        outputMappings: [
          {
            promptIndex: 0,
            prompt: "Back view",
            inputImage: harness.subjectPath,
            pairId: "prompt-1",
            artifactId: "restored-artifact-1",
            outputPath: restoredOutputPath
          }
        ],
        pausedPrompt: null
      }
    };
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/recovered"
    });

    const run = chatGptExtensionImageSequenceWorkflow.run(
      {
        sourceImages: [harness.subjectPath],
        prompts: ["Back view", "Side view"],
        masterPrompt: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/recovered" },
        selectors: {}
      },
      harness.ctx
    );

    const promptTask = await waitForLeasedTask(harness.clientId, "subject");
    expect(promptTask.subjectImage).toMatchObject({ index: 1, name: "restored-prompt-1.png" });
    expect(promptTask.subjectInstruction).toBe("Side view");
    extensionBridge.addTaskOutput(promptTask.id, output(1, "side-output"));
    extensionBridge.completeTask(promptTask.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/recovered", title: "Recovered conversation" }
    });

    const result = await run;
    expect(result.checkpoint).toMatchObject({
      setupCompleted: true,
      completedPromptIndexes: [0, 1],
      pausedPrompt: null
    });
    expect(result.artifactIds).toContain("restored-artifact-1");
    expect(result.artifactIds).toContain("artifact-1");

    fs.rmSync(harness.dir, { recursive: true, force: true });
  });

  it("fails a sequence workflow when a prompt does not return an output", async () => {
    const harness = createWorkflowHarness();
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/start"
    });

    const run = chatGptExtensionImageSequenceWorkflow.run(
      {
        sourceImages: [harness.subjectPath],
        prompts: ["Back view"],
        masterPrompt: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/start" },
        selectors: {}
      },
      harness.ctx
    );

    const task = await waitForLeasedTask(harness.clientId, "subject");
    extensionBridge.completeTask(task.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/start", title: "Sequence conversation" }
    });

    await expect(run).rejects.toThrow("did not return an output image for prompt 1");
    fs.rmSync(harness.dir, { recursive: true, force: true });
  });

  it("fails a sequence workflow when one prompt returns multiple distinct outputs", async () => {
    const harness = createWorkflowHarness();
    extensionBridge.heartbeat({
      id: harness.clientId,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.9.0",
      url: "https://chatgpt.com/c/start"
    });

    const run = chatGptExtensionImageSequenceWorkflow.run(
      {
        sourceImages: [harness.subjectPath],
        prompts: ["Back view"],
        masterPrompt: "",
        timeoutMinutes: 1,
        chatGptTab: { mode: "existing", clientId: harness.clientId, url: "https://chatgpt.com/c/start" },
        selectors: {}
      },
      harness.ctx
    );

    const task = await waitForLeasedTask(harness.clientId, "subject");
    extensionBridge.addTaskOutput(task.id, output(0, "first-output"));
    extensionBridge.addTaskOutput(task.id, output(0, "second-output"));
    extensionBridge.completeTask(task.id, {
      outputs: [],
      metadata: { url: "https://chatgpt.com/c/start", title: "Sequence conversation" }
    });

    await expect(run).rejects.toThrow("multiple distinct output images for prompt 1");
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

  it("keeps one output per sequence prompt", () => {
    const normalized = normalizeChatGptExtensionSequenceOutputs([output(0, "first"), output(1, "second")], [
      "Back view",
      "Side view"
    ]);

    expect(normalized).toMatchObject([
      { promptIndex: 0, prompt: "Back view", pairId: "prompt-1" },
      { promptIndex: 1, prompt: "Side view", pairId: "prompt-2" }
    ]);
  });

  it("fails when a sequence prompt is missing an output", () => {
    expect(() => normalizeChatGptExtensionSequenceOutputs([output(0, "first")], ["Back view", "Side view"])).toThrow(
      "did not return an output image for prompt 2"
    );
  });

  it("fails when one sequence prompt has multiple distinct outputs", () => {
    expect(() => normalizeChatGptExtensionSequenceOutputs([output(0, "first"), output(0, "second")], ["Back view"])).toThrow(
      "distinct output images for prompt 1"
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
