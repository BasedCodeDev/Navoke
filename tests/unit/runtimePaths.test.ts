import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimePaths, getRunDir, safeRunFolderName } from "../../src/main/runtime/paths";
import { SqliteStore } from "../../src/main/db/sqliteStore";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime paths", () => {
  it("uses root-level run folders and .blink internals", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "blink-project-"));
    tempDirs.push(projectDir);

    const paths = createRuntimePaths(projectDir);
    expect(paths.projectDir).toBe(path.resolve(projectDir));
    expect(paths.runRootDir).toBe(path.resolve(projectDir));
    expect(paths.internalDir).toBe(path.join(path.resolve(projectDir), ".blink"));
    expect(paths.dbPath).toBe(path.join(path.resolve(projectDir), ".blink", "workflow.sqlite"));
    expect(paths.browserProfilesDir).toBe(path.join(path.resolve(projectDir), ".blink", "browser-profiles"));
    expect(paths.workflowLabDir).toBe(path.join(path.resolve(projectDir), ".blink", "workflow-lab"));

    const store = await SqliteStore.open(paths.dbPath);
    store.close();
    expect(fs.existsSync(paths.dbPath)).toBe(true);
  });

  it("builds safe unique run folder names from run names and ids", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "blink-project-"));
    tempDirs.push(projectDir);
    const paths = createRuntimePaths(projectDir);

    expect(safeRunFolderName('Bad: Run / Name * ? "')).toBe("Bad_ Run _ Name _ _ _");
    expect(safeRunFolderName(".blink")).toBe("blink");
    expect(getRunDir(paths, "Same Name", "11111111-aaaa")).toBe(path.join(path.resolve(projectDir), "Same Name - 11111111"));
    expect(getRunDir(paths, "Same Name", "22222222-bbbb")).toBe(path.join(path.resolve(projectDir), "Same Name - 22222222"));
  });
});
