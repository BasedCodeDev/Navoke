import type { RunOrigin } from "./types";

type CliRunOrigin = Extract<RunOrigin, { source: "cli" }>;

export function normalizeRunOrigin(value: unknown): RunOrigin {
  if (!isRecord(value) || value.source !== "cli") return { source: "ui" };

  return {
    source: "cli",
    ...optionalString("agentName", value.agentName),
    ...optionalString("command", value.command),
    ...optionalString("cwd", value.cwd),
    ...optionalPositiveInteger("pid", value.pid),
    ...optionalString("cliVersion", value.cliVersion)
  };
}

function optionalString(key: "agentName" | "command" | "cwd" | "cliVersion", value: unknown): Partial<CliRunOrigin> {
  return typeof value === "string" && value.trim() ? { [key]: value.trim() } : {};
}

function optionalPositiveInteger(key: "pid", value: unknown): Partial<CliRunOrigin> {
  return Number.isInteger(value) && Number(value) > 0 ? { [key]: Number(value) } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
