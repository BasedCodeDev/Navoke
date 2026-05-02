import type { z } from "zod";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_manual"
  | "completed"
  | "failed"
  | "cancelled";

export type ArtifactKind = "image" | "model" | "download" | "trace" | "screenshot" | "log" | "json";

export interface RuntimePaths {
  projectDir: string;
  internalDir: string;
  runRootDir: string;
  dataDir: string;
  artifactDir: string;
  browserProfilesDir: string;
  workflowLabDir: string;
  logsDir: string;
  dbPath: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  name: string;
  runDir: string | null;
  status: RunStatus;
  currentStep: string | null;
  progress: number;
  input: unknown;
  output: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeEvent {
  id: number;
  runId: string;
  type: string;
  message: string;
  data: unknown | null;
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  kind: ArtifactKind;
  name: string;
  path: string;
  mimeType: string | null;
  size: number;
  metadata: unknown | null;
  createdAt: string;
}

export interface WorkflowInputField {
  name: string;
  label: string;
  type: "text" | "textarea" | "fileList" | "json" | "number" | "checkbox" | "select";
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
}

export interface WorkflowManifest {
  id: string;
  title: string;
  description: string;
  category: "demo" | "hunyuan" | "chatgpt" | "utility";
  version: string;
  concurrency: number;
  inputFields: WorkflowInputField[];
  outputKinds: ArtifactKind[];
  requiresBrowser: boolean;
  targetUrl?: string;
}

export interface WorkflowContext {
  runId: string;
  paths: RuntimePaths;
  runDir: string;
  inputDir: string;
  artifactDir: string;
  signal: AbortSignal;
  step(message: string, progress?: number, data?: unknown): Promise<void>;
  event(type: string, message: string, data?: unknown): Promise<void>;
  addArtifact(input: {
    kind: ArtifactKind;
    name: string;
    path: string;
    mimeType?: string | null;
    metadata?: unknown;
  }): Promise<ArtifactRecord>;
  waitForManualAction(message: string, data?: unknown): Promise<void>;
}

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  manifest: WorkflowManifest;
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  outputSchema: z.ZodType<TOutput, z.ZodTypeDef, unknown>;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}

export interface PublicWorkflow {
  manifest: WorkflowManifest;
}
