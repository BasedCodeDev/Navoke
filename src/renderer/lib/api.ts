export interface WorkflowManifest {
  id: string;
  title: string;
  description: string;
  category: "demo" | "hunyuan" | "chatgpt" | "utility";
  version: string;
  concurrency: number;
  requiresBrowser: boolean;
  targetUrl?: string;
  outputKinds: string[];
  inputFields: Array<{
    name: string;
    label: string;
    type: string;
    required?: boolean;
    placeholder?: string;
    help?: string;
    defaultValue?: unknown;
  }>;
}

export interface WorkflowSummary {
  manifest: WorkflowManifest;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  name: string;
  runDir: string | null;
  status: "queued" | "running" | "pausing" | "waiting_manual" | "completed" | "failed" | "cancelled";
  currentStep: string | null;
  progress: number;
  input: unknown;
  output: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  kind: "image" | "model" | "download" | "trace" | "screenshot" | "log" | "json";
  name: string;
  path: string;
  mimeType: string | null;
  size: number;
  metadata: unknown | null;
  createdAt: string;
}

export interface RuntimeEvent {
  id: number;
  runId: string;
  type: string;
  message: string;
  data: unknown | null;
  createdAt: string;
}

export interface FileValidationRecord {
  path: string;
  exists: boolean;
  isFile: boolean;
  size: number | null;
  error?: string;
}

export interface FileValidationResult {
  files: FileValidationRecord[];
}

export interface RunDetail {
  run: RunRecord;
  events: RuntimeEvent[];
  artifacts: ArtifactRecord[];
}

export interface SystemInfo {
  paths: Record<string, string>;
  runner: { queued: number; running: number };
  extension: {
    pending: number;
    running: number;
    labPending: number;
    labRunning: number;
    focusPending: number;
    focusRunning: number;
    requiredProtocolVersion: number;
    connectedClients: Array<{
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
    }>;
  };
}

export type AppConfig = BasedBlinkConfig;

export type WorkflowLabSessionMode = "playwright" | "extension";

export interface LabSelectorCandidate {
  selector: string;
  engine: "css" | "text" | "role";
  source: string;
  confidence: number;
}

export interface LabInteractiveElement {
  index: number;
  tagName: string;
  label: string;
  text: string;
  role?: string;
  ariaLabel?: string;
  type?: string;
  disabled: boolean;
  visible: boolean;
  attributes: Record<string, string>;
  selectors: LabSelectorCandidate[];
}

export interface LabInspectionModel {
  url: string;
  title: string;
  capturedAt: string;
  viewport: { width: number; height: number };
  bodyTextSample: string;
  bodyTextLength: number;
  fingerprint: string;
  imageFingerprints: string[];
  interactiveElements: LabInteractiveElement[];
}

export interface WorkflowLabArtifactRef {
  name: string;
  path: string;
  mimeType: string;
  size: number;
}

export interface WorkflowLabActionLogEntry {
  id: string;
  type: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

export interface WorkflowLabSessionSummary {
  id: string;
  mode: WorkflowLabSessionMode;
  targetUrl: string;
  profileName?: string;
  clientId?: string;
  status: "ready" | "closed";
  title?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
  artifacts: WorkflowLabArtifactRef[];
  actionLog: WorkflowLabActionLogEntry[];
}

export type WorkflowLabAction =
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "submit"; selector: string }
  | { kind: "attach-file"; selector: string; filePaths: string[] };

export type LabWaitCondition =
  | { kind: "element"; selector: string; state: "visible" | "hidden" | "enabled" | "disabled"; timeoutMs?: number }
  | { kind: "text"; text: string; state: "present" | "absent"; timeoutMs?: number }
  | { kind: "image-count"; selector?: string; minCount: number; previousFingerprints?: string[]; timeoutMs?: number }
  | { kind: "stop-button"; selector?: string; state: "visible" | "hidden"; timeoutMs?: number }
  | {
      kind: "chatgpt-submit-ready";
      selectors?: { composer?: string; submitButton?: string; stopButton?: string; fileInput?: string };
      timeoutMs?: number;
    }
  | { kind: "network-idle"; timeoutMs?: number };

export interface WorkflowLabInspectionResult {
  session: WorkflowLabSessionSummary;
  inspection: LabInspectionModel;
  screenshotBase64?: string;
  screenshotMimeType?: string;
  artifacts: WorkflowLabArtifactRef[];
}

export interface WorkflowLabWaitResult {
  session: WorkflowLabSessionSummary;
  condition: LabWaitCondition;
  satisfied: boolean;
  reason: string;
  elapsedMs: number;
  diagnostics: Record<string, unknown>;
}

let configPromise: Promise<AppConfig> | null = null;

