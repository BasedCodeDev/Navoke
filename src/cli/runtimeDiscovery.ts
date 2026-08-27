import fs from "node:fs";
import path from "node:path";

export const DEFAULT_API_URL = "http://127.0.0.1:39201";
export const RUNTIME_POINTER_FILE = "runtime.json";
export const NAVOKE_INTERNAL_DIR_NAME = ".navoke";
const LEGACY_BLINK_INTERNAL_DIR_NAME = ".blink";

export type RuntimeDiscoverySource = "flag" | "env" | "runtime-file" | "default";

export interface RuntimeDiscoveryInput {
  apiUrl?: string;
  projectPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RuntimeDiscovery {
  apiUrl: string;
  source: RuntimeDiscoverySource;
  runtimeFile?: string;
  staleRuntimeFile?: string;
  runtimeFileError?: string;
}

interface RuntimePointer {
  apiBaseUrl?: unknown;
}

export interface RuntimeDiscoveryDeps {
  existsSync?(filePath: string): boolean;
  readFileSync?(filePath: string): string;
  healthCheck?(apiUrl: string): Promise<boolean>;
}

export async function discoverRuntime(
  input: RuntimeDiscoveryInput = {},
  deps: RuntimeDiscoveryDeps = {}
): Promise<RuntimeDiscovery> {
  const env = input.env ?? process.env;
  const cwd = path.resolve(input.cwd ?? process.cwd());

  if (input.apiUrl?.trim()) {
    return { apiUrl: normalizeApiUrl(input.apiUrl), source: "flag" };
  }

  if (env.NAVOKE_API_URL?.trim()) {
    return { apiUrl: normalizeApiUrl(env.NAVOKE_API_URL), source: "env" };
  }

  if (env.BASED_BLINK_API_URL?.trim()) {
    return { apiUrl: normalizeApiUrl(env.BASED_BLINK_API_URL), source: "env" };
  }

  const runtimeFile = input.projectPath
    ? findProjectRuntimeFile(path.resolve(input.projectPath), deps)
    : findNearestRuntimeFile(cwd, deps);

  if (runtimeFile && exists(runtimeFile, deps)) {
    try {
      const pointer = readRuntimePointer(runtimeFile, deps);
      if (pointer.apiBaseUrl) {
        const apiUrl = normalizeApiUrl(pointer.apiBaseUrl);
        const healthy = await (deps.healthCheck ?? defaultHealthCheck)(apiUrl).catch(() => false);
        if (healthy) return { apiUrl, source: "runtime-file", runtimeFile };
        return { apiUrl: DEFAULT_API_URL, source: "default", staleRuntimeFile: runtimeFile };
      }
      return {
        apiUrl: DEFAULT_API_URL,
        source: "default",
        staleRuntimeFile: runtimeFile,
        runtimeFileError: "Runtime file does not include apiBaseUrl."
      };
    } catch (error) {
      return {
        apiUrl: DEFAULT_API_URL,
        source: "default",
        staleRuntimeFile: runtimeFile,
        runtimeFileError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return { apiUrl: DEFAULT_API_URL, source: "default" };
}

export function findNearestRuntimeFile(startDir: string, deps: RuntimeDiscoveryDeps = {}): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = findProjectRuntimeFile(current, deps);
    if (candidate) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findProjectRuntimeFile(projectDir: string, deps: RuntimeDiscoveryDeps): string | undefined {
  for (const internalDirName of [NAVOKE_INTERNAL_DIR_NAME, LEGACY_BLINK_INTERNAL_DIR_NAME]) {
    const candidate = path.join(projectDir, internalDirName, RUNTIME_POINTER_FILE);
    if (exists(candidate, deps)) return candidate;
  }
  return undefined;
}

export function readRuntimePointer(filePath: string, deps: RuntimeDiscoveryDeps = {}): { apiBaseUrl?: string } {
  const raw = (deps.readFileSync ?? ((target: string) => fs.readFileSync(target, "utf8")))(filePath);
  const pointer = JSON.parse(raw) as RuntimePointer;
  return typeof pointer.apiBaseUrl === "string" ? { apiBaseUrl: pointer.apiBaseUrl } : {};
}

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("API URL is required.");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported API URL protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, "");
}

function exists(filePath: string, deps: RuntimeDiscoveryDeps): boolean {
  return (deps.existsSync ?? fs.existsSync)(filePath);
}

async function defaultHealthCheck(apiUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(`${apiUrl}/api/health`, { signal: controller.signal });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}
