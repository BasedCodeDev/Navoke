import fs from "node:fs";
import path from "node:path";

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
