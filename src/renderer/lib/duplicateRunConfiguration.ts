import type { RunRecord, SystemInfo, WorkflowSummary } from "./api";
import {
  DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON,
  HUNYUAN_WORKFLOW_ID,
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

  if (run.workflowId === HUNYUAN_WORKFLOW_ID) {
    base.hunyuanViewFiles = {
      frontImage: stringFieldAsArray(input, "frontImage"),
      backImage: stringFieldAsArray(input, "backImage"),
      leftImage: stringFieldAsArray(input, "leftImage"),
      rightImage: stringFieldAsArray(input, "rightImage"),
      topImage: stringFieldAsArray(input, "topImage"),
      bottomImage: stringFieldAsArray(input, "bottomImage"),
      left45Image: stringFieldAsArray(input, "left45Image"),
      right45Image: stringFieldAsArray(input, "right45Image")
    };
    base.prompt = stringField(input, "prompt");
    base.profileName = stringField(input, "profileName") || DEFAULT_PROFILE_NAME;
    base.pauseForManualLogin = booleanField(input, "pauseForManualLogin", true);
    base.hunyuanModelFaceCount = hunyuanFaceCountField(input, "modelFaceCount");
    base.hunyuanRetopologyType = hunyuanRetopologyTypeField(input, "retopologyType");
    base.hunyuanGenerateTexture = booleanField(input, "generateTexture", true);
    base.hunyuanAutoRig = booleanField(input, "autoRig", false);
    base.hunyuanExportFormat = hunyuanExportFormatField(input, "exportFormat");
    base.hunyuanSelectorsJson = jsonObjectField(input, "selectors") ?? DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON;
  } else if (isChatGptWorkflowInput(input, options.workflow)) {
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
    ...stringArrayField(record, "sourceImages"),
    ...[
      "frontImage",
      "backImage",
      "leftImage",
      "rightImage",
      "topImage",
      "bottomImage",
      "left45Image",
      "right45Image"
    ].map((field) => stringField(record, field))
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

function stringFieldAsArray(record: Record<string, unknown>, field: string): string[] {
  const value = stringField(record, field);
  return value ? [value] : [];
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function booleanField(record: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = record[field];
  return typeof value === "boolean" ? value : fallback;
}

function hunyuanFaceCountField(record: Record<string, unknown>, field: string): HunyuanFaceCount {
  const value = stringField(record, field);
  return value === "1.5m" || value === "1m" || value === "500k" || value === "50k" ? value : "50k";
}

function hunyuanRetopologyTypeField(record: Record<string, unknown>, field: string): HunyuanRetopologyType {
  const value = stringField(record, field);
  return value === "triangle" || value === "quad" ? value : "quad";
}

function hunyuanExportFormatField(record: Record<string, unknown>, field: string): HunyuanExportFormat {
  const value = stringField(record, field);
  return value === "obj" || value === "glb" ? value : "obj";
}

function jsonObjectField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return `${JSON.stringify(value, null, 2)}\n`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
