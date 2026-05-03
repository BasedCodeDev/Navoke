import type * as zod from "zod";

export interface WorkflowContext {
  paths: unknown;
  artifactDir: string;
  step(message: string, progress?: number, data?: unknown): Promise<void>;
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
    uiCapabilities?: Array<"browser.profile">;
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
