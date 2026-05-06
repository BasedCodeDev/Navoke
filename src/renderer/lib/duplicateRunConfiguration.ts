import type { RunRecord, SystemInfo, WorkflowSummary } from "./api";

export interface DuplicateRunConfiguration {
  workflowId: string;
  name: string;
  values: Record<string, unknown>;
  extensionTabSelection: string;
  filePaths: string[];
}

interface DuplicateRunOptions {
  workflow?: WorkflowSummary;
  compatibleClients: SystemInfo["extension"]["connectedClients"];
  existingRuns?: Array<Pick<RunRecord, "name">>;
  newExtensionTabValue: string;
}

export function buildDuplicateRunConfiguration(run: RunRecord, options: DuplicateRunOptions): DuplicateRunConfiguration {
  const input = asRecord(run.input);
  const values: Record<string, unknown> = {};

  for (const field of options.workflow?.manifest.inputFields ?? []) {
    if (field.name in input) {
      values[field.name] = input[field.name];
    } else if (field.defaultValue !== undefined) {
      values[field.name] = cloneDefaultValue(field.defaultValue);
    }
  }

  return {
    workflowId: run.workflowId,
    name: nextResubmitRunName(run.name, options.existingRuns ?? []),
    values,
    extensionTabSelection: resolveDuplicateExtensionTabSelection(input, options),
    filePaths: collectRunInputFilePaths(run.input, options.workflow)
  };
}

export function collectRunInputFilePaths(input: unknown, workflow?: WorkflowSummary): string[] {
  const record = asRecord(input);
  const manifestFileFields = workflow?.manifest.inputFields.filter((field) => field.type === "fileList").map((field) => field.name) ?? [];
  const fallbackFileFields = Object.keys(record).filter((field) => isFileValue(record[field]));
  return uniqueStrings(
    [...new Set([...manifestFileFields, ...fallbackFileFields])].flatMap((field) => {
      const value = record[field];
      if (typeof value === "string") return value.trim() ? [value] : [];
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      return [];
    })
  );
}

function resolveDuplicateExtensionTabSelection(input: Record<string, unknown>, options: DuplicateRunOptions): string {
  const extensionTab = asRecord(input.extensionTab);
  const mode = stringField(extensionTab, "mode");
  const clientId = stringField(extensionTab, "clientId");
  const routingToken = stringField(extensionTab, "routingToken");
  const url = stringField(extensionTab, "url");

  if (mode === "existing" && clientId) {
    const connectedClient = options.compatibleClients.find((client) => client.id === clientId);
    if (connectedClient) return connectedClient.id;
  }

  if (mode === "new" && routingToken) {
    const routedClient = options.compatibleClients.find((client) => client.routingToken === routingToken);
    if (routedClient) return routedClient.id;
  }

  if (url) {
    const urlClient = options.compatibleClients.find((client) => client.url === url);
    if (urlClient) return urlClient.id;
  }

  return options.newExtensionTabValue;
}

function nextResubmitRunName(name: string, existingRuns: Array<Pick<RunRecord, "name">>): string {
  const trimmedName = name.trim();
  if (!trimmedName) return "";

  const baseName = trimmedName.replace(/\s+\(\d+\)$/, "");
  const existingNames = new Set(existingRuns.map((run) => run.name.trim()).filter(Boolean));
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${baseName} (${suffix})`;
    if (!existingNames.has(candidate)) return candidate;
  }
}

function isFileValue(value: unknown): boolean {
  if (typeof value === "string") return hasFileLikeExtension(value);
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && hasFileLikeExtension(item));
  return false;
}

function hasFileLikeExtension(value: string): boolean {
  return /\.[A-Za-z0-9]{2,8}$/.test(value.trim());
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function cloneDefaultValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
