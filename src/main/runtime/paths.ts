import fs from "node:fs";
import path from "node:path";
import type { RuntimePaths } from "./types";

export const BLINK_INTERNAL_DIR_NAME = ".blink";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function createRuntimePaths(projectDir: string): RuntimePaths {
  const resolvedProjectDir = path.resolve(projectDir);
  const internalDir = path.join(resolvedProjectDir, BLINK_INTERNAL_DIR_NAME);
  const dataDir = internalDir;
  const runRootDir = resolvedProjectDir;
  const artifactDir = path.join(internalDir, "artifacts");
  const browserProfilesDir = path.join(internalDir, "browser-profiles");
  const workflowLabDir = path.join(internalDir, "workflow-lab");
  const logsDir = path.join(internalDir, "logs");
  const dbPath = path.join(internalDir, "workflow.sqlite");

  for (const dir of [resolvedProjectDir, dataDir, artifactDir, browserProfilesDir, workflowLabDir, logsDir]) {
    ensureDir(dir);
  }

  return {
    projectDir: resolvedProjectDir,
    internalDir,
    runRootDir,
    dataDir,
    artifactDir,
    browserProfilesDir,
    workflowLabDir,
    logsDir,
    dbPath
  };
}

export function getRunArtifactDir(paths: RuntimePaths, runId: string): string {
  const dir = path.join(paths.artifactDir, runId);
  ensureDir(dir);
  return dir;
}

export function safeRunFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/g, "")
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim();
  return cleaned || "run";
}

export function shortRunId(runId: string): string {
  const compact = runId.replace(/[^\w]+/g, "");
  return (compact || runId).slice(0, 8);
}

export function getRunDir(paths: RuntimePaths, runName: string, runId: string): string {
  return path.join(paths.runRootDir, `${safeRunFolderName(runName)} - ${shortRunId(runId)}`);
}

export function getRunInputDir(runDir: string): string {
  return path.join(runDir, "inputs");
}

export function getRunOutputArtifactDir(runDir: string): string {
  return path.join(runDir, "artifacts");
}

export function ensureRunDataDirs(runDir: string): { inputDir: string; artifactDir: string } {
  const inputDir = getRunInputDir(runDir);
  const artifactDir = getRunOutputArtifactDir(runDir);
  for (const dir of [runDir, inputDir, artifactDir]) {
    ensureDir(dir);
  }
  return { inputDir, artifactDir };
}
