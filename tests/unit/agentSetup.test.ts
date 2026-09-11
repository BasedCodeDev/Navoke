import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentSetupManager,
  MANAGED_SKILL_MARKER,
  buildWindowsLauncher,
  ensureWindowsPathEntry,
  hashDirectory,
  removeWindowsPathEntry,
  verifyWindowsLauncher,
  windowsPathContains,
  type AgentSetupPreferences,
  type UserPathEnvironment
} from "../../src/main/agentSetup";

const tempDirs: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AgentSetupManager", () => {
  function createHarness(initialPreferences: AgentSetupPreferences = { firstRunSeen: false, targets: ["codex", "claude"] }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-agent-setup-"));
    tempDirs.push(root);
    const homeDir = path.join(root, "home");
    const localAppDataDir = path.join(root, "local-app-data");
    const skillSourceDir = path.join(root, "skill-source");
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillSourceDir, "SKILL.md"),
      "---\nname: navoke\ndescription: Drive Navoke workflows.\n---\n\n# Navoke\n",
      "utf8"
    );
    fs.mkdirSync(path.join(skillSourceDir, "references"));
    fs.writeFileSync(path.join(skillSourceDir, "references", "usage.md"), "Use the CLI.\n", "utf8");

    let preferences = initialPreferences;
    let userPath = "C:\\Tools;C:\\Windows";
    const writtenPaths: string[] = [];
    const userPathEnvironment: UserPathEnvironment = {
      getUserPath: async () => userPath,
      setUserPath: async (value) => {
        userPath = value;
        writtenPaths.push(value);
      }
    };
    const verifiedLaunchers: string[] = [];
    const manager = new AgentSetupManager({
      appVersion: "1.2.3",
      executablePath: "C:\\Program Files\\Navoke\\Navoke.exe",
      cliScriptPath: "C:\\Program Files\\Navoke\\resources\\app.asar\\dist\\cli\\index.js",
      skillSourceDir,
      homeDir,
      localAppDataDir,
      platform: "win32",
      preferences: {
        get: () => preferences,
        set: (value) => {
          preferences = value;
        }
      },
      userPathEnvironment,
      verifyLauncher: async (launcherPath) => {
        verifiedLaunchers.push(launcherPath);
      }
    });

    return {
      manager,
      root,
      homeDir,
      localAppDataDir,
      skillSourceDir,
      get preferences() {
        return preferences;
      },
      get userPath() {
        return userPath;
      },
      writtenPaths,
      verifiedLaunchers
    };
  }

  it("installs the launcher and selected personal skills, then reports them current", async () => {
    const harness = createHarness();
    const before = await harness.manager.getStatus();
    expect(before.needsAttention).toBe(true);
    expect(before.agents.map((agent) => agent.status)).toEqual(["missing", "missing"]);

    const result = await harness.manager.install(["codex", "claude"]);

    expect(result.errors).toEqual([]);
    expect(result.status.needsAttention).toBe(false);
    expect(result.status.cli).toMatchObject({ status: "current", pathConfigured: true, verified: true });
    expect(result.status.agents.map((agent) => agent.status)).toEqual(["current", "current"]);
    expect(harness.preferences).toEqual({ firstRunSeen: true, targets: ["codex", "claude"] });
    expect(fs.existsSync(path.join(harness.homeDir, ".agents", "skills", "navoke", MANAGED_SKILL_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(harness.homeDir, ".claude", "skills", "navoke", MANAGED_SKILL_MARKER))).toBe(true);
    expect(windowsPathContains(harness.userPath, path.join(harness.localAppDataDir, "Navoke", "bin"))).toBe(true);
    expect(harness.writtenPaths).toHaveLength(1);
    expect(harness.verifiedLaunchers.length).toBeGreaterThanOrEqual(2);
  });

  it("marks a changed skill outdated and replaces it without retaining a backup", async () => {
    const harness = createHarness();
    await harness.manager.install(["codex"]);
    const installedSkill = path.join(harness.homeDir, ".agents", "skills", "navoke", "SKILL.md");
    fs.writeFileSync(installedSkill, "customized\n", "utf8");

    expect((await harness.manager.getStatus()).agents[0].status).toBe("outdated");

    const result = await harness.manager.install(["codex"]);

    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(installedSkill, "utf8")).toBe(fs.readFileSync(path.join(harness.skillSourceDir, "SKILL.md"), "utf8"));
    expect(fs.readdirSync(path.dirname(path.dirname(installedSkill))).some((name) => name.startsWith(".navoke-previous-"))).toBe(false);
  });

  it("only requires setup for selected agents", async () => {
    const harness = createHarness({ firstRunSeen: true, targets: ["codex"] });
    const result = await harness.manager.install(["codex"]);

    expect(result.status.needsAttention).toBe(false);
    expect(result.status.agents.find((agent) => agent.target === "claude")?.status).toBe("missing");
  });

  it("persists dismissal without installing components", async () => {
    const harness = createHarness();

    const status = await harness.manager.dismissFirstRun();

    expect(status.firstRunSeen).toBe(true);
    expect(status.needsAttention).toBe(true);
    expect(harness.preferences.firstRunSeen).toBe(true);
  });
});

describe("agent setup helpers", () => {
  const windowsIt = process.platform === "win32" ? it : it.skip;

  it("keeps the Codex and Claude project skill copies synchronized", () => {
    const codexSkill = fs.readFileSync(path.resolve(".agents", "skills", "navoke", "SKILL.md"), "utf8");
    const claudeSkill = fs.readFileSync(path.resolve(".claude", "skills", "navoke", "SKILL.md"), "utf8");

    expect(claudeSkill).toBe(codexSkill);
  });

  it("normalizes, deduplicates, and removes one exact Windows PATH entry", () => {
    const current = "C:\\Tools;\"C:\\Users\\User\\AppData\\Local\\Navoke\\bin\\\";C:\\Windows";
    const navokeBin = "c:/users/user/appdata/local/navoke/bin";

    expect(ensureWindowsPathEntry(current, navokeBin)).toBe(current);
    expect(ensureWindowsPathEntry(`${current};C:\\Users\\User\\AppData\\Local\\Navoke\\bin`, navokeBin)).toBe(current);
    expect(removeWindowsPathEntry(current, navokeBin)).toBe("C:\\Tools;C:\\Windows");
  });

  it("ignores the Navoke ownership marker when hashing skill contents", () => {
    const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-skill-hash-"));
    tempDirs.push(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "content\n", "utf8");
    const before = hashDirectory(skillDir);
    fs.writeFileSync(path.join(skillDir, MANAGED_SKILL_MARKER), "{}\n", "utf8");

    expect(hashDirectory(skillDir)).toBe(before);
  });

  it("builds a launcher that preserves percent signs in custom install paths", () => {
    const launcher = buildWindowsLauncher("C:\\Apps\\100% Navoke\\Navoke.exe", "C:\\Apps\\100% Navoke\\cli.js");

    expect(launcher).toContain('"C:\\Apps\\100%% Navoke\\Navoke.exe"');
    expect(launcher).toContain('"C:\\Apps\\100%% Navoke\\cli.js" %*');
    expect(launcher).toContain("Managed by Navoke");
  });

  windowsIt("verifies a Windows launcher whose path contains spaces", async () => {
    const launcherDir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke launcher "));
    tempDirs.push(launcherDir);
    const launcherPath = path.join(launcherDir, "navoke test.cmd");
    fs.writeFileSync(launcherPath, "@echo off\r\necho {\"ok\":true}\r\n", "utf8");

    await expect(verifyWindowsLauncher(launcherPath)).resolves.toBeUndefined();
  });
});
