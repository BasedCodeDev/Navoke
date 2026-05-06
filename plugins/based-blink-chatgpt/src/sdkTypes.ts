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
    uiCapabilities?: Array<"extension.tabRouting" | "extension.focusTarget">;
    calibrationPresets?: WorkflowCalibrationPreset[];
    inputFields: Array<{
      name: string;
      label: string;
      type: "text" | "textarea" | "fileList" | "json" | "number" | "checkbox" | "select" | "stringList";
      required?: boolean;
      placeholder?: string;
      defaultValue?: unknown;
      help?: string;
      options?: Array<{ label: string; value: string }>;
      fileValue?: "array" | "single";
      maxFiles?: number;
      filePickerTitle?: string;
      fileFilters?: Array<{ name: string; extensions: string[] }>;
      group?: string;
    }>;
  };
  inputSchema: zod.ZodType<TInput, zod.ZodTypeDef, unknown>;
  outputSchema: zod.ZodType<TOutput, zod.ZodTypeDef, unknown>;
  canResumeFailedRun?(run: RunRecord): boolean;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}

export interface WorkflowCalibrationPreset {
  id: string;
  label: string;
  description?: string;
  targetField: string;
  defaultValue?: unknown;
  assignments: Array<{ key: string; label: string; path: string[] }>;
}

export type ExtensionBrowserTarget =
  | { mode: "any" }
  | { mode: "existing"; clientId: string; url?: string; title?: string; tabId?: number; windowId?: number; controllerId?: string }
  | {
      mode: "new";
      routingToken: string;
      url?: string;
      title?: string;
      openMode?: "window" | "tab";
      clientId?: string;
      tabId?: number;
      windowId?: number;
      controllerId?: string;
    };

export type ChatGptExtensionTaskTarget = ExtensionBrowserTarget;
export type ChatGptSubjectTaskMode = "submit-and-capture" | "capture-existing";

export interface ExtensionClientStatus {
  id: string;
  url: string;
  title: string;
  status: string;
  protocolVersion: number | null;
  extensionVersion: string;
  routingToken?: string;
  controllerId?: string;
  tabId?: number;
  windowId?: number;
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

export interface WorkflowSdk {
  schema: { z: typeof zod.z };
  extension: {
    browser: {
      findCompatibleClientForTarget(target: ExtensionBrowserTarget): ExtensionClientStatus | undefined;
      ensureRoutedTab(target: ExtensionBrowserTarget, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ExtensionClientStatus>;
      openTab(url: string, options?: { active?: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      openWindow(url: string, options?: { focused?: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      closeTab(tabId: number, options?: { controllerId?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      focusTarget(target: ExtensionBrowserTarget, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      stageFiles(filePaths: string[]): Array<{ id: string; name: string; mimeType: string; url: string }>;
      executeCommand(target: ExtensionBrowserTarget, command: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      inspect(target: ExtensionBrowserTarget, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      action(target: ExtensionBrowserTarget, action: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      wait(target: ExtensionBrowserTarget, condition: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      extract(target: ExtensionBrowserTarget, query: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
    };
  };
  files: {
    inferMimeType(filePath: string): string | null;
    writeJson(filePath: string, value: unknown): void;
  };
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
