import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const AGENT_SETUP_TARGETS = ["codex", "claude"] as const;
export type AgentSetupTarget = (typeof AGENT_SETUP_TARGETS)[number];
export type AgentSetupComponentStatus = "missing" | "current" | "outdated" | "error";

export interface AgentSetupPreferences {
  firstRunSeen: boolean;
  targets: AgentSetupTarget[];
}

export interface AgentSkillSetupStatus {
  target: AgentSetupTarget;
  label: string;
  path: string;
  status: AgentSetupComponentStatus;
  installedVersion?: string;
  error?: string;
}

export interface AgentCliSetupStatus {
  path: string;
  status: AgentSetupComponentStatus;
  pathConfigured: boolean;
  verified: boolean;
  error?: string;
}

export interface AgentSetupStatus {
  supported: boolean;
  appVersion: string;
  firstRunSeen: boolean;
  targets: AgentSetupTarget[];
  agents: AgentSkillSetupStatus[];
  cli: AgentCliSetupStatus;
  needsAttention: boolean;
}

export interface AgentSetupInstallResult {
  status: AgentSetupStatus;
  errors: string[];
}

export interface AgentSetupPreferencesStore {
  get(): AgentSetupPreferences;
  set(preferences: AgentSetupPreferences): void;
}

export interface UserPathEnvironment {
  getUserPath(): Promise<string>;
  setUserPath(value: string): Promise<void>;
}

export interface AgentSetupManagerOptions {
  appVersion: string;
  executablePath: string;
  cliScriptPath: string;
  skillSourceDir: string;
  homeDir: string;
  localAppDataDir: string;
  preferences: AgentSetupPreferencesStore;
  platform?: NodeJS.Platform;
  userPathEnvironment?: UserPathEnvironment;
  verifyLauncher?: (launcherPath: string) => Promise<void>;
}

interface ManagedSkillMarker {
  managedBy: "navoke";
  appVersion: string;
  skillHash: string;
  target: AgentSetupTarget;
}

export const MANAGED_SKILL_MARKER = ".navoke-managed.json";
const WINDOWS_USER_PATH_VARIABLE = "NAVOKE_USER_PATH_VALUE";

