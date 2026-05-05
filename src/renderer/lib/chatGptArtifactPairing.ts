import type { ArtifactRecord } from "./api";

export type ChatGptRunInputModel = ChatGptSubjectRunInputModel | ChatGptSequenceRunInputModel;

export interface ChatGptSubjectRunInputModel {
  kind: "subjects";
  referenceImages: string[];
  subjectImages: string[];
  masterPrompt: string;
  subjectInstruction: string;
}

export interface ChatGptSequenceRunInputModel {
  kind: "sequence";
  sourceImages: string[];
  prompts: string[];
  masterPrompt: string;
  masterPromptSuffix: string;
}

export interface ChatGptOutputMetadata {
  source?: string;
  workflowKind?: string;
  inputImage?: string;
  sourceImage?: string;
  subjectIndex?: number;
  promptIndex?: number;
  pairId?: string;
}

export interface ChatGptArtifactPair {
  index: number;
  subjectImage?: string;
  sourceImage?: string;
  prompt?: string;
  primaryOutput: ArtifactRecord | null;
}

export interface ChatGptArtifactPairing {
  pairs: ChatGptArtifactPair[];
  otherArtifacts: ArtifactRecord[];
}

const CHATGPT_PAIRABLE_WORKFLOW_IDS = new Set([
  "based-blink.chatgpt.extension-image-transform",
  "based-blink.chatgpt.extension-image-sequence"
]);

export function supportsChatGptArtifactPairing(workflowId: string | undefined, input: unknown): boolean {
  return Boolean(workflowId && CHATGPT_PAIRABLE_WORKFLOW_IDS.has(workflowId) && getChatGptRunInput(input));
}

export function getChatGptRunInput(input: unknown): ChatGptRunInputModel | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const sourceImages = readStringArray(record.sourceImages);
  const prompts = readStringArray(record.prompts);
  if (sourceImages && prompts) {
    return {
      kind: "sequence",
      sourceImages,
      prompts,
      masterPrompt: typeof record.masterPrompt === "string" ? record.masterPrompt : "",
      masterPromptSuffix: typeof record.masterPromptSuffix === "string" ? record.masterPromptSuffix : ""
    };
  }

  const subjectImages = readStringArray(record.subjectImages) ?? readStringArray(record.images);
  if (!subjectImages) return null;
  return {
    kind: "subjects",
    referenceImages: readStringArray(record.referenceImages) ?? [],
    subjectImages,
    masterPrompt: typeof record.masterPrompt === "string" ? record.masterPrompt : "",
    subjectInstruction: typeof record.subjectInstruction === "string" ? record.subjectInstruction : ""
  };
}

export function buildChatGptArtifactPairing(input: ChatGptRunInputModel, artifacts: ArtifactRecord[]): ChatGptArtifactPairing {
  if (input.kind === "sequence") return buildChatGptSequenceArtifactPairing(input, artifacts);
  return buildChatGptSubjectArtifactPairing(input, artifacts);
}

function buildChatGptSubjectArtifactPairing(input: ChatGptSubjectRunInputModel, artifacts: ArtifactRecord[]): ChatGptArtifactPairing {
  const outputEntries = artifacts
    .map((artifact) => ({ artifact, metadata: getChatGptOutputMetadata(artifact) }))
    .filter((entry): entry is { artifact: ArtifactRecord; metadata: ChatGptOutputMetadata } => Boolean(entry.metadata));
  const usedOutputIds = new Set<string>();

  const pairs = input.subjectImages.map((subjectImage, index) => {
    const outputs = outputEntries
      .filter(({ metadata }) => outputMatchesSubject(metadata, index, subjectImage))
      .map(({ artifact }) => artifact);
    const primaryOutput = outputs[0] ?? null;
    for (const output of outputs) usedOutputIds.add(output.id);
    return { index, subjectImage, primaryOutput };
  });

  for (const { artifact } of outputEntries) usedOutputIds.add(artifact.id);
  const otherArtifacts = artifacts.filter((artifact) => !usedOutputIds.has(artifact.id));

  return { pairs, otherArtifacts };
}

function buildChatGptSequenceArtifactPairing(input: ChatGptSequenceRunInputModel, artifacts: ArtifactRecord[]): ChatGptArtifactPairing {
  const outputEntries = artifacts
    .map((artifact) => ({ artifact, metadata: getChatGptOutputMetadata(artifact) }))
    .filter((entry): entry is { artifact: ArtifactRecord; metadata: ChatGptOutputMetadata } => Boolean(entry.metadata));
  const usedOutputIds = new Set<string>();
  const sourceImage = input.sourceImages[0] ?? "";

  const pairs = input.prompts.map((prompt, index) => {
    const outputs = outputEntries
      .filter(({ metadata }) => outputMatchesPrompt(metadata, index))
      .map(({ artifact }) => artifact);
    const primaryOutput = outputs[0] ?? null;
    for (const output of outputs) usedOutputIds.add(output.id);
    return { index, sourceImage, prompt, primaryOutput };
  });

  for (const { artifact } of outputEntries) usedOutputIds.add(artifact.id);
  const otherArtifacts = artifacts.filter((artifact) => !usedOutputIds.has(artifact.id));

  return { pairs, otherArtifacts };
}

export function getChatGptOutputMetadata(artifact: ArtifactRecord): ChatGptOutputMetadata | null {
  if (!artifact.metadata || typeof artifact.metadata !== "object") return null;
  const metadata = artifact.metadata as Record<string, unknown>;
  if (metadata.source !== "chatgpt-extension") return null;
  return {
    source: "chatgpt-extension",
    workflowKind: typeof metadata.workflowKind === "string" ? metadata.workflowKind : undefined,
    inputImage: typeof metadata.inputImage === "string" ? metadata.inputImage : undefined,
    sourceImage: typeof metadata.sourceImage === "string" ? metadata.sourceImage : undefined,
    subjectIndex: typeof metadata.subjectIndex === "number" ? metadata.subjectIndex : undefined,
    promptIndex: typeof metadata.promptIndex === "number" ? metadata.promptIndex : undefined,
    pairId: typeof metadata.pairId === "string" ? metadata.pairId : undefined
  };
}

export function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

export function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

function outputMatchesSubject(metadata: ChatGptOutputMetadata, index: number, subjectImage: string): boolean {
  if (metadata.pairId) return metadata.pairId === `subject-${index + 1}`;
  if (typeof metadata.subjectIndex === "number") return metadata.subjectIndex === index;
  return Boolean(metadata.inputImage && samePath(metadata.inputImage, subjectImage));
}

function outputMatchesPrompt(metadata: ChatGptOutputMetadata, index: number): boolean {
  if (metadata.pairId) return metadata.pairId === `prompt-${index + 1}`;
  return metadata.workflowKind === "image-sequence" && metadata.promptIndex === index;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}
