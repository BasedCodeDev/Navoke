import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inferMimeType } from "../utils/files";

export type ExtensionTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type ExtensionImageGroup = "reference" | "subject";

export const CHATGPT_EXTENSION_PROTOCOL_VERSION = 9;
const CLIENT_TTL_MS = 30_000;
const LAB_COMMAND_LEASE_MS = 60_000;
const FOCUS_COMMAND_LEASE_MS = 15_000;

export type ChatGptExtensionTaskTarget =
  | { mode: "any" }
  | { mode: "existing"; clientId: string; url?: string; title?: string }
  | { mode: "new"; routingToken: string; url?: string; title?: string };

export interface ExtensionClientStatus {
  id: string;
  url: string;
  title: string;
  status: string;
  protocolVersion: number | null;
  extensionVersion: string;
  routingToken?: string;
  compatible: boolean;
  incompatibilityReason?: string;
  lastSeenAt: string;
}

export type ChatGptExtensionTaskPhase = "setup" | "subject";
export type ChatGptSubjectTaskMode = "submit-and-capture" | "capture-existing";

export interface ChatGptExtensionTaskInput {
  runId: string;
  phase: ChatGptExtensionTaskPhase;
  subjectMode?: ChatGptSubjectTaskMode;
  masterPrompt?: string;
  referenceImagePaths?: string[];
  subjectImagePath?: string;
  subjectIndex?: number;
  subjectInstruction?: string;
  subjectBaseline?: unknown;
  selectors?: Record<string, unknown>;
  target?: ChatGptExtensionTaskTarget;
}

export interface ExtensionTaskImagePayload {
  index: number;
  name: string;
  mimeType: string;
  url: string;
}

export interface ExtensionTaskPayload {
  id: string;
  kind: "chatgpt-image-transform";
  phase: ChatGptExtensionTaskPhase;
  protocolVersion: number;
  runId: string;
  masterPrompt?: string;
  referenceImages?: ExtensionTaskImagePayload[];
  subjectMode?: ChatGptSubjectTaskMode;
  subjectImage?: ExtensionTaskImagePayload;
  subjectInstruction: string;
  subjectBaseline?: unknown;
  selectors: Record<string, unknown>;
  createdAt: string;
}

export interface ExtensionTaskOutput {
  subjectIndex: number;
  subjectName?: string;
  name?: string;
  mimeType?: string;
  base64: string;
  metadata?: unknown;
}

export interface ExtensionTaskResult {
  outputs: ExtensionTaskOutput[];
  metadata?: unknown;
}

