import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../../src/main/db/sqliteStore";
import { RuntimeEventBus } from "../../src/main/runtime/eventBus";
import { LocalWorkflowRunner } from "../../src/main/runtime/localWorkflowRunner";
import { createRuntimePaths } from "../../src/main/runtime/paths";
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

    expect(run.runDir).toContain("Runner test - ");
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
});
