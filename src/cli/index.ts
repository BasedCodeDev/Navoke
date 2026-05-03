#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_API_URL, discoverRuntime, type RuntimeDiscovery } from "./runtimeDiscovery";

const CLI_VERSION = "0.1.0";
const ACTIVE_STATUSES = new Set(["queued", "running", "pausing", "waiting_manual"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RunRecordLike {
  id: string;
  status: string;
  [key: string]: unknown;
}

interface RunDetailLike {
  run: RunRecordLike;
  events: unknown[];
  artifacts: unknown[];
}

interface ParsedGlobals {
  apiUrl?: string;
  projectPath?: string;
}

type ParsedCommand =
  | { kind: "help"; globals: ParsedGlobals }
  | { kind: "status"; globals: ParsedGlobals }
  | { kind: "workflows"; globals: ParsedGlobals }
  | { kind: "workflow"; globals: ParsedGlobals; workflowId: string }
  | { kind: "run"; globals: ParsedGlobals; workflowId: string; inputFile: string; name?: string; agentName?: string; wait: boolean }
  | { kind: "runs"; globals: ParsedGlobals; active: boolean }
  | { kind: "get"; globals: ParsedGlobals; runId: string }
  | { kind: "watch"; globals: ParsedGlobals; runId: string }
  | { kind: "pause" | "resume" | "cancel" | "delete"; globals: ParsedGlobals; runId: string }
  | { kind: "plugins"; globals: ParsedGlobals }
  | { kind: "plugin-install"; globals: ParsedGlobals; pluginPath: string };

export interface CliDeps {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  stdout?(line: string): void;
  stderr?(line: string): void;
  readFile?(filePath: string): string;
  discoverRuntime?(input: { apiUrl?: string; projectPath?: string; cwd: string; env: NodeJS.ProcessEnv }): Promise<RuntimeDiscovery>;
  request?<T>(apiUrl: string, method: HttpMethod, apiPath: string, body?: unknown): Promise<T>;
  watchRun?(apiUrl: string, runId: string, options: WatchRunOptions): Promise<RunRecordLike>;
}

export interface WatchRunOptions {
  stdout(line: string): void;
  request<T>(apiUrl: string, method: HttpMethod, apiPath: string, body?: unknown): Promise<T>;
}

class CliUsageError extends Error {
  exitCode = 2;
}

const MUTATING_COMMANDS = new Set<ParsedCommand["kind"]>(["run", "plugin-install", "pause", "resume", "cancel", "delete"]);

export async function runCli(argv = process.argv.slice(2), deps: CliDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => process.stdout.write(line));
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(line));
  const cwd = path.resolve(deps.cwd ?? process.cwd());
  const env = deps.env ?? process.env;
  const request = deps.request ?? apiRequest;

  try {
    const parsed = parseBlinkArgs(argv);
    if (parsed.kind === "help") {
      writeJson(stdout, { ok: true, commands: commandList() });
      return 0;
    }

    const runtime = await (deps.discoverRuntime ?? discoverRuntime)({
      apiUrl: parsed.globals.apiUrl,
      projectPath: parsed.globals.projectPath,
      cwd,
      env
    });
    const context = {
      apiUrl: runtime.apiUrl,
      runtimeSource: runtime.source,
      ...(runtime.runtimeFile ? { runtimeFile: runtime.runtimeFile } : {}),
      ...(runtime.staleRuntimeFile ? { staleRuntimeFile: runtime.staleRuntimeFile } : {})
    };
    assertSafeRuntimeForCommand(parsed, runtime);

    switch (parsed.kind) {
      case "status": {
        const health = await request(runtime.apiUrl, "GET", "/api/health");
        const system = await request(runtime.apiUrl, "GET", "/api/system");
        writeJson(stdout, { ok: true, ...context, health, system });
        return 0;
      }
      case "workflows": {
        const workflows = await request(runtime.apiUrl, "GET", "/api/workflows");
        writeJson(stdout, { ok: true, ...context, workflows });
        return 0;
      }
      case "workflow": {
        const workflows = await request<Array<{ manifest?: { id?: string } }>>(runtime.apiUrl, "GET", "/api/workflows");
        const workflow = workflows.find((item) => item.manifest?.id === parsed.workflowId);
        if (!workflow) throw new Error(`Workflow not found: ${parsed.workflowId}`);
        writeJson(stdout, { ok: true, ...context, workflow });
        return 0;
      }
      case "runs": {
        const runs = await request<RunRecordLike[]>(runtime.apiUrl, "GET", "/api/runs");
        writeJson(stdout, {
          ok: true,
          ...context,
          runs: parsed.active ? runs.filter((run) => ACTIVE_STATUSES.has(run.status)) : runs
        });
        return 0;
      }
      case "get": {
        const detail = await request(runtime.apiUrl, "GET", `/api/runs/${encodeURIComponent(parsed.runId)}`);
        writeJson(stdout, { ok: true, ...context, detail });
        return 0;
      }
      case "plugins": {
        const plugins = await request(runtime.apiUrl, "GET", "/api/plugins");
        writeJson(stdout, { ok: true, ...context, plugins });
        return 0;
      }
      case "plugin-install": {
        const result = await request(runtime.apiUrl, "POST", "/api/plugins/install", { path: parsed.pluginPath });
        writeJson(stdout, { ok: true, ...context, result });
        return 0;
      }
      case "pause":
      case "resume":
      case "cancel": {
        const run = await request(runtime.apiUrl, "POST", `/api/runs/${encodeURIComponent(parsed.runId)}/${parsed.kind}`, {});
        writeJson(stdout, { ok: true, ...context, run });
        return 0;
      }
      case "delete": {
        const result = await request(runtime.apiUrl, "DELETE", `/api/runs/${encodeURIComponent(parsed.runId)}`);
        writeJson(stdout, { ok: true, ...context, result });
        return 0;
      }
      case "watch": {
        const finalRun = await (deps.watchRun ?? watchRun)(runtime.apiUrl, parsed.runId, { stdout, request });
        return exitCodeForRun(finalRun);
      }
      case "run": {
        const input = readJsonInputFile(parsed.inputFile, cwd, deps.readFile);
        const origin = {
          source: "cli",
          ...(parsed.agentName ? { agentName: parsed.agentName } : {}),
          command: `blink ${argv.join(" ")}`,
          cwd,
          pid: deps.pid ?? process.pid,
          cliVersion: CLI_VERSION
        };
        const run = await request<RunRecordLike>(runtime.apiUrl, "POST", "/api/runs", {
          workflowId: parsed.workflowId,
          ...(parsed.name ? { name: parsed.name } : {}),
          input,
          origin
        });
        if (!parsed.wait) {
          writeJson(stdout, { ok: true, ...context, run });
          return 0;
        }
        writeJson(stdout, { type: "run.created", ok: true, ...context, run });
        const finalRun = await (deps.watchRun ?? watchRun)(runtime.apiUrl, run.id, { stdout, request });
        return exitCodeForRun(finalRun);
      }
    }
  } catch (error) {
    const exitCode = error instanceof CliUsageError ? error.exitCode : 1;
    writeJson(stderr, {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        exitCode
      }
    });
    return exitCode;
  }
}

