import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppSettingsStore, projectDisplayName, projectMetadataPath, renameProject } from "../../src/main/projectSettings";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("project settings metadata", () => {
  function makeProjectDir(name = "Folder Project"): string {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-project-settings-"));
    const projectDir = path.join(parentDir, name);
    fs.mkdirSync(projectDir);
    tempDirs.push(parentDir);
    return projectDir;
  }

  it("falls back to the project folder basename when metadata is missing", () => {
    const projectDir = makeProjectDir("Folder Named Project");

    expect(projectDisplayName(projectDir)).toBe("Folder Named Project");
  });

  it("writes trimmed display names to .navoke/project.json", () => {
    const projectDir = makeProjectDir("Storage Folder");

    const displayName = renameProject(projectDir, "  Client Campaign  ");

    expect(displayName).toBe("Client Campaign");
    expect(projectDisplayName(projectDir)).toBe("Client Campaign");
    expect(JSON.parse(fs.readFileSync(projectMetadataPath(projectDir), "utf8"))).toEqual({ name: "Client Campaign" });
  });

  it("rejects blank project names", () => {
    const projectDir = makeProjectDir("Blank Name");

    expect(() => renameProject(projectDir, "   ")).toThrow("Project name is required.");
    expect(fs.existsSync(projectMetadataPath(projectDir))).toBe(false);
  });

  it("falls back to the folder basename when metadata is invalid", () => {
    const projectDir = makeProjectDir("Invalid Metadata");
    fs.mkdirSync(path.dirname(projectMetadataPath(projectDir)), { recursive: true });
    fs.writeFileSync(projectMetadataPath(projectDir), JSON.stringify({ name: "   " }), "utf8");

    expect(projectDisplayName(projectDir)).toBe("Invalid Metadata");
  });

  it("rejects rename requests for missing project folders", () => {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-project-settings-"));
    tempDirs.push(parentDir);
    const missingProjectDir = path.join(parentDir, "Missing Project");

    expect(() => renameProject(missingProjectDir, "New Name")).toThrow("Project folder not found:");
  });
});

describe("application settings", () => {
  function makeSettingsStore(): AppSettingsStore {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-app-settings-"));
    tempDirs.push(userDataDir);
    return new AppSettingsStore(userDataDir);
  }

  it("defaults agent setup to both supported agents without marking the prompt seen", () => {
    const store = makeSettingsStore();

    expect(store.agentSetupPreferences).toEqual({ firstRunSeen: false, targets: ["codex", "claude"] });
  });

  it("persists normalized agent setup preferences without changing project settings", () => {
    const store = makeSettingsStore();
    store.setLastProjectDir("C:\\Work\\Example");

    store.setAgentSetupPreferences({ firstRunSeen: true, targets: ["claude"] });

    expect(store.agentSetupPreferences).toEqual({ firstRunSeen: true, targets: ["claude"] });
    expect(store.lastProjectDir).toBe(path.resolve("C:\\Work\\Example"));
  });
});
