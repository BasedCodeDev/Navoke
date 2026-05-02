import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  extensionBridge,
  type ChatGptSubjectTaskMode,
  type ChatGptExtensionTaskTarget,
  type ExtensionClientStatus,
  type ExtensionTaskOutput,
  type ExtensionTaskResult
} from "../extension/extensionBridge";
import type { RunRecord, WorkflowContext, WorkflowDefinition } from "../runtime/types";
import { sleep } from "../utils/sleep";
import { inferMimeType, writeJson } from "../utils/files";

const selectorsSchema = z
  .object({
    fileInput: z.string().optional(),
    composer: z.string().optional(),
    submitButton: z.string().optional(),
    stopButton: z.string().optional(),
    outputImage: z.string().optional()
  })
  .default({});

const chatGptPageSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
  clientId: z.string().optional(),
  routingToken: z.string().optional(),
  capturedAt: z.string().min(1)
});

const outputMappingSchema = z.object({
  subjectIndex: z.number(),
  subjectImage: z.string(),
  pairId: z.string(),
  artifactId: z.string(),
  outputPath: z.string()
});

const pausedSubjectSchema = z.object({
  subjectIndex: z.number(),
  reason: z.string().optional(),
  baseline: z.unknown().optional(),
  captureDiagnostics: z.unknown().optional()
});

const checkpointSchema = z.object({
  setupCompleted: z.boolean(),
  completedSubjectIndexes: z.array(z.number()),
  outputMappings: z.array(outputMappingSchema),
  pausedSubject: pausedSubjectSchema.nullable().optional()
});

const inputSchema = z.object({
  referenceImages: z.array(z.string()).optional().default([]),
  subjectImages: z.array(z.string()).min(1, "Choose at least one subject image."),
  masterPrompt: z.string().min(1, "Master prompt is required."),
  subjectInstruction: z.string().optional().default(""),
  timeoutMinutes: z.number().min(1).max(240).optional().default(60),
  chatGptTab: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("any") }),
      z.object({
        mode: z.literal("existing"),
        clientId: z.string().trim().min(1, "Choose a ChatGPT tab."),
        url: z.string().trim().optional(),
        title: z.string().trim().optional()
      }),
      z.object({
        mode: z.literal("new"),
        routingToken: z.string().trim().min(8, "New-tab routing token is required."),
        url: z.string().trim().optional(),
        title: z.string().trim().optional()
      })
    ])
    .default({ mode: "any" }),
  selectors: selectorsSchema
});

const outputSchema = z.object({
  artifactIds: z.array(z.string()),
  summary: z.string(),
  chatGptPage: chatGptPageSchema.optional(),
  checkpoint: checkpointSchema.optional()
});

type ChatGptWorkflowInput = z.infer<typeof inputSchema>;
type ChatGptWorkflowOutput = z.infer<typeof outputSchema>;
type OutputMapping = z.infer<typeof outputMappingSchema>;
type PausedSubject = z.infer<typeof pausedSubjectSchema>;

interface RestoredOutputMapping {
  mapping: OutputMapping;
  output: ExtensionTaskOutput;
}

interface RestoredCheckpointState {
  artifactIds: string[];
  outputMappings: RestoredOutputMapping[];
  setupCompleted: boolean;
  chatGptPage?: z.infer<typeof chatGptPageSchema>;
  pausedSubject?: PausedSubject;
}

