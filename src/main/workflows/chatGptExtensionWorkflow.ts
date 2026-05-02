import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  extensionBridge,
  type ChatGptExtensionTaskTarget,
  type ExtensionClientStatus,
  type ExtensionTaskOutput,
  type ExtensionTaskResult
} from "../extension/extensionBridge";
import type { WorkflowContext, WorkflowDefinition } from "../runtime/types";
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

const inputSchema = z.object({
  referenceImages: z.array(z.string()).optional().default([]),
  subjectImages: z.array(z.string()).min(1, "Choose at least one subject image."),
  masterPrompt: z.string().min(1, "Master prompt is required."),
  subjectInstruction: z.string().optional().default(""),
  timeoutMinutes: z.number().min(1).max(240).optional().default(60),
  chatGptTab: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("any") }),
      z.object({ mode: z.literal("existing"), clientId: z.string().trim().min(1, "Choose a ChatGPT tab.") }),
      z.object({ mode: z.literal("new"), routingToken: z.string().trim().min(8, "New-tab routing token is required.") })
    ])
    .default({ mode: "any" }),
  selectors: selectorsSchema
});

const outputSchema = z.object({
  artifactIds: z.array(z.string()),
  summary: z.string()
});

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
  async run(input, ctx) {
    const artifactIds: string[] = [];
    const artifactDir = ctx.artifactDir;

    await ensureChatGptTargetAvailable(input.chatGptTab, ctx);

    await ctx.step("Queued sequential ChatGPT conversation task", 5, {
      referenceCount: input.referenceImages.length,
      subjectCount: input.subjectImages.length,
      targetMode: input.chatGptTab.mode
    });
    const task = extensionBridge.createChatGptConversationTask({
      runId: ctx.runId,
      masterPrompt: input.masterPrompt,
      referenceImagePaths: input.referenceImages,
      subjectImagePaths: input.subjectImages,
      subjectInstruction: input.subjectInstruction,
      selectors: input.selectors,
      target: input.chatGptTab
    });

    const unsubscribe = extensionBridge.subscribeTask(task.id, (event) => {
      void ctx.event("extension.task", event.message, {
        taskId: event.taskId,
        type: event.type,
        data: event.data
      });
    });

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

    const registerOutputArtifact = async (output: ExtensionTaskOutput): Promise<void> => {
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
          taskId: task.id,
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
    };

    const queueOutput = (output: ExtensionTaskOutput): void => {
      outputProcessing = outputProcessing.then(async () => {
        if (outputProcessingError) return;
        try {
          await registerOutputArtifact(output);
        } catch (error) {
          outputProcessingError = error instanceof Error ? error : new Error(String(error));
        }
      });
      void outputProcessing;
    };

    const unsubscribeOutput = extensionBridge.subscribeTaskOutput(task.id, queueOutput);

    try {
      const result = await extensionBridge.waitForTask(task.id, {
        signal: ctx.signal,
        timeoutMs: input.timeoutMinutes * 60_000
      });

      if (result.outputs.length === 0) {
        throw new Error("ChatGPT extension completed without returning any output images.");
      }

      for (const output of result.outputs) {
        queueOutput(output);
      }
      await outputProcessing;
      if (outputProcessingError) throw outputProcessingError;
      normalizeChatGptExtensionOutputs(registeredOutputs, input.subjectImages);
    } finally {
      unsubscribeOutput();
      unsubscribe();
    }

    const manifestPath = path.join(artifactDir, "chatgpt-extension-manifest.json");
    writeJson(manifestPath, {
      masterPrompt: input.masterPrompt,
      referenceImages: input.referenceImages,
      subjectImages: input.subjectImages,
      subjectInstruction: input.subjectInstruction,
      chatGptTab: redactTargetForManifest(input.chatGptTab),
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
      summary: `Processed ${input.subjectImages.length} subject image(s) through the ChatGPT Chrome extension.`
    };
  }
};

async function ensureChatGptTargetAvailable(target: ChatGptExtensionTaskTarget, ctx: WorkflowContext): Promise<void> {
  if (target.mode === "new") {
    await ctx.step("Waiting for new ChatGPT tab to check in", 3, { targetMode: target.mode });
    const client = await waitForCompatibleTarget(target, ctx.signal, 45_000);
    if (!client) {
      throw new Error(
        "Could not detect the newly opened ChatGPT tab. Open ChatGPT in the Chrome profile with the Based BLINK extension installed, then start the run again."
      );
    }
    await ctx.event("extension.routing", `Targeting new ChatGPT tab: ${describeClient(client)}`, {
      clientId: client.id,
      url: client.url,
      targetMode: target.mode
    });
    return;
  }

  if (target.mode === "existing") {
    const client = extensionBridge.findCompatibleClientForTarget(target);
    if (!client) {
      throw new Error(
        "The selected ChatGPT tab is no longer connected or is running an incompatible extension. Refresh the tab list, choose a compatible tab, or choose a new tab."
      );
    }
    await ctx.event("extension.routing", `Targeting selected ChatGPT tab: ${describeClient(client)}`, {
      clientId: client.id,
      url: client.url,
      targetMode: target.mode
    });
    return;
  }

  let extensionStatus = extensionBridge.status();
  if (!extensionStatus.connectedClients.some((client) => client.compatible)) {
    await ctx.waitForManualAction(
      "Open ChatGPT in Chrome with the Based BLINK extension installed. If Chrome already has the extension open, reload the unpacked extension and refresh ChatGPT tabs, then resume this run."
    );
  }
  extensionStatus = extensionBridge.status();
  if (!extensionStatus.connectedClients.some((client) => client.compatible)) {
    throw new Error(
      `No compatible ChatGPT extension tab is connected. Reload the unpacked Chrome extension and refresh ChatGPT tabs. App requires extension protocol ${extensionStatus.requiredProtocolVersion}.`
    );
  }
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

function describeClient(client: ExtensionClientStatus): string {
  return client.title || client.url || client.id;
}

function redactTargetForManifest(target: ChatGptExtensionTaskTarget): Record<string, string> {
  if (target.mode === "existing") return { mode: target.mode, clientId: target.clientId };
  return { mode: target.mode };
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