const POWERSHELL_BROADCAST_ENVIRONMENT = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NavokeEnvironmentBroadcast {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    uint Msg,
    UIntPtr wParam,
    string lParam,
    uint fuFlags,
    uint uTimeout,
    out UIntPtr lpdwResult
  );
}
'@
$result = [UIntPtr]::Zero
[void][NavokeEnvironmentBroadcast]::SendMessageTimeout(
  [IntPtr]0xffff,
  0x001A,
  [UIntPtr]::Zero,
  'Environment',
  0x0002,
  5000,
  [ref]$result
)
`;

export class PowerShellUserPathEnvironment implements UserPathEnvironment {
  async getUserPath(): Promise<string> {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "[Console]::Out.Write([Environment]::GetEnvironmentVariable('Path', 'User'))"
      ],
      { windowsHide: true }
    );
    return stdout;
  }

  async setUserPath(value: string): Promise<void> {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `[Environment]::SetEnvironmentVariable('Path', $env:${WINDOWS_USER_PATH_VARIABLE}, 'User')\n${POWERSHELL_BROADCAST_ENVIRONMENT}`
      ],
      {
        windowsHide: true,
        env: { ...process.env, [WINDOWS_USER_PATH_VARIABLE]: value }
      }
    );
  }
}

export class AgentSetupManager {
  private readonly options: AgentSetupManagerOptions;
  private readonly userPathEnvironment: UserPathEnvironment;
  private readonly verifyLauncher: (launcherPath: string) => Promise<void>;

  constructor(options: AgentSetupManagerOptions) {
    this.options = options;
    this.userPathEnvironment = options.userPathEnvironment ?? new PowerShellUserPathEnvironment();
    this.verifyLauncher = options.verifyLauncher ?? verifyWindowsLauncher;
  }

  async getStatus(): Promise<AgentSetupStatus> {
    const preferences = normalizePreferences(this.options.preferences.get());
    const supported = (this.options.platform ?? process.platform) === "win32";
    const agents = await this.getAgentStatuses();
    const cli = supported ? await this.getCliStatus() : unsupportedCliStatus(this.launcherPath);
    const selectedAgents = agents.filter((agent) => preferences.targets.includes(agent.target));
    const needsAttention =
      supported && (cli.status !== "current" || selectedAgents.some((agent) => agent.status !== "current"));

    return {
      supported,
      appVersion: this.options.appVersion,
      firstRunSeen: preferences.firstRunSeen,
      targets: preferences.targets,
      agents,
      cli,
      needsAttention
    };
  }

  async install(targets: AgentSetupTarget[]): Promise<AgentSetupInstallResult> {
    const normalizedTargets = normalizeTargets(targets);
    if ((this.options.platform ?? process.platform) !== "win32") {
      throw new Error("Agent setup is currently supported on Windows only.");
    }

    this.options.preferences.set({ firstRunSeen: true, targets: normalizedTargets });
    const errors: string[] = [];

    try {
      await this.installCli();
    } catch (error) {
      errors.push(`Navoke CLI: ${errorMessage(error)}`);
    }

    for (const target of normalizedTargets) {
      try {
        this.installAgentSkill(target);
      } catch (error) {
        errors.push(`${agentLabel(target)}: ${errorMessage(error)}`);
      }
    }

    return { status: await this.getStatus(), errors };
  }

  async savePreferences(targets: AgentSetupTarget[]): Promise<AgentSetupStatus> {
    const current = normalizePreferences(this.options.preferences.get());
    this.options.preferences.set({ ...current, targets: normalizeTargets(targets) });
    return this.getStatus();
  }

  async dismissFirstRun(): Promise<AgentSetupStatus> {
    const current = normalizePreferences(this.options.preferences.get());
    this.options.preferences.set({ ...current, firstRunSeen: true });
    return this.getStatus();
  }

  private get launcherPath(): string {
    return path.join(this.options.localAppDataDir, "Navoke", "bin", "navoke.cmd");
  }

  private async getAgentStatuses(): Promise<AgentSkillSetupStatus[]> {
    let sourceHash: string;
    try {
      sourceHash = hashDirectory(this.options.skillSourceDir);
    } catch (error) {
      return AGENT_SETUP_TARGETS.map((target) => ({
        target,
        label: agentLabel(target),
        path: this.agentSkillPath(target),
        status: "error",
        error: `Bundled skill is unavailable: ${errorMessage(error)}`
      }));
    }

    return AGENT_SETUP_TARGETS.map((target) => this.getAgentStatus(target, sourceHash));
  }

  private getAgentStatus(target: AgentSetupTarget, sourceHash: string): AgentSkillSetupStatus {
    const targetPath = this.agentSkillPath(target);
    if (!fs.existsSync(path.join(targetPath, "SKILL.md"))) {
      return { target, label: agentLabel(target), path: targetPath, status: "missing" };
    }

    try {
      const installedHash = hashDirectory(targetPath);
      const marker = readManagedMarker(targetPath);
      return {
        target,
        label: agentLabel(target),
        path: targetPath,
        status: installedHash === sourceHash ? "current" : "outdated",
        ...(marker?.appVersion ? { installedVersion: marker.appVersion } : {})
      };
    } catch (error) {
      return {
        target,
        label: agentLabel(target),
        path: targetPath,
        status: "error",
        error: errorMessage(error)
      };
    }
  }

  private async getCliStatus(): Promise<AgentCliSetupStatus> {
    const launcherPath = this.launcherPath;
    const expectedLauncher = buildWindowsLauncher(this.options.executablePath, this.options.cliScriptPath);
    if (!fs.existsSync(launcherPath)) {
      return { path: launcherPath, status: "missing", pathConfigured: false, verified: false };
    }

    try {
      const currentLauncher = fs.readFileSync(launcherPath, "utf8");
      const userPath = await this.userPathEnvironment.getUserPath();
      const pathConfigured = windowsPathContains(userPath, path.dirname(launcherPath));
      if (currentLauncher !== expectedLauncher || !pathConfigured) {
        return { path: launcherPath, status: "outdated", pathConfigured, verified: false };
      }

      await this.verifyLauncher(launcherPath);
      return { path: launcherPath, status: "current", pathConfigured: true, verified: true };
    } catch (error) {
      return {
        path: launcherPath,
        status: "error",
        pathConfigured: false,
        verified: false,
        error: errorMessage(error)
      };
    }
  }

  private installAgentSkill(target: AgentSetupTarget): void {
    if (!fs.existsSync(path.join(this.options.skillSourceDir, "SKILL.md"))) {
      throw new Error(`Bundled Navoke skill was not found at ${this.options.skillSourceDir}.`);
    }

    const targetPath = this.agentSkillPath(target);
    this.assertExpectedSkillPath(target, targetPath);
    const sourceHash = hashDirectory(this.options.skillSourceDir);
    const marker: ManagedSkillMarker = {
      managedBy: "navoke",
      appVersion: this.options.appVersion,
      skillHash: sourceHash,
      target
    };
    atomicReplaceDirectory(this.options.skillSourceDir, targetPath, marker);
  }

  private async installCli(): Promise<void> {
    const launcherPath = this.launcherPath;
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    atomicWriteFile(launcherPath, buildWindowsLauncher(this.options.executablePath, this.options.cliScriptPath));

    const launcherDir = path.dirname(launcherPath);
    const userPath = await this.userPathEnvironment.getUserPath();
    const nextUserPath = ensureWindowsPathEntry(userPath, launcherDir);
    if (nextUserPath !== userPath) {
      await this.userPathEnvironment.setUserPath(nextUserPath);
    }
    process.env.PATH = ensureWindowsPathEntry(process.env.PATH ?? "", launcherDir);
    await this.verifyLauncher(launcherPath);
  }

  private agentSkillPath(target: AgentSetupTarget): string {
    return target === "codex"
      ? path.join(this.options.homeDir, ".agents", "skills", "navoke")
      : path.join(this.options.homeDir, ".claude", "skills", "navoke");
  }

  private assertExpectedSkillPath(target: AgentSetupTarget, candidate: string): void {
    const expected = path.resolve(this.agentSkillPath(target));
    if (path.resolve(candidate).toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Refusing to write outside the expected ${agentLabel(target)} skill directory.`);
    }
  }
}

