import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inferMimeType } from "../utils/files";

export type ExtensionTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ExtensionClientStatus {
  id: string;
  url: string;
  title: string;
  status: string;
  lastSeenAt: string;
}

export interface ChatGptExtensionTaskInput {
  runId: string;
  prompt: string;
  imagePath: string;
  selectors?: Record<string, unknown>;
}

export interface ExtensionTaskPayload {
  id: string;
  kind: "chatgpt-image-transform";
  runId: string;
  prompt: string;
  image: {
    index: number;
    name: string;
    mimeType: string;
    url: string;
  };
  selectors: Record<string, unknown>;
  createdAt: string;
}

export interface ExtensionTaskResult {
  outputs: Array<{
    name?: string;
    mimeType?: string;
    base64: string;
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
  prompt: string;
  imagePath: string;
  selectors: Record<string, unknown>;
  status: ExtensionTaskStatus;
  result?: ExtensionTaskResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
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

  createChatGptImageTask(input: ChatGptExtensionTaskInput): ExtensionTaskPayload {
    const now = new Date().toISOString();
    const task: ExtensionTask = {
      id: randomUUID(),
      kind: "chatgpt-image-transform",
      runId: input.runId,
      prompt: input.prompt,
      imagePath: input.imagePath,
      selectors: input.selectors ?? {},
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    this.emitTaskEvent(task.id, "task.created", "Queued task for ChatGPT extension");
    return this.toPayload(task);
  }

  nextTask(): ExtensionTaskPayload | null {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.status === "running" && now - Date.parse(task.updatedAt) > 120_000) {
        task.status = "pending";
        task.updatedAt = new Date().toISOString();
        this.emitTaskEvent(task.id, "task.requeued", "Extension task lease expired; requeued");
      }
      if (task.status === "pending") {
        task.status = "running";
        task.updatedAt = new Date().toISOString();
        this.emitTaskEvent(task.id, "task.started", "Extension picked up task");
        return this.toPayload(task);
      }
    }
    return null;
  }

  getTaskImagePath(taskId: string, imageIndex: number): string {
    const task = this.getTask(taskId);
    if (imageIndex !== 0) throw new Error(`Image index not found: ${imageIndex}`);
    return task.imagePath;
  }

  heartbeat(input: { id?: string; url?: string; title?: string; status?: string }): ExtensionClientStatus {
    const id = input.id?.trim() || "chatgpt-tab";
    const client: ExtensionClientStatus = {
      id,
      url: input.url ?? "",
      title: input.title ?? "",
      status: input.status ?? "ready",
      lastSeenAt: new Date().toISOString()
    };
    this.clients.set(id, client);
    return client;
  }

  listClients(): ExtensionClientStatus[] {
    return [...this.clients.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  status(): { connectedClients: ExtensionClientStatus[]; pending: number; running: number } {
    const counts = [...this.tasks.values()].reduce(
      (acc, task) => {
        if (task.status === "pending") acc.pending += 1;
        if (task.status === "running") acc.running += 1;
        return acc;
      },
      { pending: 0, running: 0 }
    );
    return { connectedClients: this.listClients(), ...counts };
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
      runId: task.runId,
      prompt: task.prompt,
      image: {
        index: 0,
        name: path.basename(task.imagePath),
        mimeType: inferMimeType(task.imagePath) ?? "application/octet-stream",
        url: `/api/extension/tasks/${task.id}/images/0`
      },
      selectors: task.selectors,
      createdAt: task.createdAt
    };
  }
}

export const extensionBridge = new ExtensionBridge();
