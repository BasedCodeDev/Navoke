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
  status: "queued" | "running" | "waiting_manual" | "completed" | "failed" | "cancelled";
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
    connectedClients: Array<{ id: string; url: string; title: string; status: string; lastSeenAt: string }>;
  };
}

let configPromise: Promise<{ apiBaseUrl: string; dataDir: string; platform: string }> | null = null;

export function getConfig(): Promise<{ apiBaseUrl: string; dataDir: string; platform: string }> {
  configPromise ??= window.workflowAutomation.getConfig();
  return configPromise;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const config = await getConfig();
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

export async function createRun(input: { workflowId: string; name?: string; input: unknown }): Promise<RunRecord> {
  return apiFetch("/api/runs", { method: "POST", body: JSON.stringify(input) });
}

export async function cancelRun(id: string): Promise<RunRecord> {
  return apiFetch(`/api/runs/${id}/cancel`, { method: "POST", body: "{}" });
}

export async function resumeRun(id: string): Promise<RunRecord> {
  return apiFetch(`/api/runs/${id}/resume`, { method: "POST", body: "{}" });
}

export async function artifactUrl(id: string): Promise<string> {
  const config = await getConfig();
  return `${config.apiBaseUrl}/api/artifacts/${id}/file`;
}

export async function artifactDownloadUrl(id: string): Promise<string> {
  const config = await getConfig();
  return `${config.apiBaseUrl}/api/artifacts/${id}/download`;
}

export async function subscribeRuntimeEvents(onMessage: (message: unknown) => void): Promise<() => void> {
  const config = await getConfig();
  const source = new EventSource(`${config.apiBaseUrl}/api/events`);
  source.onmessage = (event) => onMessage(JSON.parse(event.data));
  return () => source.close();
}
