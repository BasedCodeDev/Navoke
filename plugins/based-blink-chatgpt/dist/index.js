"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkflows = createWorkflows;
exports.buildChatGptPage = buildChatGptPage;
exports.normalizeChatGptExtensionOutputs = normalizeChatGptExtensionOutputs;
exports.normalizeChatGptExtensionSequenceOutputs = normalizeChatGptExtensionSequenceOutputs;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const CHATGPT_NEW_TAB_URL = "https://chatgpt.com/";
const EXTENSION_TAB_ROUTING_PARAM = "based-blink-tab";
function buildNewExtensionTabUrl(routingToken) {
    const url = new URL(CHATGPT_NEW_TAB_URL);
    url.hash = `${EXTENSION_TAB_ROUTING_PARAM}=${encodeURIComponent(routingToken)}`;
    return url.toString();
}
function createDefaultExtensionTabTarget() {
    const routingToken = (0, node_crypto_1.randomUUID)();
    return { mode: "new", routingToken, url: buildNewExtensionTabUrl(routingToken) };
}
function createWorkflows(sdk) {
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
            title: z.string().trim().optional()
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
    const promptSequenceSchema = z.preprocess((value) => Array.isArray(value)
        ? value
            .map((item) => (typeof item === "string" ? item.trim() : item))
            .filter((item) => typeof item !== "string" || item.length > 0)
        : value, z.array(z.string().min(1)).min(1, "Add at least one prompt."));
    const sequenceInputSchema = z.object({
        sourceImages: z.array(z.string()).length(1, "Choose exactly one source image."),
        prompts: promptSequenceSchema,
        masterPrompt: z.string().optional().default("").transform((value) => value.trim()),
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
    const chatGptExtensionImageTransformWorkflow = {
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
            const artifactIds = [];
            const artifactDir = ctx.artifactDir;
            const outputMappings = [];
            const usedOutputNames = new Set();
            const outputKeysBySubject = new Map();
            const registeredOutputs = [];
            let outputProcessing = Promise.resolve();
            let outputProcessingError;
            let setupCompleted = false;
            let latestChatGptPage = buildChatGptPage(input.extensionTab, undefined, undefined);
            let pausedSubject;
            const restored = restoreCheckpointState(ctx.previousOutput, input, artifactDir);
            for (const restoredArtifactId of restored.artifactIds)
                artifactIds.push(restoredArtifactId);
            for (const restoredMapping of restored.outputMappings) {
                outputMappings.push(restoredMapping.mapping);
                outputKeysBySubject.set(restoredMapping.output.subjectIndex, outputIdentityKey(restoredMapping.output));
                registeredOutputs.push(restoredMapping.output);
                usedOutputNames.add(node_path_1.default.basename(restoredMapping.mapping.outputPath));
            }
            setupCompleted = restored.setupCompleted;
            latestChatGptPage = restored.chatGptPage ?? latestChatGptPage;
            pausedSubject = restored.pausedSubject;
            const checkpointOutput = (summary) => ({
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
            const persistCheckpointOutput = async (summary) => {
                await ctx.updateOutput(checkpointOutput(summary));
            };
            const manualActionData = (phase) => ({
                phase,
                pausedSubject: pausedSubject ?? null,
                chatGptPage: latestChatGptPage ?? null,
                url: latestChatGptPage?.url ?? targetUrl(input.extensionTab) ?? null,
                target: buildRecoverableTarget(input.extensionTab, latestChatGptPage)
            });
            const registerOutputArtifact = async (output, taskId) => {
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
                    if (existingKey === key)
                        return;
                    throw new Error(`ChatGPT extension returned multiple distinct output images for subject ${subjectIndex + 1}. ` +
                        "This workflow expects exactly one result per subject.");
                }
                outputKeysBySubject.set(subjectIndex, key);
                const pairId = `subject-${subjectIndex + 1}`;
                const mimeType = output.mimeType ?? "image/png";
                const extension = extensionForMimeType(mimeType);
                const outputPath = node_path_1.default.join(artifactDir, outputFileNameForSubject(subjectImage, subjectIndex, extension, usedOutputNames));
                node_fs_1.default.writeFileSync(outputPath, Buffer.from(output.base64, "base64"));
                const artifact = await ctx.addArtifact({
                    kind: "image",
                    name: node_path_1.default.basename(outputPath),
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
            const queueOutput = (output, taskId) => {
                outputProcessing = outputProcessing.then(async () => {
                    if (outputProcessingError)
                        return;
                    try {
                        await registerOutputArtifact(output, taskId);
                    }
                    catch (error) {
                        outputProcessingError = error instanceof Error ? error : new Error(String(error));
                    }
                });
                void outputProcessing;
            };
            const waitForTargetAtCheckpoint = async (phase) => {
                while (true) {
                    const target = buildRecoverableTarget(input.extensionTab, latestChatGptPage);
                    try {
                        const client = await chatgpt.ensureRoutedTab(target, { signal: ctx.signal, timeoutMs: 45_000 });
                        const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
                        if (page && chatGptPageChanged(page, latestChatGptPage)) {
                            latestChatGptPage = page;
                            await persistCheckpointOutput(`Tracking ChatGPT page before ${phase}.`);
                        }
                        return { target: buildRecoverableTarget(target, page), client };
                    }
                    catch (error) {
                        await persistCheckpointOutput(`Waiting for ChatGPT browser controller before ${phase}.`);
                        await ctx.waitForManualAction(chatGptControllerManualMessage(error), manualActionData(phase));
                    }
                }
            };
            const runPhaseTask = async (phase, phaseLabel, phaseInput) => {
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
                    const unsubscribe = chatgpt.subscribeTask(task.id, (event) => {
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
                        if (outputProcessingError)
                            throw outputProcessingError;
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
                            await ctx.waitForManualAction(`Paused during ChatGPT ${phaseLabel}. Resume will try to capture the current page output before resubmitting this subject.`, manualActionData(phaseLabel));
                            return result;
                        }
                        await persistCheckpointOutput(`Completed ChatGPT ${phaseLabel} task.`);
                        return result;
                    }
                    catch (error) {
                        if (error instanceof ImmediateChatGptPauseError) {
                            if (phase === "subject" && phaseInput.subjectIndex !== undefined) {
                                pausedSubject = {
                                    subjectIndex: phaseInput.subjectIndex,
                                    reason: "Paused immediately. Resume will inspect the current ChatGPT page for an output before resubmitting this subject.",
                                    ...(phaseInput.subjectBaseline !== undefined ? { baseline: phaseInput.subjectBaseline } : {})
                                };
                                await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
                                await ctx.waitForManualAction(`Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume. Resume will inspect the current page for an output before resubmitting this subject.`, manualActionData(phaseLabel));
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
                            await ctx.waitForManualAction(`Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume this run.`, manualActionData(phaseLabel));
                            continue;
                        }
                        if (error instanceof MissingExtensionTabError) {
                            await persistCheckpointOutput(`ChatGPT tab disconnected during ${phaseLabel}.`);
                            continue;
                        }
                        throw error;
                    }
                    finally {
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
            }
            else {
                await persistCheckpointOutput("ChatGPT setup restored from checkpoint.");
            }
            for (const [subjectIndex, subjectImagePath] of input.subjectImages.entries()) {
                if (outputKeysBySubject.has(subjectIndex))
                    continue;
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
                        if (outputProcessingError)
                            throw outputProcessingError;
                        if (outputKeysBySubject.has(subjectIndex))
                            break;
                        await ctx.event("chatgpt.capture_existing.missed", `Could not capture an existing ChatGPT output for ${phaseLabel}; resubmitting the subject.`);
                    }
                    await runPhaseTask("subject", phaseLabel, {
                        subjectMode: "submit-and-capture",
                        subjectImagePath,
                        subjectIndex
                    });
                    await outputProcessing;
                    if (outputProcessingError)
                        throw outputProcessingError;
                    if (pausedSubject?.subjectIndex === subjectIndex && !outputKeysBySubject.has(subjectIndex))
                        continue;
                    if (!outputKeysBySubject.has(subjectIndex)) {
                        throw new Error(`ChatGPT extension did not return an output image for subject ${subjectIndex + 1}.`);
                    }
                }
                await ctx.pauseIfRequested(`Paused after ChatGPT ${phaseLabel}.`, manualActionData(phaseLabel));
            }
            normalizeChatGptExtensionOutputs(registeredOutputs, input.subjectImages);
            const manifestPath = node_path_1.default.join(artifactDir, "chatgpt-extension-manifest.json");
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
                name: node_path_1.default.basename(manifestPath),
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
    const chatGptExtensionImageSequenceWorkflow = {
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
                    help: "Target a compatible open ChatGPT tab, or open a new tab for this run."
                },
                {
                    name: "masterPrompt",
                    label: "Setup prompt",
                    type: "textarea",
                    help: "Optional global setup sent with the source image before the prompt sequence."
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
            const artifactIds = [];
            const artifactDir = ctx.artifactDir;
            const sourceImage = input.sourceImages[0];
            const outputMappings = [];
            const usedOutputNames = new Set();
            const outputKeysByPrompt = new Map();
            const outputPathsByPrompt = new Map();
            const inputImagesByPrompt = new Map();
            const registeredOutputs = [];
            let outputProcessing = Promise.resolve();
            let outputProcessingError;
            let setupCompleted = false;
            let latestChatGptPage = buildChatGptPage(input.extensionTab, undefined, undefined);
            let pausedPrompt;
            const restored = restoreSequenceCheckpointState(ctx.previousOutput, input, artifactDir);
            for (const restoredArtifactId of restored.artifactIds)
                artifactIds.push(restoredArtifactId);
            for (const restoredMapping of restored.outputMappings) {
                outputMappings.push(restoredMapping.mapping);
                outputKeysByPrompt.set(restoredMapping.output.subjectIndex, outputIdentityKey(restoredMapping.output));
                outputPathsByPrompt.set(restoredMapping.mapping.promptIndex, restoredMapping.mapping.outputPath);
                inputImagesByPrompt.set(restoredMapping.mapping.promptIndex, restoredMapping.mapping.inputImage);
                registeredOutputs.push(restoredMapping.output);
                usedOutputNames.add(node_path_1.default.basename(restoredMapping.mapping.outputPath));
            }
            setupCompleted = input.masterPrompt ? restored.setupCompleted : true;
            latestChatGptPage = restored.chatGptPage ?? latestChatGptPage;
            pausedPrompt = restored.pausedPrompt;
            const checkpointOutput = (summary) => ({
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
            const persistCheckpointOutput = async (summary) => {
                await ctx.updateOutput(checkpointOutput(summary));
            };
            const manualActionData = (phase) => ({
                phase,
                pausedPrompt: pausedPrompt ?? null,
                chatGptPage: latestChatGptPage ?? null,
                url: latestChatGptPage?.url ?? targetUrl(input.extensionTab) ?? null,
                target: buildRecoverableTarget(input.extensionTab, latestChatGptPage)
            });
            const registerOutputArtifact = async (output, taskId) => {
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
                    if (existingKey === key)
                        return;
                    throw new Error(`ChatGPT extension returned multiple distinct output images for prompt ${promptIndex + 1}. ` +
                        "This workflow expects exactly one result per prompt.");
                }
                outputKeysByPrompt.set(promptIndex, key);
                const pairId = `prompt-${promptIndex + 1}`;
                const mimeType = output.mimeType ?? "image/png";
                const extension = extensionForMimeType(mimeType);
                const inputImage = inputImagesByPrompt.get(promptIndex) ?? sourceImage;
                const outputPath = node_path_1.default.join(artifactDir, outputFileNameForPrompt(sourceImage, promptIndex, extension, usedOutputNames));
                node_fs_1.default.writeFileSync(outputPath, Buffer.from(output.base64, "base64"));
                const artifact = await ctx.addArtifact({
                    kind: "image",
                    name: node_path_1.default.basename(outputPath),
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
            const queueOutput = (output, taskId) => {
                outputProcessing = outputProcessing.then(async () => {
                    if (outputProcessingError)
                        return;
                    try {
                        await registerOutputArtifact(output, taskId);
                    }
                    catch (error) {
                        outputProcessingError = error instanceof Error ? error : new Error(String(error));
                    }
                });
                void outputProcessing;
            };
            const waitForTargetAtCheckpoint = async (phase) => {
                while (true) {
                    const target = buildRecoverableTarget(input.extensionTab, latestChatGptPage);
                    try {
                        const client = await chatgpt.ensureRoutedTab(target, { signal: ctx.signal, timeoutMs: 45_000 });
                        const page = buildChatGptPage(target, { url: client.url, title: client.title }, client);
                        if (page && chatGptPageChanged(page, latestChatGptPage)) {
                            latestChatGptPage = page;
                            await persistCheckpointOutput(`Tracking ChatGPT page before ${phase}.`);
                        }
                        return { target: buildRecoverableTarget(target, page), client };
                    }
                    catch (error) {
                        await persistCheckpointOutput(`Waiting for ChatGPT browser controller before ${phase}.`);
                        await ctx.waitForManualAction(chatGptControllerManualMessage(error), manualActionData(phase));
                    }
                }
            };
            const runPhaseTask = async (phase, phaseLabel, phaseInput) => {
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
                    const unsubscribe = chatgpt.subscribeTask(task.id, (event) => {
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
                        if (outputProcessingError)
                            throw outputProcessingError;
                        latestChatGptPage = buildChatGptPage(target, result.metadata, client) ?? latestChatGptPage;
                        const pausedMetadata = readPausedTaskMetadata(result.metadata);
                        if (pausedMetadata && phase === "subject" && phaseInput.subjectIndex !== undefined) {
                            pausedPrompt = {
                                promptIndex: phaseInput.subjectIndex,
                                ...(phaseInput.subjectImagePath ? { inputImage: phaseInput.subjectImagePath } : {}),
                                ...(pausedMetadata.reason ? { reason: pausedMetadata.reason } : {}),
                                ...(pausedMetadata.baseline !== undefined ? { baseline: pausedMetadata.baseline } : {}),
                                ...(pausedMetadata.captureDiagnostics !== undefined
                                    ? { captureDiagnostics: pausedMetadata.captureDiagnostics }
                                    : {})
                            };
                            await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
                            await ctx.waitForManualAction(`Paused during ChatGPT ${phaseLabel}. Resume will try to capture the current page output before resubmitting this prompt.`, manualActionData(phaseLabel));
                            return result;
                        }
                        await persistCheckpointOutput(`Completed ChatGPT ${phaseLabel} task.`);
                        return result;
                    }
                    catch (error) {
                        if (error instanceof ImmediateChatGptPauseError) {
                            if (phase === "subject" && phaseInput.subjectIndex !== undefined) {
                                pausedPrompt = {
                                    promptIndex: phaseInput.subjectIndex,
                                    ...(phaseInput.subjectImagePath ? { inputImage: phaseInput.subjectImagePath } : {}),
                                    reason: "Paused immediately. Resume will inspect the current ChatGPT page for an output before resubmitting this prompt.",
                                    ...(phaseInput.subjectBaseline !== undefined ? { baseline: phaseInput.subjectBaseline } : {})
                                };
                                await persistCheckpointOutput(`Paused during ChatGPT ${phaseLabel}.`);
                                await ctx.waitForManualAction(`Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume. Resume will inspect the current page for an output before resubmitting this prompt.`, manualActionData(phaseLabel));
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
                            await ctx.waitForManualAction(`Paused during ChatGPT ${phaseLabel}. Refresh the ChatGPT page if needed, then resume this run.`, manualActionData(phaseLabel));
                            continue;
                        }
                        if (error instanceof MissingExtensionTabError) {
                            await persistCheckpointOutput(`ChatGPT tab disconnected during ${phaseLabel}.`);
                            continue;
                        }
                        throw error;
                    }
                    finally {
                        unsubscribeOutput();
                        unsubscribe();
                    }
                }
            };
            await persistCheckpointOutput("Preparing ChatGPT image sequence workflow.");
            if (!input.masterPrompt) {
                setupCompleted = true;
                await persistCheckpointOutput("No ChatGPT sequence setup prompt was provided.");
            }
            else if (!setupCompleted) {
                await ctx.pauseIfRequested("Paused before ChatGPT sequence setup.", manualActionData("setup"));
                await runPhaseTask("setup", "sequence setup", {
                    masterPrompt: input.masterPrompt,
                    referenceImagePaths: [sourceImage]
                });
                setupCompleted = true;
                await persistCheckpointOutput("ChatGPT sequence setup completed.");
                await ctx.pauseIfRequested("Paused after ChatGPT sequence setup.", manualActionData("setup"));
            }
            else {
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
                            subjectIndex: promptIndex,
                            ...(captureBaseline !== undefined ? { subjectBaseline: captureBaseline } : {})
                        });
                        await outputProcessing;
                        if (outputProcessingError)
                            throw outputProcessingError;
                        const capturedOutputPath = outputPathsByPrompt.get(promptIndex);
                        if (capturedOutputPath) {
                            currentInputImagePath = capturedOutputPath;
                            break;
                        }
                        await ctx.event("chatgpt.capture_existing.missed", `Could not capture an existing ChatGPT output for ${phaseLabel}; resubmitting the prompt.`);
                    }
                    inputImagesByPrompt.set(promptIndex, currentInputImagePath);
                    await runPhaseTask("subject", phaseLabel, {
                        subjectMode: "submit-and-capture",
                        subjectImagePath: currentInputImagePath,
                        subjectIndex: promptIndex,
                        subjectInstruction: prompt
                    });
                    await outputProcessing;
                    if (outputProcessingError)
                        throw outputProcessingError;
                    if (pausedPrompt?.promptIndex === promptIndex && !outputKeysByPrompt.has(promptIndex))
                        continue;
                    const nextInputPath = outputPathsByPrompt.get(promptIndex);
                    if (!nextInputPath) {
                        throw new Error(`ChatGPT extension did not return an output image for prompt ${promptIndex + 1}.`);
                    }
                    currentInputImagePath = nextInputPath;
                }
                await ctx.pauseIfRequested(`Paused after ChatGPT ${phaseLabel}.`, manualActionData(phaseLabel));
            }
            normalizeChatGptExtensionSequenceOutputs(registeredOutputs, input.prompts);
            const manifestPath = node_path_1.default.join(artifactDir, "chatgpt-extension-sequence-manifest.json");
            writeJson(manifestPath, {
                masterPrompt: input.masterPrompt,
                sourceImages: input.sourceImages,
                prompts: input.prompts,
                extensionTab: redactTargetForManifest(input.extensionTab),
                chatGptPage: latestChatGptPage ?? null,
                selectors: input.selectors,
                outputMappings
            });
            const manifest = await ctx.addArtifact({
                kind: "json",
                name: node_path_1.default.basename(manifestPath),
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
    function canResumeFailedChatGptRun(run) {
        if (run.status !== "failed" || run.workflowId !== "based-blink.chatgpt.extension-image-transform")
            return false;
        const parsedInput = inputSchema.safeParse(run.input);
        if (!parsedInput.success)
            return false;
        const output = readStoredOutput(run.output);
        if (output?.checkpoint || output?.chatGptPage)
            return true;
        return Boolean(targetUrl(parsedInput.data.extensionTab));
    }
    function readStoredOutput(value) {
        const parsed = outputSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
    }
    function restoreCheckpointState(previousOutput, input, artifactDir) {
        const output = readStoredOutput(previousOutput);
        if (!output) {
            return { artifactIds: [], outputMappings: [], setupCompleted: false };
        }
        const restoredMappings = [];
        const artifactIds = new Set();
        for (const mapping of output.checkpoint?.outputMappings ?? []) {
            const restored = restoreOutputMapping(mapping, input, artifactDir);
            if (!restored)
                continue;
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
    function restoreOutputMapping(mapping, input, artifactDir) {
        if (!Number.isInteger(mapping.subjectIndex))
            return null;
        if (input.subjectImages[mapping.subjectIndex] !== mapping.subjectImage)
            return null;
        if (!mapping.outputPath || !node_fs_1.default.existsSync(mapping.outputPath))
            return null;
        const outputPath = node_path_1.default.resolve(mapping.outputPath);
        const resolvedArtifactDir = node_path_1.default.resolve(artifactDir);
        if (outputPath !== resolvedArtifactDir && !outputPath.startsWith(`${resolvedArtifactDir}${node_path_1.default.sep}`))
            return null;
        const mimeType = inferMimeType(outputPath) ?? "image/png";
        return {
            mapping,
            output: {
                subjectIndex: mapping.subjectIndex,
                subjectName: node_path_1.default.basename(mapping.subjectImage),
                name: node_path_1.default.basename(outputPath),
                mimeType,
                base64: node_fs_1.default.readFileSync(outputPath).toString("base64"),
                metadata: {
                    source: "restored-checkpoint",
                    artifactId: mapping.artifactId,
                    outputPath
                }
            }
        };
    }
    function resolvePausedSubjectForResume(storedPausedSubject, input, completedSubjects, setupCompleted) {
        if (!setupCompleted)
            return undefined;
        if (storedPausedSubject &&
            Number.isInteger(storedPausedSubject.subjectIndex) &&
            input.subjectImages[storedPausedSubject.subjectIndex] &&
            !completedSubjects.has(storedPausedSubject.subjectIndex)) {
            return storedPausedSubject;
        }
        return undefined;
    }
    function canResumeFailedChatGptSequenceRun(run) {
        if (run.status !== "failed" || run.workflowId !== "based-blink.chatgpt.extension-image-sequence")
            return false;
        const parsedInput = sequenceInputSchema.safeParse(run.input);
        if (!parsedInput.success)
            return false;
        const output = readStoredSequenceOutput(run.output);
        if (output?.checkpoint || output?.chatGptPage)
            return true;
        return Boolean(targetUrl(parsedInput.data.extensionTab));
    }
    function readStoredSequenceOutput(value) {
        const parsed = sequenceOutputSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
    }
    function restoreSequenceCheckpointState(previousOutput, input, artifactDir) {
        const output = readStoredSequenceOutput(previousOutput);
        if (!output) {
            return { artifactIds: [], outputMappings: [], setupCompleted: false };
        }
        const candidatesByPrompt = new Map();
        for (const mapping of output.checkpoint?.outputMappings ?? []) {
            const restored = restoreSequenceOutputMapping(mapping, input, artifactDir);
            if (!restored || candidatesByPrompt.has(restored.mapping.promptIndex))
                continue;
            candidatesByPrompt.set(restored.mapping.promptIndex, restored);
        }
        const restoredMappings = [];
        const artifactIds = new Set();
        for (let promptIndex = 0; promptIndex < input.prompts.length; promptIndex += 1) {
            const restored = candidatesByPrompt.get(promptIndex);
            if (!restored)
                break;
            artifactIds.add(restored.mapping.artifactId);
            restoredMappings.push(restored);
        }
        const completedPrompts = new Set(restoredMappings.map((mapping) => mapping.output.subjectIndex));
        const setupCompleted = input.masterPrompt ? Boolean(output.checkpoint?.setupCompleted) : true;
        const pausedPrompt = resolvePausedPromptForResume(output.checkpoint?.pausedPrompt, input, completedPrompts, setupCompleted);
        return {
            artifactIds: [...artifactIds],
            outputMappings: restoredMappings,
            setupCompleted,
            ...(output.chatGptPage ? { chatGptPage: output.chatGptPage } : {}),
            ...(pausedPrompt ? { pausedPrompt } : {})
        };
    }
    function restoreSequenceOutputMapping(mapping, input, artifactDir) {
        if (!Number.isInteger(mapping.promptIndex))
            return null;
        if (input.prompts[mapping.promptIndex] !== mapping.prompt)
            return null;
        if (!mapping.outputPath || !node_fs_1.default.existsSync(mapping.outputPath))
            return null;
        const outputPath = node_path_1.default.resolve(mapping.outputPath);
        const resolvedArtifactDir = node_path_1.default.resolve(artifactDir);
        if (outputPath !== resolvedArtifactDir && !outputPath.startsWith(`${resolvedArtifactDir}${node_path_1.default.sep}`))
            return null;
        const mimeType = inferMimeType(outputPath) ?? "image/png";
        return {
            mapping,
            output: {
                subjectIndex: mapping.promptIndex,
                subjectName: `prompt-${mapping.promptIndex + 1}`,
                name: node_path_1.default.basename(outputPath),
                mimeType,
                base64: node_fs_1.default.readFileSync(outputPath).toString("base64"),
                metadata: {
                    source: "restored-checkpoint",
                    artifactId: mapping.artifactId,
                    outputPath
                }
            }
        };
    }
    function resolvePausedPromptForResume(storedPausedPrompt, input, completedPrompts, setupCompleted) {
        if (!setupCompleted)
            return undefined;
        if (storedPausedPrompt &&
            Number.isInteger(storedPausedPrompt.promptIndex) &&
            input.prompts[storedPausedPrompt.promptIndex] &&
            !completedPrompts.has(storedPausedPrompt.promptIndex)) {
            return storedPausedPrompt;
        }
        return undefined;
    }
    class MissingExtensionTabError extends Error {
        constructor() {
            super("ChatGPT tab disconnected before the extension task completed.");
        }
    }
    function chatGptControllerManualMessage(error) {
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
    async function waitForTaskWithRecoverableTarget(taskId, target, ctx, timeoutMs, onClientSeen) {
        let missingSince = null;
        let taskPauseRequested = false;
        let settled = false;
        const wait = chatgpt
            .waitForTask(taskId, {
            signal: ctx.signal,
            timeoutMs
        })
            .then((result) => ({ result }), (error) => ({ error }))
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
    function recoverDisconnectedCommandError(error, _target) {
        if (isRecoverableExtensionCommandError(error)) {
            return new MissingExtensionTabError();
        }
        return error instanceof Error ? error : new Error(String(error));
    }
    function isRecoverableExtensionCommandError(error) {
        if (!(error instanceof Error))
            return false;
        return (/Timed out waiting for browser extension command/i.test(error.message) ||
            /No compatible BLINK browser extension tab is connected/i.test(error.message) ||
            /Selected browser extension tab is not connected/i.test(error.message));
    }
    return [chatGptExtensionImageTransformWorkflow, chatGptExtensionImageSequenceWorkflow];
}
function createChatGptBrowserController(browser, sleep) {
    const tasks = new Map();
    const eventListeners = new Map();
    const outputListeners = new Map();
    function emit(taskId, type, message, data) {
        const event = { taskId, type, message, ...(data === undefined ? {} : { data }), createdAt: new Date().toISOString() };
        for (const listener of eventListeners.get(taskId) ?? [])
            listener(event);
    }
    function output(taskId, value) {
        for (const listener of outputListeners.get(taskId) ?? [])
            listener(value);
    }
    return {
        createConversationTask(input) {
            const id = (0, node_crypto_1.randomUUID)();
            tasks.set(id, { ...input, id, target: input.target ?? { mode: "any" }, cancelled: false, pauseRequested: false });
            return { id };
        },
        async waitForTask(taskId, options) {
            const task = tasks.get(taskId);
            if (!task)
                throw new Error(`ChatGPT browser task not found: ${taskId}`);
            emit(task.id, "browser.task.started", `Running ChatGPT ${task.phase} controller in plugin code`, {
                phase: task.phase,
                target: redactTargetForManifest(task.target ?? { mode: "any" })
            });
            const result = await runChatGptBrowserTask(browser, sleep, task, options, emit);
            for (const item of result.outputs)
                output(task.id, item);
            emit(task.id, "browser.task.completed", `Completed ChatGPT ${task.phase} controller`, result.metadata);
            return result;
        },
        subscribeTask(taskId, listener) {
            const listeners = eventListeners.get(taskId) ?? new Set();
            listeners.add(listener);
            eventListeners.set(taskId, listeners);
            return () => listeners.delete(listener);
        },
        subscribeTaskOutput(taskId, listener) {
            const listeners = outputListeners.get(taskId) ?? new Set();
            listeners.add(listener);
            outputListeners.set(taskId, listeners);
            return () => listeners.delete(listener);
        },
        requestTaskPause(taskId) {
            const task = tasks.get(taskId);
            if (task)
                task.pauseRequested = true;
        },
        cancelTask(taskId) {
            const task = tasks.get(taskId);
            if (task)
                task.cancelled = true;
        },
        findCompatibleClientForTarget(target) {
            return browser.findCompatibleClientForTarget(target);
        },
        ensureRoutedTab(target, options) {
            return browser.ensureRoutedTab(target, options);
        }
    };
}
async function runChatGptBrowserTask(browser, sleep, task, options, emit) {
    const target = task.target ?? { mode: "any" };
    const selectors = normalizeChatGptSelectors(task.selectors);
    const baseline = task.subjectBaseline && typeof task.subjectBaseline === "object"
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
    if (!Number.isInteger(task.subjectIndex))
        throw new Error("ChatGPT subject task requires subjectIndex.");
    if (task.subjectMode !== "capture-existing") {
        if (!task.subjectImagePath)
            throw new Error("ChatGPT subject task requires subjectImagePath.");
        await removeChatGptComposerAttachments(browser, sleep, target, selectors, options.signal, task, emit);
        await attachAndSubmitChatGptSubjectImage(browser, sleep, target, selectors, task, options, emit);
        await waitForChatGptIdle(browser, sleep, target, selectors, options, task);
    }
    const captured = await waitForChatGptOutput(browser, sleep, target, selectors, baseline, options, task);
    return {
        outputs: [
            {
                subjectIndex: task.subjectIndex,
                ...(task.subjectImagePath ? { subjectName: node_path_1.default.basename(task.subjectImagePath) } : {}),
                name: captured.name,
                mimeType: captured.mimeType,
                base64: captured.base64,
                metadata: {
                    source: "generic-browser-extension",
                    fingerprint: captured.fingerprint,
                    src: captured.src,
                    width: captured.width,
                    height: captured.height
                }
            }
        ],
        metadata: pageMetadata(normalizeRecord(await browser.inspect(target, { signal: options.signal, timeoutMs: 30_000 })))
    };
}
async function attachAndSubmitChatGptSubjectImage(browser, sleep, target, selectors, task, options, emit) {
    if (!task.subjectImagePath)
        throw new Error("ChatGPT subject task requires subjectImagePath.");
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfTaskStopped(task);
        const files = browser.stageFiles([task.subjectImagePath]);
        await browser.action(target, { kind: "attach-file", selector: selectors.fileInput, files }, { signal: options.signal, timeoutMs: 30_000 });
        emit(task.id, "browser.task.files_attached", "Attached ChatGPT subject image", { count: files.length, attempt });
        try {
            await submitChatGptPrompt(browser, sleep, target, selectors, task.subjectInstruction ?? "", options, task, emit);
            return;
        }
        catch (error) {
            if (attempt >= maxAttempts || !isSubmitReadinessTimeout(error))
                throw error;
            emit(task.id, "browser.task.submit_retry", "Retrying ChatGPT subject upload after submit control did not become ready", {
                attempt,
                reason: error instanceof Error ? error.message : String(error)
            });
            await removeChatGptComposerAttachments(browser, sleep, target, selectors, options.signal, task, emit);
            await sleep(1_000, options.signal);
        }
    }
}
async function removeChatGptComposerAttachments(browser, sleep, target, selectors, signal, task, emit) {
    for (let removed = 0; removed < 6; removed += 1) {
        throwIfTaskStopped(task);
        const state = await elementStateOrNull(browser, target, selectors.removeAttachmentButton, signal);
        if (state?.visible !== true || state.disabled === true)
            return;
        await browser.action(target, { kind: "click", selector: selectors.removeAttachmentButton }, { signal, timeoutMs: 10_000 });
        emit?.(task.id, "browser.task.attachment_removed", "Removed stale ChatGPT composer attachment", { removed: removed + 1 });
        await sleep(500, signal);
    }
}
function isSubmitReadinessTimeout(error) {
    return error instanceof Error && /Timed out waiting for ChatGPT submit control to become ready/i.test(error.message);
}
function normalizeChatGptSelectors(selectors) {
    return {
        fileInput: stringValue(selectors?.fileInput) || "input[type='file']",
        composer: stringValue(selectors?.composer) || "#prompt-textarea, textarea[data-id='root'], textarea, [contenteditable='true']",
        submitButton: stringValue(selectors?.submitButton) ||
            "button[data-testid='send-button'], button[aria-label='Send prompt'], button[aria-label='Send message'], form button[type='submit']",
        stopButton: stringValue(selectors?.stopButton) ||
            "button[data-testid='stop-button'], button[data-testid='composer-stop-button'], button[aria-label='Stop'], button[aria-label^='Stop '], button[aria-label^='Cancel ']",
        removeAttachmentButton: stringValue(selectors?.removeAttachmentButton) || "button[aria-label^='Remove file']",
        outputImage: stringValue(selectors?.outputImage) || "img"
    };
}
async function submitChatGptPrompt(browser, sleep, target, selectors, prompt, options, task, emit) {
    if (prompt.trim()) {
        await fillAndVerifyPrompt(browser, target, selectors, prompt, options, task, emit);
    }
    await waitForChatGptSubmitReady(browser, sleep, target, selectors, options, task);
    await browser.action(target, { kind: "click", selector: selectors.submitButton }, { signal: options.signal, timeoutMs: 30_000 });
}
async function fillAndVerifyPrompt(browser, target, selectors, prompt, options, task, emit) {
    const fillResult = normalizeRecord(await browser.action(target, { kind: "fill", selector: selectors.composer, value: prompt }, { signal: options.signal, timeoutMs: 30_000 }));
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
async function waitForChatGptSubmitReady(browser, sleep, target, selectors, options, task) {
    const deadline = Date.now() + Math.min(options.timeoutMs, 120_000);
    while (Date.now() < deadline) {
        throwIfTaskStopped(task);
        const submit = normalizeRecord(await browser.extract(target, { kind: "element-state", selector: selectors.submitButton }, { signal: options.signal, timeoutMs: 10_000 }));
        const stop = await elementStateOrNull(browser, target, selectors.stopButton, options.signal);
        if (submit.visible === true && submit.disabled !== true && stop?.visible !== true)
            return;
        await sleep(750, options.signal);
    }
    throw new Error("Timed out waiting for ChatGPT submit control to become ready.");
}
async function waitForChatGptIdle(browser, sleep, target, selectors, options, task) {
    const deadline = Date.now() + Math.min(options.timeoutMs, 300_000);
    while (Date.now() < deadline) {
        throwIfTaskStopped(task);
        const stop = await elementStateOrNull(browser, target, selectors.stopButton, options.signal);
        if (stop?.visible !== true)
            return;
        await sleep(1_000, options.signal);
    }
}
async function waitForChatGptOutput(browser, sleep, target, selectors, baseline, options, task) {
    const previousFingerprints = baselineFingerprints(baseline);
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
        throwIfTaskStopped(task);
        const result = normalizeRecord(await browser.extract(target, {
            kind: "images",
            selector: selectors.outputImage,
            minWidth: 128,
            minHeight: 128,
            includeBase64: true,
            excludeFingerprints: previousFingerprints,
            latestFirst: true,
            maxImages: 6,
            fetchTimeoutMs: 8_000
        }, { signal: options.signal, timeoutMs: 120_000 }));
        const images = Array.isArray(result.images) ? result.images.map(normalizeRecord) : [];
        const captured = [...images].reverse().find((image) => stringValue(image.base64));
        if (captured) {
            return {
                src: stringValue(captured.src),
                fingerprint: stringValue(captured.fingerprint),
                width: numberValue(captured.width),
                height: numberValue(captured.height),
                mimeType: stringValue(captured.mimeType) || "image/png",
                base64: stringValue(captured.base64),
                name: "chatgpt-output.png"
            };
        }
        await sleep(1_500, options.signal);
    }
    throw new Error("Timed out waiting for a new ChatGPT output image.");
}
async function extractChatGptImageBaseline(browser, target, selectors, signal) {
    const result = normalizeRecord(await browser.extract(target, { kind: "images", selector: selectors.outputImage }, { signal, timeoutMs: 30_000 }));
    const images = Array.isArray(result.images) ? result.images.map(normalizeRecord) : [];
    return {
        imageFingerprints: images.map((image) => stringValue(image.fingerprint)).filter(Boolean)
    };
}
async function elementStateOrNull(browser, target, selector, signal) {
    try {
        return normalizeRecord(await browser.extract(target, { kind: "element-state", selector }, { signal, timeoutMs: 10_000 }));
    }
    catch {
        return null;
    }
}
function throwIfTaskStopped(task) {
    if (task.cancelled)
        throw new Error("ChatGPT browser task was cancelled.");
    if (task.pauseRequested) {
        throw new Error("ChatGPT browser task pause requested.");
    }
}
function baselineFingerprints(value) {
    if (!value || typeof value !== "object")
        return [];
    const record = value;
    return Array.isArray(record.imageFingerprints)
        ? record.imageFingerprints.filter((item) => typeof item === "string")
        : [];
}
function pageMetadata(page) {
    return {
        url: stringValue(page.url),
        title: stringValue(page.title)
    };
}
function normalizeRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value) {
    return typeof value === "string" ? value : "";
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function buildRecoverableTarget(target, page) {
    const url = page?.url ?? targetUrl(target);
    const title = page?.title ?? targetTitle(target);
    if (page?.clientId) {
        return {
            mode: "existing",
            clientId: page.clientId,
            ...(url ? { url } : {}),
            ...(title ? { title } : {})
        };
    }
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
function chatGptPageChanged(next, previous) {
    return (!previous ||
        next.url !== previous.url ||
        next.title !== previous.title ||
        next.clientId !== previous.clientId ||
        next.routingToken !== previous.routingToken);
}
function targetUrl(target) {
    return target.mode === "existing" || target.mode === "new" ? target.url : undefined;
}
function targetTitle(target) {
    return target.mode === "existing" || target.mode === "new" ? target.title : undefined;
}
function redactTargetForManifest(target) {
    if (target.mode === "existing")
        return { mode: target.mode, clientId: target.clientId };
    return { mode: target.mode };
}
function buildChatGptPage(target, metadata, targetClient) {
    const pageMetadata = readPageMetadata(metadata);
    const targetRecord = target;
    const url = firstNonEmptyString(pageMetadata.url, targetClient?.url, targetRecord.url);
    if (!url)
        return undefined;
    const title = firstNonEmptyString(pageMetadata.title, targetClient?.title, targetRecord.title);
    const clientId = firstNonEmptyString(targetClient?.id, target.mode === "existing" ? target.clientId : undefined);
    const routingToken = firstNonEmptyString(target.mode === "new" ? target.routingToken : undefined, targetClient?.routingToken);
    return {
        url,
        ...(title ? { title } : {}),
        ...(clientId ? { clientId } : {}),
        ...(routingToken ? { routingToken } : {}),
        capturedAt: new Date().toISOString()
    };
}
function readPageMetadata(metadata) {
    if (!metadata || typeof metadata !== "object")
        return {};
    const record = metadata;
    return {
        url: typeof record.url === "string" ? record.url : undefined,
        title: typeof record.title === "string" ? record.title : undefined
    };
}
function readPausedTaskMetadata(metadata) {
    if (!metadata || typeof metadata !== "object")
        return null;
    const record = metadata;
    if (record.paused !== true)
        return null;
    return {
        reason: typeof record.pauseReason === "string" ? record.pauseReason : undefined,
        baseline: record.subjectBaseline,
        captureDiagnostics: record.captureDiagnostics
    };
}
function firstNonEmptyString(...values) {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed)
            return trimmed;
    }
    return undefined;
}
function extensionForMimeType(mimeType) {
    if (mimeType === "image/webp")
        return "webp";
    if (mimeType === "image/jpeg")
        return "jpg";
    return "png";
}
function safeStem(filePath) {
    return node_path_1.default.parse(node_path_1.default.basename(filePath)).name.replace(/[^\w.-]+/g, "_") || "subject";
}
function outputFileNameForSubject(subjectImage, subjectIndex, extension, usedNames) {
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
function outputFileNameForPrompt(sourceImage, promptIndex, extension, usedNames) {
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
function normalizeChatGptExtensionOutputs(outputs, subjectImages) {
    const outputsBySubject = new Map();
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
        const subjectOutputs = outputsBySubject.get(subjectIndex) ?? new Map();
        subjectOutputs.set(outputIdentityKey(output), subjectOutputs.get(outputIdentityKey(output)) ?? output);
        outputsBySubject.set(subjectIndex, subjectOutputs);
    }
    return subjectImages.map((subjectImage, subjectIndex) => {
        const subjectOutputs = [...(outputsBySubject.get(subjectIndex)?.values() ?? [])];
        if (subjectOutputs.length === 0) {
            throw new Error(`ChatGPT extension did not return an output image for subject ${subjectIndex + 1}.`);
        }
        if (subjectOutputs.length > 1) {
            throw new Error(`ChatGPT extension returned ${subjectOutputs.length} distinct output images for subject ${subjectIndex + 1}. ` +
                "This workflow expects exactly one result per subject.");
        }
        return {
            subjectIndex,
            subjectImage,
            pairId: `subject-${subjectIndex + 1}`,
            output: subjectOutputs[0]
        };
    });
}
function normalizeChatGptExtensionSequenceOutputs(outputs, prompts) {
    const outputsByPrompt = new Map();
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
        const promptOutputs = outputsByPrompt.get(promptIndex) ?? new Map();
        promptOutputs.set(outputIdentityKey(output), promptOutputs.get(outputIdentityKey(output)) ?? output);
        outputsByPrompt.set(promptIndex, promptOutputs);
    }
    return prompts.map((prompt, promptIndex) => {
        const promptOutputs = [...(outputsByPrompt.get(promptIndex)?.values() ?? [])];
        if (promptOutputs.length === 0) {
            throw new Error(`ChatGPT extension did not return an output image for prompt ${promptIndex + 1}.`);
        }
        if (promptOutputs.length > 1) {
            throw new Error(`ChatGPT extension returned ${promptOutputs.length} distinct output images for prompt ${promptIndex + 1}. ` +
                "This workflow expects exactly one result per prompt.");
        }
        return {
            promptIndex,
            prompt,
            pairId: `prompt-${promptIndex + 1}`,
            output: promptOutputs[0]
        };
    });
}
function outputIdentityKey(output) {
    const hash = (0, node_crypto_1.createHash)("sha256").update(output.base64).digest("hex");
    return `${output.mimeType ?? "image/png"}:${hash}`;
}
