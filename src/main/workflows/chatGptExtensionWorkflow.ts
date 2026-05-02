import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { extensionBridge, type ChatGptExtensionTaskTarget, type ExtensionClientStatus } from "../extension/extensionBridge";
import { getRunArtifactDir } from "../runtime/paths";
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
    const runDir = getRunArtifactDir(ctx.paths, ctx.runId);

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
      artifactId: string;
      outputPath: string;
    }> = [];

    try {
      const result = await extensionBridge.waitForTask(task.id, {
        signal: ctx.signal,
        timeoutMs: input.timeoutMinutes * 60_000
      });

      if (result.outputs.length === 0) {
        throw new Error("ChatGPT extension completed without returning any output images.");
      }

      const totalsBySubject = countOutputsBySubject(result.outputs);
      const seenBySubject = new Map<number, number>();
      const completedSubjects = new Set<number>();

      for (const output of result.outputs) {
        const subjectIndex = output.subjectIndex;
        const subjectImage = input.subjectImages[subjectIndex];
        if (!subjectImage) {
          throw new Error(`ChatGPT extension returned output for unknown subject index ${subjectIndex}.`);
        }

        const count = (seenBySubject.get(subjectIndex) ?? 0) + 1;
        seenBySubject.set(subjectIndex, count);
        completedSubjects.add(subjectIndex);

        const mimeType = output.mimeType ?? "image/png";
        const extension = extensionForMimeType(mimeType);
        const suffix = (totalsBySubject.get(subjectIndex) ?? 0) > 1 ? `-${count}` : "";
        const outputPath = path.join(runDir, `${safeStem(subjectImage)}-chatgpt${suffix}.${extension}`);
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
            taskId: task.id,
            extensionMetadata: output.metadata ?? null
          }
        });
        artifactIds.push(artifact.id);
        outputMappings.push({ subjectIndex, subjectImage, artifactId: artifact.id, outputPath });
      }

      if (completedSubjects.size < input.subjectImages.length) {
        throw new Error("ChatGPT extension did not return an output image for every subject image.");
      }
    } finally {
      unsubscribe();
    }

    const manifestPath = path.join(runDir, "chatgpt-extension-manifest.json");
    writeJson(manifestPath, {
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
        "Could not detect the newly opened ChatGPT tab. Open ChatGPT in the Chrome profile with the Browser Workflow Automation extension installed, then start the run again."
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
      "Open ChatGPT in Chrome with the Browser Workflow Automation extension installed. If Chrome already has the extension open, reload the unpacked extension and refresh ChatGPT tabs, then resume this run."
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

function countOutputsBySubject(outputs: Array<{ subjectIndex: number }>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const output of outputs) {
    counts.set(output.subjectIndex, (counts.get(output.subjectIndex) ?? 0) + 1);
  }
  return counts;
}