export interface ExtensionTaskEvent {
  taskId: string;
  type: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

export type ExtensionLabCommandInput =
  | { kind: "inspect" }
  | { kind: "action"; action: unknown }
  | { kind: "wait"; condition: unknown };

export interface ExtensionLabCommandPayload {
  id: string;
  kind: "workflow-lab";
  protocolVersion: number;
  command: ExtensionLabCommandInput;
  createdAt: string;
}

export interface ExtensionFocusCommandPayload {
  id: string;
  kind: "focus-tab";
  protocolVersion: number;
  createdAt: string;
}

export interface ExtensionTaskControlPayload {
  id: string;
  kind: "task-control";
  protocolVersion: number;
  status: ExtensionTaskStatus;
  pauseRequested: boolean;
  cancelled: boolean;
  updatedAt: string;
}

interface ExtensionTask {
  id: string;
  kind: "chatgpt-image-transform";
  phase: ChatGptExtensionTaskPhase;
  runId: string;
  subjectMode: ChatGptSubjectTaskMode;
  masterPrompt?: string;
  referenceImagePaths: string[];
  subjectImagePath?: string;
  subjectIndex?: number;
  subjectInstruction: string;
  subjectBaseline?: unknown;
  selectors: Record<string, unknown>;
  target: ExtensionTaskTargetState;
  status: ExtensionTaskStatus;
  leasedClientId?: string;
  pauseRequested: boolean;
  outputs: ExtensionTaskOutput[];
  result?: ExtensionTaskResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ExtensionTaskTargetState {
  mode: "any" | "existing" | "new";
  clientId?: string;
  routingToken?: string;
  url?: string;
}

interface Waiter {
  resolve(result: ExtensionTaskResult): void;
  reject(error: Error): void;
}

type ExtensionLabCommandStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type ExtensionFocusCommandStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface ExtensionLabCommand {
  id: string;
  clientId: string;
  command: ExtensionLabCommandInput;
  status: ExtensionLabCommandStatus;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface LabWaiter {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

interface ExtensionFocusCommand {
  id: string;
  clientId: string;
  status: ExtensionFocusCommandStatus;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface FocusWaiter {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

export class ExtensionBridge {
  private readonly tasks = new Map<string, ExtensionTask>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly labCommands = new Map<string, ExtensionLabCommand>();
  private readonly labWaiters = new Map<string, LabWaiter>();
  private readonly focusCommands = new Map<string, ExtensionFocusCommand>();
  private readonly focusWaiters = new Map<string, FocusWaiter>();
  private readonly clients = new Map<string, ExtensionClientStatus>();
  private readonly events = new EventEmitter();

  createChatGptConversationTask(input: ChatGptExtensionTaskInput): ExtensionTaskPayload {
    const now = new Date().toISOString();
    const task: ExtensionTask = {
      id: randomUUID(),
      kind: "chatgpt-image-transform",
      phase: input.phase,
      runId: input.runId,
      subjectMode: input.subjectMode ?? "submit-and-capture",
      masterPrompt: input.masterPrompt,
      referenceImagePaths: input.referenceImagePaths ?? [],
      subjectImagePath: input.subjectImagePath,
      subjectIndex: input.subjectIndex,
      subjectInstruction: input.subjectInstruction?.trim() ?? "",
      subjectBaseline: input.subjectBaseline,
      selectors: input.selectors ?? {},
      target: normalizeTaskTarget(input.target),
      status: "pending",
      pauseRequested: false,
      outputs: [],
      createdAt: now,
      updatedAt: now
    };
    validateTaskShape(task);
    this.tasks.set(task.id, task);
    this.emitTaskEvent(task.id, "task.created", describeTaskTarget(task));
    return this.toPayload(task);
  }

  nextTask(clientId: string): ExtensionTaskPayload | null {
    const client = this.assertCompatibleClient(clientId);
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.status === "running" && now - Date.parse(task.updatedAt) > 120_000) {
        task.status = "pending";
        task.leasedClientId = undefined;
        task.updatedAt = new Date().toISOString();
        this.emitTaskEvent(task.id, "task.requeued", "Extension task lease expired; requeued");
      }
      if (task.status === "pending" && this.matchesTaskTarget(task, client)) {
        if (task.target.mode === "new" && !task.target.clientId) {
          task.target.clientId = client.id;
        }
        task.status = "running";
        task.leasedClientId = client.id;
        task.updatedAt = new Date().toISOString();
        this.emitTaskEvent(task.id, "task.started", "Extension picked up task", {
          clientId,
          targetMode: task.target.mode,
          phase: task.phase
        });
        return this.toPayload(task);
      }
    }
    return null;
  }

  executeLabCommand(input: {
    clientId: string;
    command: ExtensionLabCommandInput;
    timeoutMs: number;
  }): Promise<unknown> {
    const client = this.assertCompatibleClient(input.clientId);
    const now = new Date().toISOString();
    const command: ExtensionLabCommand = {
      id: randomUUID(),
      clientId: client.id,
      command: input.command,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.labCommands.set(command.id, command);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const current = this.labCommands.get(command.id);
        if (current && ["pending", "running"].includes(current.status)) {
          current.status = "cancelled";
          current.updatedAt = new Date().toISOString();
        }
        this.labWaiters.delete(command.id);
        reject(new Error("Timed out waiting for the Chrome extension Workflow Lab command."));
      }, input.timeoutMs);

      this.labWaiters.set(command.id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  nextLabCommand(clientId: string): ExtensionLabCommandPayload | null {
    const client = this.assertCompatibleClient(clientId);
    const now = Date.now();
    for (const command of this.labCommands.values()) {
      if (command.status === "running" && now - Date.parse(command.updatedAt) > LAB_COMMAND_LEASE_MS) {
        command.status = "pending";
        command.updatedAt = new Date().toISOString();
      }
      if (command.status === "pending" && command.clientId === client.id) {
        command.status = "running";
        command.updatedAt = new Date().toISOString();
        return {
          id: command.id,
          kind: "workflow-lab",
          protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
          command: command.command,
          createdAt: command.createdAt
        };
      }
    }
    return null;
  }

  completeLabCommand(commandId: string, result: unknown): void {
    const command = this.getLabCommand(commandId);
    command.status = "completed";
    command.result = result;
    command.updatedAt = new Date().toISOString();
    this.labWaiters.get(commandId)?.resolve(result);
    this.labWaiters.delete(commandId);
  }

  failLabCommand(commandId: string, message: string): void {
    const command = this.getLabCommand(commandId);
    command.status = "failed";
    command.error = message;
    command.updatedAt = new Date().toISOString();
    this.labWaiters.get(commandId)?.reject(new Error(message));
    this.labWaiters.delete(commandId);
  }

  focusClient(clientId: string, options: { timeoutMs?: number } = {}): Promise<unknown> {
    const client = this.assertCompatibleClient(clientId);
    const now = new Date().toISOString();
    const command: ExtensionFocusCommand = {
      id: randomUUID(),
      clientId: client.id,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.focusCommands.set(command.id, command);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const current = this.focusCommands.get(command.id);
        if (current && ["pending", "running"].includes(current.status)) {
          current.status = "cancelled";
          current.updatedAt = new Date().toISOString();
        }
        this.focusWaiters.delete(command.id);
        reject(new Error("Timed out waiting for the Chrome extension to focus the selected tab."));
      }, options.timeoutMs ?? 10_000);

      this.focusWaiters.set(command.id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  nextFocusCommand(clientId: string): ExtensionFocusCommandPayload | null {
    const client = this.assertCompatibleClient(clientId);
    const now = Date.now();
    for (const command of this.focusCommands.values()) {
      if (command.status === "running" && now - Date.parse(command.updatedAt) > FOCUS_COMMAND_LEASE_MS) {
        command.status = "pending";
        command.updatedAt = new Date().toISOString();
      }
      if (command.status === "pending" && command.clientId === client.id) {
        command.status = "running";
        command.updatedAt = new Date().toISOString();
        return {
          id: command.id,
          kind: "focus-tab",
          protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
          createdAt: command.createdAt
        };
      }
    }
    return null;
  }

  completeFocusCommand(commandId: string, result: unknown): void {
    const command = this.getFocusCommand(commandId);
    command.status = "completed";
    command.result = result;
    command.updatedAt = new Date().toISOString();
    this.focusWaiters.get(commandId)?.resolve(result);
    this.focusWaiters.delete(commandId);
  }

  failFocusCommand(commandId: string, message: string): void {
    const command = this.getFocusCommand(commandId);
    command.status = "failed";
    command.error = message;
    command.updatedAt = new Date().toISOString();
    this.focusWaiters.get(commandId)?.reject(new Error(message));
    this.focusWaiters.delete(commandId);
  }

  requestTaskPause(taskId: string): void {
    const task = this.getTask(taskId);
    if (["completed", "failed", "cancelled"].includes(task.status)) return;
    if (!task.pauseRequested) {
      task.pauseRequested = true;
      this.emitTaskEvent(task.id, "task.pause_requested", "Pause requested for active extension task", {
        phase: task.phase,
        subjectIndex: task.subjectIndex
      });
    }
    task.updatedAt = new Date().toISOString();
  }

  taskControl(taskId: string, clientId: string): ExtensionTaskControlPayload {
    const task = this.getTask(taskId);
    const client = this.assertCompatibleClient(clientId);
    if (task.leasedClientId && task.leasedClientId !== client.id) {
      throw new Error(`Extension task ${taskId} is leased to a different ChatGPT tab.`);
    }
    if (task.status === "running") {
      task.updatedAt = new Date().toISOString();
    }
    return {
      id: task.id,
      kind: "task-control",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      status: task.status,
      pauseRequested: task.pauseRequested,
      cancelled: task.status === "cancelled",
      updatedAt: task.updatedAt
    };
  }

  getTaskImagePath(taskId: string, group: ExtensionImageGroup, imageIndex: number): string {
    const task = this.getTask(taskId);
    const imagePath =
      group === "reference"
        ? task.referenceImagePaths[imageIndex]
        : task.subjectImagePath && imageIndex === task.subjectIndex
          ? task.subjectImagePath
          : undefined;
    if (!imagePath) throw new Error(`Image not found: ${group}/${imageIndex}`);
    return imagePath;
  }

  heartbeat(input: {
    id?: string;
    url?: string;
    title?: string;
    status?: string;
    protocolVersion?: unknown;
    extensionVersion?: unknown;
    routingToken?: unknown;
  }): ExtensionClientStatus {
    const id = input.id?.trim() || "chatgpt-tab";
    const protocolVersion = parseProtocolVersion(input.protocolVersion);
    const compatible = protocolVersion === CHATGPT_EXTENSION_PROTOCOL_VERSION;
    const routingToken = normalizeRoutingToken(input.routingToken);
    const client: ExtensionClientStatus = {
      id,
      url: input.url ?? "",
      title: input.title ?? "",
      status: input.status ?? "ready",
      protocolVersion,
      extensionVersion: typeof input.extensionVersion === "string" ? input.extensionVersion : "unknown",
      ...(routingToken ? { routingToken } : {}),
      compatible,
      incompatibilityReason: compatible
        ? undefined
        : `Reload the unpacked Chrome extension and refresh ChatGPT tabs. App requires extension protocol ${CHATGPT_EXTENSION_PROTOCOL_VERSION}.`,
      lastSeenAt: new Date().toISOString()
    };
    this.clients.set(id, client);
    return client;
  }

  listClients(): ExtensionClientStatus[] {
    this.pruneStaleClients();
    return [...this.clients.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  status(): {
    connectedClients: ExtensionClientStatus[];
    pending: number;
    running: number;
    labPending: number;
    labRunning: number;
    focusPending: number;
    focusRunning: number;
    requiredProtocolVersion: number;
  } {
    const counts = [...this.tasks.values()].reduce(
      (acc, task) => {
        if (task.status === "pending") acc.pending += 1;
        if (task.status === "running") acc.running += 1;
        return acc;
      },
      { pending: 0, running: 0 }
    );
    const labCounts = [...this.labCommands.values()].reduce(
      (acc, command) => {
        if (command.status === "pending") acc.labPending += 1;
        if (command.status === "running") acc.labRunning += 1;
        return acc;
      },
      { labPending: 0, labRunning: 0 }
    );
    const focusCounts = [...this.focusCommands.values()].reduce(
      (acc, command) => {
        if (command.status === "pending") acc.focusPending += 1;
        if (command.status === "running") acc.focusRunning += 1;
        return acc;
      },
      { focusPending: 0, focusRunning: 0 }
    );
    return {
      connectedClients: this.listClients(),
      requiredProtocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      ...counts,
      ...labCounts,
      ...focusCounts
    };
  }

  findCompatibleClientForTarget(target: ChatGptExtensionTaskTarget): ExtensionClientStatus | undefined {
    const normalizedTarget = normalizeTaskTarget(target);
    this.pruneStaleClients();
    const compatibleClients = [...this.clients.values()].filter((client) => client.compatible);
    if (normalizedTarget.mode === "existing" && normalizedTarget.clientId) {
      const exactClient = compatibleClients.find(
        (client) => client.id === normalizedTarget.clientId && this.matchesTarget(normalizedTarget, client)
      );
      if (exactClient) return exactClient;
    }
    return compatibleClients.find((client) => this.matchesTarget(normalizedTarget, client));
  }

  completeTask(taskId: string, result: ExtensionTaskResult): void {
    const task = this.getTask(taskId);
    if (task.status === "cancelled") return;
    task.status = "completed";
    task.result = {
      ...result,
      outputs: mergeTaskOutputs(task.outputs, result.outputs)
    };
    task.updatedAt = new Date().toISOString();
    this.emitTaskEvent(task.id, "task.completed", "Extension completed task", result.metadata);
    this.waiters.get(taskId)?.resolve(task.result);
    this.waiters.delete(taskId);
  }

  addTaskOutput(taskId: string, output: ExtensionTaskOutput): void {
    const task = this.getTask(taskId);
    if (task.status === "cancelled") return;
    task.outputs = mergeTaskOutputs(task.outputs, [output]);
    task.updatedAt = new Date().toISOString();
    this.emitTaskEvent(taskId, "task.output", `Extension streamed output for subject ${output.subjectIndex + 1}`, {
      subjectIndex: output.subjectIndex,
      subjectName: output.subjectName,
      name: output.name,
      mimeType: output.mimeType,
      metadata: output.metadata
    });
    this.events.emit(`task-output:${taskId}`, output);
  }

  failTask(taskId: string, message: string, data?: unknown): void {
    const task = this.getTask(taskId);
    if (task.status === "cancelled") return;
    task.status = "failed";
    task.error = message;
    task.updatedAt = new Date().toISOString();
    this.emitTaskEvent(task.id, "task.failed", message, data);
    this.waiters.get(taskId)?.reject(new Error(message));
    this.waiters.delete(taskId);
  }

  cancelTask(taskId: string): void {
    const task = this.getTask(taskId);
    task.status = "cancelled";
    task.updatedAt = new Date().toISOString();
    this.emitTaskEvent(task.id, "task.cancelled", "Task cancelled");
    this.waiters.get(taskId)?.reject(new Error("Task cancelled"));
    this.waiters.delete(taskId);
  }

  addTaskEvent(taskId: string, type: string, message: string, data?: unknown): void {
    const task = this.getTask(taskId);
    if (task.status === "cancelled") return;
    task.updatedAt = new Date().toISOString();
    this.emitTaskEvent(taskId, type, message, data);
  }

  waitForTask(taskId: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<ExtensionTaskResult> {
    const task = this.getTask(taskId);
    if (task.status === "completed" && task.result) return Promise.resolve(task.result);
    if (task.status === "failed") return Promise.reject(new Error(task.error ?? "Extension task failed"));
    if (task.status === "cancelled") return Promise.reject(new Error("Task cancelled"));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cancelTask(taskId);
        reject(new Error("Timed out waiting for the Chrome extension to complete the task."));
      }, options.timeoutMs);

      const onAbort = () => {
        clearTimeout(timeout);
        this.cancelTask(taskId);
        reject(new Error("Operation cancelled"));
      };

      this.waiters.set(taskId, {
        resolve: (result) => {
          clearTimeout(timeout);
          options.signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          options.signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      });
      options.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  subscribeTask(taskId: string, listener: (event: ExtensionTaskEvent) => void): () => void {
    const eventName = `task:${taskId}`;
    this.events.on(eventName, listener);
    return () => this.events.off(eventName, listener);
  }

  subscribeTaskOutput(taskId: string, listener: (output: ExtensionTaskOutput) => void): () => void {
    const eventName = `task-output:${taskId}`;
    this.events.on(eventName, listener);
    return () => this.events.off(eventName, listener);
  }

  private getTask(taskId: string): ExtensionTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Extension task not found: ${taskId}`);
    return task;
  }

  private getLabCommand(commandId: string): ExtensionLabCommand {
    const command = this.labCommands.get(commandId);
    if (!command) throw new Error(`Extension Workflow Lab command not found: ${commandId}`);
    return command;
  }

  private getFocusCommand(commandId: string): ExtensionFocusCommand {
    const command = this.focusCommands.get(commandId);
    if (!command) throw new Error(`Extension focus command not found: ${commandId}`);
    return command;
  }

  private assertCompatibleClient(clientId: string): ExtensionClientStatus {
    this.pruneStaleClients();
    const normalizedClientId = clientId.trim();
    if (!normalizedClientId) {
      throw new Error(
        `ChatGPT extension task polling requires a client id. Reload the unpacked Chrome extension and refresh ChatGPT tabs. App requires extension protocol ${CHATGPT_EXTENSION_PROTOCOL_VERSION}.`
      );
    }

    const client = this.clients.get(normalizedClientId);
    if (!client) {
      throw new Error(
        `ChatGPT extension client ${normalizedClientId} has not checked in. Reload the unpacked Chrome extension and refresh ChatGPT tabs.`
      );
    }

    if (!client.compatible) {
      throw new Error(
        client.incompatibilityReason ??
          `Reload the unpacked Chrome extension and refresh ChatGPT tabs. App requires extension protocol ${CHATGPT_EXTENSION_PROTOCOL_VERSION}.`
      );
    }

    return client;
  }

  private matchesTaskTarget(task: ExtensionTask, client: ExtensionClientStatus): boolean {
    return this.matchesTarget(task.target, client);
  }

  private matchesTarget(target: ExtensionTaskTargetState, client: ExtensionClientStatus): boolean {
    if (target.mode === "any") return true;
    if (target.mode === "existing") return target.clientId === client.id || sameUrl(target.url, client.url);
    if (target.clientId) return target.clientId === client.id;
    return Boolean((target.routingToken && client.routingToken === target.routingToken) || sameUrl(target.url, client.url));
  }

  private pruneStaleClients(now = Date.now()): void {
    for (const [id, client] of this.clients) {
      if (now - Date.parse(client.lastSeenAt) > CLIENT_TTL_MS) {
        this.clients.delete(id);
      }
    }
  }

  private emitTaskEvent(taskId: string, type: string, message: string, data?: unknown): void {
    const event: ExtensionTaskEvent = {
      taskId,
      type,
      message,
      data,
      createdAt: new Date().toISOString()
    };
    this.events.emit(`task:${taskId}`, event);
  }

  private toPayload(task: ExtensionTask): ExtensionTaskPayload {
    return {
      id: task.id,
      kind: task.kind,
      phase: task.phase,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      runId: task.runId,
      ...(task.masterPrompt ? { masterPrompt: task.masterPrompt } : {}),
      ...(task.referenceImagePaths.length > 0
        ? {
            referenceImages: task.referenceImagePaths.map((imagePath, index) =>
              this.toImagePayload(task.id, "reference", imagePath, index)
            )
          }
        : {}),
      ...(task.subjectImagePath !== undefined && task.subjectIndex !== undefined
        ? {
            subjectMode: task.subjectMode,
            subjectImage: this.toImagePayload(task.id, "subject", task.subjectImagePath, task.subjectIndex)
          }
        : {}),
      subjectInstruction: task.subjectInstruction,
      ...(task.subjectBaseline !== undefined ? { subjectBaseline: task.subjectBaseline } : {}),
      selectors: task.selectors,
      createdAt: task.createdAt
    };
  }

  private toImagePayload(
    taskId: string,
    group: ExtensionImageGroup,
    imagePath: string,
    index: number
  ): ExtensionTaskImagePayload {
    return {
      index,
      name: path.basename(imagePath),
      mimeType: inferMimeType(imagePath) ?? "application/octet-stream",
      url: `/api/extension/tasks/${taskId}/images/${group}/${index}`
    };
  }
}

export const extensionBridge = new ExtensionBridge();

function parseProtocolVersion(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRoutingToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTaskTarget(target?: ChatGptExtensionTaskTarget): ExtensionTaskTargetState {
  if (!target || target.mode === "any") return { mode: "any" };
  if (target.mode === "existing") {
    const clientId = target.clientId.trim();
    if (!clientId) throw new Error("ChatGPT extension target client id is required.");
    return { mode: "existing", clientId, url: normalizeComparableUrl(target.url) };
  }

  const routingToken = normalizeRoutingToken(target.routingToken);
  if (!routingToken) throw new Error("ChatGPT extension new-tab routing token is required.");
  return { mode: "new", routingToken, url: normalizeComparableUrl(target.url) };
}

function describeTaskTarget(task: ExtensionTask): string {
  const phase = task.phase === "setup" ? "setup" : `subject ${Number(task.subjectIndex ?? 0) + 1}`;
  const target = task.target;
  if (target.mode === "existing") return "Queued task for selected ChatGPT tab";
  if (target.mode === "new") return `Queued ${phase} task for new ChatGPT tab`;
  return `Queued ${phase} task for ChatGPT extension`;
}

function mergeTaskOutputs(existing: ExtensionTaskOutput[], incoming: ExtensionTaskOutput[] = []): ExtensionTaskOutput[] {
  const merged = new Map<string, ExtensionTaskOutput>();
  for (const output of [...existing, ...incoming]) {
    merged.set(outputKey(output), output);
  }
  return [...merged.values()];
}

function outputKey(output: ExtensionTaskOutput): string {
  return `${output.subjectIndex}:${output.mimeType ?? "image/png"}:${output.base64}`;
}

function validateTaskShape(task: ExtensionTask): void {
  if (task.phase === "setup") {
    if (!task.masterPrompt?.trim()) throw new Error("ChatGPT setup task requires masterPrompt.");
    return;
  }

  if (task.subjectMode !== "submit-and-capture" && task.subjectMode !== "capture-existing") {
    throw new Error("ChatGPT subject task mode is invalid.");
  }
  if (!Number.isInteger(task.subjectIndex) || (task.subjectIndex ?? -1) < 0) {
    throw new Error("ChatGPT subject task requires subjectIndex.");
  }
  if (!task.subjectImagePath) throw new Error("ChatGPT subject task requires subjectImagePath.");
}

function normalizeComparableUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    removeRoutingToken(url);
    return url.toString();
  } catch {
    return trimmed;
  }
}

function sameUrl(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function removeRoutingToken(url: URL): void {
  const search = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  if (search.has("based-blink-tab")) {
    search.delete("based-blink-tab");
    url.search = search.toString();
  }
  if (hash.has("based-blink-tab")) {
    hash.delete("based-blink-tab");
    url.hash = hash.toString();
  }
}
