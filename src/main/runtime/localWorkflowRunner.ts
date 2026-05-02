import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RuntimeEventBus } from "./eventBus";
import type { SqliteStore } from "../db/sqliteStore";
import type { ArtifactRecord, RunRecord, RuntimePaths, WorkflowContext, WorkflowDefinition } from "./types";
import { ensureRunDataDirs, getRunArtifactDir, getRunDir, getRunInputDir, getRunOutputArtifactDir } from "./paths";
import { copyFileToDir, writeJson } from "../utils/files";

function createId(): string {
  return randomUUID();
}

const DELETE_WAIT_TIMEOUT_MS = 30_000;

interface FileInputMapping {
  field: string;
  index: number;
  name: string;
  originalPath: string;
  copiedPath: string;
}

interface QueuedRun {
  runId: string;
  workflowId: string;
  input: unknown;
  previousOutput?: unknown | null;
}

interface RunningRun {
  controller: AbortController;
  pauseRequested?: boolean;
  resume?: () => void;
}

export class LocalWorkflowRunner {
  private queue: QueuedRun[] = [];
  private readonly running = new Map<string, RunningRun>();
  private readonly activeByWorkflow = new Map<string, number>();

  constructor(
    private readonly workflows: Map<string, WorkflowDefinition>,
    private readonly store: SqliteStore,
    private readonly paths: RuntimePaths,
    private readonly eventBus: RuntimeEventBus
  ) {}

  enqueue(input: { workflowId: string; name?: string; workflowInput: unknown }): RunRecord {
    const workflow = this.workflows.get(input.workflowId);
    if (!workflow) throw new Error(`Unknown workflow: ${input.workflowId}`);

    const parsed = workflow.inputSchema.safeParse(input.workflowInput);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }

    const runId = createId();
    const runName = input.name?.trim() || workflow.manifest.title;
    const runDir = getRunDir(this.paths, runName, runId);
    const { inputDir, artifactDir } = ensureRunDataDirs(runDir);
    const preparedInput = copyWorkflowInputFiles(workflow, parsed.data, inputDir);
    const promptsPath = path.join(runDir, "prompts.json");
    writeJson(
      promptsPath,
      buildPromptsDocument({
        workflow,
        runId,
        runName,
        runDir,
        originalInput: parsed.data,
        copiedInput: preparedInput.input,
        fileMappings: preparedInput.fileMappings
      })
    );

