"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STUDIO_SELECTORS = exports.HUNYUAN_GLOBAL_TARGET_URL = exports.HUNYUAN_GLOBAL_WORKFLOW_ID = void 0;
exports.createWorkflows = createWorkflows;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const studioHelpers_1 = require("./studioHelpers");
exports.HUNYUAN_GLOBAL_WORKFLOW_ID = "navoke.hunyuan.global.image-to-model";
exports.HUNYUAN_GLOBAL_TARGET_URL = "https://hy3d.tencent.ai/studio/creation/prop/geo";
exports.STUDIO_SELECTORS = {
    multiView: "text=/^Multi-View$/",
    addViews: "text=/^Add Multi-View \\(Min2, Max8\\)$/",
    viewCard: (n) => `[class*="h-[730px]"] > div:nth-child(${n})`,
    faceCount: "text=/^50k$/",
    generate: "text=/^Generate Now$/",
    retopology: 'a[href="/studio/creation/prop/poly"]',
    topology: (value) => `text=/^${value}$/`,
    medium: "text=/^Medium$/",
    texture: 'a[href="/studio/creation/prop/texture"]',
    imageToTexture: "text=/^Image-to-Texture/",
    download: 'button:has-text("Download")',
    exportHover: "*:has(> button.toolbar-button-TCrII)",
    glb: "text=/^glb$/"
};
function createWorkflows(sdk) {
    const { z } = sdk.schema;
    const inputSchema = z.object({
        frontImage: z.string().trim().min(1),
        backImage: z.string().trim().min(1),
        topology: z.enum(["Quads", "Triangles", "Original"]).default("Quads")
    }).strict();
    const outputSchema = z.object({ artifactIds: z.array(z.string()), summary: z.string() });
    const workflow = {
        manifest: {
            id: exports.HUNYUAN_GLOBAL_WORKFLOW_ID,
            title: "Hunyuan Global Studio Image to 3D Model",
            description: "Generate a textured GLB prop from front and rear references in Hunyuan Global Studio.",
            category: "hunyuan", version: "0.3.0", concurrency: 3, requiresBrowser: false,
            targetUrl: exports.HUNYUAN_GLOBAL_TARGET_URL, outputKinds: ["model", "json"],
            inputFields: [
                { name: "frontImage", label: "Front reference", type: "fileList", fileValue: "single", maxFiles: 1, required: true, fileFilters: [{ name: "PNG images", extensions: ["png"] }] },
                { name: "backImage", label: "Rear reference", type: "fileList", fileValue: "single", maxFiles: 1, required: true, fileFilters: [{ name: "PNG images", extensions: ["png"] }] },
                { name: "topology", label: "Topology", type: "select", defaultValue: "Quads", options: [
                        { label: "Quads", value: "Quads" }, { label: "Triangles", value: "Triangles" }, { label: "Original", value: "Original" }
                    ], help: "Original keeps the 50k geometry. Quads and Triangles use Medium retopology." }
            ]
        },
        inputSchema, outputSchema,
        async run(input, ctx) {
            const browser = sdk.extension.browser;
            const apiBase = (0, studioHelpers_1.projectApiBase)(ctx.paths.projectDir);
            for (const file of [input.frontImage, input.backImage]) {
                if (!node_fs_1.default.statSync(file).isFile())
                    throw new Error(`Reference is not a file: ${file}`);
            }
            const target = {
                mode: "new", routingToken: node_crypto_1.default.randomUUID(), url: exports.HUNYUAN_GLOBAL_TARGET_URL, openMode: "window", background: true
            };
            let ownedClient;
            let session;
            let pausedMs = 0;
            const artifactIds = [];
            const options = { signal: ctx.signal, timeoutMs: 30_000 };
            async function request(route, body, method = "POST", cleanup = false) {
                const response = await fetch(apiBase + route, {
                    method, headers: { "Content-Type": "application/json" },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                    signal: cleanup ? AbortSignal.timeout(15_000) : AbortSignal.any([ctx.signal, AbortSignal.timeout(45_000)])
                });
                const result = await response.json();
                if (!response.ok)
                    throw new Error(result.error || `Workflow Lab request failed (${response.status}).`);
                return result;
            }
            const route = (suffix = "") => `/api/lab/sessions/${session.id}${suffix}`;
            async function saveJson(name, value) {
                const file = node_path_1.default.join(ctx.artifactDir, name);
                node_fs_1.default.writeFileSync(file, JSON.stringify(value, null, 2));
                const artifact = await ctx.addArtifact({ kind: "json", name, path: file, mimeType: "application/json" });
                artifactIds.push(artifact.id);
            }
            async function manual(message) {
                ctx.signal.throwIfAborted();
                const start = Date.now();
                await ctx.waitForManualAction(message, { tabId: ownedClient?.tabId, controllerId: ownedClient?.controllerId });
                pausedMs += Date.now() - start;
                ctx.signal.throwIfAborted();
            }
            async function read(query) {
                for (;;) {
                    ctx.signal.throwIfAborted();
                    try {
                        return await browser.extract(target, query, options);
                    }
                    catch (error) {
                        ctx.signal.throwIfAborted();
                        if (browser.findCompatibleClientForTarget(target))
                            throw error;
                        await manual("Reconnect the Navoke controller and refresh this run's Hunyuan window, then resume. Keep the current model open.");
                    }
                }
            }
            async function text() {
                for (;;) {
                    const body = String((await read({ kind: "text" })).text || "");
                    const reason = (0, studioHelpers_1.manualActionReason)(body);
                    if (!reason)
                        return body;
                    await manual(reason);
                }
            }
            const state = (selector) => read({ kind: "element-state", selector });
            const images = () => read({ kind: "images" });
            async function capture(label) {
                await saveJson(`lab-${label}.json`, await request(route("/inspect")));
            }
            async function waitFor(check, label, timeoutMs = 180_000) {
                const start = Date.now();
                const initialPaused = pausedMs;
                while (Date.now() - start - (pausedMs - initialPaused) < timeoutMs) {
                    ctx.signal.throwIfAborted();
                    if (await check())
                        return;
                    await (0, studioHelpers_1.abortableDelay)(2_000, ctx.signal);
                }
                throw new Error(`Timed out: ${label}`);
            }
            const action = (value) => request(route("/actions"), { action: value });
            async function click(selector) {
                // Check human gates before an action. Never blindly retry a submitted generation.
                await text();
                const ready = await request(route("/wait"), { condition: { kind: "element", selector, state: "visible", timeoutMs: 30_000 } });
                if (!ready.satisfied) {
                    await text();
                    throw new Error(`Control did not become ready: ${selector}; ${ready.reason}`);
                }
                await action({ kind: "click", selector });
            }
            async function generate(label, progress) {
                await ctx.step(label, progress);
                await capture(`before-${progress}`);
                await click(exports.STUDIO_SELECTORS.generate);
                await waitFor(async () => {
                    const body = await text();
                    const failure = (0, studioHelpers_1.modelFailure)(body);
                    if (failure)
                        throw new Error(`${label} reported: ${failure}`);
                    return (0, studioHelpers_1.isModelRunning)(body);
                }, `${label} start`, 60_000);
                await capture(`running-${progress}`);
                await waitFor(async () => {
                    const body = await text();
                    const failure = (0, studioHelpers_1.modelFailure)(body);
                    if (failure)
                        throw new Error(`${label} reported: ${failure}`);
                    return (0, studioHelpers_1.isModelReady)(body) && (await state(exports.STUDIO_SELECTORS.download)).visible;
                }, `${label} completion`, 1_800_000);
                await capture(`complete-${progress}`);
            }
            async function uploadViews() {
                await click(exports.STUDIO_SELECTORS.multiView);
                await click(exports.STUDIO_SELECTORS.addViews);
                for (const [n, file, label] of [[2, input.frontImage, "Front View"], [3, input.backImage, "Back View"]]) {
                    const selector = exports.STUDIO_SELECTORS.viewCard(n);
                    const card = await state(selector);
                    if (card.count !== 1 || !card.text.includes(label))
                        throw new Error(`Unexpected multiview slot layout for ${label}.`);
                    await action({ kind: "attach-file", selector: `${selector} input[type=file]`, filePaths: [file] });
                    await waitFor(async () => {
                        await text();
                        const result = await state(selector);
                        if (/failed|unsupported/i.test(result.text))
                            throw new Error(`Reference rejected: ${label}; ${result.text}`);
                        return result.count === 1 && !result.text.includes(label) && !/Uploading|Loading|Detecting/i.test(result.text);
                    }, `accept ${label}`);
                }
            }
            try {
                const system = await request("/api/system", undefined, "GET");
                if (node_path_1.default.resolve(system.paths.projectDir) !== node_path_1.default.resolve(ctx.paths.projectDir))
                    throw new Error("Active Navoke runtime belongs to another project.");
                for (;;) {
                    try {
                        ownedClient = await browser.ensureRoutedTab(target, { signal: ctx.signal, timeoutMs: 90_000 });
                        break;
                    }
                    catch (error) {
                        ctx.signal.throwIfAborted();
                        await manual(`Connect the Navoke Browser Controller (protocol 7) in your Hunyuan Chrome profile, then resume. ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                session = await request("/api/lab/sessions", { mode: "extension", clientId: ownedClient.id, targetUrl: ownedClient.url });
                await ctx.event("lab.session", "Hunyuan Studio workflow captured in Workflow Lab", { sessionId: session.id, background: true, tabId: ownedClient.tabId });
                await waitFor(async () => /Image to Geometry/.test(await text()), "Studio ready");
                await capture("studio-ready");
                await ctx.step("Uploading front and rear references", 10);
                await uploadViews();
                const originals = input.topology === "Original" ? (0, studioHelpers_1.referenceUrls)((await images()).images) : [];
                if (input.topology === "Original" && originals.length !== 2)
                    throw new Error("Expected two uploaded reference URLs before preserving geometry.");
                await click(exports.STUDIO_SELECTORS.faceCount);
                await generate("Generating 50k prop geometry", 25);
                if (input.topology !== "Original") {
                    await click(exports.STUDIO_SELECTORS.retopology);
                    await click(exports.STUDIO_SELECTORS.topology(input.topology));
                    await click(exports.STUDIO_SELECTORS.medium);
                    await generate(`Generating ${input.topology.toLowerCase()} retopology`, 50);
                }
                else {
                    await ctx.event("geometry.preserved", "Preserving original 50k geometry for texture painting");
                }
                await click(exports.STUDIO_SELECTORS.texture);
                await click(exports.STUDIO_SELECTORS.imageToTexture);
                if (input.topology === "Original") {
                    await click(exports.STUDIO_SELECTORS.multiView);
                    (0, studioHelpers_1.verifyRetainedReferences)(originals, (await images()).images);
                    await ctx.event("references.reused", "Texture painting reuses the verified geometry reference pair", { referenceUrls: originals });
                }
                else {
                    await uploadViews();
                }
                await generate("Painting reference textures", 75);
                const release = await (0, studioHelpers_1.acquireExport)(ctx.signal);
                try {
                    await ctx.step("Opening GLB export menu", 90);
                    await text();
                    await action({ kind: "hover", selector: exports.STUDIO_SELECTORS.exportHover });
                    await capture("export-menu");
                    const watch = browser.startDownloadWatch();
                    await click(exports.STUDIO_SELECTORS.glb);
                    await ctx.step("Downloading textured GLB", 95);
                    const download = await browser.waitForDownload(watch.id, { signal: ctx.signal, timeoutMs: 180_000 });
                    const metadata = (0, studioHelpers_1.modelMetadata)(input, node_fs_1.default.readFileSync(download.filename));
                    const modelPath = node_path_1.default.join(ctx.artifactDir, "prop.glb");
                    node_fs_1.default.copyFileSync(download.filename, modelPath);
                    const model = await ctx.addArtifact({ kind: "model", name: "prop.glb", path: modelPath, mimeType: "model/gltf-binary", metadata });
                    artifactIds.push(model.id);
                    await saveJson("model-manifest.json", metadata);
                }
                finally {
                    release();
                }
            }
            catch (error) {
                // A cancelled run still gets diagnostics: don't reuse its aborted signal.
                if (ownedClient) {
                    await browser.inspect(target, { timeoutMs: 10_000 })
                        .then((inspection) => saveJson("last-ui-state.json", inspection))
                        .catch(() => undefined);
                }
                throw error;
            }
            finally {
                if (session) {
                    await request(route(), undefined, "GET", true)
                        .then((log) => saveJson("workflow-lab-session.json", log))
                        .catch((error) => ctx.event("lab.history-failed", "Could not save Workflow Lab history", { error: String(error) }).catch(() => undefined));
                    await request(route(), undefined, "DELETE", true).catch(() => undefined);
                }
                const client = ownedClient ?? browser.findCompatibleClientForTarget(target);
                if (client?.tabId) {
                    await browser.closeTab(client.tabId, { controllerId: client.controllerId, timeoutMs: 15_000 })
                        .catch((error) => ctx.event("browser.cleanup-failed", "Could not close run-owned Hunyuan window", { tabId: client.tabId, error: String(error) }).catch(() => undefined));
                }
            }
            await ctx.step("Hunyuan Global Studio completed", 100);
            return { artifactIds, summary: "Textured GLB generated in a background window; Workflow Lab captured each phase and action." };
        }
    };
    return [workflow];
}
