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

    await waitFor(() => store.getRun(run.id)?.status === "completed");

    expect(store.getRun(run.id)?.progress).toBe(100);
    expect(store.listEvents(run.id).length).toBeGreaterThan(1);
    expect(store.getRun(run.id)?.output).toEqual({ ok: true });

    store.close();
  });
});
