import fs from "node:fs";
import path from "node:path";
import { NAVOKE_INTERNAL_DIR_NAME } from "./runtime/paths";

interface AppSettingsModel {
  lastProjectDir?: string;
  recentProjectDirs?: string[];
}

export class AppSettingsStore {
  private readonly settingsPath: string;

  constructor(userDataDir: string) {
    this.settingsPath = path.join(userDataDir, "settings.json");
  }

  read(): AppSettingsModel {
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath, "utf8")) as AppSettingsModel;
    } catch {
      return {};
    }
  }

  get lastProjectDir(): string | undefined {
    return this.read().lastProjectDir;
  }

  get recentProjectDirs(): string[] {
    return normalizeRecentProjectDirs(this.read());
  }

  setLastProjectDir(projectDir: string): void {
    const resolvedProjectDir = path.resolve(projectDir);
    const recentProjectDirs = [
      resolvedProjectDir,
      ...this.recentProjectDirs.filter((recentProjectDir) => path.resolve(recentProjectDir) !== resolvedProjectDir)
    ].slice(0, 20);
    this.write({ ...this.read(), lastProjectDir: resolvedProjectDir, recentProjectDirs });
  }

  private write(settings: AppSettingsModel): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}

export function projectDisplayName(projectDir: string): string {
  const metadataName = readProjectMetadataName(projectDir);
  if (metadataName) return metadataName;
  return path.basename(path.resolve(projectDir)) || path.resolve(projectDir);
}

export function renameProject(projectDir: string, name: string): string {
  const resolvedProjectDir = path.resolve(projectDir);
  if (!fs.existsSync(resolvedProjectDir) || !fs.statSync(resolvedProjectDir).isDirectory()) {
    throw new Error(`Project folder not found: ${resolvedProjectDir}`);
  }

  const displayName = normalizeProjectName(name);
  fs.mkdirSync(path.dirname(projectMetadataPath(resolvedProjectDir)), { recursive: true });
  fs.writeFileSync(projectMetadataPath(resolvedProjectDir), `${JSON.stringify({ name: displayName }, null, 2)}\n`, "utf8");
  return displayName;
}

export function projectMetadataPath(projectDir: string): string {
  return path.join(path.resolve(projectDir), NAVOKE_INTERNAL_DIR_NAME, "project.json");
}

function readProjectMetadataName(projectDir: string): string | null {
  try {
    const metadata = JSON.parse(fs.readFileSync(projectMetadataPath(projectDir), "utf8")) as { name?: unknown };
    return typeof metadata.name === "string" ? normalizeProjectName(metadata.name) : null;
  } catch {
    return null;
  }
}

function normalizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required.");
  return trimmed;
}

function normalizeRecentProjectDirs(settings: AppSettingsModel): string[] {
  const candidates = [
    ...(Array.isArray(settings.recentProjectDirs) ? settings.recentProjectDirs : []),
    ...(settings.lastProjectDir ? [settings.lastProjectDir] : [])
  ];
  const seen = new Set<string>();
  const projectDirs: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    projectDirs.push(resolved);
  }

  return projectDirs;
}
