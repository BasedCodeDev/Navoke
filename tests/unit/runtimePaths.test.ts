import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimePaths,
  getRunDir,
  migrateLegacyProjectStorage,
  safeRunFolderName
} from "../../src/main/runtime/paths";
import { SqliteStore } from "../../src/main/db/sqliteStore";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime paths", () => {
  it("uses root-level run folders and .navoke internals", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-project-"));
    tempDirs.push(projectDir);

    const paths = createRuntimePaths(projectDir);
    expect(paths.projectDir).toBe(path.resolve(projectDir));
    expect(paths.runRootDir).toBe(path.resolve(projectDir));
    expect(paths.internalDir).toBe(path.join(path.resolve(projectDir), ".navoke"));
    expect(paths.dbPath).toBe(path.join(path.resolve(projectDir), ".navoke", "workflow.sqlite"));
    expect(paths.libraryDir).toBe(path.join(path.resolve(projectDir), ".navoke", "library"));
    expect(paths.browserProfilesDir).toBe(path.join(path.resolve(projectDir), ".navoke", "browser-profiles"));
    expect(paths.workflowLabDir).toBe(path.join(path.resolve(projectDir), ".navoke", "workflow-lab"));

    const store = await SqliteStore.open(paths.dbPath);
    store.close();
    expect(fs.existsSync(paths.dbPath)).toBe(true);
  });

  it("migrates .blink storage and preserves legacy absolute paths", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-project-migration-"));
    tempDirs.push(projectDir);
    const legacyDir = path.join(projectDir, ".blink");
    const legacyArtifactPath = path.join(legacyDir, "artifacts", "run-1", "result.json");
    fs.mkdirSync(path.dirname(legacyArtifactPath), { recursive: true });
    fs.writeFileSync(legacyArtifactPath, "legacy artifact", "utf8");

    const paths = createRuntimePaths(projectDir);

    expect(paths.internalDir).toBe(path.join(projectDir, ".navoke"));
    expect(fs.readFileSync(path.join(paths.artifactDir, "run-1", "result.json"), "utf8")).toBe("legacy artifact");
    expect(fs.readFileSync(legacyArtifactPath, "utf8")).toBe("legacy artifact");
    expect(fs.realpathSync(legacyDir)).toBe(fs.realpathSync(paths.internalDir));
  });

  it("does not merge or overwrite storage when .navoke already exists", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-project-migration-conflict-"));
    tempDirs.push(projectDir);
    const legacyDir = path.join(projectDir, ".blink");
    const canonicalDir = path.join(projectDir, ".navoke");
    fs.mkdirSync(legacyDir);
    fs.mkdirSync(canonicalDir);
    fs.writeFileSync(path.join(legacyDir, "legacy.txt"), "legacy", "utf8");
    fs.writeFileSync(path.join(canonicalDir, "canonical.txt"), "canonical", "utf8");

    expect(migrateLegacyProjectStorage(projectDir)).toBe("canonical-storage-exists");
    expect(() => createRuntimePaths(projectDir)).toThrow(/found both \.navoke and legacy \.blink storage/);
    expect(fs.readFileSync(path.join(legacyDir, "legacy.txt"), "utf8")).toBe("legacy");
    expect(fs.readFileSync(path.join(canonicalDir, "canonical.txt"), "utf8")).toBe("canonical");
  });

  it("builds safe unique run folder names from run names and ids", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-project-"));
    tempDirs.push(projectDir);
    const paths = createRuntimePaths(projectDir);

    expect(safeRunFolderName('Bad: Run / Name * ? "')).toBe("Bad-Run-Name");
    expect(safeRunFolderName(".navoke")).toBe("navoke");
    expect(getRunDir(paths, "Same Name", "11111111-aaaa", 12)).toBe(path.join(path.resolve(projectDir), "12-Same-Name-11111111"));
    expect(getRunDir(paths, "Same Name", "22222222-bbbb")).toBe(path.join(path.resolve(projectDir), "Same-Name-22222222"));
  });
});
