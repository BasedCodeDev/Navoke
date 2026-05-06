import type { WorkflowSummary } from "./api";

export type WorkflowFormValues = Record<string, unknown>;

export function createInitialWorkflowValues(workflow: WorkflowSummary | undefined): WorkflowFormValues {
  const values: WorkflowFormValues = {};
  for (const field of workflow?.manifest.inputFields ?? []) {
    values[field.name] = initialFieldValue(field);
  }
  return values;
}

export function normalizeWorkflowValues(workflow: WorkflowSummary | undefined, current: WorkflowFormValues): WorkflowFormValues {
  const values = createInitialWorkflowValues(workflow);
  for (const field of workflow?.manifest.inputFields ?? []) {
    if (field.name in current) values[field.name] = current[field.name];
  }
  return values;
}

export function buildWorkflowInputFromValues(workflow: WorkflowSummary, values: WorkflowFormValues): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of workflow.manifest.inputFields) {
    const value = values[field.name];
    const normalized = normalizeValueForInput(field, value);
    if (normalized !== undefined) input[field.name] = normalized;
  }
  return input;
}

export function parseJsonFieldValue(value: unknown, fieldLabel: string): unknown {
  if (typeof value !== "string") return value ?? {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} must be a JSON object.`);
  }
  return parsed;
}

export function stringifyJsonFieldValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeValueForInput(field: WorkflowSummary["manifest"]["inputFields"][number], value: unknown): unknown {
  if (field.type === "checkbox") return Boolean(value);
  if (field.type === "number") {
    if (typeof value === "number") return value;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (field.type === "json") return parseJsonFieldValue(value, field.label);
  if (field.type === "fileList") {
    if (field.fileValue === "single") {
      const file = Array.isArray(value) ? value[0] : value;
      return typeof file === "string" && file.trim() ? file : undefined;
    }
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  }
  if (field.type === "stringList") {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return value ?? "";
}

function initialFieldValue(field: WorkflowSummary["manifest"]["inputFields"][number]): unknown {
  if (field.defaultValue !== undefined) {
    return field.type === "json" ? stringifyJsonFieldValue(field.defaultValue) : cloneDefaultValue(field.defaultValue);
  }
  if (field.type === "checkbox") return false;
  if (field.type === "fileList") return [];
  if (field.type === "stringList") return [];
  if (field.type === "json") return "";
  if (field.type === "number") return "";
  return "";
}

function cloneDefaultValue(value: unknown): unknown {
  return value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
}
