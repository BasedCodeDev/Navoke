import type { z } from "zod";

export type RunStatus =
  | "queued"
  | "running"
  | "pausing"
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

export type RunOriginSource = "ui" | "cli";

export type RunOrigin =
  | { source: "ui" }
  | {
      source: "cli";
      agentName?: string;
      command?: string;
      cwd?: string;
      pid?: number;
      cliVersion?: string;
    };

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowVersion?: string | null;
  pluginId?: string | null;
  pluginVersion?: string | null;
  pluginApiVersion?: string | null;
  pluginSource?: PluginSource | "unknown" | null;
  origin: RunOrigin;
  runNumber: number | null;
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

export type WorkflowUiCapability =
  | "extension.tabRouting"
  | "extension.focusTarget"
  | "browser.profile";

export interface WorkflowManifest {
  id: string;
  title: string;
  description: string;
  category: string;
  version: string;
  concurrency: number;
  inputFields: WorkflowInputField[];
  outputKinds: ArtifactKind[];
  requiresBrowser: boolean;
  targetUrl?: string;
  uiCapabilities?: WorkflowUiCapability[];
}

export interface WorkflowContext {
  runId: string;
  paths: RuntimePaths;
  runDir: string;
  inputDir: string;
  artifactDir: string;
  signal: AbortSignal;
  previousOutput: unknown | null;
  step(message: string, progress?: number, data?: unknown): Promise<void>;
  event(type: string, message: string, data?: unknown): Promise<void>;
  updateOutput(output: unknown): Promise<void>;
  isPauseRequested(): boolean;
  pauseIfRequested(message: string, data?: unknown): Promise<void>;
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
  canResumeFailedRun?(run: RunRecord): boolean;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}

export type PluginSource = "builtin" | "user";

export type WorkflowPluginCapability = "filesystem.artifacts" | "browser" | "extension.browser";

export interface WorkflowPluginMetadata {
  id: string;
  name: string;
  version: string;
  source: PluginSource;
  apiVersion: string;
  installPath?: string;
  capabilities: WorkflowPluginCapability[];
}

export interface WorkflowRegistration {
  definition: WorkflowDefinition;
  plugin: WorkflowPluginMetadata;
}

export type WorkflowRegistry = Map<string, WorkflowRegistration>;

export interface PublicWorkflow {
  manifest: WorkflowManifest;
  plugin: WorkflowPluginMetadata;
  availability: {
    status: "available";
  };
}