export const chatGptExtensionImageTransformWorkflow: WorkflowDefinition<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  manifest: {
    id: "chatgpt.extension-image-transform",
    title: "ChatGPT Extension Image Transform",
    description: "Uses the companion Chrome extension in your normal ChatGPT tab instead of Playwright.",
    category: "chatgpt",
    version: "0.1.0",
    concurrency: 1,
    requiresBrowser: false,
    targetUrl: "https://chatgpt.com/",
    outputKinds: ["image", "json"],
    inputFields: [
      { name: "referenceImages", label: "Reference images", type: "fileList" },
      { name: "subjectImages", label: "Subject images", type: "fileList", required: true },
      {
        name: "chatGptTab",
        label: "ChatGPT tab",
        type: "select",
        help: "Target a compatible open ChatGPT tab, or open a new tab for this run."
      },
      { name: "masterPrompt", label: "Master prompt", type: "textarea", required: true },
      { name: "subjectInstruction", label: "Per-subject instruction", type: "textarea" },
      {
        name: "selectors",
        label: "Selector config",
        type: "json",
        help: "Optional CSS selectors for file input, composer, submit button, stop button, and output image."
      }
    ]
  },
  inputSchema,
  outputSchema,
  canResumeFailedRun: canResumeFailedChatGptRun,
  async run(input, ctx) {
    const artifactIds: string[] = [];
    const artifactDir = ctx.artifactDir;
    const outputMappings: Array<{
      subjectIndex: number;
      subjectImage: string;
      pairId: string;
      artifactId: string;
      outputPath: string;
    }> = [];
    const usedOutputNames = new Set<string>();
    const outputKeysBySubject = new Map<number, string>();
    const registeredOutputs: ExtensionTaskOutput[] = [];
    let outputProcessing = Promise.resolve();
    let outputProcessingError: Error | undefined;
    let setupCompleted = false;
    let latestChatGptPage = buildChatGptPage(input.chatGptTab, undefined, undefined);
    let pausedSubject: z.infer<typeof pausedSubjectSchema> | undefined;

    const restored = restoreCheckpointState(ctx.previousOutput, input, artifactDir);
    for (const restoredArtifactId of restored.artifactIds) artifactIds.push(restoredArtifactId);
    for (const restoredMapping of restored.outputMappings) {
      outputMappings.push(restoredMapping.mapping);
      outputKeysBySubject.set(restoredMapping.output.subjectIndex, outputIdentityKey(restoredMapping.output));
      registeredOutputs.push(restoredMapping.output);
      usedOutputNames.add(path.basename(restoredMapping.mapping.outputPath));
    }
    setupCompleted = restored.setupCompleted;
    latestChatGptPage = restored.chatGptPage ?? latestChatGptPage;
    pausedSubject = restored.pausedSubject;

    const checkpointOutput = (summary: string): z.infer<typeof outputSchema> => ({
      artifactIds: [...artifactIds],
      summary,
      ...(latestChatGptPage ? { chatGptPage: latestChatGptPage } : {}),
      checkpoint: {
        setupCompleted,
        completedSubjectIndexes: [...outputKeysBySubject.keys()].sort((a, b) => a - b),
        outputMappings: [...outputMappings],
        pausedSubject: pausedSubject ?? null
      }
    });

    const persistCheckpointOutput = async (summary: string): Promise<void> => {
      await ctx.updateOutput(checkpointOutput(summary));
    };

    const manualActionData = (phase: string): Record<string, unknown> => ({
      phase,
      pausedSubject: pausedSubject ?? null,
      chatGptPage: latestChatGptPage ?? null,
      url: latestChatGptPage?.url ?? targetUrl(input.chatGptTab) ?? null,
      target: buildRecoverableTarget(input.chatGptTab, latestChatGptPage)
    });

    const registerOutputArtifact = async (output: ExtensionTaskOutput, taskId: string): Promise<void> => {
      const subjectIndex = output.subjectIndex;
      const subjectImage = input.subjectImages[subjectIndex];
      if (!Number.isInteger(subjectIndex) || !subjectImage) {
        throw new Error(`ChatGPT extension returned output for unknown subject index ${subjectIndex}.`);
      }
      if (typeof output.base64 !== "string" || output.base64.length === 0) {
        throw new Error(`ChatGPT extension returned an empty output image for subject ${subjectIndex + 1}.`);
      }

      const key = outputIdentityKey(output);
      const existingKey = outputKeysBySubject.get(subjectIndex);
      if (existingKey) {
        if (existingKey === key) return;
        throw new Error(
          `ChatGPT extension returned multiple distinct output images for subject ${subjectIndex + 1}. ` +
            "This workflow expects exactly one result per subject."
        );
      }
      outputKeysBySubject.set(subjectIndex, key);

      const pairId = `subject-${subjectIndex + 1}`;
      const mimeType = output.mimeType ?? "image/png";
      const extension = extensionForMimeType(mimeType);
      const outputPath = path.join(artifactDir, outputFileNameForSubject(subjectImage, subjectIndex, extension, usedOutputNames));
      fs.writeFileSync(outputPath, Buffer.from(output.base64, "base64"));
      const artifact = await ctx.addArtifact({
        kind: "image",
        name: path.basename(outputPath),
        path: outputPath,
        mimeType: inferMimeType(outputPath) ?? mimeType,
        metadata: {
          source: "chatgpt-extension",
          inputImage: subjectImage,
          subjectIndex,
          pairId,
          taskId,
          masterPrompt: input.masterPrompt,
          subjectInstruction: input.subjectInstruction,
          referenceImages: input.referenceImages,
          extensionMetadata: output.metadata ?? null
        }
      });
      artifactIds.push(artifact.id);
      outputMappings.push({ subjectIndex, subjectImage, pairId, artifactId: artifact.id, outputPath });
      registeredOutputs.push(output);
      await ctx.step(`Registered ChatGPT result ${outputMappings.length} of ${input.subjectImages.length}`, Math.min(95, 20 + (outputMappings.length / input.subjectImages.length) * 70), {
        subjectIndex,
        artifactId: artifact.id
      });
      await persistCheckpointOutput(`Processed ${outputMappings.length} of ${input.subjectImages.length} ChatGPT subject image(s).`);
    };

    const queueOutput = (output: ExtensionTaskOutput, taskId: string): void => {
      outputProcessing = outputProcessing.then(async () => {
        if (outputProcessingError) return;
        try {
          await registerOutputArtifact(output, taskId);
        } catch (error) {
          outputProcessingError = error instanceof Error ? error : new Error(String(error));
        }
      });
      void outputProcessing;
    };

    const waitForTargetAtCheckpoint = async (phase: string): Promise<{ target: ChatGptExtensionTaskTarget; client: ExtensionClientStatus }> => {
      let target = buildRecoverableTarget(input.chatGptTab, latestChatGptPage);
      let client = await waitForCompatibleTarget(target, ctx.signal, 45_000);
      while (!client) {
        await persistCheckpointOutput(`Waiting for ChatGPT tab before ${phase}.`);
        await ctx.waitForManualAction(
          `Open the tracked ChatGPT page, wait for the Based BLINK extension to reconnect, then resume this run.`,
          manualActionData(phase)
        );
        target = buildRecoverableTarget(input.chatGptTab, latestChatGptPage);
        client = await waitForCompatibleTarget(target, ctx.signal, 10_000);
      }
      const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
      if (page && page.url !== latestChatGptPage?.url) {
        latestChatGptPage = page;
        await persistCheckpointOutput(`Tracking ChatGPT page before ${phase}.`);
      }
      return { target, client };
    };

    const runPhaseTask = async (
      phase: "setup" | "subject",
      phaseLabel: string,
      phaseInput: {
        subjectMode?: ChatGptSubjectTaskMode;
        masterPrompt?: string;
        referenceImagePaths?: string[];
        subjectImagePath?: string;
        subjectIndex?: number;
        subjectBaseline?: unknown;
      }
    ): Promise<ExtensionTaskResult> => {
      while (true) {
        const { target, client } = await waitForTargetAtCheckpoint(phaseLabel);
        await ctx.step(`Queued ChatGPT ${phaseLabel} task`, phase === "setup" ? 5 : Math.min(90, 20 + ((phaseInput.subjectIndex ?? 0) / input.subjectImages.length) * 70), {
          phase,
          targetMode: target.mode,
          clientId: client.id,
          url: client.url
        });
        const task = extensionBridge.createChatGptConversationTask({
          runId: ctx.runId,
          phase,
          subjectMode: phaseInput.subjectMode,
          masterPrompt: phaseInput.masterPrompt,
          referenceImagePaths: phaseInput.referenceImagePaths,
          subjectImagePath: phaseInput.subjectImagePath,
          subjectIndex: phaseInput.subjectIndex,
          subjectInstruction: input.subjectInstruction,
          subjectBaseline: phaseInput.subjectBaseline,
          selectors: input.selectors,
          target
        });
        const unsubscribe = extensionBridge.subscribeTask(task.id, (event) => {
          void ctx.event("extension.task", event.message, {
            taskId: event.taskId,
            type: event.type,
            data: event.data
          });
        });
        const unsubscribeOutput = extensionBridge.subscribeTaskOutput(task.id, (output) => queueOutput(output, task.id));
        try {
          const result = await waitForTaskWithRecoverableTarget(task.id, target, ctx, input.timeoutMinutes * 60_000, async (client) => {
            const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
            if (page && page.url !== latestChatGptPage?.url) {
              latestChatGptPage = page;
              await persistCheckpointOutput(`Tracking ChatGPT page during ${phaseLabel}.`);
            }
          });
          for (const output of result.outputs) {
            queueOutput(output, task.id);
          }
          await outputProcessing;
          if (outputProcessingError) throw outputProcessingError;
          latestChatGptPage = buildChatGptPage(target, result.metadata, client) ?? latestChatGptPage;
          const pausedMetadata = readPausedTaskMetadata(result.metadata);
          if (pausedMetadata && phase === "subject" && phaseInput.subjectIndex !== undefined) {
            pausedSubject = {
              subjectIndex: phaseInput.subjectIndex,
              ...(pausedMetadata.reason ? { reason: pausedMetadata.reason } : {}),
              ...(pausedMetadata.baseline !== undefined ? { baseline: pausedMetadata.baseline } : {}),
              ...(pausedMetadata.captureDiagnostics !== undefined
                ? { captureDiagnostics: pausedMetadata.captureDiagnostics }
                : {})
            };
            await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
            await ctx.waitForManualAction(
              `Paused during ChatGPT ${phaseLabel}. Resume will try to capture the current page output before resubmitting this subject.`,
              manualActionData(phaseLabel)
            );
            return result;
          }
          await persistCheckpointOutput(`Completed ChatGPT ${phaseLabel} task.`);
          return result;
        } catch (error) {
          if (error instanceof ImmediateChatGptPauseError) {
            if (phase === "subject" && phaseInput.subjectIndex !== undefined) {
              pausedSubject = {
                subjectIndex: phaseInput.subjectIndex,
                reason:
                  "Paused immediately. Resume will inspect the current ChatGPT page for an output before resubmitting this subject.",
                ...(phaseInput.subjectBaseline !== undefined ? { baseline: phaseInput.subjectBaseline } : {})
              };
              await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
              await ctx.waitForManualAction(
                `Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume. Resume will inspect the current page for an output before resubmitting this subject.`,
                manualActionData(phaseLabel)
              );
              return {
                outputs: [],
                metadata: {
                  paused: true,
                  pauseReason: pausedSubject.reason,
                  ...(phaseInput.subjectBaseline !== undefined ? { subjectBaseline: phaseInput.subjectBaseline } : {})
                }
              };
            }
            await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
            await ctx.waitForManualAction(
              `Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume this run.`,
              manualActionData(phaseLabel)
            );
            continue;
          }
          if (error instanceof MissingChatGptTabError) {
            await persistCheckpointOutput(`ChatGPT tab disconnected during ${phaseLabel}.`);
            await ctx.waitForManualAction(
              `The ChatGPT tab disconnected during ${phaseLabel}. Open the tracked ChatGPT page, wait for the extension to reconnect, then resume this run.`,
              manualActionData(phaseLabel)
            );
            continue;
          }
          throw error;
        } finally {
          unsubscribeOutput();
          unsubscribe();
        }
      }
    };

    await persistCheckpointOutput("Preparing ChatGPT extension workflow.");
    if (!setupCompleted) {
      await ctx.pauseIfRequested("Paused before ChatGPT setup.", manualActionData("setup"));
      await runPhaseTask("setup", "setup", {
        masterPrompt: input.masterPrompt,
        referenceImagePaths: input.referenceImages
      });
      setupCompleted = true;
      await persistCheckpointOutput("ChatGPT setup completed.");
      await ctx.pauseIfRequested("Paused after ChatGPT setup.", manualActionData("setup"));
    } else {
      await persistCheckpointOutput("ChatGPT setup restored from checkpoint.");
    }

    for (const [subjectIndex, subjectImagePath] of input.subjectImages.entries()) {
      if (outputKeysBySubject.has(subjectIndex)) continue;
      const phaseLabel = `subject ${subjectIndex + 1}`;
      await ctx.pauseIfRequested(`Paused before ChatGPT ${phaseLabel}.`, manualActionData(phaseLabel));
      while (!outputKeysBySubject.has(subjectIndex)) {
        if (pausedSubject?.subjectIndex === subjectIndex) {
          const captureBaseline = pausedSubject.baseline;
          pausedSubject = undefined;
          await runPhaseTask("subject", `${phaseLabel} capture`, {
            subjectMode: "capture-existing",
            subjectImagePath,
            subjectIndex,
            ...(captureBaseline !== undefined ? { subjectBaseline: captureBaseline } : {})
          });
          await outputProcessing;
          if (outputProcessingError) throw outputProcessingError;
          if (outputKeysBySubject.has(subjectIndex)) break;
          await ctx.event(
            "chatgpt.capture_existing.missed",
            `Could not capture an existing ChatGPT output for ${phaseLabel}; resubmitting the subject.`
          );
        }

        await runPhaseTask("subject", phaseLabel, {
          subjectMode: "submit-and-capture",
          subjectImagePath,
          subjectIndex
        });
        await outputProcessing;
        if (outputProcessingError) throw outputProcessingError;
        if (pausedSubject?.subjectIndex === subjectIndex && !outputKeysBySubject.has(subjectIndex)) continue;
        if (!outputKeysBySubject.has(subjectIndex)) {
          throw new Error(`ChatGPT extension did not return an output image for subject ${subjectIndex + 1}.`);
        }
      }
      await ctx.pauseIfRequested(`Paused after ChatGPT ${phaseLabel}.`, manualActionData(phaseLabel));
    }

    normalizeChatGptExtensionOutputs(registeredOutputs, input.subjectImages);

    const manifestPath = path.join(artifactDir, "chatgpt-extension-manifest.json");
    writeJson(manifestPath, {
      masterPrompt: input.masterPrompt,
      referenceImages: input.referenceImages,
      subjectImages: input.subjectImages,
      subjectInstruction: input.subjectInstruction,
      chatGptTab: redactTargetForManifest(input.chatGptTab),
      chatGptPage: latestChatGptPage ?? null,
      selectors: input.selectors,
      outputMappings
    });
    const manifest = await ctx.addArtifact({
      kind: "json",
      name: path.basename(manifestPath),
      path: manifestPath,
      mimeType: "application/json"
    });
    artifactIds.push(manifest.id);

    return {
      artifactIds,
      ...(latestChatGptPage ? { chatGptPage: latestChatGptPage } : {}),
      checkpoint: {
        setupCompleted,
        completedSubjectIndexes: [...outputKeysBySubject.keys()].sort((a, b) => a - b),
        outputMappings,
        pausedSubject: pausedSubject ?? null
      },
      summary: `Processed ${input.subjectImages.length} subject image(s) through the ChatGPT Chrome extension.`
    };
  }
};

