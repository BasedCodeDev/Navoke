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
    expect(store.listEvents(run.id)).toHaveLength(1);

    store.close();
  });
});
