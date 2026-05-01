import fs from "node:fs";
import path from "node:path";
import type { RuntimePaths } from "./types";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function createRuntimePaths(userDataDir: string): RuntimePaths {
  const dataDir = userDataDir;
  const artifactDir = path.join(dataDir, "artifacts");
  const browserProfilesDir = path.join(dataDir, "browser-profiles");
  const logsDir = path.join(dataDir, "logs");
  const dbPath = path.join(dataDir, "workflow.sqlite");

  for (const dir of [dataDir, artifactDir, browserProfilesDir, logsDir]) {
    ensureDir(dir);
  }

  return { dataDir, artifactDir, browserProfilesDir, logsDir, dbPath };
}

export function getRunArtifactDir(paths: RuntimePaths, runId: string): string {
  const dir = path.join(paths.artifactDir, runId);
  ensureDir(dir);
  return dir;
}