export function canResumeFailedChatGptRun(run: RunRecord): boolean {
  if (run.status !== "failed" || run.workflowId !== "chatgpt.extension-image-transform") return false;
  const parsedInput = inputSchema.safeParse(run.input);
  if (!parsedInput.success) return false;

  const output = readStoredOutput(run.output);
  if (output?.checkpoint || output?.chatGptPage) return true;
  return Boolean(targetUrl(parsedInput.data.chatGptTab));
}

function readStoredOutput(value: unknown): ChatGptWorkflowOutput | null {
  const parsed = outputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function restoreCheckpointState(
  previousOutput: unknown,
  input: ChatGptWorkflowInput,
  artifactDir: string
): RestoredCheckpointState {
  const output = readStoredOutput(previousOutput);
  if (!output) {
    return { artifactIds: [], outputMappings: [], setupCompleted: false };
  }

  const restoredMappings: RestoredOutputMapping[] = [];
  const artifactIds = new Set<string>();
  for (const mapping of output.checkpoint?.outputMappings ?? []) {
    const restored = restoreOutputMapping(mapping, input, artifactDir);
    if (!restored) continue;
    artifactIds.add(restored.mapping.artifactId);
    restoredMappings.push(restored);
  }

  const completedSubjects = new Set(restoredMappings.map((mapping) => mapping.output.subjectIndex));
  const setupCompleted = Boolean(output.checkpoint?.setupCompleted);
  const pausedSubject = resolvePausedSubjectForResume(output.checkpoint?.pausedSubject, input, completedSubjects, setupCompleted);

  return {
    artifactIds: [...artifactIds],
    outputMappings: restoredMappings,
    setupCompleted,
    ...(output.chatGptPage ? { chatGptPage: output.chatGptPage } : {}),
    ...(pausedSubject ? { pausedSubject } : {})
  };
}

function restoreOutputMapping(
  mapping: OutputMapping,
  input: ChatGptWorkflowInput,
  artifactDir: string
): RestoredOutputMapping | null {
  if (!Number.isInteger(mapping.subjectIndex)) return null;
  if (input.subjectImages[mapping.subjectIndex] !== mapping.subjectImage) return null;
  if (!mapping.outputPath || !fs.existsSync(mapping.outputPath)) return null;

  const outputPath = path.resolve(mapping.outputPath);
  const resolvedArtifactDir = path.resolve(artifactDir);
  if (outputPath !== resolvedArtifactDir && !outputPath.startsWith(`${resolvedArtifactDir}${path.sep}`)) return null;

  const mimeType = inferMimeType(outputPath) ?? "image/png";
  return {
    mapping,
    output: {
      subjectIndex: mapping.subjectIndex,
      subjectName: path.basename(mapping.subjectImage),
      name: path.basename(outputPath),
      mimeType,
      base64: fs.readFileSync(outputPath).toString("base64"),
      metadata: {
        source: "restored-checkpoint",
        artifactId: mapping.artifactId,
        outputPath
      }
    }
  };
}

function resolvePausedSubjectForResume(
  storedPausedSubject: PausedSubject | null | undefined,
  input: ChatGptWorkflowInput,
  completedSubjects: Set<number>,
  setupCompleted: boolean
): PausedSubject | undefined {
  if (!setupCompleted) return undefined;
  if (
    storedPausedSubject &&
    Number.isInteger(storedPausedSubject.subjectIndex) &&
    input.subjectImages[storedPausedSubject.subjectIndex] &&
    !completedSubjects.has(storedPausedSubject.subjectIndex)
  ) {
    return storedPausedSubject;
  }

  const firstUnfinished = input.subjectImages.findIndex((_subject, index) => !completedSubjects.has(index));
  if (firstUnfinished < 0) return undefined;
  return {
    subjectIndex: firstUnfinished,
    reason:
      "Resuming a failed ChatGPT run. Resume will inspect the current page for an output before resubmitting this subject."
  };
}

async function waitForCompatibleTarget(
  target: ChatGptExtensionTaskTarget,
  signal: AbortSignal,
  timeoutMs: number
): Promise<ExtensionClientStatus | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const client = extensionBridge.findCompatibleClientForTarget(target);
    if (client) return client;
    await sleep(1_000, signal);
  }
  return undefined;
}

