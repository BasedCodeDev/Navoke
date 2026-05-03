import type { RunRecord, SystemInfo, WorkflowSummary } from "./api";

export interface DuplicateRunConfiguration {
  workflowId: string;
  name: string;
  selectedFiles: string[];
  referenceFiles: string[];
  subjectFiles: string[];
  sourceFiles: string[];
  prompt: string;
  masterPrompt: string;
  subjectInstruction: string;
  sequencePrompts: string[];
  modelName: string;
  profileName: string;
  pauseForManualLogin: boolean;
  chatGptTabSelection: string;
  filePaths: string[];
}

interface DuplicateRunOptions {
  workflow?: WorkflowSummary;
  compatibleClients: SystemInfo["extension"]["connectedClients"];
  newChatGptTabValue: string;
}

const DEFAULT_MODEL_NAME = "Demo model";
const DEFAULT_PROFILE_NAME = "default";

export function buildDuplicateRunConfiguration(run: RunRecord, options: DuplicateRunOptions): DuplicateRunConfiguration {
  const input = asRecord(run.input);
  const base: DuplicateRunConfiguration = {
    workflowId: run.workflowId,
    name: run.name.trim() ? `Copy of ${run.name}` : "",
    selectedFiles: [],
    referenceFiles: [],
    subjectFiles: [],
    sourceFiles: [],
    prompt: "",
    masterPrompt: "",
    subjectInstruction: "",
    sequencePrompts: [],
    modelName: DEFAULT_MODEL_NAME,
    profileName: DEFAULT_PROFILE_NAME,
    pauseForManualLogin: true,
    chatGptTabSelection: options.newChatGptTabValue,
    filePaths: []
  };

  if (isChatGptWorkflowInput(input, options.workflow)) {
    if ("sourceImages" in input || "prompts" in input) {
      base.sourceFiles = stringArrayField(input, "sourceImages");
      base.sequencePrompts = stringArrayField(input, "prompts");
    } else {
      base.referenceFiles = stringArrayField(input, "referenceImages");
      base.subjectFiles = stringArrayField(input, "subjectImages");
      base.subjectInstruction = stringField(input, "subjectInstruction");
    }
    base.masterPrompt = stringField(input, "masterPrompt");
    base.chatGptTabSelection = resolveDuplicateChatGptTabSelection(input, options);
  } else if (isBrowserProfileWorkflowInput(input, options.workflow)) {
    base.selectedFiles = stringArrayField(input, "images");
    base.prompt = stringField(input, "prompt");
    base.profileName = stringField(input, "profileName") || DEFAULT_PROFILE_NAME;
    base.pauseForManualLogin = booleanField(input, "pauseForManualLogin", true);
  } else {
    base.selectedFiles = stringArrayField(input, "images");
    base.prompt = stringField(input, "prompt");
    base.modelName = stringField(input, "modelName") || DEFAULT_MODEL_NAME;
  }

  base.filePaths = collectRunInputFilePaths(input);
  return base;
}

function isChatGptWorkflowInput(input: Record<string, unknown>, workflow: WorkflowSummary | undefined): boolean {
  return Boolean(workflow?.manifest.uiCapabilities?.includes("chatgpt.tabRouting")) || "masterPrompt" in input || "subjectImages" in input || "sourceImages" in input;
}

function isBrowserProfileWorkflowInput(input: Record<string, unknown>, workflow: WorkflowSummary | undefined): boolean {
  return Boolean(workflow?.manifest.uiCapabilities?.includes("browser.profile")) || "profileName" in input || "pauseForManualLogin" in input;
}

export function collectRunInputFilePaths(input: unknown): string[] {
  const record = asRecord(input);
  return uniqueStrings([
    ...stringArrayField(record, "images"),
    ...stringArrayField(record, "referenceImages"),
    ...stringArrayField(record, "subjectImages"),
    ...stringArrayField(record, "sourceImages")
  ]);
}

function resolveDuplicateChatGptTabSelection(input: Record<string, unknown>, options: DuplicateRunOptions): string {
  const chatGptTab = asRecord(input.chatGptTab);
  const mode = stringField(chatGptTab, "mode");
  const clientId = stringField(chatGptTab, "clientId");
  const routingToken = stringField(chatGptTab, "routingToken");
  const url = stringField(chatGptTab, "url");

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

  return options.newChatGptTabValue;
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function booleanField(record: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = record[field];
  return typeof value === "boolean" ? value : fallback;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