function assertSafeRuntimeForCommand(command: ParsedCommand, runtime: RuntimeDiscovery): void {
  if (!MUTATING_COMMANDS.has(command.kind) || runtime.source !== "default") return;
  const staleHint = runtime.staleRuntimeFile
    ? ` The runtime file at ${runtime.staleRuntimeFile} is stale or invalid.`
    : "";
  throw new CliUsageError(
    `Refusing to run mutating command "${command.kind}" using the default BLINK API ${DEFAULT_API_URL}.${staleHint} ` +
      "Pass --project <project-dir>, pass --api-url <url>, or set BASED_BLINK_API_URL so the target app is explicit."
  );
}

export function parseBlinkArgs(argv: string[]): ParsedCommand {
  const { globals, args } = extractGlobals(argv);
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  if (command === "help" || command === "--help" || command === "-h") return { kind: "help", globals };
  if (command === "status") return requireNoArgs({ kind: "status", globals }, rest);
  if (command === "workflows") return requireNoArgs({ kind: "workflows", globals }, rest);
  if (command === "workflow") return { kind: "workflow", globals, workflowId: requiredOnlyPositional(rest, "workflow id") };
  if (command === "runs") return parseRunsCommand(globals, rest);
  if (command === "run") return parseRunCommand(globals, rest);
  if (command === "get") return { kind: "get", globals, runId: requiredOnlyPositional(rest, "run id") };
  if (command === "watch") return { kind: "watch", globals, runId: requiredOnlyPositional(rest, "run id") };
  if (command === "plugins") return requireNoArgs({ kind: "plugins", globals }, rest);
  if (command === "plugin-install") return { kind: "plugin-install", globals, pluginPath: requiredOnlyPositional(rest, "plugin path") };
  if (command === "pause" || command === "resume" || command === "cancel" || command === "delete") {
    return { kind: command, globals, runId: requiredOnlyPositional(rest, "run id") };
  }

  throw new CliUsageError(`Unknown command: ${command}`);
}