class MissingChatGptTabError extends Error {
  constructor() {
    super("ChatGPT tab disconnected before the extension task completed.");
  }
}

class ImmediateChatGptPauseError extends Error {
  constructor() {
    super("ChatGPT run paused; active extension task was abandoned.");
  }
}

async function waitForTaskWithRecoverableTarget(
  taskId: string,
  target: ChatGptExtensionTaskTarget,
  ctx: WorkflowContext,
  timeoutMs: number,
  onClientSeen?: (client: ExtensionClientStatus) => Promise<void>
): Promise<ExtensionTaskResult> {
  let missingSince: number | null = null;
  let taskPauseRequested = false;
  let settled = false;
  const wait = extensionBridge
    .waitForTask(taskId, {
      signal: ctx.signal,
      timeoutMs
    })
    .finally(() => {
      settled = true;
    });

  while (!settled) {
    const tick = sleep(1_000, ctx.signal).then(() => null);
    const result = await Promise.race([wait, tick]);
    if (result) return result;

    if (ctx.isPauseRequested() && !taskPauseRequested) {
      extensionBridge.requestTaskPause(taskId);
      taskPauseRequested = true;
      extensionBridge.cancelTask(taskId);
      await wait.catch(() => undefined);
      throw new ImmediateChatGptPauseError();
    }

    const client = extensionBridge.findCompatibleClientForTarget(target);
    if (client) {
      await onClientSeen?.(client);
      missingSince = null;
      continue;
    }

    missingSince ??= Date.now();
    if (Date.now() - missingSince > 45_000) {
      extensionBridge.cancelTask(taskId);
      await wait.catch(() => undefined);
      throw new MissingChatGptTabError();
    }
  }

  return wait;
}

