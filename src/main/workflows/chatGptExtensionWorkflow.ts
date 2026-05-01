import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { extensionBridge } from "../extension/extensionBridge";
import { getRunArtifactDir } from "../runtime/paths";
import type { WorkflowDefinition } from "../runtime/types";
import { inferMimeType, writeJson } from "../utils/files";

const selectorsSchema = z
  .object({
    fileInput: z.string().optional(),
    composer: z.string().optional(),
    submitButton: z.string().optional(),
    outputImage: z.string().optional()
  })
  .default({});

const inputSchema = z.object({
  images: z.array(z.string()).min(1, "Choose at least one image."),
  masterPrompt: z.string().min(1, "Master prompt is required."),
  timeoutMinutes: z.number().min(1).max(240).optional().default(60),
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
      { name: "images", label: "Input images", type: "fileList", required: true },
      { name: "masterPrompt", label: "Master prompt", type: "textarea", required: true },
      {
        name: "selectors",
        label: "Selector config",
        type: "json",
        help: "Optional CSS selectors for file input, composer, submit button, and output image."
      }
    ]
  },
  inputSchema,
  outputSchema,
  async run(input, ctx) {
    const artifactIds: string[] = [];
    const runDir = getRunArtifactDir(ctx.paths, ctx.runId);

    if (extensionBridge.status().connectedClients.length === 0) {
      await ctx.waitForManualAction(
        "Open ChatGPT in Chrome with the Browser Workflow Automation extension installed, then resume this run."
      );
    }

    for (const [index, imagePath] of input.images.entries()) {
      await ctx.step(
        `Queued image ${index + 1} of ${input.images.length} for ChatGPT extension`,
        Math.round(5 + (index / input.images.length) * 85)
      );
      const task = extensionBridge.createChatGptImageTask({
        runId: ctx.runId,
        prompt: input.masterPrompt,
        imagePath,
        selectors: input.selectors
      });

      const unsubscribe = extensionBridge.subscribeTask(task.id, (event) => {
        void ctx.event("extension.task", event.message, {
          taskId: event.taskId,
          type: event.type,
          data: event.data
        });
      });

      try {
        const result = await extensionBridge.waitForTask(task.id, {
          signal: ctx.signal,
          timeoutMs: input.timeoutMinutes * 60_000
        });

        for (const [outputIndex, output] of result.outputs.entries()) {
          const mimeType = output.mimeType ?? "image/png";
          const extension = mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpg" : "png";
          const outputPath = path.join(runDir, `chatgpt-extension-output-${index + 1}-${outputIndex + 1}.${extension}`);
          fs.writeFileSync(outputPath, Buffer.from(output.base64, "base64"));
          const artifact = await ctx.addArtifact({
            kind: "image",
            name: path.basename(outputPath),
            path: outputPath,
            mimeType: inferMimeType(outputPath) ?? mimeType,
            metadata: { source: "chatgpt-extension", inputImage: imagePath, taskId: task.id }
          });
          artifactIds.push(artifact.id);
        }
      } finally {
        unsubscribe();
      }
    }

    const manifestPath = path.join(runDir, "chatgpt-extension-manifest.json");
    writeJson(manifestPath, {
      inputCount: input.images.length,
      selectors: input.selectors
    });
    const manifest = await ctx.addArtifact({
      kind: "json",
      name: path.basename(manifestPath),
      path: manifestPath,
      mimeType: "application/json"
    });
    artifactIds.push(manifest.id);

    return { artifactIds, summary: `Processed ${input.images.length} image(s) through the ChatGPT Chrome extension.` };
  }
};
