import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type * as zod from "zod";
import type {
  ChatGptExtensionTaskTarget,
  ChatGptSubjectTaskMode,
  ExtensionClientStatus,
  ExtensionTaskOutput,
  ExtensionTaskResult,
  RunRecord,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowSdk
} from "./sdkTypes";

export interface ChatGptPage {
  url: string;
  title?: string;
  clientId?: string;
  routingToken?: string;
  controllerId?: string;
  tabId?: number;
  windowId?: number;
  capturedAt: string;
}

const CHATGPT_NEW_TAB_URL = "https://chatgpt.com/";
const EXTENSION_TAB_ROUTING_PARAM = "based-blink-tab";

function buildNewExtensionTabUrl(routingToken: string): string {
  const url = new URL(CHATGPT_NEW_TAB_URL);
  url.hash = `${EXTENSION_TAB_ROUTING_PARAM}=${encodeURIComponent(routingToken)}`;
  return url.toString();
}

function createDefaultExtensionTabTarget(): { mode: "new"; routingToken: string; url: string; openMode: "window" } {
  const routingToken = randomUUID();
  return { mode: "new", routingToken, url: buildNewExtensionTabUrl(routingToken), openMode: "window" };
}

export function createWorkflows(sdk: WorkflowSdk): WorkflowDefinition[] {
  const { z } = sdk.schema;
  const chatgpt = createChatGptBrowserController(sdk.extension.browser, sdk.sleep);
  const sleep = sdk.sleep;
  const { inferMimeType, writeJson } = sdk.files;

const selectorsSchema = z
  .object({
    fileInput: z.string().optional(),
    composer: z.string().optional(),
    submitButton: z.string().optional(),
    stopButton: z.string().optional(),
    removeAttachmentButton: z.string().optional(),
    outputImage: z.string().optional()
  })
  .default({});

const chatGptPageSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
  clientId: z.string().optional(),
  routingToken: z.string().optional(),
  controllerId: z.string().optional(),
  tabId: z.number().optional(),
  windowId: z.number().optional(),
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

const extensionTabSchema = z
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
      title: z.string().trim().optional(),
      openMode: z.enum(["window", "tab"]).optional().default("window")
    })
  ])
  .default(createDefaultExtensionTabTarget);

const inputSchema = z.object({
  referenceImages: z.array(z.string()).optional().default([]),
  subjectImages: z.array(z.string()).min(1, "Choose at least one subject image."),
  masterPrompt: z.string().min(1, "Master prompt is required."),
  subjectInstruction: z.string().optional().default(""),
  timeoutMinutes: z.number().min(1).max(240).optional().default(60),
  extensionTab: extensionTabSchema,
  selectors: selectorsSchema
});

const outputSchema = z.object({
  artifactIds: z.array(z.string()),
  summary: z.string(),
  chatGptPage: chatGptPageSchema.optional(),
  checkpoint: checkpointSchema.optional()
});

const sequenceOutputMappingSchema = z.object({
  promptIndex: z.number(),
  prompt: z.string(),
  inputImage: z.string(),
  pairId: z.string(),
  artifactId: z.string(),
  outputPath: z.string()
});

const pausedPromptSchema = z.object({
  promptIndex: z.number(),
  inputImage: z.string().optional(),
  reason: z.string().optional(),
  baseline: z.unknown().optional(),
  captureDiagnostics: z.unknown().optional()
});

const sequenceCheckpointSchema = z.object({
  setupCompleted: z.boolean(),
  completedPromptIndexes: z.array(z.number()),
  outputMappings: z.array(sequenceOutputMappingSchema),
  pausedPrompt: pausedPromptSchema.nullable().optional()
});

const promptSequenceSchema = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value
          .map((item) => (typeof item === "string" ? item.trim() : item))
          .filter((item) => typeof item !== "string" || item.length > 0)
      : value,
  z.array(z.string().min(1)).min(1, "Add at least one prompt.")
);

const sequenceInputSchema = z.object({
  sourceImages: z.array(z.string()).length(1, "Choose exactly one source image."),
  prompts: promptSequenceSchema,
  masterPrompt: z.string().optional().default("").transform((value) => value.trim()),
  masterPromptSuffix: z.string().optional().default("").transform((value) => value.trim()),
  timeoutMinutes: z.number().min(1).max(240).optional().default(60),
  extensionTab: extensionTabSchema,
  selectors: selectorsSchema
});

const sequenceOutputSchema = z.object({
  artifactIds: z.array(z.string()),
  summary: z.string(),
  chatGptPage: chatGptPageSchema.optional(),
  checkpoint: sequenceCheckpointSchema.optional()
});

const promptImageOutputMappingSchema = z.object({
  prompt: z.string(),
  pairId: z.string(),
  artifactId: z.string(),
  outputPath: z.string()
});

const pausedPromptImageSchema = z.object({
  reason: z.string().optional(),
  baseline: z.unknown().optional(),
  captureDiagnostics: z.unknown().optional()
});

const promptImageCheckpointSchema = z.object({
  completed: z.boolean(),
  outputMapping: promptImageOutputMappingSchema.nullable().optional(),
  pausedPrompt: pausedPromptImageSchema.nullable().optional()
});

const promptImageInputSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required."),
  timeoutMinutes: z.number().min(1).max(240).optional().default(60),
  extensionTab: extensionTabSchema,
  selectors: selectorsSchema
});

const promptImageOutputSchema = z.object({
  artifactIds: z.array(z.string()),
  summary: z.string(),
  chatGptPage: chatGptPageSchema.optional(),
  checkpoint: promptImageCheckpointSchema.optional()
});

type ChatGptWorkflowInput = zod.infer<typeof inputSchema>;
type ChatGptWorkflowOutput = zod.infer<typeof outputSchema>;
type OutputMapping = zod.infer<typeof outputMappingSchema>;
type PausedSubject = zod.infer<typeof pausedSubjectSchema>;
type ChatGptSequenceWorkflowInput = zod.infer<typeof sequenceInputSchema>;
type ChatGptSequenceWorkflowOutput = zod.infer<typeof sequenceOutputSchema>;
type SequenceOutputMapping = zod.infer<typeof sequenceOutputMappingSchema>;
type PausedPrompt = zod.infer<typeof pausedPromptSchema>;
type ChatGptPromptImageWorkflowInput = zod.infer<typeof promptImageInputSchema>;
type ChatGptPromptImageWorkflowOutput = zod.infer<typeof promptImageOutputSchema>;
type PromptImageOutputMapping = zod.infer<typeof promptImageOutputMappingSchema>;
type PausedPromptImage = zod.infer<typeof pausedPromptImageSchema>;

interface RestoredOutputMapping {
  mapping: OutputMapping;
  output: ExtensionTaskOutput;
}

interface RestoredCheckpointState {
  artifactIds: string[];
  outputMappings: RestoredOutputMapping[];
  setupCompleted: boolean;
  chatGptPage?: ChatGptPage;
  pausedSubject?: PausedSubject;
}

interface RestoredSequenceOutputMapping {
  mapping: SequenceOutputMapping;
  output: ExtensionTaskOutput;
}

interface RestoredSequenceCheckpointState {
  artifactIds: string[];
  outputMappings: RestoredSequenceOutputMapping[];
  setupCompleted: boolean;
  chatGptPage?: ChatGptPage;
  pausedPrompt?: PausedPrompt;
}

interface RestoredPromptImageCheckpointState {
  artifactIds: string[];
  outputMapping?: PromptImageOutputMapping;
  output?: ExtensionTaskOutput;
  chatGptPage?: ChatGptPage;
  pausedPrompt?: PausedPromptImage;
}

const chatGptExtensionImageTransformWorkflow: WorkflowDefinition<
  zod.infer<typeof inputSchema>,
  zod.infer<typeof outputSchema>
