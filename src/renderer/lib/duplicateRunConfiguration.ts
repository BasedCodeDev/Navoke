import type { RunRecord, SystemInfo, WorkflowSummary } from "./api";
import {
  DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON,
  HUNYUAN_VIEW_FIELDS,
  HUNYUAN_WORKFLOW_ID,
  collectHunyuanInputFilePaths,
  emptyHunyuanViewFiles,
  type HunyuanExportFormat,
  type HunyuanFaceCount,
  type HunyuanRetopologyType,
  type HunyuanViewFiles
} from "./hunyuanWorkflow";

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
  hunyuanViewFiles: HunyuanViewFiles;
  hunyuanModelFaceCount: HunyuanFaceCount;
  hunyuanRetopologyType: HunyuanRetopologyType;
  hunyuanGenerateTexture: boolean;
  hunyuanAutoRig: boolean;
  hunyuanExportFormat: HunyuanExportFormat;
  hunyuanSelectorsJson: string;
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
    hunyuanViewFiles: emptyHunyuanViewFiles(),
    hunyuanModelFaceCount: "50k",
    hunyuanRetopologyType: "quad",
    hunyuanGenerateTexture: true,
    hunyuanAutoRig: false,
    hunyuanExportFormat: "obj",
    hunyuanSelectorsJson: DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON,
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
  } else if (isHunyuanWorkflowInput(run.workflowId, input, options.workflow)) {
    base.hunyuanViewFiles = readHunyuanViewFiles(input);
    base.selectedFiles = Object.values(base.hunyuanViewFiles).flat();
    base.prompt = stringField(input, "prompt");
    base.profileName = stringField(input, "profileName") || DEFAULT_PROFILE_NAME;
    base.pauseForManualLogin = booleanField(input, "pauseForManualLogin", true);
    base.hunyuanModelFaceCount = enumField(input, "modelFaceCount", ["1.5m", "1m", "500k", "50k"], "50k");
    base.hunyuanRetopologyType = enumField(input, "retopologyType", ["triangle", "quad"], "quad");
    base.hunyuanGenerateTexture = booleanField(input, "generateTexture", true);
    base.hunyuanAutoRig = booleanField(input, "autoRig", false);
    base.hunyuanExportFormat = enumField(input, "exportFormat", ["obj", "glb"], "obj");
    base.hunyuanSelectorsJson = selectorsJsonField(input);
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

function isHunyuanWorkflowInput(workflowId: string, input: Record<string, unknown>, workflow: WorkflowSummary | undefined): boolean {
  return workflowId === HUNYUAN_WORKFLOW_ID || workflow?.manifest.id === HUNYUAN_WORKFLOW_ID || "frontImage" in input;
}

export function collectRunInputFilePaths(input: unknown): string[] {
  const record = asRecord(input);
  return uniqueStrings([
    ...stringArrayField(record, "images"),
    ...stringArrayField(record, "referenceImages"),
    ...stringArrayField(record, "subjectImages"),
    ...stringArrayField(record, "sourceImages"),
    ...collectHunyuanInputFilePaths(record)
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

function enumField<T extends string>(record: Record<string, unknown>, field: string, values: T[], fallback: T): T {
  const value = record[field];
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}

function selectorsJsonField(record: Record<string, unknown>): string {
  const selectors = record.selectors;
  if (!selectors || typeof selectors !== "object" || Array.isArray(selectors)) return DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON;
  return `${JSON.stringify(selectors, null, 2)}\n`;
}

function readHunyuanViewFiles(input: Record<string, unknown>): HunyuanViewFiles {
  const viewFiles = emptyHunyuanViewFiles();
  for (const field of HUNYUAN_VIEW_FIELDS) {
    const value = input[field.field];
    if (typeof value === "string" && value.length > 0) {
      viewFiles[field.field] = [value];
    }
  }

  if (Object.values(viewFiles).every((files) => files.length === 0)) {
    const legacyImages = stringArrayField(input, "images");
    if (legacyImages[0]) viewFiles.frontImage = [legacyImages[0]];
    if (legacyImages[1]) viewFiles.backImage = [legacyImages[1]];
  }
  return viewFiles;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
