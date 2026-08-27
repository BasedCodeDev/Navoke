import type * as zod from "zod";

export interface WorkflowContext {
  paths: unknown;
  artifactDir: string;
  runId: string;
  signal: AbortSignal;
  previousOutput: unknown | null;
  step(message: string, progress?: number, data?: unknown): Promise<void>;
  event(type: string, message: string, data?: unknown): Promise<void>;
  updateOutput(output: unknown): Promise<void>;
  isPauseRequested(): boolean;
  pauseIfRequested(message: string, data?: unknown): Promise<void>;
  waitForManualAction(message: string, data?: unknown): Promise<void>;
  addArtifact(input: {
    kind: "image" | "model" | "json";
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
    category: "model";
    version: string;
    concurrency: number;
    requiresBrowser: boolean;
    outputKinds: Array<"image" | "model" | "json">;
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
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}

export interface WorkflowSdk {
  schema: { z: typeof zod.z };
  files: {
    inferMimeType(filePath: string): string | null;
    writeJson(filePath: string, value: unknown): void;
    extractZip(zipPath: string, targetDir: string): Promise<void>;
  };
  browser: {
    launchPersistentProfile(input: {
      paths: unknown;
      workflowId: string;
      profileName: string;
      headless?: boolean;
    }): Promise<any>;
  };
  packages?: {
    resolvePackageRoot(packageName: string): string;
  };
  errors: {
    WorkflowConfigurationError: typeof Error;
  };
}
