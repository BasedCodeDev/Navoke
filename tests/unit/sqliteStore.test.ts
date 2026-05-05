import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../../src/main/db/sqliteStore";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SqliteStore", () => {
  it("persists inserted events and returns the created row", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-store-"));
    tempDirs.push(dir);
    const store = await SqliteStore.open(path.join(dir, "workflow.sqlite"));

    const run = store.createRun({
      id: "run-1",
      workflowId: "test.workflow",
      workflowVersion: "0.1.0",
      pluginId: "test.plugin",
      pluginVersion: "1.0.0",
      pluginApiVersion: "1",
      pluginSource: "user",
      name: "Test run",
      runDir: path.join(dir, "Test run - run-1"),
      status: "queued",
      input: { images: [] }
    });
    const event = store.addEvent({
      runId: run.id,
      type: "step",
      message: "Inserted event",
      data: { progress: 10 }
    });

    expect(event.id).toBeGreaterThan(0);
    expect(event.runId).toBe(run.id);
    expect(run.runDir).toBe(path.join(dir, "Test run - run-1"));
    expect(run.runNumber).toBe(1);
    expect(run.pluginId).toBe("test.plugin");
    expect(run.pluginVersion).toBe("1.0.0");
    expect(store.listEvents(run.id)).toHaveLength(1);

    store.close();
  });

  it("deletes a run with its events and artifact records", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-store-"));
    tempDirs.push(dir);
    const store = await SqliteStore.open(path.join(dir, "workflow.sqlite"));
    const artifactPath = path.join(dir, "artifact.json");
    fs.writeFileSync(artifactPath, "{}");

    const run = store.createRun({
      id: "run-delete",
      workflowId: "test.workflow",
      name: "Delete test",
      status: "completed",
      input: { images: [] }
    });
    store.addEvent({ runId: run.id, type: "step", message: "Inserted event" });
    const artifact = store.addArtifact({
      id: "artifact-delete",
      runId: run.id,
      kind: "json",
      name: "artifact.json",
      path: artifactPath,
      mimeType: "application/json"
    });

    store.deleteRunCascade(run.id);

    expect(store.getRun(run.id)).toBeNull();
    expect(store.listEvents(run.id)).toHaveLength(0);
    expect(store.listArtifacts(run.id)).toHaveLength(0);
    expect(store.getArtifact(artifact.id)).toBeNull();

    store.close();
  });

  it("persists workflow library entries independently from source runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-store-"));
    tempDirs.push(dir);
    const store = await SqliteStore.open(path.join(dir, "workflow.sqlite"));

    const run = store.createRun({
      id: "run-library-source",
      workflowId: "test.workflow",
      workflowVersion: "0.1.0",
      pluginId: "test.plugin",
      pluginVersion: "1.0.0",
      pluginApiVersion: "1",
      pluginSource: "user",
      name: "Reusable run",
      status: "completed",
      input: { images: ["C:\\inputs\\copied.png"], prompt: "Reuse this" }
    });
    const entry = store.createWorkflowLibraryEntry({
      id: "library-entry-1",
      name: "Reusable template",
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      pluginId: run.pluginId,
      pluginVersion: run.pluginVersion,
      pluginApiVersion: run.pluginApiVersion,
      pluginSource: run.pluginSource,
      sourceRunId: run.id,
      input: run.input
    });

    store.deleteRunCascade(run.id);

    expect(store.getRun(run.id)).toBeNull();
    expect(store.getWorkflowLibraryEntry(entry.id)).toMatchObject({
      id: entry.id,
      sourceRunId: run.id,
      input: { images: ["C:\\inputs\\copied.png"], prompt: "Reuse this" }
    });
    expect(store.listWorkflowLibraryEntries()).toHaveLength(1);
    expect(store.updateWorkflowLibraryEntry(entry.id, { name: "Renamed template" }).name).toBe("Renamed template");
    store.deleteWorkflowLibraryEntry(entry.id);
    expect(store.listWorkflowLibraryEntries()).toHaveLength(0);

    store.close();
  });

  it("backfills run numbers by creation order and never reuses deleted numbers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwa-store-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "workflow.sqlite");
    let store = await SqliteStore.open(dbPath);

    const first = store.createRun({
      id: "run-a",
      workflowId: "test.workflow",
      name: "First",
      status: "completed",
      input: {}
    });
    const second = store.createRun({
      id: "run-b",
      workflowId: "test.workflow",
      name: "Second",
      status: "completed",
      input: {}
    });
    (store as unknown as { db: { run(sql: string): void } }).db.run("update runs set run_number = null");
    (store as unknown as { db: { run(sql: string): void } }).db.run("delete from metadata where key = 'runNumberCounter'");
    store.close();

    store = await SqliteStore.open(dbPath);
    expect(store.getRun(first.id)?.runNumber).toBe(1);
    expect(store.getRun(second.id)?.runNumber).toBe(2);

    store.deleteRunCascade(second.id);
    const third = store.createRun({
      id: "run-c",
      workflowId: "test.workflow",
      name: "Third",
      status: "completed",
      input: {}
    });

    expect(third.runNumber).toBe(3);
    expect(store.getRun(first.id)?.runNumber).toBe(1);
    store.close();
  });
});