export function getConfig(): Promise<AppConfig> {
  configPromise ??= window.basedBlink.getConfig();
  return configPromise;
}

export async function openProject(path?: string): Promise<AppConfig> {
  const config = await window.basedBlink.openProject(path);
  configPromise = Promise.resolve(config);
  return config;
}

export async function renameProject(projectPath: string, name: string): Promise<AppConfig> {
  const config = await window.basedBlink.renameProject(projectPath, name);
  configPromise = Promise.resolve(config);
  return config;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const config = await getConfig();
  if (!config.apiBaseUrl) {
    throw new Error("Open a project folder before using the local API.");
  }
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  return apiFetch("/api/workflows");
}

export async function listRuns(): Promise<RunRecord[]> {
  return apiFetch("/api/runs");
}

export async function getRun(id: string): Promise<RunDetail> {
  return apiFetch(`/api/runs/${id}`);
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return apiFetch("/api/system");
}

export async function focusExtensionClient(clientId: string): Promise<{ ok: true; result?: unknown }> {
  return apiFetch(`/api/extension/clients/${encodeURIComponent(clientId)}/focus`, { method: "POST", body: "{}" });
}

export async function validateFilePaths(paths: string[]): Promise<FileValidationResult> {
  return apiFetch("/api/files/validate", { method: "POST", body: JSON.stringify({ paths }) });
}

export async function listLabSessions(): Promise<WorkflowLabSessionSummary[]> {
  return apiFetch("/api/lab/sessions");
}

export async function createLabSession(input: {
  mode: WorkflowLabSessionMode;
  targetUrl?: string;
  profileName?: string;
  clientId?: string;
}): Promise<WorkflowLabSessionSummary> {
  return apiFetch("/api/lab/sessions", { method: "POST", body: JSON.stringify(input) });
}

export async function closeLabSession(id: string): Promise<WorkflowLabSessionSummary> {
  return apiFetch(`/api/lab/sessions/${id}`, { method: "DELETE" });
}

export async function inspectLabSession(id: string): Promise<WorkflowLabInspectionResult> {
  return apiFetch(`/api/lab/sessions/${id}/inspect`, { method: "POST", body: "{}" });
}

export async function runLabAction(input: { sessionId: string; action: WorkflowLabAction }): Promise<{ session: WorkflowLabSessionSummary }> {
  return apiFetch(`/api/lab/sessions/${input.sessionId}/actions`, {
    method: "POST",
    body: JSON.stringify({ action: input.action })
  });
}

export async function waitForLabCondition(input: {
  sessionId: string;
  condition: LabWaitCondition;
}): Promise<WorkflowLabWaitResult> {
  return apiFetch(`/api/lab/sessions/${input.sessionId}/wait`, {
    method: "POST",
    body: JSON.stringify({ condition: input.condition })
  });
}

export async function createRun(input: { workflowId: string; name?: string; input: unknown }): Promise<RunRecord> {
  return apiFetch("/api/runs", { method: "POST", body: JSON.stringify(input) });
}

export async function renameRun(id: string, name: string): Promise<RunRecord> {
  return apiFetch(`/api/runs/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export async function cancelRun(id: string): Promise<RunRecord> {
  return apiFetch(`/api/runs/${id}/cancel`, { method: "POST", body: "{}" });
}

export async function pauseRun(id: string): Promise<RunRecord> {
  return apiFetch(`/api/runs/${id}/pause`, { method: "POST", body: "{}" });
}

export async function resumeRun(id: string): Promise<RunRecord> {
  return apiFetch(`/api/runs/${id}/resume`, { method: "POST", body: "{}" });
}

export async function deleteRun(id: string): Promise<{ id: string; deleted: true }> {
  return apiFetch(`/api/runs/${id}`, { method: "DELETE" });
}

export async function artifactUrl(id: string): Promise<string> {
  const config = await getConfig();
  return `${config.apiBaseUrl}/api/artifacts/${id}/file`;
}

export async function artifactDownloadUrl(id: string): Promise<string> {
  const config = await getConfig();
  return `${config.apiBaseUrl}/api/artifacts/${id}/download`;
}

export async function runInputFileUrl(runId: string, field: "images" | "referenceImages" | "subjectImages", index: number): Promise<string> {
  const config = await getConfig();
  return `${config.apiBaseUrl}/api/runs/${runId}/input-files/${field}/${index}`;
}

export async function subscribeRuntimeEvents(onMessage: (message: unknown) => void): Promise<() => void> {
  const config = await getConfig();
  const source = new EventSource(`${config.apiBaseUrl}/api/events`);
  source.onmessage = (event) => onMessage(JSON.parse(event.data));
  return () => source.close();
}
