import type * as zod from "zod";

export interface RunRecord {
  workflowId: string;
  status: string;
  input: unknown;
  output: unknown;
}

export interface WorkflowContext {
  runId: string;
  artifactDir: string;
  signal: AbortSignal;
  previousOutput: unknown | null;
  step(message: string, progress?: number, data?: unknown): Promise<void>;
  event(type: string, message: string, data?: unknown): Promise<void>;
  updateOutput(output: unknown): Promise<void>;
  isPauseRequested(): boolean;
  pauseIfRequested(message: string, data?: unknown): Promise<void>;
  waitForManualAction(message: string, data?: unknown): Promise<void>;
  addArtifact(input: {
    kind: "image" | "json";
    name: string;
    path: string;
    mimeType?: string | null;
    metadata?: unknown;
  }): Promise<{ id: string }>;
}

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  manifest: {
    id: string;
    title: string;
    description: string;
    category: "chatgpt";
    version: string;
    concurrency: number;
    requiresBrowser: boolean;
    targetUrl?: string;
    outputKinds: Array<"image" | "json">;
    uiCapabilities?: Array<"chatgpt.tabRouting" | "chatgpt.focusTarget" | "chatgpt.artifactPairs">;
    inputFields: Array<{
      name: string;
      label: string;
      type: "text" | "textarea" | "fileList" | "json" | "number" | "checkbox" | "select";
      required?: boolean;
      help?: string;
    }>;
  };
  inputSchema: zod.ZodType<TInput, zod.ZodTypeDef, unknown>;
  outputSchema: zod.ZodType<TOutput, zod.ZodTypeDef, unknown>;
  canResumeFailedRun?(run: RunRecord): boolean;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}

export type ChatGptExtensionTaskTarget =
  | { mode: "any" }
  | { mode: "existing"; clientId: string; url?: string; title?: string }
  | { mode: "new"; routingToken: string; url?: string; title?: string };

export type ChatGptSubjectTaskMode = "submit-and-capture" | "capture-existing";

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

export interface WorkflowSdk {
  schema: { z: typeof zod.z };
  extension: {
    chatgpt: {
      createConversationTask(input: {
        runId: string;
        phase: "setup" | "subject";
        subjectMode?: ChatGptSubjectTaskMode;
        masterPrompt?: string;
        referenceImagePaths?: string[];
        subjectImagePath?: string;
        subjectIndex?: number;
        subjectInstruction?: string;
        subjectBaseline?: unknown;
        selectors?: Record<string, unknown>;
        target?: ChatGptExtensionTaskTarget;
      }): { id: string };
      waitForTask(taskId: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<ExtensionTaskResult>;
      subscribeTask(taskId: string, listener: (event: ExtensionTaskEvent) => void): () => void;
      subscribeTaskOutput(taskId: string, listener: (output: ExtensionTaskOutput) => void): () => void;
      requestTaskPause(taskId: string): void;
      cancelTask(taskId: string): void;
      findCompatibleClientForTarget(target: ChatGptExtensionTaskTarget): ExtensionClientStatus | undefined;
    };
  };
  files: {
    inferMimeType(filePath: string): string | null;
    writeJson(filePath: string, value: unknown): void;
  };
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
