import type { WorkflowSummary } from "./api";

export interface RunPromptInputSummaryItem {
  name: string;
  label: string;
  value: string;
  multiline: boolean;
}

type WorkflowInputField = WorkflowSummary["manifest"]["inputFields"][number];

const PROMPT_FIELD_PATTERN = /(prompt|instruction)/i;
const PROMPT_FIELD_TYPES = new Set(["text", "textarea", "stringList", "select"]);

export function runPromptInputSummary(input: unknown, workflow?: WorkflowSummary): RunPromptInputSummaryItem[] {
  if (!isRecord(input)) return [];

  const items: RunPromptInputSummaryItem[] = [];
  const seen = new Set<string>();

  for (const field of workflow?.manifest.inputFields ?? []) {
    if (!isPromptLikeField(field)) continue;
    const item = buildPromptInputSummaryItem(field.name, field.label, input[field.name]);
    if (!item) continue;
    items.push(item);
    seen.add(field.name);
  }

  for (const name of Object.keys(input)) {
    if (seen.has(name)) continue;
    if (!PROMPT_FIELD_PATTERN.test(name)) continue;
    const item = buildPromptInputSummaryItem(name, labelFromFieldName(name), input[name]);
    if (!item) continue;
    items.push(item);
  }

  return items;
}

function labelFromFieldName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "Input prompt";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isPromptLikeField(field: WorkflowInputField): boolean {
  return PROMPT_FIELD_TYPES.has(field.type) && PROMPT_FIELD_PATTERN.test(`${field.name} ${field.label}`);
}

function buildPromptInputSummaryItem(name: string, label: string, value: unknown): RunPromptInputSummaryItem | null {
  const formatted = formatPromptValue(value);
  if (!formatted) return null;
  return {
    name,
    label,
    value: formatted,
    multiline: formatted.includes("\n") || formatted.length > 140
  };
}

function formatPromptValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const prompts = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    if (prompts.length === 0) return "";
    if (prompts.length === 1) return prompts[0];
    return prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n\n");
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
