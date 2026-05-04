import type * as zod from "zod";

export interface WorkflowContext {
  paths: unknown;
  artifactDir: string;
  runId: string;
  signal: AbortSignal;
  step(message: string, progress?: number, data?: unknown): Promise<void>;
  event(type: string, message: string, data?: unknown): Promise<void>;
  waitForManualAction(message: string, data?: unknown): Promise<void>;
  addArtifact(input: {
    kind: "model" | "download" | "trace" | "screenshot" | "json";
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
    category: "hunyuan";
    version: string;
    concurrency: number;
    requiresBrowser: boolean;
    targetUrl?: string;
    outputKinds: Array<"model" | "download" | "trace" | "screenshot" | "json">;
    uiCapabilities?: Array<"browser.profile" | "extension.tabRouting">;
    inputFields: Array<{
      name: string;
      label: string;
      type: "text" | "textarea" | "fileList" | "json" | "number" | "checkbox" | "select";
      required?: boolean;
      defaultValue?: unknown;
      help?: string;
      options?: Array<{ label: string; value: string }>;
    }>;
  };
  inputSchema: zod.ZodType<TInput, zod.ZodTypeDef, unknown>;
  outputSchema: zod.ZodType<TOutput, zod.ZodTypeDef, unknown>;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}

export interface WorkflowSdk {
  schema: { z: typeof zod.z };
  extension: {
    browser: {
      findCompatibleClientForTarget(target: ExtensionBrowserTarget): ExtensionClientStatus | undefined;
      ensureRoutedTab(target: ExtensionBrowserTarget, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ExtensionClientStatus>;
      openTab(url: string, options?: { active?: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      stageFiles(filePaths: string[]): Array<{ id: string; name: string; mimeType: string; url: string }>;
      executeCommand(target: ExtensionBrowserTarget, command: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      inspect(target: ExtensionBrowserTarget, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      action(target: ExtensionBrowserTarget, action: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      wait(target: ExtensionBrowserTarget, condition: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      extract(target: ExtensionBrowserTarget, query: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
    };
  };
  browser: {
    launchPersistentProfile(input: {
      paths: unknown;
      workflowId: string;
      profileName: string;
      headless?: boolean;
    }): Promise<any>;
    saveScreenshot(page: any, artifactDir: string, name: string): Promise<string>;
    startTrace(context: any, artifactDir: string): Promise<string>;
    stopTrace(context: any, tracePath: string): Promise<void>;
    timeoutMinutes(minutes: number): number;
  };
  errors: {
    WorkflowConfigurationError: typeof Error;
  };
  files: {
    inferMimeType(filePath: string): string | null;
    writeJson(filePath: string, value: unknown): void;
  };
}

export type ExtensionBrowserTarget =
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
