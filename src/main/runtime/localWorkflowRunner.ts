import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RuntimeEventBus } from "./eventBus";
import type { SqliteStore } from "../db/sqliteStore";
import type {
  ArtifactRecord,
  RunRecord,
  RuntimePaths,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowPluginMetadata,
  WorkflowRegistration,
  WorkflowRegistry
} from "./types";
import { ensureRunDataDirs, getRunArtifactDir, getRunDir, getRunInputDir, getRunOutputArtifactDir } from "./paths";
import { copyFileToDir, writeJson } from "../utils/files";

function createId(): string {
  return randomUUID();
}

const DELETE_WAIT_TIMEOUT_MS = 30_000;
const ACTIVE_RENAME_STATUSES = new Set(["queued", "running", "pausing", "waiting_manual"]);
const INLINE_WORKFLOW_PLUGIN: WorkflowPluginMetadata = {
  id: "runtime.inline",
  name: "Runtime Inline Workflow",
  version: "0.0.0",
  source: "builtin",
  apiVersion: "1",
  capabilities: ["filesystem.artifacts"]
};

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
  private readonly workflows: WorkflowRegistry;

  constructor(
    workflows: Map<string, WorkflowDefinition | WorkflowRegistration>,
    private readonly store: SqliteStore,
    private readonly paths: RuntimePaths,
    private readonly eventBus: RuntimeEventBus
  ) {
    this.workflows = normalizeWorkflowRegistry(workflows);
  }

  enqueue(input: { workflowId: string; name?: string; workflowInput: unknown }): RunRecord {
    const registration = this.workflows.get(input.workflowId);
    if (!registration) throw new Error(`Unknown workflow: ${input.workflowId}`);
    const workflow = registration.definition;

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
        plugin: registration.plugin,
        originalInput: parsed.data,
        copiedInput: preparedInput.input,
        fileMappings: preparedInput.fileMappings
      })
    );

    const run = this.store.createRun({
      id: runId,
      workflowId: workflow.manifest.id,
      workflowVersion: workflow.manifest.version,
      pluginId: registration.plugin.id,
      pluginVersion: registration.plugin.version,
      pluginApiVersion: registration.plugin.apiVersion,
      pluginSource: registration.plugin.source,
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

    const registration = this.getRegistrationForRun(existing);
    const workflow = registration.definition;
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

  renameRun(runId: string, name: string): RunRecord {
    const existing = this.store.getRun(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);
    if (ACTIVE_RENAME_STATUSES.has(existing.status)) {
      throw new Error("Run can only be renamed after it is inactive.");
    }

    const runName = name.trim();
    if (!runName) throw new Error("Run name is required.");

    const update = this.renameRunData(existing, runName);
    const run = this.store.updateRun(runId, {
      name: runName,
      runDir: update.runDir,
      input: update.input,
      output: update.output
    });
    this.eventBus.publish({ kind: "run-updated", runId });
    return run;
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

  private renameRunData(run: RunRecord, runName: string): { runDir: string | null; input: unknown; output: unknown } {
    if (!run.runDir) {
      return { runDir: null, input: run.input, output: run.output };
    }

    const oldRunDir = path.resolve(run.runDir);
    this.assertRunDirIsSafe(oldRunDir);
    const newRunDir = path.resolve(getRunDir(this.paths, runName, run.id));
    const hasNewPath = !samePath(oldRunDir, newRunDir);

    if (hasNewPath) {
      if (!fs.existsSync(oldRunDir)) {
        throw new Error(`Run data folder not found: ${oldRunDir}`);
      }
      if (fs.existsSync(newRunDir)) {
        throw new Error(`Run data folder already exists: ${newRunDir}`);
      }
      fs.renameSync(oldRunDir, newRunDir);
    }

    const finalRunDir = hasNewPath ? newRunDir : oldRunDir;
    const input = hasNewPath ? replacePathReferences(run.input, oldRunDir, finalRunDir) : run.input;
    const output = hasNewPath ? replacePathReferences(run.output, oldRunDir, finalRunDir) : run.output;

    if (hasNewPath) {
      for (const artifact of this.store.listArtifacts(run.id)) {
        const nextPath = replacePathReferences(artifact.path, oldRunDir, finalRunDir);
        this.store.updateArtifact(artifact.id, {
          path: typeof nextPath === "string" ? nextPath : artifact.path,
          metadata: replacePathReferences(artifact.metadata, oldRunDir, finalRunDir)
        });
      }
    }

    rewritePromptsJson(finalRunDir, runName, oldRunDir, finalRunDir);
    return { runDir: finalRunDir, input, output };
  }

  private assertRunDirIsSafe(runDir: string): void {
    const projectRoot = path.resolve(this.paths.runRootDir);
    const internalRoot = path.resolve(this.paths.internalDir);
    if (samePath(runDir, projectRoot) || !isSameOrChildPath(runDir, projectRoot)) {
      throw new Error(`Refusing to rename run path outside project directory: ${runDir}`);
    }
    if (isSameOrChildPath(runDir, internalRoot)) {
      throw new Error(`Refusing to rename internal project path as run data: ${runDir}`);
    }
  }

  private async drain(): Promise<void> {
    for (const entry of [...this.queue]) {
      const registration = this.workflows.get(entry.workflowId);
      if (!registration) continue;
      const workflow = registration.definition;
      const active = this.activeByWorkflow.get(entry.workflowId) ?? 0;
      if (active >= workflow.manifest.concurrency) continue;

      this.queue = this.queue.filter((queued) => queued.runId !== entry.runId);
      this.activeByWorkflow.set(entry.workflowId, active + 1);
      void this.run(entry, registration).finally(() => {
        this.activeByWorkflow.set(entry.workflowId, Math.max(0, (this.activeByWorkflow.get(entry.workflowId) ?? 1) - 1));
        void this.drain();
      });
    }
  }

  private async run(entry: QueuedRun, registration: WorkflowRegistration): Promise<void> {
    const workflow = registration.definition;
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

  private getRegistrationForRun(run: RunRecord): WorkflowRegistration {
    const registration = this.workflows.get(run.workflowId);
    if (!registration) throw new Error(`Unknown workflow: ${run.workflowId}`);
    if (!run.pluginId || !run.pluginVersion) return registration;

    const plugin = registration.plugin;
    if (plugin.id === run.pluginId && plugin.version === run.pluginVersion) return registration;

    throw new Error(
      `The workflow plugin required by this run is not available: ${run.pluginId}@${run.pluginVersion}. ` +
        `Installed workflow ${run.workflowId} is provided by ${plugin.id}@${plugin.version}.`
    );
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
    if (typeof value === "string" && value.trim()) {
      const copiedPath = copyFileToDir(value, path.join(inputDir, field.name), "01-");
      fileMappings.push({
        field: field.name,
        index: 0,
        name: path.basename(copiedPath),
        originalPath: value,
        copiedPath
      });
      copiedInput[field.name] = copiedPath;
      continue;
    }
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
  plugin: WorkflowPluginMetadata;
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
    workflowVersion: input.workflow.manifest.version,
    workflowTitle: input.workflow.manifest.title,
    plugin: {
      id: input.plugin.id,
      name: input.plugin.name,
      version: input.plugin.version,
      source: input.plugin.source,
      apiVersion: input.plugin.apiVersion
    },
    runDir: input.runDir,
    createdAt: new Date().toISOString(),
    prompts: {
      masterPrompt: original.masterPrompt ?? null,
      prompt: original.prompt ?? null,
      subjectInstruction: original.subjectInstruction ?? null,
      perSubjectInstruction: original.subjectInstruction ?? null,
      sequencePrompts: original.prompts ?? null
    },
    imagePaths: {
      images: mappedPathsForField(input.fileMappings, "images"),
      referenceImages: mappedPathsForField(input.fileMappings, "referenceImages"),
      subjectImages: mappedPathsForField(input.fileMappings, "subjectImages"),
      sourceImages: mappedPathsForField(input.fileMappings, "sourceImages"),
      frontImage: mappedPathsForField(input.fileMappings, "frontImage"),
      backImage: mappedPathsForField(input.fileMappings, "backImage"),
      leftImage: mappedPathsForField(input.fileMappings, "leftImage"),
      rightImage: mappedPathsForField(input.fileMappings, "rightImage"),
      topImage: mappedPathsForField(input.fileMappings, "topImage"),
      bottomImage: mappedPathsForField(input.fileMappings, "bottomImage"),
      left45Image: mappedPathsForField(input.fileMappings, "left45Image"),
      right45Image: mappedPathsForField(input.fileMappings, "right45Image")
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

function normalizeWorkflowRegistry(workflows: Map<string, WorkflowDefinition | WorkflowRegistration>): WorkflowRegistry {
  const values = [...workflows.values()];
  if (values.every(isWorkflowRegistration)) return workflows as WorkflowRegistry;
  return new Map(
    [...workflows.entries()].map(([workflowId, value]) => {
      const registration = isWorkflowRegistration(value) ? value : registerInlineWorkflow(value);
      return [workflowId, registration];
    })
  );
}

function registerInlineWorkflow(definition: WorkflowDefinition): WorkflowRegistration {
  return {
    definition,
    plugin: INLINE_WORKFLOW_PLUGIN
  };
}

function isWorkflowRegistration(value: WorkflowDefinition | WorkflowRegistration): value is WorkflowRegistration {
  return Boolean(isRecord(value) && isRecord(value.definition) && isRecord(value.plugin));
}

function rewritePromptsJson(runDir: string, runName: string, oldRunDir: string, newRunDir: string): void {
  const promptsPath = path.join(runDir, "prompts.json");
  if (!fs.existsSync(promptsPath)) return;

  try {
    const prompts = replacePathReferences(JSON.parse(fs.readFileSync(promptsPath, "utf8")) as unknown, oldRunDir, newRunDir);
    if (isRecord(prompts)) {
      prompts.runName = runName;
    }
    writeJson(promptsPath, prompts);
  } catch {
    // Malformed historical prompts should not block renaming the run.
  }
}

function replacePathReferences(value: unknown, oldRunDir: string, newRunDir: string): unknown {
  if (typeof value === "string") {
    return replacePathString(value, oldRunDir, newRunDir);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePathReferences(item, oldRunDir, newRunDir));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replacePathReferences(item, oldRunDir, newRunDir)])
    );
  }
  return value;
}

function replacePathString(value: string, oldRunDir: string, newRunDir: string): string {
  if (!path.isAbsolute(value)) return value;
  const resolvedValue = path.resolve(value);
  if (!isSameOrChildPath(resolvedValue, oldRunDir)) return value;
  return path.join(newRunDir, path.relative(oldRunDir, resolvedValue));
}

function isSameOrChildPath(candidate: string, parent: string): boolean {
  const comparisonCandidate = pathComparisonKey(candidate);
  const comparisonParent = pathComparisonKey(parent);
  return comparisonCandidate === comparisonParent || comparisonCandidate.startsWith(`${comparisonParent}${path.sep}`);
}

function samePath(left: string, right: string): boolean {
  return pathComparisonKey(left) === pathComparisonKey(right);
}

function pathComparisonKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
