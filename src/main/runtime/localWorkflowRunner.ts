import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RuntimeEventBus } from "./eventBus";
import type { SqliteStore } from "../db/sqliteStore";
import type { ArtifactRecord, RunRecord, RuntimePaths, WorkflowContext, WorkflowDefinition } from "./types";

function createId(): string {
  return randomUUID();
}

const DELETE_WAIT_TIMEOUT_MS = 30_000;

interface QueuedRun {
  runId: string;
  workflowId: string;
  input: unknown;
}

interface RunningRun {
  controller: AbortController;
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

    const run = this.store.createRun({
      id: createId(),
      workflowId: workflow.manifest.id,
      name: input.name?.trim() || workflow.manifest.title,
      status: "queued",
      input: parsed.data
    });
    this.queue.push({ runId: run.id, workflowId: workflow.manifest.id, input: parsed.data });
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

  resume(runId: string): RunRecord {
    const running = this.running.get(runId);
    if (running?.resume) {
      running.resume();
      running.resume = undefined;
      const run = this.store.updateRun(runId, { status: "running", currentStep: "Manual step completed" });
      this.eventBus.publish({ kind: "run-updated", runId });
      return run;
    }

    const existing = this.store.getRun(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);
    return existing;
  }

  async deleteRun(runId: string): Promise<void> {
    const existing = this.store.getRun(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);

    if (["queued", "running", "waiting_manual"].includes(existing.status)) {
      this.cancel(runId);
    }

    await this.waitUntilInactive(runId);
    this.deleteRunArtifactDir(runId);
    this.store.deleteRunCascade(runId);
    this.eventBus.publish({ kind: "run-updated", runId });
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

  private deleteRunArtifactDir(runId: string): void {
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

    const ctx = this.createContext(entry.runId, controller);
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

  private createContext(runId: string, controller: AbortController): WorkflowContext {
    const store = this.store;
    const eventBus = this.eventBus;
    const getRunning = () => this.running.get(runId);

    return {
      runId,
      paths: this.paths,
      signal: controller.signal,
      async step(message, progress, data) {
        store.updateRun(runId, {
          status: "running",
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
