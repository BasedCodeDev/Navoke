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
  libraryDir: string;
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

export interface WorkflowLibraryEntry {
  id: string;
  name: string;
  workflowId: string;
  workflowVersion?: string | null;
  pluginId?: string | null;
  pluginVersion?: string | null;
  pluginApiVersion?: string | null;
  pluginSource?: PluginSource | "unknown" | null;
  sourceRunId: string | null;
  input: unknown;
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

export type RunArtifactPreview = Pick<
  ArtifactRecord,
  "id" | "runId" | "kind" | "name" | "mimeType" | "size" | "metadata" | "createdAt"
>;

export interface RunArtifactSummary {
  previews: RunArtifactPreview[];
  visualTotal: number;
  hiddenVisualCount: number;
  counts: Partial<Record<ArtifactKind, number>>;
  total: number;
}

export interface RunListRecord extends RunRecord {
  artifactSummary: RunArtifactSummary;
}

export interface WorkflowInputField {
  name: string;
  label: string;
  type: "text" | "textarea" | "fileList" | "json" | "number" | "checkbox" | "select" | "stringList";
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  fileValue?: "array" | "single";
  maxFiles?: number;
  filePickerTitle?: string;
  fileFilters?: Array<{ name: string; extensions: string[] }>;
  group?: string;
}

export interface WorkflowCalibrationPresetAssignment {
  key: string;
  label: string;
  path: string[];
}

export interface WorkflowCalibrationPreset {
  id: string;
  label: string;
  description?: string;
  targetField: string;
  defaultValue?: unknown;
  assignments: WorkflowCalibrationPresetAssignment[];
}

export type WorkflowPresentationItem =
  | { kind: "text"; label?: string; value: string }
  | { kind: "inputFile"; label?: string; field: string; index?: number; path: string }
  | { kind: "artifact"; label?: string; artifactId: string; preview?: "default" | "image" | "model" }
  | { kind: "pair"; label?: string; left?: WorkflowPresentationItem; right?: WorkflowPresentationItem }
  | { kind: "grid"; label?: string; items: WorkflowPresentationItem[] };

export interface WorkflowPresentationGroup {
  id?: string;
  title?: string;
  description?: string;
  items: WorkflowPresentationItem[];
}

export interface WorkflowRunPresentation {
  title?: string;
  groups: WorkflowPresentationGroup[];
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
  calibrationPresets?: WorkflowCalibrationPreset[];
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