export function normalizeTargets(targets: readonly string[]): AgentSetupTarget[] {
  const normalized = AGENT_SETUP_TARGETS.filter((target) => targets.includes(target));
  if (normalized.length === 0) throw new Error("Select at least one agent to set up.");
  return normalized;
}

export function ensureWindowsPathEntry(currentPath: string, entry: string): string {
  const entries = splitWindowsPath(currentPath);
  const normalizedEntry = normalizeWindowsPathEntry(entry);
  let found = false;
  let changed = false;
  const nextEntries = entries.filter((candidate) => {
    if (normalizeWindowsPathEntry(candidate) !== normalizedEntry) return true;
    if (!found) {
      found = true;
      return true;
    }
    changed = true;
    return false;
  });
  if (!found) {
    nextEntries.push(entry);
    changed = true;
  }
  return changed ? nextEntries.join(";") : currentPath;
}

export function removeWindowsPathEntry(currentPath: string, entry: string): string {
  const normalizedEntry = normalizeWindowsPathEntry(entry);
  return splitWindowsPath(currentPath)
    .filter((candidate) => normalizeWindowsPathEntry(candidate) !== normalizedEntry)
    .join(";");
}

export function windowsPathContains(currentPath: string, entry: string): boolean {
  const normalizedEntry = normalizeWindowsPathEntry(entry);
  return splitWindowsPath(currentPath).some((candidate) => normalizeWindowsPathEntry(candidate) === normalizedEntry);
}

