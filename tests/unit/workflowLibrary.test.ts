import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../../src/main/db/sqliteStore";
import { createRuntimePaths } from "../../src/main/runtime/paths";
import {
  createWorkflowLibraryEntryFromRun,
  mergeLibraryInput
} from "../../src/main/runtime/workflowLibrary";
import type { WorkflowDefinition, WorkflowRegistration } from "../../src/main/runtime/types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("workflow library", () => {
  it("copies run input files into the durable library folder", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "blink-library-"));
    tempDirs.push(projectDir);
    const sourcePath = path.join(projectDir, "source.png");
    fs.writeFileSync(sourcePath, "image");
    const paths = createRuntimePaths(projectDir);
    const store = await SqliteStore.open(paths.dbPath);
    const workflow = workflowRegistration();
    const run = store.createRun({
      id: "run-1",
      workflowId: workflow.definition.manifest.id,
      workflowVersion: workflow.definition.manifest.version,
      pluginId: workflow.plugin.id,
      pluginVersion: workflow.plugin.version,
      pluginApiVersion: workflow.plugin.apiVersion,
      pluginSource: workflow.plugin.source,
      name: "Source run",
      status: "completed",
      input: { images: [sourcePath], prompt: "Use this" }
    });

    const entry = createWorkflowLibraryEntryFromRun({
      store,
      paths,
      workflows: new Map([[workflow.definition.manifest.id, workflow]]),
      runId: run.id,
      name: "Reusable"
    });

    const copiedImage = (entry.input as { images: string[] }).images[0];
    expect(copiedImage).toContain(path.join(".blink", "library", entry.id, "inputs", "images"));
    expect(copiedImage).toContain("01-source.png");
    expect(fs.readFileSync(copiedImage, "utf8")).toBe("image");
    expect(entry).toMatchObject({
      name: "Reusable",
      workflowId: workflow.definition.manifest.id,
      pluginId: workflow.plugin.id,
      sourceRunId: run.id
    });

    store.deleteRunCascade(run.id);
    expect(store.getWorkflowLibraryEntry(entry.id)).not.toBeNull();
    expect(fs.existsSync(copiedImage)).toBe(true);
    store.close();
  });

  it("fails clearly when a referenced input file is missing", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "blink-library-"));
    tempDirs.push(projectDir);
    const paths = createRuntimePaths(projectDir);
    const store = await SqliteStore.open(paths.dbPath);
    const workflow = workflowRegistration();
    const missingPath = path.join(projectDir, "missing.png");
    const run = store.createRun({
      id: "run-1",
      workflowId: workflow.definition.manifest.id,
      name: "Source run",
      status: "completed",
      input: { images: [missingPath] }
    });

    expect(() =>
      createWorkflowLibraryEntryFromRun({
        store,
        paths,
        workflows: new Map([[workflow.definition.manifest.id, workflow]]),
        runId: run.id
      })
    ).toThrow(/input file is missing or inaccessible/);
    expect(store.listWorkflowLibraryEntries()).toHaveLength(0);
    store.close();
  });

  it("merges input overrides recursively and replaces arrays", () => {
    expect(
      mergeLibraryInput(
        { prompt: "old", selectors: { composer: "#prompt", nested: { send: "button" } }, images: ["a.png"] },
        { prompt: "new", selectors: { nested: { send: "[data-send]" } }, images: ["b.png"] }
      )
    ).toEqual({
      prompt: "new",
      selectors: { composer: "#prompt", nested: { send: "[data-send]" } },
      images: ["b.png"]
    });
  });
});

function workflowRegistration(): WorkflowRegistration {
  const workflow: WorkflowDefinition<{ images: string[]; prompt?: string }, { ok: boolean }> = {
    manifest: {
      id: "test.library",
      title: "Library Workflow",
      description: "Workflow library test",
      category: "utility",
      version: "0.1.0",
      concurrency: 1,
      inputFields: [{ name: "images", label: "Images", type: "fileList", required: true }],
      outputKinds: ["json"],
      requiresBrowser: false
    },
    inputSchema: z.object({ images: z.array(z.string()), prompt: z.string().optional() }),
    outputSchema: z.object({ ok: z.boolean() }),
    async run() {
      return { ok: true };
    }
  };
  return {
    definition: workflow,
    plugin: {
      id: "test.plugin",
      name: "Test Plugin",
      version: "1.0.0",
      source: "user",
      apiVersion: "1",
      capabilities: ["filesystem.artifacts"]
    }
  };
}
