import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../../src/main/db/sqliteStore";
import { RuntimeEventBus } from "../../src/main/runtime/eventBus";
import { LocalWorkflowRunner } from "../../src/main/runtime/localWorkflowRunner";
import { createRuntimePaths, getRunDir } from "../../src/main/runtime/paths";
import type { WorkflowDefinition } from "../../src/main/runtime/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("LocalWorkflowRunner", () => {
  it("runs a workflow and records events/artifacts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    const workflow: WorkflowDefinition<{ message: string }, { ok: boolean }> = {
      manifest: {
        id: "test.workflow",
        title: "Test Workflow",
        description: "Runtime test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      async run(input, ctx) {
        await ctx.step(`Received ${input.message}`, 50);
        await ctx.event("test.event", "Runtime workflow event");
        return { ok: true };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());

    const run = runner.enqueue({
      workflowId: "test.workflow",
      name: "Runner test",
      workflowInput: { message: "test" }
    });

    expect(path.basename(run.runDir!)).toMatch(/^Runner-test-[\w]{8}$/);
    expect(path.basename(run.runDir!)).not.toContain(" ");
    expect(fs.existsSync(path.join(run.runDir!, "prompts.json"))).toBe(true);

    await waitFor(() => store.getRun(run.id)?.status === "completed");

    expect(store.getRun(run.id)?.progress).toBe(100);
    expect(store.listEvents(run.id).length).toBeGreaterThan(1);
    expect(store.getRun(run.id)?.output).toEqual({ ok: true });

    store.close();
  });

  it("deletes a queued run and its artifact directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    let releaseFirstRun: (() => void) | undefined;
    const workflow: WorkflowDefinition<{ message: string }, { ok: boolean }> = {
      manifest: {
        id: "test.blocking",
        title: "Blocking Workflow",
        description: "Runtime delete test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      async run(_input, ctx) {
        await ctx.step("Blocking", 10);
        await new Promise<void>((resolve, reject) => {
          releaseFirstRun = resolve;
          ctx.signal.addEventListener("abort", () => reject(new Error("Operation cancelled")), { once: true });
        });
        return { ok: true };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());

    const runningRun = runner.enqueue({ workflowId: "test.blocking", name: "Running", workflowInput: { message: "run" } });
    await waitFor(() => store.getRun(runningRun.id)?.status === "running");
    const queuedRun = runner.enqueue({ workflowId: "test.blocking", name: "Queued", workflowInput: { message: "queue" } });
    const artifactDir = path.join(queuedRun.runDir!, "artifacts");
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "artifact.json"), "{}");

    await runner.deleteRun(queuedRun.id);

    expect(store.getRun(queuedRun.id)).toBeNull();
    expect(fs.existsSync(queuedRun.runDir!)).toBe(false);
    releaseFirstRun?.();
    await waitFor(() => store.getRun(runningRun.id)?.status === "completed");

    store.close();
  });

  it("cancels a running run before deletion", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    const workflow: WorkflowDefinition<{ message: string }, { ok: boolean }> = {
      manifest: {
        id: "test.cancellable",
        title: "Cancellable Workflow",
        description: "Runtime delete test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      async run(_input, ctx) {
        await ctx.step("Waiting for cancellation", 10);
        await new Promise<void>((_resolve, reject) => {
          if (ctx.signal.aborted) {
            reject(new Error("Operation cancelled"));
            return;
          }
          ctx.signal.addEventListener("abort", () => reject(new Error("Operation cancelled")), { once: true });
        });
        return { ok: true };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());

    const run = runner.enqueue({ workflowId: "test.cancellable", name: "Delete running", workflowInput: { message: "run" } });
    await waitFor(() => store.getRun(run.id)?.status === "running");
    await runner.deleteRun(run.id);

    expect(store.getRun(run.id)).toBeNull();
    expect(fs.existsSync(run.runDir!)).toBe(false);
    expect(runner.stats().running).toBe(0);

    store.close();
  });

  it("pauses at a safe checkpoint and resumes the active run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    let releaseCheckpoint: (() => void) | undefined;
    let pauseObservedAtCheckpoint = false;
    const workflow: WorkflowDefinition<{ message: string }, { ok: boolean }> = {
      manifest: {
        id: "test.pause",
        title: "Pause Workflow",
        description: "Runtime pause test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      async run(_input, ctx) {
        await ctx.step("Before checkpoint", 10);
        await new Promise<void>((resolve) => {
          releaseCheckpoint = resolve;
        });
        pauseObservedAtCheckpoint = ctx.isPauseRequested();
        await ctx.pauseIfRequested("Paused at safe checkpoint", { url: "https://chatgpt.com/c/test" });
        await ctx.step("After resume", 80);
        return { ok: true };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());

    const run = runner.enqueue({ workflowId: "test.pause", name: "Pause run", workflowInput: { message: "run" } });
    await waitFor(() => store.getRun(run.id)?.currentStep === "Before checkpoint");

    const pausing = runner.pause(run.id);
    expect(pausing.status).toBe("pausing");
    releaseCheckpoint?.();
    await waitFor(() => store.getRun(run.id)?.status === "waiting_manual");

    expect(store.getRun(run.id)).toMatchObject({
      currentStep: "Paused at safe checkpoint",
      status: "waiting_manual"
    });
    expect(pauseObservedAtCheckpoint).toBe(true);

    runner.resume(run.id);
    await waitFor(() => store.getRun(run.id)?.status === "completed");

    expect(store.getRun(run.id)?.output).toEqual({ ok: true });
    store.close();
  });

  it("checkpoint pause helper is a no-op when no pause was requested", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    const workflow: WorkflowDefinition<{ message: string }, { ok: boolean }> = {
      manifest: {
        id: "test.no-pause",
        title: "No Pause Workflow",
        description: "Runtime pause helper test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      async run(_input, ctx) {
        expect(ctx.isPauseRequested()).toBe(false);
        await ctx.pauseIfRequested("Should not pause");
        return { ok: true };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());

    const run = runner.enqueue({ workflowId: "test.no-pause", name: "No pause run", workflowInput: { message: "run" } });
    await waitFor(() => store.getRun(run.id)?.status === "completed");

    expect(store.getRun(run.id)?.output).toEqual({ ok: true });
    store.close();
  });

  it("requeues a recoverable failed run with the same run id, run directory, and previous output", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    const runDir = path.join(paths.runRootDir, "recoverable-failed-run");
    let observedPreviousOutput: unknown;
    const workflow: WorkflowDefinition<{ message: string }, { ok: boolean; previousOutput?: unknown }> = {
      manifest: {
        id: "test.recoverable",
        title: "Recoverable Workflow",
        description: "Runtime failed resume test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean(), previousOutput: z.unknown() }),
      canResumeFailedRun: (run) => run.error === "App exited before this run finished.",
      async run(input, ctx) {
        expect(input.message).toBe("resume me");
        expect(ctx.runDir).toBe(runDir);
        observedPreviousOutput = ctx.previousOutput;
        return { ok: true, previousOutput: ctx.previousOutput };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());
    const run = store.createRun({
      id: "failed-run-1",
      workflowId: workflow.manifest.id,
      name: "Failed run",
      runDir,
      status: "failed",
      input: { message: "resume me" }
    });
    store.updateRun(run.id, {
      output: { checkpoint: { completed: false } },
      error: "App exited before this run finished."
    });

    const resumed = runner.resume(run.id);
    expect(resumed).toMatchObject({ id: run.id, status: "queued", runDir });
    await waitFor(() => store.getRun(run.id)?.status === "completed");

    expect(observedPreviousOutput).toEqual({ checkpoint: { completed: false } });
    expect(store.getRun(run.id)).toMatchObject({
      id: run.id,
      runDir,
      output: { ok: true, previousOutput: { checkpoint: { completed: false } } },
      error: null
    });
    expect(store.listEvents(run.id).some((event) => event.type === "run.resume_requested")).toBe(true);
    store.close();
  });

  it("rejects failed-run resume when the workflow does not mark it recoverable", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    const workflow: WorkflowDefinition<{ message: string }, { ok: boolean }> = {
      manifest: {
        id: "test.unrecoverable",
        title: "Unrecoverable Workflow",
        description: "Runtime failed resume rejection test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      canResumeFailedRun: () => false,
      async run() {
        return { ok: true };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());
    const run = store.createRun({
      id: "failed-run-2",
      workflowId: workflow.manifest.id,
      name: "Failed run",
      runDir: path.join(paths.runRootDir, "unrecoverable-failed-run"),
      status: "failed",
      input: { message: "do not resume" }
    });

    expect(() => runner.resume(run.id)).toThrow("not recoverable");
    expect(store.getRun(run.id)?.status).toBe("failed");
    store.close();
  });

  it("copies file-list inputs into the run folder and records prompts metadata", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const sourceDir = path.join(dir, "source");
    fs.mkdirSync(sourceDir, { recursive: true });
    const imagePath = path.join(sourceDir, "subject.png");
    fs.writeFileSync(imagePath, "image");
    const paths = createRuntimePaths(path.join(dir, "project"));
    const store = await SqliteStore.open(paths.dbPath);
    const workflow: WorkflowDefinition<
      { subjectImages: string[]; referenceImages: string[]; masterPrompt: string; subjectInstruction: string },
      { ok: boolean }
    > = {
      manifest: {
        id: "test.inputs",
        title: "Input Workflow",
        description: "Runtime input copy test workflow",
        category: "utility",
        version: "0.0.0",
        concurrency: 1,
        inputFields: [
          { name: "referenceImages", label: "Reference images", type: "fileList" },
          { name: "subjectImages", label: "Subject images", type: "fileList", required: true },
          { name: "masterPrompt", label: "Master prompt", type: "textarea", required: true },
          { name: "subjectInstruction", label: "Subject instruction", type: "textarea" }
        ],
        outputKinds: ["json"],
        requiresBrowser: false
      },
      inputSchema: z.object({
        subjectImages: z.array(z.string()).min(1),
        referenceImages: z.array(z.string()).default([]),
        masterPrompt: z.string(),
        subjectInstruction: z.string().default("")
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      async run(input, ctx) {
        expect(input.subjectImages[0]).toBe(path.join(ctx.inputDir, "subjectImages", "01-subject.png"));
        expect(fs.existsSync(input.subjectImages[0])).toBe(true);
        expect(ctx.artifactDir).toBe(path.join(ctx.runDir, "artifacts"));
        return { ok: true };
      }
    };
    const runner = new LocalWorkflowRunner(new Map([[workflow.manifest.id, workflow]]), store, paths, new RuntimeEventBus());

    const run = runner.enqueue({
      workflowId: "test.inputs",
      name: "Prompt: Copy Test",
      workflowInput: {
        referenceImages: [],
        subjectImages: [imagePath],
        masterPrompt: "Master prompt text",
        subjectInstruction: "Per subject instruction"
      }
    });

    await waitFor(() => store.getRun(run.id)?.status === "completed");

    expect(path.basename(run.runDir!)).toMatch(/^Prompt-Copy-Test-[\w]{8}$/);
    expect(path.basename(run.runDir!)).not.toContain(" ");
    const storedInput = store.getRun(run.id)?.input as { subjectImages: string[] };
    expect(storedInput.subjectImages[0]).toBe(path.join(run.runDir!, "inputs", "subjectImages", "01-subject.png"));
    const promptsPath = path.join(run.runDir!, "prompts.json");
    const prompts = JSON.parse(fs.readFileSync(promptsPath, "utf8")) as {
      prompts: { masterPrompt: string; subjectInstruction: string };
      imagePaths: { subjectImages: Array<{ originalPath: string; copiedPath: string }> };
    };
    expect(prompts.prompts.masterPrompt).toBe("Master prompt text");
    expect(prompts.prompts.subjectInstruction).toBe("Per subject instruction");
    expect(prompts.imagePaths.subjectImages).toEqual([
      {
        originalPath: imagePath,
        copiedPath: path.join(run.runDir!, "inputs", "subjectImages", "01-subject.png")
      }
    ]);
    expect(store.listArtifacts(run.id).some((artifact) => artifact.name === "prompts.json")).toBe(true);

    store.close();
  });

  it("renames inactive runs and moves stored run data", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    const runner = new LocalWorkflowRunner(new Map(), store, paths, new RuntimeEventBus());
    const runId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const oldRunDir = getRunDir(paths, "Old Run Name", runId);
    const inputPath = path.join(oldRunDir, "inputs", "images", "01-source.png");
    const artifactPath = path.join(oldRunDir, "artifacts", "result.json");
    const promptsPath = path.join(oldRunDir, "prompts.json");
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(inputPath, "image");
    fs.writeFileSync(artifactPath, "{}");
    fs.writeFileSync(
      promptsPath,
      `${JSON.stringify({ runName: "Old Run Name", runDir: oldRunDir, input: { copied: { images: [inputPath] } } }, null, 2)}\n`,
      "utf8"
    );

    const run = store.createRun({
      id: runId,
      workflowId: "test.workflow",
      name: "Old Run Name",
      runDir: oldRunDir,
      status: "completed",
      input: { images: [inputPath] }
    });
    store.updateRun(run.id, { output: { resultPath: artifactPath } });
    const artifact = store.addArtifact({
      id: "artifact-rename",
      runId,
      kind: "json",
      name: "result.json",
      path: artifactPath,
      mimeType: "application/json",
      metadata: { artifactDir: path.dirname(artifactPath) }
    });

    const renamed = runner.renameRun(run.id, "New Run Name");
    const newRunDir = getRunDir(paths, "New Run Name", run.id);

    expect(renamed.name).toBe("New Run Name");
    expect(renamed.runDir).toBe(newRunDir);
    expect(fs.existsSync(oldRunDir)).toBe(false);
    expect(fs.existsSync(newRunDir)).toBe(true);
    expect(path.basename(newRunDir)).toBe("New-Run-Name-aaaaaaaa");
    expect((renamed.input as { images: string[] }).images[0]).toBe(path.join(newRunDir, "inputs", "images", "01-source.png"));
    expect((renamed.output as { resultPath: string }).resultPath).toBe(path.join(newRunDir, "artifacts", "result.json"));
    expect(store.getArtifact(artifact.id)?.path).toBe(path.join(newRunDir, "artifacts", "result.json"));
    expect(store.getArtifact(artifact.id)?.metadata).toEqual({ artifactDir: path.join(newRunDir, "artifacts") });
    const prompts = JSON.parse(fs.readFileSync(path.join(newRunDir, "prompts.json"), "utf8")) as {
      runName: string;
      runDir: string;
      input: { copied: { images: string[] } };
    };
    expect(prompts.runName).toBe("New Run Name");
    expect(prompts.runDir).toBe(newRunDir);
    expect(prompts.input.copied.images[0]).toBe(path.join(newRunDir, "inputs", "images", "01-source.png"));

    store.close();
  });

  it("rejects renaming active runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-runner-"));
    tempDirs.push(dir);
    const paths = createRuntimePaths(dir);
    const store = await SqliteStore.open(paths.dbPath);
    const runner = new LocalWorkflowRunner(new Map(), store, paths, new RuntimeEventBus());
    const run = store.createRun({
      id: "active-run",
      workflowId: "test.workflow",
      name: "Active Run",
      runDir: getRunDir(paths, "Active Run", "active-run"),
      status: "running",
      input: {}
    });

    expect(() => runner.renameRun(run.id, "New Name")).toThrow("Run can only be renamed after it is inactive.");
    expect(store.getRun(run.id)?.name).toBe("Active Run");

    store.close();
  });
});