export function buildWindowsLauncher(executablePath: string, cliScriptPath: string): string {
  return [
    "@echo off",
    "rem Managed by Navoke. Re-run Agent Setup to repair this launcher.",
    "setlocal",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${escapeBatchPath(executablePath)}" "${escapeBatchPath(cliScriptPath)}" %*`,
    ""
  ].join("\r\n");
}

export function hashDirectory(directory: string): string {
  const root = path.resolve(directory);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Directory not found: ${root}`);
  }

  const hash = crypto.createHash("sha256");
  const visit = (currentDir: string): void => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === MANAGED_SKILL_MARKER) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\0`);
        visit(fullPath);
      } else if (entry.isFile()) {
        hash.update(`file:${relativePath}\0`);
        hash.update(fs.readFileSync(fullPath));
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`link:${relativePath}\0${fs.readlinkSync(fullPath)}\0`);
      } else {
        hash.update(`other:${relativePath}\0`);
      }
    }
  };

  visit(root);
  return hash.digest("hex");
}

export async function verifyWindowsLauncher(launcherPath: string): Promise<void> {
  const command = `""${launcherPath.replace(/"/g, '""')}" help"`;
  const { stdout } = await execFileAsync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
    windowsHide: true,
    windowsVerbatimArguments: true,
    maxBuffer: 1024 * 1024
  });
  const result = JSON.parse(stdout.trim()) as { ok?: unknown };
  if (result.ok !== true) throw new Error("The Navoke CLI launcher did not return a successful response.");
}

function normalizePreferences(preferences: AgentSetupPreferences): AgentSetupPreferences {
  let targets: AgentSetupTarget[];
  try {
    targets = normalizeTargets(preferences.targets ?? []);
  } catch {
    targets = [...AGENT_SETUP_TARGETS];
  }
  return { firstRunSeen: Boolean(preferences.firstRunSeen), targets };
}

function splitWindowsPath(value: string): string[] {
  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeWindowsPathEntry(value: string): string {
  const expanded = value.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? match);
  return expanded
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/[\\/]+$/g, "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

function escapeBatchPath(value: string): string {
  return value.replace(/%/g, "%%").replace(/"/g, '""');
}

function agentLabel(target: AgentSetupTarget): string {
  return target === "codex" ? "Codex" : "Claude Code";
}

function readManagedMarker(skillDir: string): ManagedSkillMarker | null {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(skillDir, MANAGED_SKILL_MARKER), "utf8")) as Partial<ManagedSkillMarker>;
    return marker.managedBy === "navoke" && typeof marker.appVersion === "string" ? (marker as ManagedSkillMarker) : null;
  } catch {
    return null;
  }
}

function atomicReplaceDirectory(sourceDir: string, targetDir: string, marker: ManagedSkillMarker): void {
  const parentDir = path.dirname(targetDir);
  fs.mkdirSync(parentDir, { recursive: true });
  const operationId = crypto.randomUUID();
  const stagedDir = path.join(parentDir, `.navoke-install-${operationId}`);
  const previousDir = path.join(parentDir, `.navoke-previous-${operationId}`);
  let movedPrevious = false;

  try {
    fs.cpSync(sourceDir, stagedDir, { recursive: true, force: true });
    fs.writeFileSync(path.join(stagedDir, MANAGED_SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, previousDir);
      movedPrevious = true;
    }
    fs.renameSync(stagedDir, targetDir);
    if (movedPrevious) fs.rmSync(previousDir, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(stagedDir)) fs.rmSync(stagedDir, { recursive: true, force: true });
    if (movedPrevious && fs.existsSync(previousDir) && !fs.existsSync(targetDir)) {
      fs.renameSync(previousDir, targetDir);
    }
    throw error;
  }
}

function atomicWriteFile(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function unsupportedCliStatus(launcherPath: string): AgentCliSetupStatus {
  return {
    path: launcherPath,
    status: "error",
    pathConfigured: false,
    verified: false,
    error: "Agent setup is currently supported on Windows only."
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