    const run = this.store.createRun({
      id: runId,
      workflowId: workflow.manifest.id,
      name: runName,
      runDir,
      status: "queued",
      input: preparedInput.input
    });
    const promptsArtifact = this.store.addArtifact({
      id: createId(),
      runId: run.id,
      kind: "json",
      name: "prompts.json",
      path: promptsPath,
      mimeType: "application/json",
      metadata: { source: "run-inputs", artifactDir }
    });
    this.eventBus.publish({ kind: "artifact-added", runId: run.id, artifactId: promptsArtifact.id });
    this.queue.push({ runId: run.id, workflowId: workflow.manifest.id, input: preparedInput.input });
    this.eventBus.publish({ kind: "run-updated", runId: run.id });
    void this.drain();
    return run;
  }

  cancel(runId: string): RunRecord {
    const queuedIndex = this.queue.findIndex((entry) => entry.runId === runId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      const run = this.store.updateRun(runId, { status: "cancelled", error: "Cancelled before start." });
      this.eventBus.publish({ kind: "run-updated", runId });
      return run;
    }

    const running = this.running.get(runId);
    if (running) {
      running.controller.abort();
      running.resume?.();
      const run = this.store.updateRun(runId, { status: "cancelled", error: "Cancellation requested." });
      this.eventBus.publish({ kind: "run-updated", runId });
      return run;
    }

    const existing = this.store.getRun(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);
    return existing;
  }

  pause(runId: string): RunRecord {
    const running = this.running.get(runId);
    if (running) {
      running.pauseRequested = true;
      const run = this.store.updateRun(runId, {
        status: running.resume ? "waiting_manual" : "pausing",
        currentStep: running.resume ? "Waiting for resume" : "Pause requested. Waiting for a safe checkpoint."
      });
      this.eventBus.publish({ kind: "run-updated", runId });
      return run;
    }

    const existing = this.store.getRun(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);
    return existing;
  }

  resume(runId: string): RunRecord {
    const running = this.running.get(runId);
    if (running?.resume) {
      running.pauseRequested = false;
      running.resume();
      running.resume = undefined;
      const run = this.store.updateRun(runId, { status: "running", currentStep: "Manual step completed" });
      this.eventBus.publish({ kind: "run-updated", runId });
      return run;
    }

    if (running) {
      const existing = this.store.getRun(runId);
      if (!existing) throw new Error(`Run not found: ${runId}`);
      return existing;
    }

    if (this.queue.some((entry) => entry.runId === runId)) {
      const existing = this.store.getRun(runId);
      if (!existing) throw new Error(`Run not found: ${runId}`);
      return existing;
    }

    const existing = this.store.getRun(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);
    if (existing.status !== "failed") return existing;

    const workflow = this.workflows.get(existing.workflowId);
    if (!workflow) throw new Error(`Unknown workflow: ${existing.workflowId}`);
    if (!workflow.canResumeFailedRun?.(existing)) {
      throw new Error("This failed run is not recoverable. Create a new run instead.");
    }

    const parsed = workflow.inputSchema.safeParse(existing.input);
    if (!parsed.success) {
      throw new Error(`This failed run has invalid stored input and cannot be resumed: ${parsed.error.message}`);
    }

    const event = this.store.addEvent({
      runId,
      type: "run.resume_requested",
      message: "Resume requested for failed run",
      data: { previousStatus: existing.status, previousError: existing.error }
    });
    this.eventBus.publish({ kind: "event", event });
    const run = this.store.updateRun(runId, {
      status: "queued",
      currentStep: "Resume queued",
      error: null
    });
    this.queue.push({
      runId,
      workflowId: workflow.manifest.id,
      input: parsed.data,
      previousOutput: existing.output
    });
    this.eventBus.publish({ kind: "run-updated", runId });
    void this.drain();
    return run;
  }

  async deleteRun(runId: string): Promise<void> {
    const existing = this.store.getRun(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);

    if (["queued", "running", "pausing", "waiting_manual"].includes(existing.status)) {
      this.cancel(runId);
    }

    await this.waitUntilInactive(runId);
    this.deleteRunData(existing);
    this.store.deleteRunCascade(runId);
    this.eventBus.publish({ kind: "run-updated", runId });
  }

  async shutdown(): Promise<void> {
    const queued = this.queue.splice(0);
    for (const entry of queued) {
      this.store.updateRun(entry.runId, { status: "cancelled", error: "Project closed before this run started." });
      this.eventBus.publish({ kind: "run-updated", runId: entry.runId });
    }

    const runningIds = [...this.running.keys()];
    for (const runId of runningIds) {
      const running = this.running.get(runId);
      running?.controller.abort();
      running?.resume?.();
      this.store.updateRun(runId, { status: "cancelled", error: "Project closed while this run was active." });
      this.eventBus.publish({ kind: "run-updated", runId });
    }

    await Promise.all(runningIds.map((runId) => this.waitUntilInactive(runId)));
  }

  stats(): { queued: number; running: number } {
    return { queued: this.queue.length, running: this.running.size };
  }

  private async waitUntilInactive(runId: string): Promise<void> {
    const startedAt = Date.now();
    while (this.running.has(runId)) {
      if (Date.now() - startedAt > DELETE_WAIT_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for run to stop before deletion: ${runId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private deleteRunData(run: RunRecord): void {
    if (run.runDir) {
      const projectRoot = path.resolve(this.paths.runRootDir);
      const internalRoot = path.resolve(this.paths.internalDir);
      const runDir = path.resolve(run.runDir);
      if (runDir === projectRoot || !runDir.startsWith(`${projectRoot}${path.sep}`)) {
        throw new Error(`Refusing to delete run path outside project directory: ${runDir}`);
      }
      if (runDir === internalRoot || runDir.startsWith(`${internalRoot}${path.sep}`)) {
        throw new Error(`Refusing to delete internal project path as run data: ${runDir}`);
      }
      fs.rmSync(runDir, { recursive: true, force: true });
      return;
    }

    this.deleteLegacyRunArtifactDir(run.id);
  }

  private deleteLegacyRunArtifactDir(runId: string): void {
    const artifactRoot = path.resolve(this.paths.artifactDir);
    const runArtifactDir = path.resolve(artifactRoot, runId);
    if (runArtifactDir === artifactRoot || !runArtifactDir.startsWith(`${artifactRoot}${path.sep}`)) {
      throw new Error(`Refusing to delete artifact path outside artifact directory: ${runArtifactDir}`);
    }
    fs.rmSync(runArtifactDir, { recursive: true, force: true });
  }

  private async drain(): Promise<void> {
    for (const entry of [...this.queue]) {
      const workflow = this.workflows.get(entry.workflowId);
      if (!workflow) continue;
      const active = this.activeByWorkflow.get(entry.workflowId) ?? 0;
      if (active >= workflow.manifest.concurrency) continue;

      this.queue = this.queue.filter((queued) => queued.runId !== entry.runId);
      this.activeByWorkflow.set(entry.workflowId, active + 1);
      void this.run(entry, workflow).finally(() => {
        this.activeByWorkflow.set(entry.workflowId, Math.max(0, (this.activeByWorkflow.get(entry.workflowId) ?? 1) - 1));
        void this.drain();
      });
    }
  }

  private async run(entry: QueuedRun, workflow: WorkflowDefinition): Promise<void> {
    const controller = new AbortController();
    this.running.set(entry.runId, { controller });
    this.store.updateRun(entry.runId, { status: "running", currentStep: "Starting", progress: 1, error: null });
    this.eventBus.publish({ kind: "run-updated", runId: entry.runId });

    const ctx = this.createContext(entry, controller);
    try {
      await ctx.event("run.started", `Started ${workflow.manifest.title}`);
      const output = await workflow.run(entry.input, ctx);
      const parsedOutput = workflow.outputSchema.safeParse(output);
      if (!parsedOutput.success) {
        throw new Error(`Workflow returned invalid output: ${parsedOutput.error.message}`);
      }
      this.store.updateRun(entry.runId, {
        status: "completed",
        currentStep: "Completed",
        progress: 100,
        output: parsedOutput.data,
        error: null
      });
      await ctx.event("run.completed", "Workflow completed", parsedOutput.data);
    } catch (error) {
      if (controller.signal.aborted) {
        this.store.updateRun(entry.runId, {
          status: "cancelled",
          currentStep: "Cancelled",
          error: error instanceof Error ? error.message : String(error)
        });
      } else {
        this.store.updateRun(entry.runId, {
          status: "failed",
          currentStep: "Failed",
          error: error instanceof Error ? error.message : String(error)
        });
        await ctx.event("run.failed", error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.running.delete(entry.runId);
      this.eventBus.publish({ kind: "run-updated", runId: entry.runId });
    }
  }

  private createContext(entry: QueuedRun, controller: AbortController): WorkflowContext {
    const runId = entry.runId;
    const store = this.store;
    const eventBus = this.eventBus;
    const getRunning = () => this.running.get(runId);
    const run = store.getRun(runId);
    const runDir = run?.runDir ?? getRunArtifactDir(this.paths, runId);
    const inputDir = run?.runDir ? getRunInputDir(run.runDir) : path.join(runDir, "inputs");
    const artifactDir = run?.runDir ? getRunOutputArtifactDir(run.runDir) : runDir;
    ensureRunDataDirs(runDir);

    return {
      runId,
      paths: this.paths,
      runDir,
      inputDir,
      artifactDir,
      signal: controller.signal,
      previousOutput: entry.previousOutput ?? null,
      async step(message, progress, data) {
        const running = getRunning();
        store.updateRun(runId, {
          status: running?.pauseRequested && !running.resume ? "pausing" : "running",
          currentStep: message,
          progress: progress ?? store.getRun(runId)?.progress ?? 0
        });
        const event = store.addEvent({ runId, type: "step", message, data });
        eventBus.publish({ kind: "event", event });
        eventBus.publish({ kind: "run-updated", runId });
      },
      async event(type, message, data) {
        const event = store.addEvent({ runId, type, message, data });
        eventBus.publish({ kind: "event", event });
      },
      async updateOutput(output) {
        store.updateRun(runId, { output });
        eventBus.publish({ kind: "run-updated", runId });
      },
      isPauseRequested() {
        return Boolean(getRunning()?.pauseRequested);
      },
      async pauseIfRequested(message, data) {
        const running = getRunning();
        if (!running?.pauseRequested) return;
        await this.waitForManualAction(message, data);
      },
      async addArtifact(input): Promise<ArtifactRecord> {
        const artifact = store.addArtifact({
          id: createId(),
          runId,
          kind: input.kind,
          name: input.name,
          path: input.path,
          mimeType: input.mimeType ?? null,
          metadata: input.metadata ?? null
        });
        eventBus.publish({ kind: "artifact-added", runId, artifactId: artifact.id });
        eventBus.publish({ kind: "run-updated", runId });
        return artifact;
      },
      async waitForManualAction(message, data) {
        await this.step(message, undefined, data);
        store.updateRun(runId, { status: "waiting_manual", currentStep: message });
        eventBus.publish({ kind: "run-updated", runId });
        await new Promise<void>((resolve, reject) => {
          const running = getRunning();
          if (!running) {
            reject(new Error("Run is no longer active"));
            return;
          }
          running.resume = resolve;
          controller.signal.addEventListener("abort", () => reject(new Error("Operation cancelled")), { once: true });
        });
      }
    };
  }
}

function copyWorkflowInputFiles(
  workflow: WorkflowDefinition,
  input: unknown,
  inputDir: string
): { input: unknown; fileMappings: FileInputMapping[] } {
  if (!isRecord(input)) return { input, fileMappings: [] };

  const copiedInput: Record<string, unknown> = { ...input };
  const fileMappings: FileInputMapping[] = [];
  const fileFields = workflow.manifest.inputFields.filter((field) => field.type === "fileList");

  for (const field of fileFields) {
    const value = input[field.name];
    if (!Array.isArray(value)) continue;

    const copiedPaths = value.map((filePath, index) => {
      if (typeof filePath !== "string") return filePath;
      const copiedPath = copyFileToDir(filePath, path.join(inputDir, field.name), `${String(index + 1).padStart(2, "0")}-`);
      fileMappings.push({
        field: field.name,
        index,
        name: path.basename(copiedPath),
        originalPath: filePath,
        copiedPath
      });
      return copiedPath;
    });
    copiedInput[field.name] = copiedPaths;
  }

  return { input: copiedInput, fileMappings };
}

function buildPromptsDocument(input: {
  workflow: WorkflowDefinition;
  runId: string;
  runName: string;
  runDir: string;
  originalInput: unknown;
  copiedInput: unknown;
  fileMappings: FileInputMapping[];
}): Record<string, unknown> {
  const original = isRecord(input.originalInput) ? input.originalInput : {};
  const copied = isRecord(input.copiedInput) ? input.copiedInput : {};

  return {
    runId: input.runId,
    runName: input.runName,
    workflowId: input.workflow.manifest.id,
    workflowTitle: input.workflow.manifest.title,
    runDir: input.runDir,
    createdAt: new Date().toISOString(),
    prompts: {
      masterPrompt: original.masterPrompt ?? null,
      prompt: original.prompt ?? null,
      subjectInstruction: original.subjectInstruction ?? null,
      perSubjectInstruction: original.subjectInstruction ?? null
    },
    imagePaths: {
      images: mappedPathsForField(input.fileMappings, "images"),
      referenceImages: mappedPathsForField(input.fileMappings, "referenceImages"),
      subjectImages: mappedPathsForField(input.fileMappings, "subjectImages")
    },
    chatGptTab: original.chatGptTab ?? copied.chatGptTab ?? null,
    selectors: original.selectors ?? copied.selectors ?? null,
    modelName: original.modelName ?? copied.modelName ?? null,
    profileName: original.profileName ?? copied.profileName ?? null,
    pauseForManualLogin: original.pauseForManualLogin ?? copied.pauseForManualLogin ?? null,
    input: {
      original: input.originalInput,
      copied: input.copiedInput,
      fileMappings: input.fileMappings
    }
  };
}

function mappedPathsForField(fileMappings: FileInputMapping[], field: string): Array<{ originalPath: string; copiedPath: string }> {
  return fileMappings
    .filter((mapping) => mapping.field === field)
    .sort((a, b) => a.index - b.index)
    .map((mapping) => ({ originalPath: mapping.originalPath, copiedPath: mapping.copiedPath }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