export async function watchRun(apiUrl: string, runId: string, options: WatchRunOptions): Promise<RunRecordLike> {
  let detail = await options.request<RunDetailLike>(apiUrl, "GET", `/api/runs/${encodeURIComponent(runId)}`);
  writeJson(options.stdout, { type: "run.snapshot", run: detail.run, events: detail.events, artifacts: detail.artifacts });
  if (TERMINAL_STATUSES.has(detail.run.status)) return detail.run;

  const response = await fetch(`${apiUrl}/api/events`);
  if (!response.ok) throw new Error(`Event stream failed: ${response.status} ${response.statusText}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Event stream response did not include a readable body.");

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = extractSseMessages(buffer);
      buffer = parsed.remainder;
      for (const message of parsed.messages) {
        const envelope = JSON.parse(message) as RuntimeEnvelope;
        if (envelope.kind === "event" && envelope.event.runId === runId) {
          writeJson(options.stdout, { type: "event", event: envelope.event });
        }
        if (envelope.kind === "artifact-added" && envelope.runId === runId) {
          writeJson(options.stdout, { type: "artifact.added", runId: envelope.runId, artifactId: envelope.artifactId });
        }
        if (envelope.kind === "run-updated" && envelope.runId === runId) {
          detail = await options.request<RunDetailLike>(apiUrl, "GET", `/api/runs/${encodeURIComponent(runId)}`);
          writeJson(options.stdout, { type: "run.updated", run: detail.run });
          if (TERMINAL_STATUSES.has(detail.run.status)) return detail.run;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  throw new Error("Event stream closed before the run reached a terminal status.");
}

type RuntimeEnvelope =
  | { kind: "event"; event: { runId: string; [key: string]: unknown } }
  | { kind: "run-updated"; runId: string }
  | { kind: "artifact-added"; runId: string; artifactId: string }
  | { kind: "system"; message: string; data?: unknown };

export function extractSseMessages(buffer: string): { messages: string[]; remainder: string } {
  const messages: string[] = [];
  let remainder = buffer;
  while (true) {
    const boundary = remainder.indexOf("\n\n");
    if (boundary < 0) return { messages, remainder };
    const block = remainder.slice(0, boundary);
    remainder = remainder.slice(boundary + 2);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) messages.push(data);
  }
}

async function apiRequest<T>(apiUrl: string, method: HttpMethod, apiPath: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${apiPath}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = parsed && typeof parsed === "object" && "error" in parsed ? String(parsed.error) : response.statusText;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return parsed as T;
}

function parseRunCommand(globals: ParsedGlobals, args: string[]): ParsedCommand {
  const workflowId = requiredPositional(args, "workflow id");
  const options = parseOptions(args.slice(1), new Set(["input", "name", "agent"]), new Set(["wait"]));
  const inputFile = options.values.input;
  if (!inputFile) throw new CliUsageError("blink run requires --input <json-file>.");
  return {
    kind: "run",
    globals,
    workflowId,
    inputFile,
    ...(options.values.name ? { name: options.values.name } : {}),
    ...(options.values.agent ? { agentName: options.values.agent } : {}),
    wait: options.flags.has("wait")
  };
}

function parseRunsCommand(globals: ParsedGlobals, args: string[]): ParsedCommand {
  const options = parseOptions(args, new Set(), new Set(["active"]));
  return { kind: "runs", globals, active: options.flags.has("active") };
}

function parseOptions(
  args: string[],
  valueOptions: Set<string>,
  flagOptions: Set<string>
): { values: Record<string, string>; flags: Set<string> } {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new CliUsageError(`Unexpected positional argument: ${arg}`);
    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    if (flagOptions.has(rawName)) {
      if (inlineValue !== undefined) throw new CliUsageError(`--${rawName} does not accept a value.`);
      flags.add(rawName);
      continue;
    }
    if (!valueOptions.has(rawName)) throw new CliUsageError(`Unknown option: --${rawName}`);
    const value = inlineValue ?? args[++index];
    if (!value) throw new CliUsageError(`--${rawName} requires a value.`);
    values[rawName] = value;
  }
  return { values, flags };
}

function extractGlobals(argv: string[]): { globals: ParsedGlobals; args: string[] } {
  const globals: ParsedGlobals = {};
  const args: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-url" || arg === "--project") {
      const value = argv[++index];
      if (!value) throw new CliUsageError(`${arg} requires a value.`);
      if (arg === "--api-url") globals.apiUrl = value;
      if (arg === "--project") globals.projectPath = value;
      continue;
    }
    if (arg.startsWith("--api-url=")) {
      globals.apiUrl = arg.slice("--api-url=".length);
      continue;
    }
    if (arg.startsWith("--project=")) {
      globals.projectPath = arg.slice("--project=".length);
      continue;
    }
    args.push(arg);
  }
  return { globals, args };
}

function requiredPositional(args: string[], label: string): string {
  const value = args[0];
  if (!value || value.startsWith("--")) throw new CliUsageError(`Missing ${label}.`);
  return value;
}

function requiredOnlyPositional(args: string[], label: string): string {
  const value = requiredPositional(args, label);
  if (args.slice(1).some((arg) => !arg.startsWith("--"))) {
    throw new CliUsageError(`Unexpected extra argument for ${label}.`);
  }
  if (args.length > 1) throw new CliUsageError(`Unexpected option for ${label}: ${args[1]}`);
  return value;
}

function requireNoArgs<T extends ParsedCommand>(command: T, args: string[]): T {
  if (args.length > 0) throw new CliUsageError(`Unexpected argument: ${args[0]}`);
  return command;
}

function readJsonInputFile(filePath: string, cwd: string, readFile?: (filePath: string) => string): unknown {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const raw = (readFile ?? ((target: string) => fs.readFileSync(target, "utf8")))(resolved);
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Could not parse input JSON ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(write: (line: string) => void, value: unknown): void {
  write(`${JSON.stringify(value)}\n`);
}

function exitCodeForRun(run: RunRecordLike): number {
  return run.status === "completed" ? 0 : 1;
}

function commandList(): string[] {
  return [
    "blink status",
    "blink workflows",
    "blink workflow <workflowId>",
    "blink --project <project-dir> run <workflowId> --input <json-file> [--name <name>] [--agent <name>] [--wait]",
    "blink runs [--active]",
    "blink get <runId>",
    "blink watch <runId>",
    "blink --project <project-dir> pause|resume|cancel|delete <runId>",
    "blink plugins",
    "blink --project <project-dir> plugin-install <path>"
  ];
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export { DEFAULT_API_URL };
