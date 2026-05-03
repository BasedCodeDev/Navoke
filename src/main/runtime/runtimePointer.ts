import fs from "node:fs";
import path from "node:path";
import type { RuntimePaths } from "./types";
import { writeJson } from "../utils/files";

export const RUNTIME_POINTER_FILE = "runtime.json";

export interface RuntimePointer {
  version: 1;
  apiBaseUrl: string;
  port: number | null;
  projectDir: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
}

export function runtimePointerPath(paths: RuntimePaths): string {
  return path.join(paths.internalDir, RUNTIME_POINTER_FILE);
}

export function writeRuntimePointer(paths: RuntimePaths, apiBaseUrl: string): RuntimePointer {
  const now = new Date().toISOString();
  const pointer: RuntimePointer = {
    version: 1,
    apiBaseUrl,
    port: portFromUrl(apiBaseUrl),
    projectDir: paths.projectDir,
    pid: process.pid,
    startedAt: now,
    updatedAt: now
  };
  writeJson(runtimePointerPath(paths), pointer);
  return pointer;
}

export function removeRuntimePointer(paths: RuntimePaths): void {
  fs.rmSync(runtimePointerPath(paths), { force: true });
}

function portFromUrl(value: string): number | null {
  try {
    const rawPort = new URL(value).port;
    if (!rawPort) return null;
    const port = Number(rawPort);
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}