function buildRecoverableTarget(
  target: ChatGptExtensionTaskTarget,
  page: z.infer<typeof chatGptPageSchema> | undefined
): ChatGptExtensionTaskTarget {
  const url = page?.url ?? targetUrl(target);
  const title = page?.title ?? targetTitle(target);
  if (target.mode === "existing") {
    return {
      mode: "existing",
      clientId: page?.clientId ?? target.clientId,
      ...(url ? { url } : {}),
      ...(title ? { title } : {})
    };
  }
  if (target.mode === "new") {
    return {
      mode: "new",
      routingToken: page?.routingToken ?? target.routingToken,
      ...(url ? { url } : {}),
      ...(title ? { title } : {})
    };
  }
  return target;
}

function targetUrl(target: ChatGptExtensionTaskTarget): string | undefined {
  return target.mode === "existing" || target.mode === "new" ? target.url : undefined;
}

function targetTitle(target: ChatGptExtensionTaskTarget): string | undefined {
  return target.mode === "existing" || target.mode === "new" ? target.title : undefined;
}

function redactTargetForManifest(target: ChatGptExtensionTaskTarget): Record<string, string> {
  if (target.mode === "existing") return { mode: target.mode, clientId: target.clientId };
  return { mode: target.mode };
}

export function buildChatGptPage(
  target: ChatGptExtensionTaskTarget,
  metadata: unknown,
  targetClient?: ExtensionClientStatus
): z.infer<typeof chatGptPageSchema> | undefined {
  const pageMetadata = readPageMetadata(metadata);
  const targetRecord = target as Partial<{ url: string; title: string; routingToken: string; clientId: string }>;
  const url = firstNonEmptyString(pageMetadata.url, targetClient?.url, targetRecord.url);
  if (!url) return undefined;

  const title = firstNonEmptyString(pageMetadata.title, targetClient?.title, targetRecord.title);
  const clientId = firstNonEmptyString(targetClient?.id, target.mode === "existing" ? target.clientId : undefined);
  const routingToken = firstNonEmptyString(
    target.mode === "new" ? target.routingToken : undefined,
    targetClient?.routingToken
  );

  return {
    url,
    ...(title ? { title } : {}),
    ...(clientId ? { clientId } : {}),
    ...(routingToken ? { routingToken } : {}),
    capturedAt: new Date().toISOString()
  };
}

