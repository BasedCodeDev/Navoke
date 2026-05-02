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
});
