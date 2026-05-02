import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inferMimeType } from "../utils/files";

export type ExtensionTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type ExtensionImageGroup = "reference" | "subject";

export const CHATGPT_EXTENSION_PROTOCOL_VERSION = 3;
const CLIENT_TTL_MS = 30_000;

export type ChatGptExtensionTaskTarget =
  | { mode: "any" }
  | { mode: "existing"; clientId: string }
  | { mode: "new"; routingToken: string };

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

export interface ChatGptExtensionTaskInput {
  runId: string;
  masterPrompt: string;
  referenceImagePaths: string[];
  subjectImagePaths: string[];
  subjectInstruction?: string;
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
  protocolVersion: number;
  runId: string;
  masterPrompt: string;
  referenceImages: ExtensionTaskImagePayload[];
  subjectImages: ExtensionTaskImagePayload[];
  subjectInstruction: string;
  selectors: Record<string, unknown>;
  createdAt: string;
}

export interface ExtensionTaskResult {
  outputs: Array<{
    subjectIndex: number;
    subjectName?: string;
    name?: string;
    mimeType?: string;
    base64: string;
    metadata?: unknown;
  }>;
  metadata?: unknown;
}

export interface ExtensionTaskEvent {
  taskId: string;
  type: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

interface ExtensionTask {
  id: string;
  kind: "chatgpt-image-transform";
  runId: string;
  masterPrompt: string;
  referenceImagePaths: string[];
  subjectImagePaths: string[];
  subjectInstruction: string;
  selectors: Record<string, unknown>;
  target: ExtensionTaskTargetState;
  status: ExtensionTaskStatus;
  result?: ExtensionTaskResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ExtensionTaskTargetState {
  mode: "any" | "existing" | "new";
  clientId?: string;
  routingToken?: string;
}

interface Waiter {
  resolve(result: ExtensionTaskResult): void;
  reject(error: Error): void;
}

export class ExtensionBridge {
  private readonly tasks = new Map<string, ExtensionTask>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly clients = new Map<string, ExtensionClientStatus>();
  private readonly events = new EventEmitter();

  createChatGptConversationTask(input: ChatGptExtensionTaskInput): ExtensionTaskPayload {
    const now = new Date().toISOString();
    const task: ExtensionTask = {
      id: randomUUID(),
      kind: "chatgpt-image-transform",
      runId: input.runId,
      masterPrompt: input.masterPrompt,
      referenceImagePaths: input.referenceImagePaths,
      subjectImagePaths: input.subjectImagePaths,
      subjectInstruction: input.subjectInstruction?.trim() ?? "",
      selectors: input.selectors ?? {},
      target: normalizeTaskTarget(input.target),
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    this.emitTaskEvent(task.id, "task.created", describeTaskTarget(task.target));
    return this.toPayload(task);
  }

  nextTask(clientId: string): ExtensionTaskPayload | null {
    const client = this.assertCompatibleClient(clientId);
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.status === "running" && now - Date.parse(task.updatedAt) > 120_000) {
        task.status = "pending";
        task.updatedAt = new Date().toISOString();
        this.emitTaskEvent(task.id, "task.requeued", "Extension task lease expired; requeued");
      }
      if (task.status === "pending" && this.matchesTaskTarget(task, client)) {
        if (task.target.mode === "new" && !task.target.clientId) {
          task.target.clientId = client.id;
        }
        task.status = "running";
        task.updatedAt = new Date().toISOString();
        this.emitTaskEvent(task.id, "task.started", "Extension picked up task", {
          clientId,
          targetMode: task.target.mode
        });
        return this.toPayload(task);
      }
    }
    return null;
  }

  getTaskImagePath(taskId: string, group: ExtensionImageGroup, imageIndex: number): string {
    const task = this.getTask(taskId);
    const paths = group === "reference" ? task.referenceImagePaths : task.subjectImagePaths;
    const imagePath = paths[imageIndex];
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
    return {
      connectedClients: this.listClients(),
      requiredProtocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      ...counts
    };
  }

  findCompatibleClientForTarget(target: ChatGptExtensionTaskTarget): ExtensionClientStatus | undefined {
    const normalizedTarget = normalizeTaskTarget(target);
    this.pruneStaleClients();
    return [...this.clients.values()].find(
      (client) => client.compatible && this.matchesTarget(normalizedTarget, client)
    );
  }

  completeTask(taskId: string, result: ExtensionTaskResult): void {
    const task = this.getTask(taskId);
    task.status = "completed";
    task.result = result;
    task.updatedAt = new Date().toISOString();
    this.emitTaskEvent(task.id, "task.completed", "Extension completed task", result.metadata);
    this.waiters.get(taskId)?.resolve(result);
    this.waiters.delete(taskId);
  }

  failTask(taskId: string, message: string, data?: unknown): void {
    const task = this.getTask(taskId);
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
    this.getTask(taskId).updatedAt = new Date().toISOString();
    this.emitTaskEvent(taskId, type, message, data);
  }

  waitForTask(taskId: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<ExtensionTaskResult> {
    const task = this.getTask(taskId);
    if (task.status === "completed" && task.result) return Promise.resolve(task.result);
    if (task.status === "failed") return Promise.reject(new Error(task.error ?? "Extension task failed"));

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

  private getTask(taskId: string): ExtensionTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Extension task not found: ${taskId}`);
    return task;
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
    if (target.mode === "existing") return target.clientId === client.id;
    if (target.clientId) return target.clientId === client.id;
    return Boolean(target.routingToken && client.routingToken === target.routingToken);
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
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      runId: task.runId,
      masterPrompt: task.masterPrompt,
      referenceImages: task.referenceImagePaths.map((imagePath, index) => this.toImagePayload(task.id, "reference", imagePath, index)),
      subjectImages: task.subjectImagePaths.map((imagePath, index) => this.toImagePayload(task.id, "subject", imagePath, index)),
      subjectInstruction: task.subjectInstruction,
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
    return { mode: "existing", clientId };
  }

  const routingToken = normalizeRoutingToken(target.routingToken);
  if (!routingToken) throw new Error("ChatGPT extension new-tab routing token is required.");
  return { mode: "new", routingToken };
}

function describeTaskTarget(target: ExtensionTaskTargetState): string {
  if (target.mode === "existing") return "Queued task for selected ChatGPT tab";
  if (target.mode === "new") return "Queued task for new ChatGPT tab";
  return "Queued task for ChatGPT extension";
}