function readPageMetadata(metadata: unknown): { url?: string; title?: string } {
  if (!metadata || typeof metadata !== "object") return {};
  const record = metadata as Record<string, unknown>;
  return {
    url: typeof record.url === "string" ? record.url : undefined,
    title: typeof record.title === "string" ? record.title : undefined
  };
}

function readPausedTaskMetadata(metadata: unknown): {
  reason?: string;
  baseline?: unknown;
  captureDiagnostics?: unknown;
} | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  if (record.paused !== true) return null;
  return {
    reason: typeof record.pauseReason === "string" ? record.pauseReason : undefined,
    baseline: record.subjectBaseline,
    captureDiagnostics: record.captureDiagnostics
  };
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg") return "jpg";
  return "png";
}

function safeStem(filePath: string): string {
  return path.parse(path.basename(filePath)).name.replace(/[^\w.-]+/g, "_") || "subject";
}

function outputFileNameForSubject(subjectImage: string, subjectIndex: number, extension: string, usedNames: Set<string>): string {
  const baseName = `${safeStem(subjectImage)}-chatgpt`;
  let candidate = `${baseName}.${extension}`;
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }

  candidate = `${baseName}-${subjectIndex + 1}.${extension}`;
  let duplicate = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${subjectIndex + 1}-${duplicate}.${extension}`;
    duplicate += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

export function normalizeChatGptExtensionOutputs(
  outputs: ExtensionTaskResult["outputs"],
  subjectImages: string[]
): Array<{
  subjectIndex: number;
  subjectImage: string;
  pairId: string;
  output: ExtensionTaskResult["outputs"][number];
}> {
  const outputsBySubject = new Map<number, Map<string, ExtensionTaskResult["outputs"][number]>>();

  for (const output of outputs) {
    const subjectIndex = output.subjectIndex;
    if (!Number.isInteger(subjectIndex)) {
      throw new Error("ChatGPT extension returned an output without a valid subject index.");
    }
    if (!subjectImages[subjectIndex]) {
      throw new Error(`ChatGPT extension returned output for unknown subject index ${subjectIndex}.`);
    }
    if (typeof output.base64 !== "string" || output.base64.length === 0) {
      throw new Error(`ChatGPT extension returned an empty output image for subject ${subjectIndex + 1}.`);
    }

    const subjectOutputs = outputsBySubject.get(subjectIndex) ?? new Map<string, ExtensionTaskResult["outputs"][number]>();
    subjectOutputs.set(outputIdentityKey(output), subjectOutputs.get(outputIdentityKey(output)) ?? output);
    outputsBySubject.set(subjectIndex, subjectOutputs);
  }

  return subjectImages.map((subjectImage, subjectIndex) => {
    const subjectOutputs = [...(outputsBySubject.get(subjectIndex)?.values() ?? [])];
    if (subjectOutputs.length === 0) {
      throw new Error(`ChatGPT extension did not return an output image for subject ${subjectIndex + 1}.`);
    }
    if (subjectOutputs.length > 1) {
      throw new Error(
        `ChatGPT extension returned ${subjectOutputs.length} distinct output images for subject ${subjectIndex + 1}. ` +
          "This workflow expects exactly one result per subject."
      );
    }
    return {
      subjectIndex,
      subjectImage,
      pairId: `subject-${subjectIndex + 1}`,
      output: subjectOutputs[0]
    };
  });
}

function outputIdentityKey(output: ExtensionTaskResult["outputs"][number]): string {
  const hash = createHash("sha256").update(output.base64).digest("hex");
  return `${output.mimeType ?? "image/png"}:${hash}`;
}