> = {
  manifest: {
    id: "based-blink.chatgpt.extension-image-transform",
    title: "ChatGPT Extension Image Transform",
    description: "Uses the companion Chrome extension in your normal ChatGPT tab instead of Playwright.",
    category: "chatgpt",
    version: "0.1.0",
    concurrency: 1,
    requiresBrowser: false,
    targetUrl: "https://chatgpt.com/",
    outputKinds: ["image", "json"],
    uiCapabilities: ["extension.tabRouting", "extension.focusTarget"],
    inputFields: [
      { name: "referenceImages", label: "Reference images", type: "fileList" },
      { name: "subjectImages", label: "Subject images", type: "fileList", required: true },
      {
        name: "extensionTab",
        label: "ChatGPT tab",
        type: "select",
        help: "Target a compatible open ChatGPT tab, or open a new extension-owned window for this run."
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
    let latestChatGptPage = buildChatGptPage(input.extensionTab, undefined, undefined);
    let pausedSubject: zod.infer<typeof pausedSubjectSchema> | undefined;

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

    const checkpointOutput = (summary: string): zod.infer<typeof outputSchema> => ({
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
      url: latestChatGptPage?.url ?? targetUrl(input.extensionTab) ?? null,
      target: buildRecoverableTarget(input.extensionTab, latestChatGptPage)
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
      while (true) {
        const target = buildRecoverableTarget(input.extensionTab, latestChatGptPage);
        try {
          const client = await chatgpt.ensureRoutedTab(target, { signal: ctx.signal, timeoutMs: 45_000 });
          const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
          if (page && chatGptPageChanged(page, latestChatGptPage)) {
            latestChatGptPage = page;
            await persistCheckpointOutput(`Tracking ChatGPT page before ${phase}.`);
          }
          const recoverableTarget = buildRecoverableTarget(target, page);
          try {
            await chatgpt.focusTarget(recoverableTarget, { signal: ctx.signal, timeoutMs: 10_000 });
          } catch (focusError) {
            if (isOperationCancelled(focusError)) throw focusError;
            await ctx.event("extension.focus", "Could not focus ChatGPT browser surface before task.", {
              phase,
              message: focusError instanceof Error ? focusError.message : String(focusError)
            });
          }
          return { target: recoverableTarget, client };
        } catch (error) {
          await persistCheckpointOutput(`Waiting for ChatGPT browser controller before ${phase}.`);
          await ctx.waitForManualAction(chatGptControllerManualMessage(error), manualActionData(phase));
        }
      }
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
        const task = chatgpt.createConversationTask({
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
        let submittedBaseline = phaseInput.subjectBaseline;
        let promptSubmitted = false;
        const unsubscribe = chatgpt.subscribeTask(task.id, (event) => {
          const eventData = normalizeRecord(event.data);
          if (event.type === "browser.task.output_baseline" && eventData.baseline !== undefined) {
            submittedBaseline = eventData.baseline;
          }
          if (event.type === "browser.task.prompt_submitted") {
            promptSubmitted = true;
          }
          void ctx.event("extension.task", event.message, {
            taskId: event.taskId,
            type: event.type,
            data: event.data
          });
        });
        const unsubscribeOutput = chatgpt.subscribeTaskOutput(task.id, (output) => queueOutput(output, task.id));
        try {
          const result = await waitForTaskWithRecoverableTarget(task.id, target, ctx, input.timeoutMinutes * 60_000, async (client) => {
            const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
            if (page && chatGptPageChanged(page, latestChatGptPage)) {
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
          if (error instanceof MissingExtensionTabError) {
            if (phase === "subject" && phaseInput.subjectIndex !== undefined && (promptSubmitted || submittedBaseline !== undefined)) {
              pausedSubject = {
                subjectIndex: phaseInput.subjectIndex,
                reason:
                  "ChatGPT tab disconnected after subject submission started. Resume will inspect the current page for an output before resubmitting this subject.",
                ...(submittedBaseline !== undefined ? { baseline: submittedBaseline } : {})
              };
              await persistCheckpointOutput(`ChatGPT tab disconnected after ${phaseLabel} submit; checking for existing output.`);
              return {
                outputs: [],
                metadata: {
                  paused: true,
                  pauseReason: pausedSubject.reason,
                  ...(submittedBaseline !== undefined ? { subjectBaseline: submittedBaseline } : {})
                }
              };
            }
            await persistCheckpointOutput(`ChatGPT tab disconnected during ${phaseLabel}.`);
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
          if (pausedSubject) continue;
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
      extensionTab: redactTargetForManifest(input.extensionTab),
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

const chatGptExtensionImageSequenceWorkflow: WorkflowDefinition<
  zod.infer<typeof sequenceInputSchema>,
  zod.infer<typeof sequenceOutputSchema>
> = {
  manifest: {
    id: "based-blink.chatgpt.extension-image-sequence",
    title: "ChatGPT Extension Image Prompt Sequence",
    description: "Runs a chain of prompts against one image through the companion Chrome extension.",
    category: "chatgpt",
    version: "0.1.0",
    concurrency: 1,
    requiresBrowser: false,
    targetUrl: "https://chatgpt.com/",
    outputKinds: ["image", "json"],
    uiCapabilities: ["extension.tabRouting", "extension.focusTarget"],
    inputFields: [
      { name: "sourceImages", label: "Source image", type: "fileList", required: true },
      {
        name: "extensionTab",
        label: "ChatGPT tab",
        type: "select",
        help: "Target a compatible open ChatGPT tab, or open a new extension-owned window for this run."
      },
      {
        name: "masterPrompt",
        label: "Setup prompt",
        type: "textarea",
        help: "Optional global setup sent with the source image before the prompt sequence."
      },
      {
        name: "masterPromptSuffix",
        label: "Setup prompt suffix",
        type: "textarea",
        help: "Optional text appended to the setup prompt before submission."
      },
      {
        name: "prompts",
        label: "Prompt sequence",
        type: "json",
        required: true,
        help: "Ordered prompts. Each prompt receives the previous generated result as its input."
      },
      {
        name: "selectors",
        label: "Selector config",
        type: "json",
        help: "Optional CSS selectors for file input, composer, submit button, stop button, and output image."
      }
    ]
  },
  inputSchema: sequenceInputSchema,
  outputSchema: sequenceOutputSchema,
  canResumeFailedRun: canResumeFailedChatGptSequenceRun,
  async run(input, ctx) {
    const artifactIds: string[] = [];
    const artifactDir = ctx.artifactDir;
    const sourceImage = input.sourceImages[0];
    const outputMappings: SequenceOutputMapping[] = [];
    const usedOutputNames = new Set<string>();
    const outputKeysByPrompt = new Map<number, string>();
    const outputPathsByPrompt = new Map<number, string>();
    const inputImagesByPrompt = new Map<number, string>();
    const registeredOutputs: ExtensionTaskOutput[] = [];
    let outputProcessing = Promise.resolve();
    let outputProcessingError: Error | undefined;
    let setupCompleted = false;
    let latestChatGptPage = buildChatGptPage(input.extensionTab, undefined, undefined);
    let pausedPrompt: PausedPrompt | undefined;

    const restored = restoreSequenceCheckpointState(ctx.previousOutput, input, artifactDir);
    for (const restoredArtifactId of restored.artifactIds) artifactIds.push(restoredArtifactId);
    for (const restoredMapping of restored.outputMappings) {
      outputMappings.push(restoredMapping.mapping);
      outputKeysByPrompt.set(restoredMapping.output.subjectIndex, outputIdentityKey(restoredMapping.output));
      outputPathsByPrompt.set(restoredMapping.mapping.promptIndex, restoredMapping.mapping.outputPath);
      inputImagesByPrompt.set(restoredMapping.mapping.promptIndex, restoredMapping.mapping.inputImage);
      registeredOutputs.push(restoredMapping.output);
      usedOutputNames.add(path.basename(restoredMapping.mapping.outputPath));
    }
    setupCompleted = restored.setupCompleted;
    latestChatGptPage = restored.chatGptPage ?? latestChatGptPage;
    pausedPrompt = restored.pausedPrompt;

    const checkpointOutput = (summary: string): ChatGptSequenceWorkflowOutput => ({
      artifactIds: [...artifactIds],
      summary,
      ...(latestChatGptPage ? { chatGptPage: latestChatGptPage } : {}),
      checkpoint: {
        setupCompleted,
        completedPromptIndexes: [...outputKeysByPrompt.keys()].sort((a, b) => a - b),
        outputMappings: [...outputMappings],
        pausedPrompt: pausedPrompt ?? null
      }
    });

    const persistCheckpointOutput = async (summary: string): Promise<void> => {
      await ctx.updateOutput(checkpointOutput(summary));
    };

    const manualActionData = (phase: string): Record<string, unknown> => ({
      phase,
      pausedPrompt: pausedPrompt ?? null,
      chatGptPage: latestChatGptPage ?? null,
      url: latestChatGptPage?.url ?? targetUrl(input.extensionTab) ?? null,
      target: buildRecoverableTarget(input.extensionTab, latestChatGptPage)
    });

    const registerOutputArtifact = async (output: ExtensionTaskOutput, taskId: string): Promise<void> => {
      const promptIndex = output.subjectIndex;
      const prompt = input.prompts[promptIndex];
      if (!Number.isInteger(promptIndex) || !prompt) {
        throw new Error(`ChatGPT extension returned output for unknown prompt index ${promptIndex}.`);
      }
      if (typeof output.base64 !== "string" || output.base64.length === 0) {
        throw new Error(`ChatGPT extension returned an empty output image for prompt ${promptIndex + 1}.`);
      }

      const key = outputIdentityKey(output);
      const existingKey = outputKeysByPrompt.get(promptIndex);
      if (existingKey) {
        if (existingKey === key) return;
        throw new Error(
          `ChatGPT extension returned multiple distinct output images for prompt ${promptIndex + 1}. ` +
            "This workflow expects exactly one result per prompt."
        );
      }
      outputKeysByPrompt.set(promptIndex, key);

      const pairId = `prompt-${promptIndex + 1}`;
      const mimeType = output.mimeType ?? "image/png";
      const extension = extensionForMimeType(mimeType);
      const inputImage = inputImagesByPrompt.get(promptIndex) ?? sourceImage;
      const outputPath = path.join(artifactDir, outputFileNameForPrompt(sourceImage, promptIndex, extension, usedOutputNames));
      fs.writeFileSync(outputPath, Buffer.from(output.base64, "base64"));
      const artifact = await ctx.addArtifact({
        kind: "image",
        name: path.basename(outputPath),
        path: outputPath,
        mimeType: inferMimeType(outputPath) ?? mimeType,
        metadata: {
          source: "chatgpt-extension",
          workflowKind: "image-sequence",
          sourceImage,
          inputImage,
          promptIndex,
          prompt,
          pairId,
          taskId,
          masterPrompt: input.masterPrompt,
          masterPromptSuffix: input.masterPromptSuffix,
          effectiveMasterPrompt: sequenceSetupPrompt(input),
          prompts: input.prompts,
          extensionMetadata: output.metadata ?? null
        }
      });
      artifactIds.push(artifact.id);
      const mapping = { promptIndex, prompt, inputImage, pairId, artifactId: artifact.id, outputPath };
      outputMappings.push(mapping);
      outputPathsByPrompt.set(promptIndex, outputPath);
      registeredOutputs.push(output);
      await ctx.step(`Registered ChatGPT sequence result ${outputMappings.length} of ${input.prompts.length}`, Math.min(95, 20 + (outputMappings.length / input.prompts.length) * 70), {
        promptIndex,
        artifactId: artifact.id
      });
      await persistCheckpointOutput(`Processed ${outputMappings.length} of ${input.prompts.length} ChatGPT prompt(s).`);
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
      while (true) {
        const target = buildRecoverableTarget(input.extensionTab, latestChatGptPage);
        try {
          const client = await chatgpt.ensureRoutedTab(target, { signal: ctx.signal, timeoutMs: 45_000 });
          const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
          if (page && chatGptPageChanged(page, latestChatGptPage)) {
            latestChatGptPage = page;
            await persistCheckpointOutput(`Tracking ChatGPT page before ${phase}.`);
          }
          const recoverableTarget = buildRecoverableTarget(target, page);
          try {
            await chatgpt.focusTarget(recoverableTarget, { signal: ctx.signal, timeoutMs: 10_000 });
          } catch (focusError) {
            if (isOperationCancelled(focusError)) throw focusError;
            await ctx.event("extension.focus", "Could not focus ChatGPT browser surface before task.", {
              phase,
              message: focusError instanceof Error ? focusError.message : String(focusError)
            });
          }
          return { target: recoverableTarget, client };
        } catch (error) {
          await persistCheckpointOutput(`Waiting for ChatGPT browser controller before ${phase}.`);
          await ctx.waitForManualAction(chatGptControllerManualMessage(error), manualActionData(phase));
        }
      }
    };

    const runPhaseTask = async (
      phase: "setup" | "subject",
      phaseLabel: string,
      phaseInput: {
        subjectMode?: ChatGptSubjectTaskMode;
        masterPrompt?: string;
        referenceImagePaths?: string[];
        subjectImagePath?: string;
        inputImagePath?: string;
        subjectIndex?: number;
        subjectInstruction?: string;
        subjectBaseline?: unknown;
      }
    ): Promise<ExtensionTaskResult> => {
      while (true) {
        const { target, client } = await waitForTargetAtCheckpoint(phaseLabel);
        await ctx.step(`Queued ChatGPT ${phaseLabel} task`, phase === "setup" ? 5 : Math.min(90, 20 + ((phaseInput.subjectIndex ?? 0) / input.prompts.length) * 70), {
          phase,
          targetMode: target.mode,
          clientId: client.id,
          url: client.url
        });
        const task = chatgpt.createConversationTask({
          runId: ctx.runId,
          phase,
          subjectMode: phaseInput.subjectMode,
          masterPrompt: phaseInput.masterPrompt,
          referenceImagePaths: phaseInput.referenceImagePaths,
          subjectImagePath: phaseInput.subjectImagePath,
          subjectIndex: phaseInput.subjectIndex,
          subjectInstruction: phaseInput.subjectInstruction,
          subjectBaseline: phaseInput.subjectBaseline,
          selectors: input.selectors,
          target
        });
        let submittedBaseline = phaseInput.subjectBaseline;
        let promptSubmitted = false;
        const unsubscribe = chatgpt.subscribeTask(task.id, (event) => {
          const eventData = normalizeRecord(event.data);
          if (event.type === "browser.task.output_baseline" && eventData.baseline !== undefined) {
            submittedBaseline = eventData.baseline;
          }
          if (event.type === "browser.task.prompt_submitted") {
            promptSubmitted = true;
          }
          void ctx.event("extension.task", event.message, {
            taskId: event.taskId,
            type: event.type,
            data: event.data
          });
        });
        const unsubscribeOutput = chatgpt.subscribeTaskOutput(task.id, (output) => queueOutput(output, task.id));
        try {
          const result = await waitForTaskWithRecoverableTarget(task.id, target, ctx, input.timeoutMinutes * 60_000, async (client) => {
            const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
            if (page && chatGptPageChanged(page, latestChatGptPage)) {
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
            const pausedInputImagePath = phaseInput.inputImagePath ?? phaseInput.subjectImagePath;
            pausedPrompt = {
              promptIndex: phaseInput.subjectIndex,
              ...(pausedInputImagePath ? { inputImage: pausedInputImagePath } : {}),
              ...(pausedMetadata.reason ? { reason: pausedMetadata.reason } : {}),
              ...(pausedMetadata.baseline !== undefined ? { baseline: pausedMetadata.baseline } : {}),
              ...(pausedMetadata.captureDiagnostics !== undefined
                ? { captureDiagnostics: pausedMetadata.captureDiagnostics }
                : {})
            };
            await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
            await ctx.waitForManualAction(
              `Paused during ChatGPT ${phaseLabel}. Resume will try to capture the current page output before resubmitting this prompt.`,
              manualActionData(phaseLabel)
            );
            return result;
          }
          await persistCheckpointOutput(`Completed ChatGPT ${phaseLabel} task.`);
          return result;
        } catch (error) {
          if (error instanceof ImmediateChatGptPauseError) {
            if (phase === "subject" && phaseInput.subjectIndex !== undefined) {
              const pausedInputImagePath = phaseInput.inputImagePath ?? phaseInput.subjectImagePath;
              pausedPrompt = {
                promptIndex: phaseInput.subjectIndex,
                ...(pausedInputImagePath ? { inputImage: pausedInputImagePath } : {}),
                reason:
                  "Paused immediately. Resume will inspect the current ChatGPT page for an output before resubmitting this prompt.",
                ...(phaseInput.subjectBaseline !== undefined ? { baseline: phaseInput.subjectBaseline } : {})
              };
              await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
              await ctx.waitForManualAction(
                `Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume. Resume will inspect the current page for an output before resubmitting this prompt.`,
                manualActionData(phaseLabel)
              );
              return {
                outputs: [],
                metadata: {
                  paused: true,
                  pauseReason: pausedPrompt.reason,
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
          if (error instanceof MissingExtensionTabError) {
            if (phase === "subject" && phaseInput.subjectIndex !== undefined && (promptSubmitted || submittedBaseline !== undefined)) {
              const pausedInputImagePath = phaseInput.inputImagePath ?? phaseInput.subjectImagePath;
              pausedPrompt = {
                promptIndex: phaseInput.subjectIndex,
                ...(pausedInputImagePath ? { inputImage: pausedInputImagePath } : {}),
                reason:
                  "ChatGPT tab disconnected after prompt submission started. Resume will inspect the current page for an output before resubmitting this prompt.",
                ...(submittedBaseline !== undefined ? { baseline: submittedBaseline } : {})
              };
              await persistCheckpointOutput(`ChatGPT tab disconnected after ${phaseLabel} submit; checking for existing output.`);
              return {
                outputs: [],
                metadata: {
                  paused: true,
                  pauseReason: pausedPrompt.reason,
                  ...(submittedBaseline !== undefined ? { subjectBaseline: submittedBaseline } : {})
                }
              };
            }
            await persistCheckpointOutput(`ChatGPT tab disconnected during ${phaseLabel}.`);
            continue;
          }
          throw error;
        } finally {
          unsubscribeOutput();
          unsubscribe();
        }
      }
    };

    await persistCheckpointOutput("Preparing ChatGPT image sequence workflow.");
    if (!setupCompleted) {
      await ctx.pauseIfRequested("Paused before ChatGPT sequence setup.", manualActionData("setup"));
      await runPhaseTask("setup", "sequence setup", {
        masterPrompt: sequenceSetupPrompt(input),
        referenceImagePaths: [sourceImage]
      });
      setupCompleted = true;
      await persistCheckpointOutput("ChatGPT sequence setup completed.");
      await ctx.pauseIfRequested("Paused after ChatGPT sequence setup.", manualActionData("setup"));
    } else {
      await persistCheckpointOutput("ChatGPT sequence setup restored from checkpoint.");
    }

    let currentInputImagePath = sourceImage;
    for (const [promptIndex, prompt] of input.prompts.entries()) {
      const completedOutputPath = outputPathsByPrompt.get(promptIndex);
      if (completedOutputPath) {
        currentInputImagePath = completedOutputPath;
        continue;
      }

      const phaseLabel = `prompt ${promptIndex + 1}`;
      await ctx.pauseIfRequested(`Paused before ChatGPT ${phaseLabel}.`, manualActionData(phaseLabel));
      while (!outputKeysByPrompt.has(promptIndex)) {
        if (pausedPrompt?.promptIndex === promptIndex) {
          const captureBaseline = pausedPrompt.baseline;
          const captureInputImagePath = pausedPrompt.inputImage ?? currentInputImagePath;
          pausedPrompt = undefined;
          inputImagesByPrompt.set(promptIndex, captureInputImagePath);
          await runPhaseTask("subject", `${phaseLabel} capture`, {
            subjectMode: "capture-existing",
            subjectImagePath: captureInputImagePath,
            inputImagePath: captureInputImagePath,
            subjectIndex: promptIndex,
            ...(captureBaseline !== undefined ? { subjectBaseline: captureBaseline } : {})
          });
          await outputProcessing;
          if (outputProcessingError) throw outputProcessingError;
          const capturedOutputPath = outputPathsByPrompt.get(promptIndex);
          if (capturedOutputPath) {
            currentInputImagePath = capturedOutputPath;
            break;
          }
          if (pausedPrompt) continue;
          await ctx.event(
            "chatgpt.capture_existing.missed",
            `Could not capture an existing ChatGPT output for ${phaseLabel}; resubmitting the prompt.`
          );
        }

        inputImagesByPrompt.set(promptIndex, currentInputImagePath);
        const attachedInputImagePath = promptIndex === 0 ? undefined : currentInputImagePath;
        await runPhaseTask("subject", phaseLabel, {
          subjectMode: "submit-and-capture",
          ...(attachedInputImagePath ? { subjectImagePath: attachedInputImagePath } : {}),
          inputImagePath: currentInputImagePath,
          subjectIndex: promptIndex,
          subjectInstruction: prompt
        });
        await outputProcessing;
        if (outputProcessingError) throw outputProcessingError;
        if (pausedPrompt?.promptIndex === promptIndex && !outputKeysByPrompt.has(promptIndex)) continue;
        const nextInputPath = outputPathsByPrompt.get(promptIndex);
        if (!nextInputPath) {
          throw new Error(`ChatGPT extension did not return an output image for prompt ${promptIndex + 1}.`);
        }
        currentInputImagePath = nextInputPath;
      }
      await ctx.pauseIfRequested(`Paused after ChatGPT ${phaseLabel}.`, manualActionData(phaseLabel));
    }

    normalizeChatGptExtensionSequenceOutputs(registeredOutputs, input.prompts);

    const manifestPath = path.join(artifactDir, "chatgpt-extension-sequence-manifest.json");
    writeJson(manifestPath, {
      masterPrompt: input.masterPrompt,
      masterPromptSuffix: input.masterPromptSuffix,
      effectiveMasterPrompt: sequenceSetupPrompt(input),
      sourceImages: input.sourceImages,
      prompts: input.prompts,
      extensionTab: redactTargetForManifest(input.extensionTab),
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
        completedPromptIndexes: [...outputKeysByPrompt.keys()].sort((a, b) => a - b),
        outputMappings,
        pausedPrompt: pausedPrompt ?? null
      },
      summary: `Processed ${input.prompts.length} prompt(s) through the ChatGPT Chrome extension image sequence.`
    };
  }
};

const chatGptExtensionPromptImageWorkflow: WorkflowDefinition<
  zod.infer<typeof promptImageInputSchema>,
  zod.infer<typeof promptImageOutputSchema>
> = {
  manifest: {
    id: "based-blink.chatgpt.extension-image-prompt",
    title: "ChatGPT Extension Prompt To Image",
    description: "Submits one text prompt through the companion Chrome extension and captures one generated image.",
    category: "chatgpt",
    version: "0.1.0",
    concurrency: 1,
    requiresBrowser: false,
    targetUrl: "https://chatgpt.com/",
    outputKinds: ["image", "json"],
    uiCapabilities: ["extension.tabRouting", "extension.focusTarget"],
    inputFields: [
      {
        name: "extensionTab",
        label: "ChatGPT tab",
        type: "select",
        help: "Target a compatible open ChatGPT tab, or open a new extension-owned window for this run."
      },
      { name: "prompt", label: "Prompt", type: "textarea", required: true },
      {
        name: "selectors",
        label: "Selector config",
        type: "json",
        help: "Optional CSS selectors for composer, submit button, stop button, and output image."
      }
    ]
  },
  inputSchema: promptImageInputSchema,
  outputSchema: promptImageOutputSchema,
  canResumeFailedRun: canResumeFailedChatGptPromptImageRun,
  async run(input, ctx) {
    const artifactIds: string[] = [];
    const artifactDir = ctx.artifactDir;
    const usedOutputNames = new Set<string>();
    const registeredOutputs: ExtensionTaskOutput[] = [];
    let outputKey: string | undefined;
    let outputMapping: PromptImageOutputMapping | undefined;
    let outputProcessing = Promise.resolve();
    let outputProcessingError: Error | undefined;
    let latestChatGptPage = buildChatGptPage(input.extensionTab, undefined, undefined);
    let pausedPrompt: PausedPromptImage | undefined;

    const restored = restorePromptImageCheckpointState(ctx.previousOutput, input, artifactDir);
    for (const restoredArtifactId of restored.artifactIds) artifactIds.push(restoredArtifactId);
    if (restored.outputMapping && restored.output) {
      outputMapping = restored.outputMapping;
      outputKey = outputIdentityKey(restored.output);
      registeredOutputs.push(restored.output);
      usedOutputNames.add(path.basename(restored.outputMapping.outputPath));
    }
    latestChatGptPage = restored.chatGptPage ?? latestChatGptPage;
    pausedPrompt = restored.pausedPrompt;

    const checkpointOutput = (summary: string): ChatGptPromptImageWorkflowOutput => ({
      artifactIds: [...artifactIds],
      summary,
      ...(latestChatGptPage ? { chatGptPage: latestChatGptPage } : {}),
      checkpoint: {
        completed: Boolean(outputKey),
        outputMapping: outputMapping ?? null,
        pausedPrompt: pausedPrompt ?? null
      }
    });

    const persistCheckpointOutput = async (summary: string): Promise<void> => {
      await ctx.updateOutput(checkpointOutput(summary));
    };

    const manualActionData = (phase: string): Record<string, unknown> => ({
      phase,
      pausedPrompt: pausedPrompt ?? null,
      chatGptPage: latestChatGptPage ?? null,
      url: latestChatGptPage?.url ?? targetUrl(input.extensionTab) ?? null,
      target: buildRecoverableTarget(input.extensionTab, latestChatGptPage)
    });

    const registerOutputArtifact = async (output: ExtensionTaskOutput, taskId: string): Promise<void> => {
      if (output.subjectIndex !== 0) {
        throw new Error(`ChatGPT extension returned output for unexpected prompt index ${output.subjectIndex}.`);
      }
      if (typeof output.base64 !== "string" || output.base64.length === 0) {
        throw new Error("ChatGPT extension returned an empty output image for the prompt.");
      }

      const key = outputIdentityKey(output);
      if (outputKey) {
        if (outputKey === key) return;
        throw new Error("ChatGPT extension returned multiple distinct output images. This workflow expects exactly one result.");
      }
      outputKey = key;

      const pairId = "prompt";
      const mimeType = output.mimeType ?? "image/png";
      const extension = extensionForMimeType(mimeType);
      const outputPath = path.join(artifactDir, outputFileNameForPromptImage(input.prompt, extension, usedOutputNames));
      fs.writeFileSync(outputPath, Buffer.from(output.base64, "base64"));
      const artifact = await ctx.addArtifact({
        kind: "image",
        name: path.basename(outputPath),
        path: outputPath,
        mimeType: inferMimeType(outputPath) ?? mimeType,
        metadata: {
          source: "chatgpt-extension",
          workflowKind: "image-prompt",
          prompt: input.prompt,
          pairId,
          taskId,
          extensionMetadata: output.metadata ?? null
        }
      });
      artifactIds.push(artifact.id);
      outputMapping = { prompt: input.prompt, pairId, artifactId: artifact.id, outputPath };
      registeredOutputs.push(output);
      await ctx.step("Registered ChatGPT prompt image result", 95, { artifactId: artifact.id });
      await persistCheckpointOutput("Processed ChatGPT prompt image.");
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
      while (true) {
        const target = buildRecoverableTarget(input.extensionTab, latestChatGptPage);
        try {
          const client = await chatgpt.ensureRoutedTab(target, { signal: ctx.signal, timeoutMs: 45_000 });
          const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
          if (page && chatGptPageChanged(page, latestChatGptPage)) {
            latestChatGptPage = page;
            await persistCheckpointOutput(`Tracking ChatGPT page before ${phase}.`);
          }
          const recoverableTarget = buildRecoverableTarget(target, page);
          try {
            await chatgpt.focusTarget(recoverableTarget, { signal: ctx.signal, timeoutMs: 10_000 });
          } catch (focusError) {
            if (isOperationCancelled(focusError)) throw focusError;
            await ctx.event("extension.focus", "Could not focus ChatGPT browser surface before task.", {
              phase,
              message: focusError instanceof Error ? focusError.message : String(focusError)
            });
          }
          return { target: recoverableTarget, client };
        } catch (error) {
          await persistCheckpointOutput("Waiting for ChatGPT browser controller before prompt image.");
          await ctx.waitForManualAction(chatGptControllerManualMessage(error), manualActionData(phase));
        }
      }
    };

    const runPromptTask = async (
      phaseLabel: string,
      taskInput: {
        subjectMode: ChatGptSubjectTaskMode;
        subjectBaseline?: unknown;
      }
    ): Promise<ExtensionTaskResult> => {
      while (true) {
        const { target, client } = await waitForTargetAtCheckpoint(phaseLabel);
        await ctx.step(`Queued ChatGPT ${phaseLabel} task`, 20, {
          phase: "subject",
          targetMode: target.mode,
          clientId: client.id,
          url: client.url
        });
        const task = chatgpt.createConversationTask({
          runId: ctx.runId,
          phase: "subject",
          subjectMode: taskInput.subjectMode,
          subjectIndex: 0,
          subjectInstruction: input.prompt,
          subjectBaseline: taskInput.subjectBaseline,
          selectors: input.selectors,
          target
        });
        let submittedBaseline = taskInput.subjectBaseline;
        let promptSubmitted = false;
        const unsubscribe = chatgpt.subscribeTask(task.id, (event) => {
          const eventData = normalizeRecord(event.data);
          if (event.type === "browser.task.output_baseline" && eventData.baseline !== undefined) {
            submittedBaseline = eventData.baseline;
          }
          if (event.type === "browser.task.prompt_submitted") {
            promptSubmitted = true;
          }
          void ctx.event("extension.task", event.message, {
            taskId: event.taskId,
            type: event.type,
            data: event.data
          });
        });
        const unsubscribeOutput = chatgpt.subscribeTaskOutput(task.id, (output) => queueOutput(output, task.id));
        try {
          const result = await waitForTaskWithRecoverableTarget(task.id, target, ctx, input.timeoutMinutes * 60_000, async (client) => {
            const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
            if (page && chatGptPageChanged(page, latestChatGptPage)) {
              latestChatGptPage = page;
              await persistCheckpointOutput(`Tracking ChatGPT page during ${phaseLabel}.`);
            }
          });
          for (const output of result.outputs) queueOutput(output, task.id);
          await outputProcessing;
          if (outputProcessingError) throw outputProcessingError;
          latestChatGptPage = buildChatGptPage(target, result.metadata, client) ?? latestChatGptPage;
          const pausedMetadata = readPausedTaskMetadata(result.metadata);
          if (pausedMetadata) {
            pausedPrompt = {
              ...(pausedMetadata.reason ? { reason: pausedMetadata.reason } : {}),
              ...(pausedMetadata.baseline !== undefined ? { baseline: pausedMetadata.baseline } : {}),
              ...(pausedMetadata.captureDiagnostics !== undefined
                ? { captureDiagnostics: pausedMetadata.captureDiagnostics }
                : {})
            };
            await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
            await ctx.waitForManualAction(
              `Paused during ChatGPT ${phaseLabel}. Resume will try to capture the current page output before resubmitting this prompt.`,
              manualActionData(phaseLabel)
            );
            return result;
          }
          await persistCheckpointOutput(`Completed ChatGPT ${phaseLabel} task.`);
          return result;
        } catch (error) {
          if (error instanceof ImmediateChatGptPauseError) {
            pausedPrompt = {
              reason:
                "Paused immediately. Resume will inspect the current ChatGPT page for an output before resubmitting this prompt.",
              ...(taskInput.subjectBaseline !== undefined ? { baseline: taskInput.subjectBaseline } : {})
            };
            await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
            await ctx.waitForManualAction(
              `Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume. Resume will inspect the current page for an output before resubmitting this prompt.`,
              manualActionData(phaseLabel)
            );
            return {
              outputs: [],
              metadata: {
                paused: true,
                pauseReason: pausedPrompt.reason,
                ...(taskInput.subjectBaseline !== undefined ? { subjectBaseline: taskInput.subjectBaseline } : {})
              }
            };
          }
          if (error instanceof MissingExtensionTabError) {
            if (promptSubmitted || submittedBaseline !== undefined) {
              pausedPrompt = {
                reason:
                  "ChatGPT tab disconnected after prompt submission started. Resume will inspect the current page for an output before resubmitting this prompt.",
                ...(submittedBaseline !== undefined ? { baseline: submittedBaseline } : {})
              };
              await persistCheckpointOutput(`ChatGPT tab disconnected after ${phaseLabel} submit; checking for existing output.`);
              return {
                outputs: [],
                metadata: {
                  paused: true,
                  pauseReason: pausedPrompt.reason,
                  ...(submittedBaseline !== undefined ? { subjectBaseline: submittedBaseline } : {})
                }
              };
            }
            await persistCheckpointOutput(`ChatGPT tab disconnected during ${phaseLabel}.`);
            continue;
          }
          throw error;
        } finally {
          unsubscribeOutput();
          unsubscribe();
        }
      }
    };

    await persistCheckpointOutput("Preparing ChatGPT prompt image workflow.");
    await ctx.pauseIfRequested("Paused before ChatGPT prompt image.", manualActionData("prompt image"));
    while (!outputKey) {
      if (pausedPrompt) {
        const captureBaseline = pausedPrompt.baseline;
        pausedPrompt = undefined;
        await runPromptTask("prompt image capture", {
          subjectMode: "capture-existing",
          ...(captureBaseline !== undefined ? { subjectBaseline: captureBaseline } : {})
        });
        await outputProcessing;
        if (outputProcessingError) throw outputProcessingError;
        if (outputKey) break;
        if (pausedPrompt) continue;
        await ctx.event(
          "chatgpt.capture_existing.missed",
          "Could not capture an existing ChatGPT output for prompt image; resubmitting the prompt."
        );
      }

      await runPromptTask("prompt image", { subjectMode: "submit-and-capture" });
      await outputProcessing;
      if (outputProcessingError) throw outputProcessingError;
      if (pausedPrompt && !outputKey) continue;
      if (!outputKey) throw new Error("ChatGPT extension did not return an output image for the prompt.");
    }
    await ctx.pauseIfRequested("Paused after ChatGPT prompt image.", manualActionData("prompt image"));

    normalizeChatGptExtensionPromptImageOutputs(registeredOutputs);

    const manifestPath = path.join(artifactDir, "chatgpt-extension-prompt-image-manifest.json");
    writeJson(manifestPath, {
      prompt: input.prompt,
      extensionTab: redactTargetForManifest(input.extensionTab),
      chatGptPage: latestChatGptPage ?? null,
      selectors: input.selectors,
      outputMapping: outputMapping ?? null
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
        completed: Boolean(outputKey),
        outputMapping: outputMapping ?? null,
        pausedPrompt: pausedPrompt ?? null
      },
      summary: "Processed one prompt through the ChatGPT Chrome extension image workflow."
    };
  }
};

function canResumeFailedChatGptRun(run: RunRecord): boolean {
  if (run.status !== "failed" || run.workflowId !== "based-blink.chatgpt.extension-image-transform") return false;
  const parsedInput = inputSchema.safeParse(run.input);
  if (!parsedInput.success) return false;

  const output = readStoredOutput(run.output);
  if (output?.checkpoint || output?.chatGptPage) return true;
  return Boolean(targetUrl(parsedInput.data.extensionTab));
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

  return undefined;
}

function canResumeFailedChatGptSequenceRun(run: RunRecord): boolean {
  if (run.status !== "failed" || run.workflowId !== "based-blink.chatgpt.extension-image-sequence") return false;
  const parsedInput = sequenceInputSchema.safeParse(run.input);
  if (!parsedInput.success) return false;

  const output = readStoredSequenceOutput(run.output);
  if (output?.checkpoint || output?.chatGptPage) return true;
  return Boolean(targetUrl(parsedInput.data.extensionTab));
}

function readStoredSequenceOutput(value: unknown): ChatGptSequenceWorkflowOutput | null {
  const parsed = sequenceOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function restoreSequenceCheckpointState(
  previousOutput: unknown,
  input: ChatGptSequenceWorkflowInput,
  artifactDir: string
): RestoredSequenceCheckpointState {
  const output = readStoredSequenceOutput(previousOutput);
  if (!output) {
    return { artifactIds: [], outputMappings: [], setupCompleted: false };
  }

  const candidatesByPrompt = new Map<number, RestoredSequenceOutputMapping>();
  for (const mapping of output.checkpoint?.outputMappings ?? []) {
    const restored = restoreSequenceOutputMapping(mapping, input, artifactDir);
    if (!restored || candidatesByPrompt.has(restored.mapping.promptIndex)) continue;
    candidatesByPrompt.set(restored.mapping.promptIndex, restored);
  }

  const restoredMappings: RestoredSequenceOutputMapping[] = [];
  const artifactIds = new Set<string>();
  for (let promptIndex = 0; promptIndex < input.prompts.length; promptIndex += 1) {
    const restored = candidatesByPrompt.get(promptIndex);
    if (!restored) break;
    artifactIds.add(restored.mapping.artifactId);
    restoredMappings.push(restored);
  }

  const completedPrompts = new Set(restoredMappings.map((mapping) => mapping.output.subjectIndex));
  const setupCompleted = Boolean(output.checkpoint?.setupCompleted) || completedPrompts.size > 0;
  const pausedPrompt = resolvePausedPromptForResume(output.checkpoint?.pausedPrompt, input, completedPrompts, setupCompleted);

  return {
    artifactIds: [...artifactIds],
    outputMappings: restoredMappings,
    setupCompleted,
    ...(output.chatGptPage ? { chatGptPage: output.chatGptPage } : {}),
    ...(pausedPrompt ? { pausedPrompt } : {})
  };
}

function restoreSequenceOutputMapping(
  mapping: SequenceOutputMapping,
  input: ChatGptSequenceWorkflowInput,
  artifactDir: string
): RestoredSequenceOutputMapping | null {
  if (!Number.isInteger(mapping.promptIndex)) return null;
  if (input.prompts[mapping.promptIndex] !== mapping.prompt) return null;
  if (!mapping.outputPath || !fs.existsSync(mapping.outputPath)) return null;

  const outputPath = path.resolve(mapping.outputPath);
  const resolvedArtifactDir = path.resolve(artifactDir);
  if (outputPath !== resolvedArtifactDir && !outputPath.startsWith(`${resolvedArtifactDir}${path.sep}`)) return null;

  const mimeType = inferMimeType(outputPath) ?? "image/png";
  return {
    mapping,
    output: {
      subjectIndex: mapping.promptIndex,
      subjectName: `prompt-${mapping.promptIndex + 1}`,
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

function resolvePausedPromptForResume(
  storedPausedPrompt: PausedPrompt | null | undefined,
  input: ChatGptSequenceWorkflowInput,
  completedPrompts: Set<number>,
  setupCompleted: boolean
): PausedPrompt | undefined {
  if (!setupCompleted) return undefined;
  if (
    storedPausedPrompt &&
    Number.isInteger(storedPausedPrompt.promptIndex) &&
    input.prompts[storedPausedPrompt.promptIndex] &&
    !completedPrompts.has(storedPausedPrompt.promptIndex)
  ) {
    return storedPausedPrompt;
  }

  return undefined;
}

function canResumeFailedChatGptPromptImageRun(run: RunRecord): boolean {
  if (run.status !== "failed" || run.workflowId !== "based-blink.chatgpt.extension-image-prompt") return false;
  const parsedInput = promptImageInputSchema.safeParse(run.input);
  if (!parsedInput.success) return false;

  const output = readStoredPromptImageOutput(run.output);
  if (output?.checkpoint || output?.chatGptPage) return true;
  return Boolean(targetUrl(parsedInput.data.extensionTab));
}

function readStoredPromptImageOutput(value: unknown): ChatGptPromptImageWorkflowOutput | null {
  const parsed = promptImageOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function restorePromptImageCheckpointState(
  previousOutput: unknown,
  input: ChatGptPromptImageWorkflowInput,
  artifactDir: string
): RestoredPromptImageCheckpointState {
  const output = readStoredPromptImageOutput(previousOutput);
  if (!output) {
    return { artifactIds: [] };
  }

  const restored = restorePromptImageOutputMapping(output.checkpoint?.outputMapping, input, artifactDir);
  return {
    artifactIds: restored ? [restored.mapping.artifactId] : [],
    ...(restored ? { outputMapping: restored.mapping, output: restored.output } : {}),
    ...(output.chatGptPage ? { chatGptPage: output.chatGptPage } : {}),
    ...(output.checkpoint?.completed || restored ? {} : resolvePausedPromptImageForResume(output.checkpoint?.pausedPrompt))
  };
}

function restorePromptImageOutputMapping(
  mapping: PromptImageOutputMapping | null | undefined,
  input: ChatGptPromptImageWorkflowInput,
  artifactDir: string
): { mapping: PromptImageOutputMapping; output: ExtensionTaskOutput } | null {
  if (!mapping) return null;
  if (mapping.prompt !== input.prompt) return null;
  if (!mapping.outputPath || !fs.existsSync(mapping.outputPath)) return null;

  const outputPath = path.resolve(mapping.outputPath);
  const resolvedArtifactDir = path.resolve(artifactDir);
  if (outputPath !== resolvedArtifactDir && !outputPath.startsWith(`${resolvedArtifactDir}${path.sep}`)) return null;

  const mimeType = inferMimeType(outputPath) ?? "image/png";
  return {
    mapping,
    output: {
      subjectIndex: 0,
      subjectName: "prompt",
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

function resolvePausedPromptImageForResume(
  storedPausedPrompt: PausedPromptImage | null | undefined
): { pausedPrompt?: PausedPromptImage } {
  return storedPausedPrompt ? { pausedPrompt: storedPausedPrompt } : {};
}

class MissingExtensionTabError extends Error {
  constructor() {
    super("ChatGPT tab disconnected before the extension task completed.");
  }
}

function chatGptControllerManualMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/controller/i.test(message)) {
    return "Reload or install the Based BLINK browser extension in the intended browser profile, open any page or the extension popup so the controller connects, then resume this run.";
  }
  return "The Based BLINK browser controller could not open or connect to the tracked ChatGPT page. Reload the extension in the intended browser profile, then resume this run.";
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
  const wait = chatgpt
    .waitForTask(taskId, {
      signal: ctx.signal,
      timeoutMs
    })
    .then(
      (result) => ({ result }),
      (error) => ({ error })
    )
    .finally(() => {
      settled = true;
    });

  while (!settled) {
    const tick = sleep(1_000, ctx.signal).then(() => null);
    const settledTask = await Promise.race([wait, tick]);
    if (settledTask) {
      if ("error" in settledTask) {
        throw recoverDisconnectedCommandError(settledTask.error, target);
      }
      return settledTask.result;
    }

    if (ctx.isPauseRequested() && !taskPauseRequested) {
      chatgpt.requestTaskPause(taskId);
      taskPauseRequested = true;
      chatgpt.cancelTask(taskId);
      await wait.catch(() => undefined);
      throw new ImmediateChatGptPauseError();
    }

    const client = chatgpt.findCompatibleClientForTarget(target);
    if (client) {
      await onClientSeen?.(client);
      missingSince = null;
      continue;
    }

    missingSince ??= Date.now();
    if (Date.now() - missingSince > 45_000) {
      chatgpt.cancelTask(taskId);
      await wait.catch(() => undefined);
      throw new MissingExtensionTabError();
    }
  }

  const settledTask = await wait;
  if ("error" in settledTask) {
    throw recoverDisconnectedCommandError(settledTask.error, target);
  }
  return settledTask.result;
}

function recoverDisconnectedCommandError(error: unknown, _target: ChatGptExtensionTaskTarget): Error {
  if (isRecoverableExtensionCommandError(error)) {
    return new MissingExtensionTabError();
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isRecoverableExtensionCommandError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /Timed out waiting for browser extension command/i.test(error.message) ||
    /No compatible BLINK browser extension tab is connected/i.test(error.message) ||
    /Selected browser extension tab is not connected/i.test(error.message)
  );
}

  return [chatGptExtensionImageTransformWorkflow, chatGptExtensionImageSequenceWorkflow, chatGptExtensionPromptImageWorkflow];
}

type BrowserExtensionSdk = WorkflowSdk["extension"]["browser"];
const CHATGPT_FOCUS_THROTTLE_MS = 20_000;

interface ChatGptImageBaseline {
  imageFingerprints: string[];
  stableSourceIds: string[];
  imageCount: number;
}

interface ChatGptCapturedImage {
  src: string;
  fingerprint: string;
  stableSourceId: string;
  alt: string;
  width: number;
  height: number;
  mimeType: string;
  base64: string;
  name: string;
  domIndex: number;
  messageRole: string;
  selectionReason: string;
  diagnostics: ChatGptImageCaptureDiagnostics;
}

interface ChatGptImageCandidate {
  src: string;
  fingerprint: string;
  stableSourceId: string;
  alt: string;
  width: number;
  height: number;
  mimeType: string;
  base64: string;
  domIndex: number;
  messageRole: string;
  ancestorText: string;
  ancestorRole: string;
  ancestorAriaLabel: string;
  insideForm: boolean;
  insideEditable: boolean;
  insideButton: boolean;
  insideLink: boolean;
  generated: boolean;
  assistantLike: boolean;
  uploadLike: boolean;
  rejectionReasons: string[];
}

interface ChatGptImageCaptureDiagnostics {
  totalImages: number;
  uniqueImageCount: number;
  duplicateImageCount: number;
  eligibleCount: number;
  generatedCount: number;
  assistantCount: number;
  fallbackCount: number;
  rejectedCount: number;
  baselineFingerprintCount: number;
  baselineStableSourceIdCount: number;
  candidates: Array<Record<string, unknown>>;
}

interface ChatGptBrowserTaskInput {
  runId: string;
  phase: "setup" | "subject";
  subjectMode?: ChatGptSubjectTaskMode;
  masterPrompt?: string;
  referenceImagePaths?: string[];
  subjectImagePath?: string;
  subjectIndex?: number;
  subjectInstruction?: string;
  subjectBaseline?: unknown;
  selectors?: Record<string, unknown>;
  target?: ChatGptExtensionTaskTarget;
}

interface ChatGptBrowserTask extends ChatGptBrowserTaskInput {
  id: string;
  cancelled: boolean;
  pauseRequested: boolean;
  lastFocusedAt?: number;
}

function createChatGptBrowserController(browser: BrowserExtensionSdk, sleep: WorkflowSdk["sleep"]) {
  const tasks = new Map<string, ChatGptBrowserTask>();
  const eventListeners = new Map<string, Set<(event: { taskId: string; type: string; message: string; data?: unknown; createdAt: string }) => void>>();
  const outputListeners = new Map<string, Set<(output: ExtensionTaskOutput) => void>>();

  function emit(taskId: string, type: string, message: string, data?: unknown): void {
    const event = { taskId, type, message, ...(data === undefined ? {} : { data }), createdAt: new Date().toISOString() };
    for (const listener of eventListeners.get(taskId) ?? []) listener(event);
  }

  function output(taskId: string, value: ExtensionTaskOutput): void {
    for (const listener of outputListeners.get(taskId) ?? []) listener(value);
  }

  return {
    createConversationTask(input: ChatGptBrowserTaskInput): { id: string } {
      const id = randomUUID();
      tasks.set(id, { ...input, id, target: input.target ?? { mode: "any" }, cancelled: false, pauseRequested: false });
      return { id };
    },
    async waitForTask(taskId: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<ExtensionTaskResult> {
      const task = tasks.get(taskId);
      if (!task) throw new Error(`ChatGPT browser task not found: ${taskId}`);
      emit(task.id, "browser.task.started", `Running ChatGPT ${task.phase} controller in plugin code`, {
        phase: task.phase,
        target: redactTargetForManifest(task.target ?? { mode: "any" })
      });
      const result = await runChatGptBrowserTask(browser, sleep, task, options, emit);
      for (const item of result.outputs) output(task.id, item);
      emit(task.id, "browser.task.completed", `Completed ChatGPT ${task.phase} controller`, result.metadata);
      return result;
    },
    subscribeTask(taskId: string, listener: (event: { taskId: string; type: string; message: string; data?: unknown; createdAt: string }) => void): () => void {
      const listeners = eventListeners.get(taskId) ?? new Set();
      listeners.add(listener);
      eventListeners.set(taskId, listeners);
      return () => listeners.delete(listener);
    },
    subscribeTaskOutput(taskId: string, listener: (output: ExtensionTaskOutput) => void): () => void {
      const listeners = outputListeners.get(taskId) ?? new Set();
      listeners.add(listener);
      outputListeners.set(taskId, listeners);
      return () => listeners.delete(listener);
    },
    requestTaskPause(taskId: string): void {
      const task = tasks.get(taskId);
      if (task) task.pauseRequested = true;
    },
    cancelTask(taskId: string): void {
      const task = tasks.get(taskId);
      if (task) task.cancelled = true;
    },
    findCompatibleClientForTarget(target: ChatGptExtensionTaskTarget): ExtensionClientStatus | undefined {
      return browser.findCompatibleClientForTarget(target);
    },
    ensureRoutedTab(
      target: ChatGptExtensionTaskTarget,
      options?: { signal?: AbortSignal; timeoutMs?: number }
    ): Promise<ExtensionClientStatus> {
      return browser.ensureRoutedTab(target, options);
    },
    focusTarget(
      target: ChatGptExtensionTaskTarget,
      options?: { signal?: AbortSignal; timeoutMs?: number }
    ): Promise<unknown> {
      return browser.focusTarget(target, options);
    }
  };
}

async function runChatGptBrowserTask(
  browser: BrowserExtensionSdk,
  sleep: WorkflowSdk["sleep"],
  task: ChatGptBrowserTask,
  options: { signal: AbortSignal; timeoutMs: number },
  emit: (taskId: string, type: string, message: string, data?: unknown) => void
): Promise<ExtensionTaskResult> {
  const target = task.target ?? { mode: "any" };
  const selectors = normalizeChatGptSelectors(task.selectors);
  await focusChatGptTarget(browser, target, task, options.signal, emit, true);
  const baseline =
    task.subjectBaseline && typeof task.subjectBaseline === "object"
      ? task.subjectBaseline
      : await extractChatGptImageBaseline(browser, target, selectors, options.signal);

  if (task.phase === "setup") {
    if (task.referenceImagePaths?.length) {
      const files = browser.stageFiles(task.referenceImagePaths);
      await browser.action(target, { kind: "attach-file", selector: selectors.fileInput, files }, { signal: options.signal, timeoutMs: 30_000 });
      emit(task.id, "browser.task.files_attached", "Attached ChatGPT reference image(s)", { count: files.length });
    }
    await submitChatGptPrompt(browser, sleep, target, selectors, task.masterPrompt ?? "", options, task, emit);
    await waitForChatGptIdle(browser, sleep, target, selectors, options, task);
    return {
      outputs: [],
      metadata: pageMetadata(normalizeRecord(await browser.inspect(target, { signal: options.signal, timeoutMs: 30_000 })))
    };
  }

  if (!Number.isInteger(task.subjectIndex)) throw new Error("ChatGPT subject task requires subjectIndex.");
  let captureBaseline = baseline;
  if (task.subjectMode !== "capture-existing") {
    await removeChatGptComposerAttachments(browser, sleep, target, selectors, options.signal, task, emit);
    if (task.subjectImagePath) {
      captureBaseline = await attachAndSubmitChatGptSubjectImage(browser, sleep, target, selectors, task, options, emit);
    } else {
      let submitBaseline: ChatGptImageBaseline | undefined;
      await submitChatGptPrompt(browser, sleep, target, selectors, task.subjectInstruction ?? "", options, task, emit, async () => {
        submitBaseline = await captureChatGptSubmitBaseline(browser, target, selectors, task, options.signal, emit);
      });
      captureBaseline = submitBaseline ?? captureBaseline;
    }
    await waitForChatGptIdle(browser, sleep, target, selectors, options, task);
  }

  const captured = await waitForChatGptOutput(browser, sleep, target, selectors, captureBaseline, options, task);
  return {
    outputs: [
      {
        subjectIndex: task.subjectIndex!,
        ...(task.subjectImagePath ? { subjectName: path.basename(task.subjectImagePath) } : {}),
        name: captured.name,
        mimeType: captured.mimeType,
        base64: captured.base64,
        metadata: {
          source: "generic-browser-extension",
          fingerprint: captured.fingerprint,
          stableSourceId: captured.stableSourceId,
          src: captured.src,
          width: captured.width,
          height: captured.height,
          alt: captured.alt,
          domIndex: captured.domIndex,
          messageRole: captured.messageRole,
          selectionReason: captured.selectionReason,
          captureDiagnostics: captured.diagnostics
        }
      }
    ],
    metadata: pageMetadata(normalizeRecord(await browser.inspect(target, { signal: options.signal, timeoutMs: 30_000 })))
  };
}

async function focusChatGptTarget(
  browser: BrowserExtensionSdk,
  target: ChatGptExtensionTaskTarget,
  task: ChatGptBrowserTask,
  signal: AbortSignal,
  emit?: (taskId: string, type: string, message: string, data?: unknown) => void,
  force = false
): Promise<void> {
  const now = Date.now();
  if (!force && task.lastFocusedAt && now - task.lastFocusedAt < CHATGPT_FOCUS_THROTTLE_MS) return;
  task.lastFocusedAt = now;
  try {
    await browser.focusTarget(target, { signal, timeoutMs: 10_000 });
    emit?.(task.id, "browser.task.focused", "Focused ChatGPT browser surface", redactTargetForManifest(target));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isOperationCancelled(error)) throw error;
    emit?.(task.id, "browser.task.focus_failed", "Could not focus ChatGPT browser surface", {
      message,
      target: redactTargetForManifest(target)
    });
  }
}

async function attachAndSubmitChatGptSubjectImage(
  browser: BrowserExtensionSdk,
  sleep: WorkflowSdk["sleep"],
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  task: ChatGptBrowserTask,
  options: { signal: AbortSignal; timeoutMs: number },
  emit: (taskId: string, type: string, message: string, data?: unknown) => void
): Promise<ChatGptImageBaseline> {
  if (!task.subjectImagePath) throw new Error("ChatGPT subject task requires subjectImagePath.");
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfTaskStopped(task);
    let submitBaseline: ChatGptImageBaseline | undefined;
    const files = browser.stageFiles([task.subjectImagePath]);
    await browser.action(target, { kind: "attach-file", selector: selectors.fileInput, files }, { signal: options.signal, timeoutMs: 30_000 });
    emit(task.id, "browser.task.files_attached", "Attached ChatGPT subject image", { count: files.length, attempt });
    try {
      await submitChatGptPrompt(browser, sleep, target, selectors, task.subjectInstruction ?? "", options, task, emit, async () => {
        submitBaseline = await captureChatGptSubmitBaseline(browser, target, selectors, task, options.signal, emit);
      });
      return submitBaseline ?? (await extractChatGptImageBaseline(browser, target, selectors, options.signal));
    } catch (error) {
      if (attempt >= maxAttempts || !isSubmitReadinessTimeout(error)) throw error;
      emit(task.id, "browser.task.submit_retry", "Retrying ChatGPT subject upload after submit control did not become ready", {
        attempt,
        reason: error instanceof Error ? error.message : String(error)
      });
      await removeChatGptComposerAttachments(browser, sleep, target, selectors, options.signal, task, emit);
      await sleep(1_000, options.signal);
    }
  }
  throw new Error("ChatGPT subject image submit did not complete.");
}

async function captureChatGptSubmitBaseline(
  browser: BrowserExtensionSdk,
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  task: ChatGptBrowserTask,
  signal: AbortSignal,
  emit: (taskId: string, type: string, message: string, data?: unknown) => void
): Promise<ChatGptImageBaseline> {
  const baseline = normalizeChatGptImageBaseline(await extractChatGptImageBaseline(browser, target, selectors, signal));
  emit(task.id, "browser.task.output_baseline", "Captured ChatGPT image baseline immediately before subject submit", {
    imageCount: baseline.imageCount,
    fingerprintCount: baseline.imageFingerprints.length,
    stableSourceIdCount: baseline.stableSourceIds.length,
    baseline
  });
  return baseline;
}

async function removeChatGptComposerAttachments(
  browser: BrowserExtensionSdk,
  sleep: WorkflowSdk["sleep"],
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  signal: AbortSignal,
  task: ChatGptBrowserTask,
  emit?: (taskId: string, type: string, message: string, data?: unknown) => void
): Promise<void> {
  for (let removed = 0; removed < 6; removed += 1) {
    throwIfTaskStopped(task);
    const state = await elementStateOrNull(browser, target, selectors.removeAttachmentButton, signal);
    if (state?.visible !== true || state.disabled === true) return;
    await browser.action(target, { kind: "click", selector: selectors.removeAttachmentButton }, { signal, timeoutMs: 10_000 });
    emit?.(task.id, "browser.task.attachment_removed", "Removed stale ChatGPT composer attachment", { removed: removed + 1 });
    await sleep(500, signal);
  }
}

function isSubmitReadinessTimeout(error: unknown): boolean {
  return error instanceof Error && /Timed out waiting for ChatGPT submit control to become ready/i.test(error.message);
}

function isOperationCancelled(error: unknown): boolean {
  return error instanceof Error && /Operation cancelled/i.test(error.message);
}

function normalizeChatGptSelectors(selectors: Record<string, unknown> | undefined): {
  fileInput: string;
  composer: string;
  submitButton: string;
  stopButton: string;
  removeAttachmentButton: string;
  outputImage: string;
} {
  return {
    fileInput: stringValue(selectors?.fileInput) || "input[type='file']",
    composer: stringValue(selectors?.composer) || "#prompt-textarea, textarea[data-id='root'], textarea, [contenteditable='true']",
    submitButton:
      stringValue(selectors?.submitButton) ||
      "button[data-testid='send-button'], button[aria-label='Send prompt'], button[aria-label='Send message'], form button[type='submit']",
    stopButton:
      stringValue(selectors?.stopButton) ||
      "button[data-testid='stop-button'], button[data-testid='composer-stop-button'], button[aria-label='Stop'], button[aria-label^='Stop '], button[aria-label^='Cancel ']",
    removeAttachmentButton: stringValue(selectors?.removeAttachmentButton) || "button[aria-label^='Remove file']",
    outputImage: stringValue(selectors?.outputImage) || "img"
  };
}

async function submitChatGptPrompt(
  browser: BrowserExtensionSdk,
  sleep: WorkflowSdk["sleep"],
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  prompt: string,
  options: { signal: AbortSignal; timeoutMs: number },
  task: ChatGptBrowserTask,
  emit?: (taskId: string, type: string, message: string, data?: unknown) => void,
  beforeSubmit?: () => Promise<void>
): Promise<void> {
  if (prompt.trim()) {
    await fillAndVerifyPrompt(browser, target, selectors, prompt, options, task, emit);
  }
  await waitForChatGptSubmitReady(browser, sleep, target, selectors, options, task);
  await beforeSubmit?.();
  await browser.action(target, { kind: "click", selector: selectors.submitButton }, { signal: options.signal, timeoutMs: 30_000 });
  emit?.(task.id, "browser.task.prompt_submitted", "Submitted ChatGPT prompt", { selector: selectors.submitButton });
}

async function fillAndVerifyPrompt(
  browser: BrowserExtensionSdk,
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  prompt: string,
  options: { signal: AbortSignal; timeoutMs: number },
  task: ChatGptBrowserTask,
  emit?: (taskId: string, type: string, message: string, data?: unknown) => void
): Promise<void> {
  const fillResult = normalizeRecord(
    await browser.action(target, { kind: "fill", selector: selectors.composer, value: prompt }, { signal: options.signal, timeoutMs: 30_000 })
  );
  const diagnostics = {
    selector: selectors.composer,
    candidateCount: numberValue(fillResult.candidateCount),
    valueLength: numberValue(fillResult.valueLength) || prompt.length,
    observedLength: numberValue(fillResult.observedLength),
    method: stringValue(fillResult.method),
    chosen: fillResult.chosen ?? null
  };
  emit?.(task.id, "browser.task.prompt_filled", "Filled browser prompt field", diagnostics);
  if (prompt.trim() && diagnostics.observedLength === 0) {
    throw new Error(`ChatGPT browser fill could not verify prompt text in the composer. Diagnostics: ${JSON.stringify(diagnostics)}`);
  }
}

async function waitForChatGptSubmitReady(
  browser: BrowserExtensionSdk,
  sleep: WorkflowSdk["sleep"],
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  options: { signal: AbortSignal; timeoutMs: number },
  task: ChatGptBrowserTask
): Promise<void> {
  const deadline = Date.now() + Math.min(options.timeoutMs, 120_000);
  while (Date.now() < deadline) {
    throwIfTaskStopped(task);
    await focusChatGptTarget(browser, target, task, options.signal);
    const submit = normalizeRecord(
      await browser.extract(target, { kind: "element-state", selector: selectors.submitButton }, { signal: options.signal, timeoutMs: 10_000 })
    );
    const stop = await elementStateOrNull(browser, target, selectors.stopButton, options.signal);
    if (submit.visible === true && submit.disabled !== true && stop?.visible !== true) return;
    await sleep(750, options.signal);
  }
  throw new Error("Timed out waiting for ChatGPT submit control to become ready.");
}

async function waitForChatGptIdle(
  browser: BrowserExtensionSdk,
  sleep: WorkflowSdk["sleep"],
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  options: { signal: AbortSignal; timeoutMs: number },
  task: ChatGptBrowserTask
): Promise<void> {
  const deadline = Date.now() + Math.min(options.timeoutMs, 300_000);
  while (Date.now() < deadline) {
    throwIfTaskStopped(task);
    await focusChatGptTarget(browser, target, task, options.signal);
    const stop = await elementStateOrNull(browser, target, selectors.stopButton, options.signal);
    if (stop?.visible !== true) return;
    await sleep(1_000, options.signal);
  }
}

async function waitForChatGptOutput(
  browser: BrowserExtensionSdk,
  sleep: WorkflowSdk["sleep"],
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  baseline: unknown,
  options: { signal: AbortSignal; timeoutMs: number },
  task: ChatGptBrowserTask
): Promise<ChatGptCapturedImage> {
  const previousFingerprints = baselineFingerprints(baseline);
  const previousStableSourceIds = baselineStableSourceIds(baseline);
  const uploadedSubjectKey = imageFileBase64IdentityKey(task.subjectImagePath);
  const deadline = Date.now() + options.timeoutMs;
  let lastDiagnostics: ChatGptImageCaptureDiagnostics | undefined;
  while (Date.now() < deadline) {
    throwIfTaskStopped(task);
    await focusChatGptTarget(browser, target, task, options.signal);
    const result = normalizeRecord(
      await browser.extract(
        target,
        {
          kind: "images",
          selector: selectors.outputImage,
          minWidth: 128,
          minHeight: 128,
          includeBase64: true,
          excludeFingerprints: previousFingerprints,
          excludeStableSourceIds: previousStableSourceIds,
          fetchTimeoutMs: 8_000
        },
        { signal: options.signal, timeoutMs: 120_000 }
      )
    );
    const images = Array.isArray(result.images) ? result.images.map(normalizeRecord) : [];
    const selection = selectChatGptOutputCandidate(images, baseline, uploadedSubjectKey, task);
    lastDiagnostics = selection.diagnostics;
    const captured = selection.candidate;
    if (captured) {
      return {
        src: captured.src,
        fingerprint: captured.fingerprint,
        stableSourceId: captured.stableSourceId,
        alt: captured.alt,
        width: captured.width,
        height: captured.height,
        mimeType: captured.mimeType || "image/png",
        base64: captured.base64,
        name: "chatgpt-output.png",
        domIndex: captured.domIndex,
        messageRole: captured.messageRole,
        selectionReason: selection.reason,
        diagnostics: selection.diagnostics
      };
    }
    await sleep(1_500, options.signal);
  }
  throw new Error(
    `Timed out waiting for a new ChatGPT output image. Capture diagnostics: ${JSON.stringify(summarizeCaptureDiagnostics(lastDiagnostics))}`
  );
}

async function extractChatGptImageBaseline(
  browser: BrowserExtensionSdk,
  target: ChatGptExtensionTaskTarget,
  selectors: ReturnType<typeof normalizeChatGptSelectors>,
  signal: AbortSignal
): Promise<ChatGptImageBaseline> {
  const result = normalizeRecord(
    await browser.extract(
      target,
      { kind: "images", selector: selectors.outputImage, minWidth: 128, minHeight: 128 },
      { signal, timeoutMs: 30_000 }
    )
  );
  const images = Array.isArray(result.images) ? result.images.map(normalizeRecord) : [];
  return normalizeChatGptImageBaseline({
    imageFingerprints: uniqueStrings(images.map((image) => stringValue(image.fingerprint)).filter(Boolean)),
    stableSourceIds: uniqueStrings(images.map((image) => stringValue(image.stableSourceId)).filter(Boolean)),
    imageCount: images.length
  });
}

function normalizeChatGptImageBaseline(value: unknown): ChatGptImageBaseline {
  const record = normalizeRecord(value);
  return {
    imageFingerprints: baselineFingerprints(record),
    stableSourceIds: baselineStableSourceIds(record),
    imageCount: numberValue(record.imageCount)
  };
}

function selectChatGptOutputCandidate(
  images: Array<Record<string, unknown>>,
  baseline: unknown,
  uploadedSubjectKey: string | null,
  task: ChatGptBrowserTask
): { candidate?: ChatGptImageCandidate; reason: string; diagnostics: ChatGptImageCaptureDiagnostics } {
  const baselineFingerprintSet = new Set(baselineFingerprints(baseline));
  const baselineStableSourceIdSet = new Set(baselineStableSourceIds(baseline));
  const rawCandidates = images.map((image) =>
    normalizeChatGptImageCandidate(image, baselineFingerprintSet, baselineStableSourceIdSet, uploadedSubjectKey)
  );
  const candidates = dedupeChatGptImageCandidates(rawCandidates);
  const diagnostics = buildCaptureDiagnostics(
    candidates,
    baselineFingerprintSet.size,
    baselineStableSourceIdSet.size,
    rawCandidates.length
  );
  const eligible = candidates.filter((candidate) => candidate.rejectionReasons.length === 0);
  const generated = eligible.filter((candidate) => candidate.generated);
  if (generated.length === 1) return { candidate: generated[0], reason: "generated-image-label", diagnostics };
  if (generated.length > 1) throw multipleChatGptOutputCandidatesError(task, generated, diagnostics, "generated image candidates");

  const assistant = eligible.filter((candidate) => candidate.assistantLike);
  if (assistant.length === 1) return { candidate: assistant[0], reason: "assistant-context", diagnostics };
  if (assistant.length > 1) throw multipleChatGptOutputCandidatesError(task, assistant, diagnostics, "assistant image candidates");

  if (eligible.length === 1) return { candidate: eligible[0], reason: "single-unambiguous-fallback", diagnostics };
  if (eligible.length > 1) throw multipleChatGptOutputCandidatesError(task, eligible, diagnostics, "fallback image candidates");

  return { reason: "no-eligible-candidate", diagnostics };
}

function normalizeChatGptImageCandidate(
  image: Record<string, unknown>,
  baselineFingerprintSet: Set<string>,
  baselineStableSourceIdSet: Set<string>,
  uploadedSubjectKey: string | null
): ChatGptImageCandidate {
  const base64 = stringValue(image.base64);
  const fingerprint = stringValue(image.fingerprint);
  const stableSourceId = stringValue(image.stableSourceId);
  const alt = stringValue(image.alt);
  const ancestor = normalizeRecord(image.ancestor);
  const ancestorAttributes = normalizeRecord(ancestor.attributes);
  const messageRole = firstNonEmptyString(
    stringValue(image.messageRole),
    stringValue(ancestorAttributes["data-message-author-role"])
  ) ?? "";
  const ancestorText = stringValue(ancestor.text);
  const ancestorRole = firstNonEmptyString(stringValue(ancestor.role), stringValue(ancestorAttributes.role)) ?? "";
  const ancestorAriaLabel = firstNonEmptyString(stringValue(ancestor.ariaLabel), stringValue(ancestorAttributes["aria-label"])) ?? "";
  const insideForm = booleanValue(image.insideForm);
  const insideEditable = booleanValue(image.insideEditable);
  const uploadLike = isUploadLikeImageCandidate({
    messageRole,
    ancestorText,
    ancestorRole,
    ancestorAriaLabel,
    insideForm,
    insideEditable
  });
  const generated = /generated image/i.test(`${alt} ${ancestorAriaLabel}`);
  const assistantLike =
    /^assistant$/i.test(messageRole) ||
    generated ||
    (/chatgpt said/i.test(ancestorText) && !/^user$/i.test(messageRole) && !/\byou said\b/i.test(ancestorText));
  const rejectionReasons: string[] = [];
  if (!base64) rejectionReasons.push("missing-base64");
  if (fingerprint && baselineFingerprintSet.has(fingerprint)) rejectionReasons.push("baseline-fingerprint");
  if (stableSourceId && baselineStableSourceIdSet.has(stableSourceId)) rejectionReasons.push("baseline-stable-source-id");
  if (uploadedSubjectKey && base64 && base64IdentityKey(base64) === uploadedSubjectKey) rejectionReasons.push("uploaded-byte-identical");
  if (uploadLike) rejectionReasons.push("upload-or-user-context");

  return {
    src: stringValue(image.src),
    fingerprint,
    stableSourceId,
    alt,
    width: numberValue(image.width),
    height: numberValue(image.height),
    mimeType: stringValue(image.mimeType) || "image/png",
    base64,
    domIndex: numberValue(image.domIndex),
    messageRole,
    ancestorText,
    ancestorRole,
    ancestorAriaLabel,
    insideForm,
    insideEditable,
    insideButton: booleanValue(image.insideButton),
    insideLink: booleanValue(image.insideLink),
    generated,
    assistantLike,
    uploadLike,
    rejectionReasons
  };
}

function isUploadLikeImageCandidate(input: {
  messageRole: string;
  ancestorText: string;
  ancestorRole: string;
  ancestorAriaLabel: string;
  insideForm: boolean;
  insideEditable: boolean;
}): boolean {
  if (input.insideForm || input.insideEditable) return true;
  if (/^user$/i.test(input.messageRole)) return true;
  const label = `${input.ancestorRole} ${input.ancestorAriaLabel}`.toLowerCase();
  if (/\b(?:composer|prompt|attachment|uploaded|upload|input)\b/.test(label)) return true;
  const text = input.ancestorText.toLowerCase();
  return /\byou said\b/.test(text) && !/\bchatgpt said\b/.test(text);
}

function dedupeChatGptImageCandidates(candidates: ChatGptImageCandidate[]): ChatGptImageCandidate[] {
  const byIdentity = new Map<string, ChatGptImageCandidate>();
  for (const candidate of candidates) {
    const key = chatGptImageCandidateIdentity(candidate);
    const existing = byIdentity.get(key);
    byIdentity.set(key, existing ? mergeChatGptImageCandidates(existing, candidate) : candidate);
  }
  return [...byIdentity.values()].sort((a, b) => a.domIndex - b.domIndex);
}

function chatGptImageCandidateIdentity(candidate: ChatGptImageCandidate): string {
  return (
    firstNonEmptyString(
      candidate.stableSourceId ? `stable:${candidate.stableSourceId}` : "",
      candidate.fingerprint ? `fingerprint:${candidate.fingerprint}` : "",
      candidate.src ? `src:${candidate.src}` : "",
      candidate.base64 ? `base64:${base64IdentityKey(candidate.base64)}` : ""
    ) ?? `dom:${candidate.domIndex}`
  );
}

function mergeChatGptImageCandidates(a: ChatGptImageCandidate, b: ChatGptImageCandidate): ChatGptImageCandidate {
  const chosen = chatGptImageCandidateScore(b) > chatGptImageCandidateScore(a) ? b : a;
  const rejectionReasons = uniqueStrings([...a.rejectionReasons, ...b.rejectionReasons]).filter(
    (reason) => reason !== "missing-base64" || !chosen.base64
  );
  return {
    ...chosen,
    domIndex: Math.min(a.domIndex, b.domIndex),
    generated: a.generated || b.generated,
    assistantLike: a.assistantLike || b.assistantLike,
    uploadLike: a.uploadLike || b.uploadLike,
    rejectionReasons
  };
}

function chatGptImageCandidateScore(candidate: ChatGptImageCandidate): number {
  return (
    (candidate.rejectionReasons.length === 0 ? 32 : 0) +
    (candidate.generated ? 16 : 0) +
    (candidate.assistantLike ? 8 : 0) +
    (candidate.base64 ? 4 : 0) +
    (!candidate.uploadLike ? 2 : 0) -
    candidate.domIndex / 10000
  );
}

function buildCaptureDiagnostics(
  candidates: ChatGptImageCandidate[],
  baselineFingerprintCount: number,
  baselineStableSourceIdCount: number,
  totalImages = candidates.length
): ChatGptImageCaptureDiagnostics {
  const eligible = candidates.filter((candidate) => candidate.rejectionReasons.length === 0);
  return {
    totalImages,
    uniqueImageCount: candidates.length,
    duplicateImageCount: Math.max(0, totalImages - candidates.length),
    eligibleCount: eligible.length,
    generatedCount: eligible.filter((candidate) => candidate.generated).length,
    assistantCount: eligible.filter((candidate) => candidate.assistantLike).length,
    fallbackCount: eligible.length,
    rejectedCount: candidates.length - eligible.length,
    baselineFingerprintCount,
    baselineStableSourceIdCount,
    candidates: candidates.map(summarizeImageCandidate)
  };
}

function multipleChatGptOutputCandidatesError(
  task: ChatGptBrowserTask,
  candidates: ChatGptImageCandidate[],
  diagnostics: ChatGptImageCaptureDiagnostics,
  candidateKind: string
): Error {
  const label = Number.isInteger(task.subjectIndex) ? `prompt ${task.subjectIndex! + 1}` : "the current prompt";
  return new Error(
    `ChatGPT returned ${candidates.length} distinct output image candidates for ${label}. ` +
      `This workflow expects exactly one result per prompt. Candidate kind: ${candidateKind}. ` +
      `Candidate images: ${JSON.stringify(candidates.map(summarizeImageCandidate))}. ` +
      `Capture diagnostics: ${JSON.stringify(summarizeCaptureDiagnostics(diagnostics))}`
  );
}

function summarizeImageCandidate(candidate: ChatGptImageCandidate): Record<string, unknown> {
  return {
    src: candidate.src,
    fingerprint: candidate.fingerprint,
    stableSourceId: candidate.stableSourceId,
    alt: candidate.alt,
    width: candidate.width,
    height: candidate.height,
    domIndex: candidate.domIndex,
    messageRole: candidate.messageRole,
    generated: candidate.generated,
    assistantLike: candidate.assistantLike,
    uploadLike: candidate.uploadLike,
    insideForm: candidate.insideForm,
    insideEditable: candidate.insideEditable,
    rejectionReasons: candidate.rejectionReasons
  };
}

function summarizeCaptureDiagnostics(value: ChatGptImageCaptureDiagnostics | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return {
    totalImages: value.totalImages,
    eligibleCount: value.eligibleCount,
    generatedCount: value.generatedCount,
    assistantCount: value.assistantCount,
    fallbackCount: value.fallbackCount,
    rejectedCount: value.rejectedCount,
    baselineFingerprintCount: value.baselineFingerprintCount,
    baselineStableSourceIdCount: value.baselineStableSourceIdCount,
    uniqueImageCount: value.uniqueImageCount,
    duplicateImageCount: value.duplicateImageCount,
    candidates: value.candidates.slice(0, 12)
  };
}

async function elementStateOrNull(
  browser: BrowserExtensionSdk,
  target: ChatGptExtensionTaskTarget,
  selector: string,
  signal: AbortSignal
): Promise<Record<string, unknown> | null> {
  try {
    return normalizeRecord(await browser.extract(target, { kind: "element-state", selector }, { signal, timeoutMs: 10_000 }));
  } catch {
    return null;
  }
}

function throwIfTaskStopped(task: ChatGptBrowserTask): void {
  if (task.cancelled) throw new Error("ChatGPT browser task was cancelled.");
  if (task.pauseRequested) {
    throw new Error("ChatGPT browser task pause requested.");
  }
}

function baselineFingerprints(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.imageFingerprints)
    ? record.imageFingerprints.filter((item): item is string => typeof item === "string")
    : [];
}

function baselineStableSourceIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.stableSourceIds)
    ? record.stableSourceIds.filter((item): item is string => typeof item === "string")
    : [];
}

function pageMetadata(page: Record<string, unknown>): Record<string, unknown> {
  return {
    url: stringValue(page.url),
    title: stringValue(page.title)
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function buildRecoverableTarget(
  target: ChatGptExtensionTaskTarget,
  page: ChatGptPage | undefined
): ChatGptExtensionTaskTarget {
  const url = page?.url ?? targetUrl(target);
  const title = page?.title ?? targetTitle(target);
  const targetRecord = target as Partial<{
    clientId: string;
    routingToken: string;
    openMode: "window" | "tab";
    controllerId: string;
    tabId: number;
    windowId: number;
  }>;
  const routingToken = page?.routingToken ?? (target.mode === "new" ? target.routingToken : undefined);
  if (routingToken) {
    return {
      mode: "new",
      routingToken,
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      openMode: targetRecord.openMode ?? "window",
      ...(page?.clientId ?? targetRecord.clientId ? { clientId: page?.clientId ?? targetRecord.clientId } : {}),
      ...(page?.controllerId ?? targetRecord.controllerId ? { controllerId: page?.controllerId ?? targetRecord.controllerId } : {}),
      ...(page?.tabId ?? targetRecord.tabId ? { tabId: page?.tabId ?? targetRecord.tabId } : {}),
      ...(page?.windowId ?? targetRecord.windowId ? { windowId: page?.windowId ?? targetRecord.windowId } : {})
    };
  }
  if (target.mode === "existing" || page?.clientId) {
    return {
      mode: "existing",
      clientId: page?.clientId ?? targetRecord.clientId ?? "",
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(page?.controllerId ?? targetRecord.controllerId ? { controllerId: page?.controllerId ?? targetRecord.controllerId } : {}),
      ...(page?.tabId ?? targetRecord.tabId ? { tabId: page?.tabId ?? targetRecord.tabId } : {}),
      ...(page?.windowId ?? targetRecord.windowId ? { windowId: page?.windowId ?? targetRecord.windowId } : {})
    };
  }
  return target;
}

function chatGptPageChanged(next: ChatGptPage, previous: ChatGptPage | undefined): boolean {
  return (
    !previous ||
    next.url !== previous.url ||
    next.title !== previous.title ||
    next.clientId !== previous.clientId ||
    next.routingToken !== previous.routingToken ||
    next.controllerId !== previous.controllerId ||
    next.tabId !== previous.tabId ||
    next.windowId !== previous.windowId
  );
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
): ChatGptPage | undefined {
  const pageMetadata = readPageMetadata(metadata);
  const targetRecord = target as Partial<{
    url: string;
    title: string;
    routingToken: string;
    clientId: string;
    controllerId: string;
    tabId: number;
    windowId: number;
  }>;
  const url = firstNonEmptyString(pageMetadata.url, targetClient?.url, targetRecord.url);
  if (!url) return undefined;

  const title = firstNonEmptyString(pageMetadata.title, targetClient?.title, targetRecord.title);
  const clientId = firstNonEmptyString(targetClient?.id, pageMetadata.clientId, targetRecord.clientId);
  const routingToken = firstNonEmptyString(
    target.mode === "new" ? target.routingToken : undefined,
    targetClient?.routingToken,
    pageMetadata.routingToken,
    targetRecord.routingToken
  );
  const controllerId = firstNonEmptyString(targetClient?.controllerId, pageMetadata.controllerId, targetRecord.controllerId);
  const tabId = optionalNumber(targetClient?.tabId) ?? pageMetadata.tabId ?? optionalNumber(targetRecord.tabId);
  const windowId = optionalNumber(targetClient?.windowId) ?? pageMetadata.windowId ?? optionalNumber(targetRecord.windowId);

  return {
    url,
    ...(title ? { title } : {}),
    ...(clientId ? { clientId } : {}),
    ...(routingToken ? { routingToken } : {}),
    ...(controllerId ? { controllerId } : {}),
    ...(tabId !== undefined ? { tabId } : {}),
    ...(windowId !== undefined ? { windowId } : {}),
    capturedAt: new Date().toISOString()
  };
}

function readPageMetadata(metadata: unknown): {
  url?: string;
  title?: string;
  clientId?: string;
  routingToken?: string;
  controllerId?: string;
  tabId?: number;
  windowId?: number;
} {
  if (!metadata || typeof metadata !== "object") return {};
  const record = metadata as Record<string, unknown>;
  return {
    url: typeof record.url === "string" ? record.url : undefined,
    title: typeof record.title === "string" ? record.title : undefined,
    clientId: typeof record.clientId === "string" ? record.clientId : undefined,
    routingToken: typeof record.routingToken === "string" ? record.routingToken : undefined,
    controllerId: typeof record.controllerId === "string" ? record.controllerId : undefined,
    tabId: optionalNumber(record.tabId),
    windowId: optionalNumber(record.windowId)
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

function safePromptStem(prompt: string): string {
  return prompt.trim().slice(0, 64).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "prompt";
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

function outputFileNameForPrompt(sourceImage: string, promptIndex: number, extension: string, usedNames: Set<string>): string {
  const baseName = `${safeStem(sourceImage)}-prompt-${String(promptIndex + 1).padStart(2, "0")}-chatgpt`;
  let candidate = `${baseName}.${extension}`;
  let duplicate = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${duplicate}.${extension}`;
    duplicate += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function outputFileNameForPromptImage(prompt: string, extension: string, usedNames: Set<string>): string {
  const baseName = `${safePromptStem(prompt)}-chatgpt`;
  let candidate = `${baseName}.${extension}`;
  let duplicate = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${duplicate}.${extension}`;
    duplicate += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function sequenceSetupPrompt(input: { masterPrompt: string; masterPromptSuffix: string }): string {
  if (!input.masterPrompt || !input.masterPromptSuffix) return input.masterPrompt;
  return `${input.masterPrompt}\n\n${input.masterPromptSuffix}`;
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

export function normalizeChatGptExtensionSequenceOutputs(
  outputs: ExtensionTaskResult["outputs"],
  prompts: string[]
): Array<{
  promptIndex: number;
  prompt: string;
  pairId: string;
  output: ExtensionTaskResult["outputs"][number];
}> {
  const outputsByPrompt = new Map<number, Map<string, ExtensionTaskResult["outputs"][number]>>();

  for (const output of outputs) {
    const promptIndex = output.subjectIndex;
    if (!Number.isInteger(promptIndex)) {
      throw new Error("ChatGPT extension returned an output without a valid prompt index.");
    }
    if (!prompts[promptIndex]) {
      throw new Error(`ChatGPT extension returned output for unknown prompt index ${promptIndex}.`);
    }
    if (typeof output.base64 !== "string" || output.base64.length === 0) {
      throw new Error(`ChatGPT extension returned an empty output image for prompt ${promptIndex + 1}.`);
    }

    const promptOutputs = outputsByPrompt.get(promptIndex) ?? new Map<string, ExtensionTaskResult["outputs"][number]>();
    promptOutputs.set(outputIdentityKey(output), promptOutputs.get(outputIdentityKey(output)) ?? output);
    outputsByPrompt.set(promptIndex, promptOutputs);
  }

  return prompts.map((prompt, promptIndex) => {
    const promptOutputs = [...(outputsByPrompt.get(promptIndex)?.values() ?? [])];
    if (promptOutputs.length === 0) {
      throw new Error(`ChatGPT extension did not return an output image for prompt ${promptIndex + 1}.`);
    }
    if (promptOutputs.length > 1) {
      throw new Error(
        `ChatGPT extension returned ${promptOutputs.length} distinct output images for prompt ${promptIndex + 1}. ` +
          "This workflow expects exactly one result per prompt."
      );
    }
    return {
      promptIndex,
      prompt,
      pairId: `prompt-${promptIndex + 1}`,
      output: promptOutputs[0]
    };
  });
}

export function normalizeChatGptExtensionPromptImageOutputs(
  outputs: ExtensionTaskResult["outputs"]
): ExtensionTaskResult["outputs"][number] {
  const outputsByIdentity = new Map<string, ExtensionTaskResult["outputs"][number]>();

  for (const output of outputs) {
    if (output.subjectIndex !== 0) {
      throw new Error(`ChatGPT extension returned output for unexpected prompt index ${output.subjectIndex}.`);
    }
    if (typeof output.base64 !== "string" || output.base64.length === 0) {
      throw new Error("ChatGPT extension returned an empty output image for the prompt.");
    }
    const key = outputIdentityKey(output);
    outputsByIdentity.set(key, outputsByIdentity.get(key) ?? output);
  }

  const distinctOutputs = [...outputsByIdentity.values()];
  if (distinctOutputs.length === 0) {
    throw new Error("ChatGPT extension did not return an output image for the prompt.");
  }
  if (distinctOutputs.length > 1) {
    throw new Error(
      `ChatGPT extension returned ${distinctOutputs.length} distinct output images for the prompt. ` +
        "This workflow expects exactly one result."
    );
  }
  return distinctOutputs[0];
}

function outputIdentityKey(output: ExtensionTaskResult["outputs"][number]): string {
  return `${output.mimeType ?? "image/png"}:${base64IdentityKey(output.base64)}`;
}

function imageFileBase64IdentityKey(filePath: string | undefined): string | null {
  if (!filePath) return null;
  try {
    return base64IdentityKey(fs.readFileSync(filePath).toString("base64"));
  } catch {
    return null;
  }
}

function base64IdentityKey(base64: string): string {
  return createHash("sha256").update(base64).digest("hex");
}
