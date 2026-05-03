"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkflows = createWorkflows;
const node_path_1 = __importDefault(require("node:path"));
function createWorkflows(sdk) {
    const { z } = sdk.schema;
    const { launchPersistentProfile, saveScreenshot, startTrace, stopTrace, timeoutMinutes } = sdk.browser;
    const { WorkflowConfigurationError } = sdk.errors;
    const { inferMimeType } = sdk.files;
    const selectorsSchema = z
        .object({
        uploadInput: z.string().optional(),
        promptTextbox: z.string().optional(),
        generateButton: z.string().optional(),
        readyText: z.string().optional(),
        downloadButton: z.string().optional()
    })
        .default({});
    const inputSchema = z.object({
        images: z.array(z.string()).min(1, "Choose at least one image."),
        prompt: z.string().optional().default(""),
        profileName: z.string().optional().default("default"),
        headless: z.boolean().optional().default(false),
        pauseForManualLogin: z.boolean().optional().default(true),
        timeoutMinutes: z.number().min(1).max(240).optional().default(90),
        selectors: selectorsSchema
    });
    const outputSchema = z.object({
        artifactIds: z.array(z.string()),
        summary: z.string()
    });
    const hunyuanImageToModelWorkflow = {
        manifest: {
            id: "based-blink.hunyuan.image-to-model",
            title: "Hunyuan Image to 3D Model",
            description: "Drives 3d.hunyuan.tencent.com with a persistent profile and configurable selectors.",
            category: "hunyuan",
            version: "0.1.0",
            concurrency: 1,
            requiresBrowser: true,
            targetUrl: "https://3d.hunyuan.tencent.com/",
            outputKinds: ["model", "download", "trace", "screenshot"],
            uiCapabilities: ["browser.profile"],
            inputFields: [
                { name: "images", label: "Input images", type: "fileList", required: true },
                { name: "prompt", label: "Prompt", type: "textarea" },
                { name: "profileName", label: "Browser profile", type: "text", defaultValue: "default" },
                { name: "pauseForManualLogin", label: "Pause for manual login", type: "checkbox", defaultValue: true },
                {
                    name: "selectors",
                    label: "Selector config",
                    type: "json",
                    help: "Use Playwright codegen to calibrate selectors for upload, generation, readiness, and download."
                }
            ]
        },
        inputSchema,
        outputSchema,
        async run(input, ctx) {
            const artifactIds = [];
            const context = await launchPersistentProfile({
                paths: ctx.paths,
                workflowId: "hunyuan",
                profileName: input.profileName,
                headless: input.headless
            });
            const tracePath = await startTrace(context, ctx.artifactDir);
            try {
                const page = context.pages()[0] ?? (await context.newPage());
                await ctx.step("Opening Hunyuan", 5, { url: "https://3d.hunyuan.tencent.com/" });
                await page.goto("https://3d.hunyuan.tencent.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
                if (input.pauseForManualLogin) {
                    await ctx.waitForManualAction("Complete login or account checks in the browser, then resume this run.", {
                        url: page.url()
                    });
                }
                if (!input.selectors.uploadInput || !input.selectors.generateButton || !input.selectors.downloadButton) {
                    const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-selector-calibration.png");
                    const screenshotArtifact = await ctx.addArtifact({
                        kind: "screenshot",
                        name: node_path_1.default.basename(screenshot),
                        path: screenshot,
                        mimeType: "image/png"
                    });
                    artifactIds.push(screenshotArtifact.id);
                    throw new WorkflowConfigurationError("Hunyuan selectors are not configured. Use Workflow Lab to inspect the page controls and calibrate selector support.");
                }
                await ctx.step("Uploading images", 18);
                await page.locator(input.selectors.uploadInput).setInputFiles(input.images);
                if (input.prompt && input.selectors.promptTextbox) {
                    await ctx.step("Entering prompt", 25);
                    await page.locator(input.selectors.promptTextbox).fill(input.prompt);
                }
                await ctx.step("Starting generation", 32);
                await page.locator(input.selectors.generateButton).click();
                if (input.selectors.readyText) {
                    await ctx.step("Waiting for model generation", 55, { readyText: input.selectors.readyText });
                    await page.getByText(input.selectors.readyText, { exact: false }).waitFor({
                        timeout: timeoutMinutes(input.timeoutMinutes)
                    });
                }
                else {
                    await ctx.waitForManualAction("Wait until Hunyuan generation is ready, then resume to download.", { url: page.url() });
                }
                await ctx.step("Downloading result", 86);
                const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
                await page.locator(input.selectors.downloadButton).click();
                const download = await downloadPromise;
                const targetPath = node_path_1.default.join(ctx.artifactDir, download.suggestedFilename());
                await download.saveAs(targetPath);
                const artifact = await ctx.addArtifact({
                    kind: inferMimeType(targetPath)?.startsWith("model/") ? "model" : "download",
                    name: node_path_1.default.basename(targetPath),
                    path: targetPath,
                    mimeType: inferMimeType(targetPath),
                    metadata: { source: "hunyuan", pageUrl: page.url() }
                });
                artifactIds.push(artifact.id);
                return { artifactIds, summary: "Hunyuan workflow completed." };
            }
            finally {
                await stopTrace(context, tracePath).catch(() => undefined);
                const traceArtifact = await ctx.addArtifact({
                    kind: "trace",
                    name: "trace.zip",
                    path: tracePath,
                    mimeType: "application/zip"
                });
                artifactIds.push(traceArtifact.id);
                await context.close().catch(() => undefined);
            }
        }
    };
    return [hunyuanImageToModelWorkflow];
}
