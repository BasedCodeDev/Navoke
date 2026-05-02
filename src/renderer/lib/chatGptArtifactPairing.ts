import type { ArtifactRecord } from "./api";

export interface ChatGptRunInputModel {
  referenceImages: string[];
  subjectImages: string[];
  masterPrompt: string;
  subjectInstruction: string;
}

export interface ChatGptOutputMetadata {
  source?: string;
  inputImage?: string;
  subjectIndex?: number;
  pairId?: string;
}

export interface ChatGptArtifactPair {
  index: number;
  subjectImage: string;
  primaryOutput: ArtifactRecord | null;
}

export interface ChatGptArtifactPairing {
  pairs: ChatGptArtifactPair[];
  otherArtifacts: ArtifactRecord[];
}

export function getChatGptRunInput(input: unknown): ChatGptRunInputModel | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const subjectImages = readStringArray(record.subjectImages) ?? readStringArray(record.images);
  if (!subjectImages) return null;
  return {
    referenceImages: readStringArray(record.referenceImages) ?? [],
    subjectImages,
    masterPrompt: typeof record.masterPrompt === "string" ? record.masterPrompt : "",
    subjectInstruction: typeof record.subjectInstruction === "string" ? record.subjectInstruction : ""
  };
}

export function buildChatGptArtifactPairing(input: ChatGptRunInputModel, artifacts: ArtifactRecord[]): ChatGptArtifactPairing {
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

export function getChatGptOutputMetadata(artifact: ArtifactRecord): ChatGptOutputMetadata | null {
  if (!artifact.metadata || typeof artifact.metadata !== "object") return null;
  const metadata = artifact.metadata as Record<string, unknown>;
  if (metadata.source !== "chatgpt-extension") return null;
  return {
    source: "chatgpt-extension",
    inputImage: typeof metadata.inputImage === "string" ? metadata.inputImage : undefined,
    subjectIndex: typeof metadata.subjectIndex === "number" ? metadata.subjectIndex : undefined,
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

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}
