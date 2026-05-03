"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG = exports.HUNYUAN_EXPORT_FORMATS = exports.HUNYUAN_RETOPOLOGY_TYPES = exports.HUNYUAN_FACE_COUNTS = exports.HUNYUAN_VIEW_SLOTS = void 0;
exports.buildHunyuanViewUploadPlan = buildHunyuanViewUploadPlan;
exports.mergeHunyuanSelectorConfig = mergeHunyuanSelectorConfig;
exports.missingHunyuanSelectorKeys = missingHunyuanSelectorKeys;
exports.inferHunyuanArtifactKind = inferHunyuanArtifactKind;
exports.createWorkflows = createWorkflows;
exports.clickHunyuanGenerateButton = clickHunyuanGenerateButton;
exports.clickHunyuanActionButton = clickHunyuanActionButton;
exports.clickVisibleHunyuanControl = clickVisibleHunyuanControl;
exports.detectHunyuanLoginState = detectHunyuanLoginState;
const node_path_1 = __importDefault(require("node:path"));
exports.HUNYUAN_VIEW_SLOTS = [
    { field: "frontImage", selectorKey: "front", label: "Front", required: true },
    { field: "backImage", selectorKey: "back", label: "Back" },
    { field: "leftImage", selectorKey: "left", label: "Left" },
    { field: "rightImage", selectorKey: "right", label: "Right" },
    { field: "topImage", selectorKey: "top", label: "Top" },
    { field: "bottomImage", selectorKey: "bottom", label: "Bottom" },
    { field: "left45Image", selectorKey: "left45", label: "Left 45" },
    { field: "right45Image", selectorKey: "right45", label: "Right 45" }
];
exports.HUNYUAN_FACE_COUNTS = ["1.5m", "1m", "500k", "50k"];
exports.HUNYUAN_RETOPOLOGY_TYPES = ["triangle", "quad"];
exports.HUNYUAN_EXPORT_FORMATS = ["obj", "glb"];
const HUNYUAN_TEXT = {
    login: "\u767b\u5f55",
    imageTo3d: "\u56fe\u751f3D",
    multipleImages: "\u591a\u5f20\u56fe\u7247",
    addMultipleViews: "\u6dfb\u52a0\u591a\u89c6\u56fe",
    uploading: "\u4e0a\u4f20\u4e2d",
    modelFaceCount: "\u6a21\u578b\u9762\u6570",
    modelType: "\u6a21\u578b\u7c7b\u578b",
    geometryTexturePhased: "\u51e0\u4f55\u3001\u7eb9\u7406\u5206\u9636\u6bb5",
    generate: "\u7acb\u5373\u751f\u6210",
    generating: "\u751f\u6210\u4e2d",
    estimatedRemaining: "\u9884\u8ba1\u8fd8\u9700",
    v31: "3D\u751f\u6210-V3.1",
    triangle: "\u4e09\u89d2\u9762",
    quad: "\u56db\u8fb9\u9762",
    smartRetopology: "\u667a\u80fd\u62d3\u6251",
    generateTexture: "\u751f\u6210\u7eb9\u7406",
    autoRig: "\u81ea\u52a8\u7ed1\u9aa8",
    download: "\u4e0b\u8f7d"
};
function hunyuanEnabledButtonSelector(label) {
    return `:is(button, .t-button):not(.t-is-disabled):not([disabled]):has-text("${label}")`;
}
exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG = {
    loginReadySelector: `label.t-radio-button:has-text("${HUNYUAN_TEXT.imageTo3d}")`,
    loginRequiredSelector: `button.login-btn:has-text("${HUNYUAN_TEXT.login}")`,
    imageTo3dTab: `label.t-radio-button:has-text("${HUNYUAN_TEXT.imageTo3d}")`,
    multipleImagesTab: `text=${HUNYUAN_TEXT.multipleImages}`,
    addMultipleViewsButton: ".hy-multiple-views-upload-v2",
    multipleViewsConfirmButton: `.hy-multi-view-grid__header:has-text("${HUNYUAN_TEXT.addMultipleViews}") .hy-multi-view-grid__header-close`,
    viewUploadInputs: {
        front: '.hy-upload-card--front input[type="file"]',
        back: '.hy-upload-card--back input[type="file"]',
        left: '.hy-upload-card--left input[type="file"]',
        right: '.hy-upload-card--right input[type="file"]',
        top: '.hy-upload-card--top input[type="file"]',
        bottom: '.hy-upload-card--bottom input[type="file"]',
        left45: '.hy-upload-card--left-front input[type="file"]',
        right45: '.hy-upload-card--right-front input[type="file"]'
    },
    modelDropdown: ".model-version-select:visible",
    modelOptionV31: `li.t-select-option:has-text("${HUNYUAN_TEXT.v31}")`,
    faceCountButtons: {
        "1.5m": `div.generation-type-select:visible:has(.generation-type-select-title:has-text("${HUNYUAN_TEXT.modelFaceCount}")) .qaUJkqcCF813NIqHGF3U:visible:has-text("1.5m")`,
        "1m": `div.generation-type-select:visible:has(.generation-type-select-title:has-text("${HUNYUAN_TEXT.modelFaceCount}")) .qaUJkqcCF813NIqHGF3U:visible:has-text("1m")`,
        "500k": `div.generation-type-select:visible:has(.generation-type-select-title:has-text("${HUNYUAN_TEXT.modelFaceCount}")) .qaUJkqcCF813NIqHGF3U:visible:has-text("500k")`,
        "50k": `div.generation-type-select:visible:has(.generation-type-select-title:has-text("${HUNYUAN_TEXT.modelFaceCount}")) .qaUJkqcCF813NIqHGF3U:visible:has-text("50k")`
    },
    modelTypeGeometryTexturePhased: `div.generation-type-select:visible:has(.generation-type-select-title:has-text("${HUNYUAN_TEXT.modelType}")) .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_TEXT.geometryTexturePhased}")`,
    generateButton: `.sideBarLeft-generateBtn:not(.t-is-disabled):not([disabled]):has-text("${HUNYUAN_TEXT.generate}")`,
    geometryRunningText: HUNYUAN_TEXT.generating,
    geometryReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.smartRetopology),
    retopologyTypeButtons: {
        triangle: `.topology-panel .topo-type-select .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_TEXT.triangle}")`,
        quad: `.topology-panel .topo-type-select .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_TEXT.quad}")`
    },
    smartRetopologyButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.smartRetopology),
    retopologyRunningText: HUNYUAN_TEXT.generating,
    retopologyReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.generateTexture),
    generateTextureButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.generateTexture),
    textureRunningText: HUNYUAN_TEXT.generating,
    textureReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download),
    autoRigButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.autoRig),
    autoRigRunningText: HUNYUAN_TEXT.generating,
    autoRigReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download),
    exportFormatDropdown: 'div.t-select:has-text("OBJ")',
    exportFormatOptions: {
        obj: 'li.t-select-option:has-text("OBJ")',
        glb: 'li.t-select-option:has-text("GLB")'
    },
    downloadReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download),
    downloadButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download)
};
function buildHunyuanViewUploadPlan(input) {
    return exports.HUNYUAN_VIEW_SLOTS.flatMap((slot) => {
        const value = input[slot.field];
        const imagePath = typeof value === "string" ? value.trim() : "";
        return imagePath ? [{ field: slot.field, selectorKey: slot.selectorKey, label: slot.label, imagePath }] : [];
    });
}
function mergeHunyuanSelectorConfig(selectors) {
    return {
        ...exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG,
        ...compactSelectorObject(selectors),
        viewUploadInputs: mergeSelectorRecord(exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG.viewUploadInputs, selectors?.viewUploadInputs),
        faceCountButtons: mergeSelectorRecord(exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG.faceCountButtons, selectors?.faceCountButtons),
        retopologyTypeButtons: mergeSelectorRecord(exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG.retopologyTypeButtons, selectors?.retopologyTypeButtons),
        exportFormatOptions: mergeSelectorRecord(exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG.exportFormatOptions, selectors?.exportFormatOptions)
    };
}
function missingHunyuanSelectorKeys(input) {
    const selectors = input.selectors ?? {};
    const missing = [];
    const requireSelector = (key, value) => {
        if (!hasSelector(value))
            missing.push(key);
    };
    const requireWait = (label, selector, text) => {
        if (!hasSelector(selector) && !hasSelector(text))
            missing.push(`${label}Selector or ${label}Text`);
    };
    requireSelector("imageTo3dTab", selectors.imageTo3dTab);
    requireSelector("multipleImagesTab", selectors.multipleImagesTab);
    requireSelector("addMultipleViewsButton", selectors.addMultipleViewsButton);
    for (const upload of buildHunyuanViewUploadPlan(input)) {
        requireSelector(`viewUploadInputs.${upload.selectorKey}`, selectors.viewUploadInputs?.[upload.selectorKey]);
    }
    requireSelector("modelDropdown", selectors.modelDropdown);
    requireSelector("modelOptionV31", selectors.modelOptionV31);
    requireSelector(`faceCountButtons.${input.modelFaceCount ?? "50k"}`, selectors.faceCountButtons?.[input.modelFaceCount ?? "50k"]);
    requireSelector("modelTypeGeometryTexturePhased", selectors.modelTypeGeometryTexturePhased);
    requireSelector("generateButton", selectors.generateButton);
    requireWait("geometryReady", selectors.geometryReadySelector, selectors.geometryReadyText);
    requireSelector(`retopologyTypeButtons.${input.retopologyType ?? "quad"}`, selectors.retopologyTypeButtons?.[input.retopologyType ?? "quad"]);
    requireSelector("smartRetopologyButton", selectors.smartRetopologyButton);
    requireWait("retopologyReady", selectors.retopologyReadySelector, selectors.retopologyReadyText);
    if (input.generateTexture ?? true) {
        requireSelector("generateTextureButton", selectors.generateTextureButton);
        requireWait("textureReady", selectors.textureReadySelector, selectors.textureReadyText);
    }
    if (input.autoRig ?? false) {
        requireSelector("autoRigButton", selectors.autoRigButton);
        requireWait("autoRigReady", selectors.autoRigReadySelector, selectors.autoRigReadyText);
    }
    requireSelector("exportFormatDropdown", selectors.exportFormatDropdown);
    requireSelector(`exportFormatOptions.${input.exportFormat ?? "obj"}`, selectors.exportFormatOptions?.[input.exportFormat ?? "obj"]);
    requireSelector("downloadButton", selectors.downloadButton);
    return missing;
}
function inferHunyuanArtifactKind(filePath, inferMimeType) {
    return inferMimeType(filePath)?.startsWith("model/") ? "model" : "download";
}
function createWorkflows(sdk) {
    const { z } = sdk.schema;
    const { launchPersistentProfile, saveScreenshot, startTrace, stopTrace, timeoutMinutes } = sdk.browser;
    const { WorkflowConfigurationError } = sdk.errors;
    const { inferMimeType, writeJson } = sdk.files;
    const stringSelectorSchema = z.preprocess((value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value), z.string().trim().min(1).optional());
    const viewUploadSelectorsSchema = z
        .object({
        front: stringSelectorSchema,
        back: stringSelectorSchema,
        left: stringSelectorSchema,
        right: stringSelectorSchema,
        top: stringSelectorSchema,
        bottom: stringSelectorSchema,
        left45: stringSelectorSchema,
        right45: stringSelectorSchema
    })
        .default({});
    const faceCountSelectorsSchema = z
        .object({
        "1.5m": stringSelectorSchema,
        "1m": stringSelectorSchema,
        "500k": stringSelectorSchema,
        "50k": stringSelectorSchema
    })
        .default({});
    const retopologyTypeSelectorsSchema = z
        .object({
        triangle: stringSelectorSchema,
        quad: stringSelectorSchema
    })
        .default({});
    const exportFormatSelectorsSchema = z
        .object({
        obj: stringSelectorSchema,
        glb: stringSelectorSchema
    })
        .default({});
    const selectorsSchema = z
        .object({
        imageTo3dTab: stringSelectorSchema,
        loginReadySelector: stringSelectorSchema,
        loginReadyText: stringSelectorSchema,
        loginRequiredSelector: stringSelectorSchema,
        loginRequiredText: stringSelectorSchema,
        multipleImagesTab: stringSelectorSchema,
        addMultipleViewsButton: stringSelectorSchema,
        multipleViewsConfirmButton: stringSelectorSchema,
        viewUploadInputs: viewUploadSelectorsSchema,
        modelDropdown: stringSelectorSchema,
        modelOptionV31: stringSelectorSchema,
        faceCountButtons: faceCountSelectorsSchema,
        modelTypeGeometryTexturePhased: stringSelectorSchema,
        promptTextbox: stringSelectorSchema,
        generateButton: stringSelectorSchema,
        geometryRunningSelector: stringSelectorSchema,
        geometryRunningText: stringSelectorSchema,
        geometryReadySelector: stringSelectorSchema,
        geometryReadyText: stringSelectorSchema,
        retopologyTypeButtons: retopologyTypeSelectorsSchema,
        smartRetopologyButton: stringSelectorSchema,
        retopologyRunningSelector: stringSelectorSchema,
        retopologyRunningText: stringSelectorSchema,
        retopologyReadySelector: stringSelectorSchema,
        retopologyReadyText: stringSelectorSchema,
        generateTextureButton: stringSelectorSchema,
        textureRunningSelector: stringSelectorSchema,
        textureRunningText: stringSelectorSchema,
        textureReadySelector: stringSelectorSchema,
        textureReadyText: stringSelectorSchema,
        autoRigButton: stringSelectorSchema,
        autoRigRunningSelector: stringSelectorSchema,
        autoRigRunningText: stringSelectorSchema,
        autoRigReadySelector: stringSelectorSchema,
        autoRigReadyText: stringSelectorSchema,
        exportFormatDropdown: stringSelectorSchema,
        exportFormatOptions: exportFormatSelectorsSchema,
        downloadReadySelector: stringSelectorSchema,
        downloadReadyText: stringSelectorSchema,
        downloadButton: stringSelectorSchema
    })
        .default({});
    const optionalImageSchema = z.string().trim().optional().default("");
    const inputSchema = z
        .object({
        frontImage: z.string().trim().min(1, "Choose a front image."),
        backImage: optionalImageSchema,
        leftImage: optionalImageSchema,
        rightImage: optionalImageSchema,
        topImage: optionalImageSchema,
        bottomImage: optionalImageSchema,
        left45Image: optionalImageSchema,
        right45Image: optionalImageSchema,
        prompt: z.string().optional().default(""),
        profileName: z.string().optional().default("default"),
        headless: z.boolean().optional().default(false),
        pauseForManualLogin: z.boolean().optional().default(true),
        timeoutMinutes: z.number().min(1).max(240).optional().default(90),
        modelFaceCount: z.enum(["1.5m", "1m", "500k", "50k"]).optional().default("50k"),
        retopologyType: z.enum(["triangle", "quad"]).optional().default("quad"),
        generateTexture: z.boolean().optional().default(true),
        autoRig: z.boolean().optional().default(false),
        exportFormat: z.enum(["obj", "glb"]).optional().default("obj"),
        selectors: selectorsSchema
    })
        .superRefine((input, ctx) => {
        if (buildHunyuanViewUploadPlan(input).length < 2) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Choose a front image and at least one additional view image.",
                path: ["frontImage"]
            });
        }
    });
    const outputSchema = z.object({
        artifactIds: z.array(z.string()),
        summary: z.string(),
        modelArtifactId: z.string().optional(),
        manifestArtifactId: z.string().optional()
    });
    const hunyuanImageToModelWorkflow = {
        manifest: {
            id: "based-blink.hunyuan.image-to-model",
            title: "Hunyuan Image to 3D Model",
            description: "Generates one textured, retopologized model from multiple Hunyuan reference views.",
            category: "hunyuan",
            version: "0.1.0",
            concurrency: 1,
            requiresBrowser: true,
            targetUrl: "https://3d.hunyuan.tencent.com/",
            outputKinds: ["model", "download", "trace", "screenshot", "json"],
            uiCapabilities: ["browser.profile"],
            inputFields: [
                { name: "frontImage", label: "Front image", type: "fileList", required: true },
                { name: "backImage", label: "Back image", type: "fileList" },
                { name: "leftImage", label: "Left image", type: "fileList" },
                { name: "rightImage", label: "Right image", type: "fileList" },
                { name: "topImage", label: "Top image", type: "fileList" },
                { name: "bottomImage", label: "Bottom image", type: "fileList" },
                { name: "left45Image", label: "Left 45 image", type: "fileList" },
                { name: "right45Image", label: "Right 45 image", type: "fileList" },
                { name: "prompt", label: "Prompt", type: "textarea" },
                {
                    name: "modelFaceCount",
                    label: "Model face count",
                    type: "select",
                    defaultValue: "50k",
                    options: exports.HUNYUAN_FACE_COUNTS.map((value) => ({ label: value, value }))
                },
                {
                    name: "retopologyType",
                    label: "Retopology",
                    type: "select",
                    defaultValue: "quad",
                    options: [
                        { label: "Triangle", value: "triangle" },
                        { label: "Quad", value: "quad" }
                    ]
                },
                { name: "generateTexture", label: "Generate texture", type: "checkbox", defaultValue: true },
                { name: "autoRig", label: "Auto-rig", type: "checkbox", defaultValue: false },
                {
                    name: "exportFormat",
                    label: "Export format",
                    type: "select",
                    defaultValue: "obj",
                    options: [
                        { label: "OBJ", value: "obj" },
                        { label: "GLB", value: "glb" }
                    ]
                },
                { name: "profileName", label: "Browser profile", type: "text", defaultValue: "default" },
                { name: "pauseForManualLogin", label: "Pause for manual login", type: "checkbox", defaultValue: true },
                {
                    name: "selectors",
                    label: "Selector config",
                    type: "json",
                    help: "Workflow Lab can override the built-in Hunyuan selector preset if the page changes."
                }
            ]
        },
        inputSchema,
        outputSchema,
        async run(input, ctx) {
            const artifactIds = [];
            const phaseEvents = [];
            const uploadPlan = buildHunyuanViewUploadPlan(input);
            const selectors = mergeHunyuanSelectorConfig(input.selectors);
            const context = await launchPersistentProfile({
                paths: ctx.paths,
                workflowId: "hunyuan",
                profileName: input.profileName,
                headless: input.headless
            });
            const tracePath = await startTrace(context, ctx.artifactDir);
            function recordPhase(phase, data) {
                phaseEvents.push({ phase, completedAt: new Date().toISOString(), ...(data === undefined ? {} : { data }) });
            }
            try {
                const page = context.pages()[0] ?? (await context.newPage());
                await ctx.step("Opening Hunyuan", 5, { url: "https://3d.hunyuan.tencent.com/" });
                await page.goto("https://3d.hunyuan.tencent.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
                if (input.pauseForManualLogin) {
                    const loginState = await detectHunyuanLoginState(page, selectors, 5_000);
                    if (loginState.loggedIn) {
                        await ctx.step("Using existing Hunyuan login session", 8, loginState);
                    }
                    else {
                        await ctx.waitForManualAction("Complete login or account checks in the browser, then resume this run.", {
                            url: page.url(),
                            loginState
                        });
                    }
                }
                const missingSelectors = missingHunyuanSelectorKeys({ ...input, selectors });
                if (missingSelectors.length > 0) {
                    const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-selector-calibration.png");
                    const screenshotArtifact = await ctx.addArtifact({
                        kind: "screenshot",
                        name: node_path_1.default.basename(screenshot),
                        path: screenshot,
                        mimeType: "image/png",
                        metadata: { source: "hunyuan", missingSelectors }
                    });
                    artifactIds.push(screenshotArtifact.id);
                    throw new WorkflowConfigurationError(`Hunyuan selectors are not configured. Missing selector keys: ${missingSelectors.join(", ")}. Use Workflow Lab to inspect the page controls and calibrate selector support.`);
                }
                await clickSelector(page, selectors.imageTo3dTab);
                await clickSelector(page, selectors.multipleImagesTab);
                await clickSelector(page, selectors.addMultipleViewsButton);
                await ctx.step("Uploading multiview images", 15, { views: uploadPlan.map((upload) => upload.selectorKey) });
                for (const upload of uploadPlan) {
                    await page.locator(selectors.viewUploadInputs[upload.selectorKey]).first().setInputFiles(upload.imagePath);
                    recordPhase(`uploaded-${upload.selectorKey}`, { imagePath: upload.imagePath });
                }
                await ctx.step("Waiting for Hunyuan uploads", 20, { views: uploadPlan.map((upload) => upload.selectorKey) });
                await waitForHunyuanUploadProcessingComplete(page, timeoutMinutes(input.timeoutMinutes));
                await closeHunyuanMultipleViewsModal(page, selectors);
                await ctx.step("Applying Hunyuan settings", 25, {
                    modelFaceCount: input.modelFaceCount,
                    retopologyType: input.retopologyType,
                    generateTexture: input.generateTexture,
                    autoRig: input.autoRig,
                    exportFormat: input.exportFormat
                });
                try {
                    await clickSelector(page, selectors.modelDropdown);
                    await clickSelector(page, selectors.modelOptionV31);
                    await clickVisibleHunyuanControl(page, selectors.faceCountButtons[input.modelFaceCount], `faceCountButtons.${input.modelFaceCount}`);
                    await clickVisibleHunyuanControl(page, selectors.modelTypeGeometryTexturePhased, "modelTypeGeometryTexturePhased");
                    if (input.prompt.trim() && hasSelector(selectors.promptTextbox)) {
                        await page.locator(selectors.promptTextbox).first().fill(input.prompt);
                    }
                    recordPhase("settings-applied", {
                        modelFaceCount: input.modelFaceCount,
                        retopologyType: input.retopologyType,
                        generateTexture: input.generateTexture,
                        autoRig: input.autoRig,
                        exportFormat: input.exportFormat
                    });
                }
                catch (error) {
                    const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-settings-calibration.png");
                    const screenshotArtifact = await ctx.addArtifact({
                        kind: "screenshot",
                        name: node_path_1.default.basename(screenshot),
                        path: screenshot,
                        mimeType: "image/png",
                        metadata: {
                            source: "hunyuan",
                            phase: "settings",
                            modelFaceCount: input.modelFaceCount,
                            retopologyType: input.retopologyType,
                            exportFormat: input.exportFormat
                        }
                    });
                    artifactIds.push(screenshotArtifact.id);
                    throw new WorkflowConfigurationError(`Hunyuan settings selector failed. Saved calibration screenshot artifact ${screenshotArtifact.id}. ${formatErrorMessage(error)}`);
                }
                await ctx.step("Starting geometry generation", 35);
                try {
                    await clickHunyuanGenerateButton(page, selectors.generateButton, 120_000);
                    await waitForHunyuanGenerationStarted(page, selectors, 60_000);
                    recordPhase("geometry-started", { url: page.url() });
                }
                catch (error) {
                    const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-generate-calibration.png");
                    const screenshotArtifact = await ctx.addArtifact({
                        kind: "screenshot",
                        name: node_path_1.default.basename(screenshot),
                        path: screenshot,
                        mimeType: "image/png",
                        metadata: {
                            source: "hunyuan",
                            phase: "generate",
                            selector: selectors.generateButton,
                            modelFaceCount: input.modelFaceCount,
                            retopologyType: input.retopologyType,
                            exportFormat: input.exportFormat
                        }
                    });
                    artifactIds.push(screenshotArtifact.id);
                    throw new WorkflowConfigurationError(`Hunyuan generate button failed. Saved calibration screenshot artifact ${screenshotArtifact.id}. ${formatErrorMessage(error)}`);
                }
                await waitForHunyuanReady(page, selectors.geometryReadySelector, selectors.geometryReadyText, timeoutMinutes(input.timeoutMinutes));
                recordPhase("geometry-ready", { url: page.url() });
                await ctx.step("Running smart retopology", 55, { retopologyType: input.retopologyType });
                await clickVisibleHunyuanControl(page, selectors.retopologyTypeButtons[input.retopologyType], `retopologyTypeButtons.${input.retopologyType}`);
                await clickAndVerifyHunyuanActionStarted(page, {
                    selector: selectors.smartRetopologyButton,
                    selectorKey: "smartRetopologyButton",
                    runningSelector: selectors.retopologyRunningSelector,
                    runningText: selectors.retopologyRunningText,
                    readySelector: selectors.retopologyReadySelector,
                    readyText: selectors.retopologyReadyText
                });
                await waitForHunyuanReadyAfterRunning(page, selectors.retopologyRunningSelector, selectors.retopologyRunningText, selectors.retopologyReadySelector, selectors.retopologyReadyText, timeoutMinutes(input.timeoutMinutes));
                recordPhase("retopology-ready", { retopologyType: input.retopologyType });
                if (input.generateTexture) {
                    await ctx.step("Generating texture", 72);
                    await clickAndVerifyHunyuanActionStarted(page, {
                        selector: selectors.generateTextureButton,
                        selectorKey: "generateTextureButton",
                        runningSelector: selectors.textureRunningSelector,
                        runningText: selectors.textureRunningText,
                        readySelector: selectors.textureReadySelector,
                        readyText: selectors.textureReadyText
                    });
                    await waitForHunyuanReadyAfterRunning(page, selectors.textureRunningSelector, selectors.textureRunningText, selectors.textureReadySelector, selectors.textureReadyText, timeoutMinutes(input.timeoutMinutes));
                    recordPhase("texture-ready");
                }
                if (input.autoRig) {
                    await ctx.step("Running auto-rig", 80);
                    await clickAndVerifyHunyuanActionStarted(page, {
                        selector: selectors.autoRigButton,
                        selectorKey: "autoRigButton",
                        runningSelector: selectors.autoRigRunningSelector,
                        runningText: selectors.autoRigRunningText,
                        readySelector: selectors.autoRigReadySelector,
                        readyText: selectors.autoRigReadyText
                    });
                    await waitForHunyuanReadyAfterRunning(page, selectors.autoRigRunningSelector, selectors.autoRigRunningText, selectors.autoRigReadySelector, selectors.autoRigReadyText, timeoutMinutes(input.timeoutMinutes));
                    recordPhase("auto-rig-ready");
                }
                await ctx.step("Preparing download", 88, { exportFormat: input.exportFormat });
                if (hasSelector(selectors.downloadReadySelector) || hasSelector(selectors.downloadReadyText)) {
                    await waitForHunyuanReady(page, selectors.downloadReadySelector, selectors.downloadReadyText, timeoutMinutes(input.timeoutMinutes));
                }
                await clickSelector(page, selectors.exportFormatDropdown);
                await clickSelector(page, selectors.exportFormatOptions[input.exportFormat]);
                await ctx.step("Downloading result", 94);
                const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
                await clickHunyuanActionButton(page, selectors.downloadButton, "downloadButton", 120_000);
                const download = await downloadPromise;
                const targetPath = node_path_1.default.join(ctx.artifactDir, download.suggestedFilename());
                await download.saveAs(targetPath);
                const modelArtifact = await ctx.addArtifact({
                    kind: inferHunyuanArtifactKind(targetPath, inferMimeType),
                    name: node_path_1.default.basename(targetPath),
                    path: targetPath,
                    mimeType: inferMimeType(targetPath),
                    metadata: { source: "hunyuan", pageUrl: page.url(), exportFormat: input.exportFormat, phases: phaseEvents }
                });
                artifactIds.push(modelArtifact.id);
                recordPhase("downloaded", { targetPath, artifactId: modelArtifact.id });
                const manifestPath = node_path_1.default.join(ctx.artifactDir, "hunyuan-image-to-model-manifest.json");
                writeJson(manifestPath, {
                    source: "hunyuan",
                    pageUrl: page.url(),
                    viewImages: uploadPlan.map(({ field, selectorKey, label, imagePath }) => ({ field, selectorKey, label, imagePath })),
                    settings: {
                        modelFaceCount: input.modelFaceCount,
                        retopologyType: input.retopologyType,
                        generateTexture: input.generateTexture,
                        autoRig: input.autoRig,
                        exportFormat: input.exportFormat
                    },
                    phases: phaseEvents,
                    download: {
                        artifactId: modelArtifact.id,
                        path: targetPath,
                        filename: node_path_1.default.basename(targetPath),
                        mimeType: inferMimeType(targetPath)
                    }
                });
                const manifestArtifact = await ctx.addArtifact({
                    kind: "json",
                    name: node_path_1.default.basename(manifestPath),
                    path: manifestPath,
                    mimeType: "application/json",
                    metadata: { source: "hunyuan", modelArtifactId: modelArtifact.id }
                });
                artifactIds.push(manifestArtifact.id);
                return {
                    artifactIds,
                    modelArtifactId: modelArtifact.id,
                    manifestArtifactId: manifestArtifact.id,
                    summary: "Hunyuan workflow completed."
                };
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
function hasSelector(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function compactSelectorObject(selectors) {
    if (!selectors)
        return {};
    return Object.fromEntries(Object.entries(selectors).filter(([, value]) => {
        if (typeof value === "string")
            return hasSelector(value);
        return value !== undefined;
    }));
}
function mergeSelectorRecord(defaults, selectors) {
    return { ...(defaults ?? {}), ...compactSelectorObject(selectors) };
}
async function clickSelector(page, selector) {
    await page.locator(selector).first().click();
}
const HUNYUAN_GENERATE_BUTTON_READY_SELECTOR = `.sideBarLeft-generateBtn:not(.t-is-disabled):not([disabled]):has-text("${HUNYUAN_TEXT.generate}")`;
const HUNYUAN_GENERATE_BUTTON_ANY_SELECTOR = `.sideBarLeft-generateBtn:has-text("${HUNYUAN_TEXT.generate}")`;
async function clickHunyuanGenerateButton(page, selector, timeoutMs = 120_000) {
    await clickHunyuanActionButton(page, selector, "generateButton", timeoutMs, [HUNYUAN_GENERATE_BUTTON_READY_SELECTOR, HUNYUAN_GENERATE_BUTTON_ANY_SELECTOR]);
}
async function clickHunyuanActionButton(page, selector, selectorKey, timeoutMs = 120_000, fallbackSelectors = []) {
    const resolvedSelectors = Array.from(new Set([selector, ...fallbackSelectors].filter(hasSelector)));
    const deadline = Date.now() + timeoutMs;
    let diagnostics = [];
    while (Date.now() < deadline) {
        diagnostics = [];
        for (const candidateSelector of resolvedSelectors) {
            const locator = page.locator(candidateSelector);
            const candidateCount = await safeLocatorCount(locator);
            const diagnostic = {
                selector: candidateSelector,
                candidates: candidateCount,
                visible: 0,
                enabled: 0,
                disabled: 0,
                actionable: 0
            };
            for (let index = 0; index < candidateCount; index += 1) {
                const candidate = locator.nth(index);
                const visible = await safeIsVisible(candidate);
                if (visible)
                    diagnostic.visible += 1;
                const enabled = await safeIsEnabled(candidate);
                if (enabled)
                    diagnostic.enabled += 1;
                const disabled = await safeHasDisabledState(candidate);
                if (disabled)
                    diagnostic.disabled += 1;
                if (visible && enabled && !disabled) {
                    diagnostic.actionable += 1;
                    try {
                        await candidate.click({ timeout: 5_000 });
                        return;
                    }
                    catch (error) {
                        diagnostic.lastClickError = formatErrorMessage(error);
                    }
                }
            }
            diagnostics.push(diagnostic);
        }
        await safeWaitForTimeout(page, 250);
    }
    throw new Error(`Hunyuan action ${selectorKey} did not become clickable before timeout. ` +
        diagnostics
            .map((diagnostic) => `selector=${diagnostic.selector}; candidates=${diagnostic.candidates}; visible=${diagnostic.visible}; enabled=${diagnostic.enabled}; disabled=${diagnostic.disabled}; actionable=${diagnostic.actionable}; lastClickError=${diagnostic.lastClickError ?? ""}`)
            .join(" | "));
}
async function waitForHunyuanGenerationStarted(page, selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (hasSelector(selectors.geometryRunningSelector) && (await isSelectorVisible(page, selectors.geometryRunningSelector, 500)))
            return;
        if (hasSelector(selectors.geometryRunningText) && (await isTextVisible(page, selectors.geometryRunningText, 500)))
            return;
        if ((await hasVisibleText(page, HUNYUAN_TEXT.generating)) || (await hasVisibleText(page, HUNYUAN_TEXT.estimatedRemaining)))
            return;
        const configuredGenerateVisible = await isSelectorVisible(page, selectors.generateButton, 250);
        const anyGenerateVisible = await isSelectorVisible(page, HUNYUAN_GENERATE_BUTTON_ANY_SELECTOR, 250);
        if (!configuredGenerateVisible && !anyGenerateVisible)
            return;
        await safeWaitForTimeout(page, 500);
    }
    throw new Error(`Hunyuan did not enter geometry generation after clicking generate. ` +
        `runningSelector=${selectors.geometryRunningSelector ?? ""}; runningText=${selectors.geometryRunningText ?? ""}; generateSelector=${selectors.generateButton ?? ""}`);
}
async function clickAndVerifyHunyuanActionStarted(page, input, startTimeoutMs = 60_000) {
    await clickHunyuanActionButton(page, input.selector, input.selectorKey, 120_000);
    await waitForHunyuanActionStarted(page, input, startTimeoutMs);
}
async function waitForHunyuanActionStarted(page, input, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (hasSelector(input.runningSelector) && (await isSelectorVisible(page, input.runningSelector, 500)))
            return;
        if (hasSelector(input.runningText) && (await isTextVisible(page, input.runningText, 500)))
            return;
        if ((await hasVisibleText(page, HUNYUAN_TEXT.generating)) || (await hasVisibleText(page, HUNYUAN_TEXT.estimatedRemaining)))
            return;
        if (!(await isSelectorVisible(page, input.selector, 250)))
            return;
        await safeWaitForTimeout(page, 500);
    }
    throw new Error(`Hunyuan action ${input.selectorKey} did not enter a running or ready state after clicking. ` +
        `selector=${input.selector}; runningSelector=${input.runningSelector ?? ""}; runningText=${input.runningText ?? ""}; ` +
        `readySelector=${input.readySelector ?? ""}; readyText=${input.readyText ?? ""}`);
}
async function waitForHunyuanReadyAfterRunning(page, runningSelector, runningText, readySelector, readyText, timeoutMs) {
    if (!hasSelector(readySelector) && !hasSelector(readyText)) {
        throw new Error("Hunyuan ready-after-running wait requires a ready selector or ready text.");
    }
    const deadline = Date.now() + timeoutMs;
    let stableReadySince = 0;
    while (Date.now() < deadline) {
        const running = (hasSelector(runningSelector) && (await isSelectorVisible(page, runningSelector, 500))) ||
            (hasSelector(runningText) && (await isTextVisible(page, runningText, 500))) ||
            (await hasVisibleText(page, HUNYUAN_TEXT.generating)) ||
            (await hasVisibleText(page, HUNYUAN_TEXT.estimatedRemaining));
        if (running) {
            stableReadySince = 0;
            await safeWaitForTimeout(page, 500);
            continue;
        }
        const ready = (hasSelector(readySelector) && (await isSelectorVisible(page, readySelector, 500))) ||
            (hasSelector(readyText) && (await isTextVisible(page, readyText, 500)));
        if (ready) {
            stableReadySince ||= Date.now();
            if (Date.now() - stableReadySince >= 1_000)
                return;
        }
        else {
            stableReadySince = 0;
        }
        await safeWaitForTimeout(page, 500);
    }
    throw new Error(`Timed out waiting for Hunyuan action to finish. runningSelector=${runningSelector ?? ""}; runningText=${runningText ?? ""}; ` +
        `readySelector=${readySelector ?? ""}; readyText=${readyText ?? ""}`);
}
async function closeHunyuanMultipleViewsModal(page, selectors) {
    let closeError;
    const closeSelectors = [
        selectors.multipleViewsConfirmButton,
        `.hy-multi-view-grid__header:has-text("${HUNYUAN_TEXT.addMultipleViews}") .hy-multi-view-grid__header-close`,
        ".hy-multi-view-grid__header-close"
    ].filter(hasSelector);
    for (const closeSelector of closeSelectors) {
        try {
            await page.locator(closeSelector).first().click({ timeout: 2_000 });
            await waitForHunyuanMultipleViewsModalHidden(page, 10_000);
            return;
        }
        catch (error) {
            closeError = error;
        }
    }
    try {
        await page.evaluate(() => {
            const closeButton = document.querySelector(".hy-multi-view-grid__header-close");
            closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        });
        await waitForHunyuanMultipleViewsModalHidden(page, 10_000);
        return;
    }
    catch (error) {
        closeError = error;
    }
    try {
        await page.keyboard.press("Escape");
        await waitForHunyuanMultipleViewsModalHidden(page, 10_000);
        return;
    }
    catch (error) {
        throw new Error(`Hunyuan multiview modal did not close after uploads. Configure multipleViewsConfirmButton. ` +
            `closeSelector=${selectors.multipleViewsConfirmButton ?? ""}; fallbackSelectors=${closeSelectors.join(", ")}; ` +
            `closeError=${formatErrorMessage(closeError)}; waitError=${formatErrorMessage(error)}`);
    }
}
async function waitForHunyuanMultipleViewsModalHidden(page, timeoutMs) {
    const popup = page.locator(".hy-multiple-views-upload-v2-popup").first();
    if ((await safeLocatorCount(popup)) > 0) {
        await popup.waitFor({ state: "hidden", timeout: timeoutMs });
        return;
    }
    await page.locator(`.hy-multi-view-grid__header-title:has-text("${HUNYUAN_TEXT.addMultipleViews}")`).first().waitFor({
        state: "hidden",
        timeout: timeoutMs
    });
}
async function waitForHunyuanUploadProcessingComplete(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let stableSince = 0;
    while (Date.now() < deadline) {
        const uploadingVisible = await hasVisibleText(page, HUNYUAN_TEXT.uploading);
        if (!uploadingVisible) {
            stableSince ||= Date.now();
            if (Date.now() - stableSince >= 1_000)
                return;
        }
        else {
            stableSince = 0;
        }
        await page.waitForTimeout(250);
    }
    throw new Error(`Timed out waiting for Hunyuan upload processing to finish. Visible text still matched "${HUNYUAN_TEXT.uploading}".`);
}
async function hasVisibleText(page, text) {
    return page.evaluate((needle) => {
        function isVisible(element) {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        }
        return Array.from(document.body.querySelectorAll("*")).some((element) => isVisible(element) && (element.textContent ?? "").includes(needle));
    }, text);
}
const HUNYUAN_CLICKABLE_ANCESTOR_XPATH = "xpath=ancestor-or-self::*[self::button or self::label or @role='button' or @role='radio' or contains(concat(' ', normalize-space(@class), ' '), ' qaUJkqcCF813NIqHGF3U ') or contains(concat(' ', normalize-space(@class), ' '), ' t-radio-button ') or contains(concat(' ', normalize-space(@class), ' '), ' t-button ')][1]";
async function clickVisibleHunyuanControl(page, selector, selectorKey) {
    const locator = page.locator(selector);
    let directClickError;
    try {
        await locator.first().click({ timeout: 1_500 });
        return;
    }
    catch (error) {
        directClickError = error;
    }
    const candidateCount = await safeLocatorCount(locator);
    let visibleCount = 0;
    let enabledCount = 0;
    let ancestorCandidateCount = 0;
    let ancestorVisibleCount = 0;
    let ancestorEnabledCount = 0;
    for (let index = 0; index < candidateCount; index += 1) {
        const candidate = locator.nth(index);
        const candidateVisible = await safeIsVisible(candidate);
        if (candidateVisible) {
            visibleCount += 1;
            if (await safeIsEnabled(candidate)) {
                enabledCount += 1;
                await candidate.click({ timeout: 5_000 });
                return;
            }
        }
        const ancestor = candidate.locator(HUNYUAN_CLICKABLE_ANCESTOR_XPATH).first();
        ancestorCandidateCount += 1;
        if (await safeIsVisible(ancestor)) {
            ancestorVisibleCount += 1;
            if (await safeIsEnabled(ancestor)) {
                ancestorEnabledCount += 1;
                await ancestor.click({ timeout: 5_000 });
                return;
            }
        }
    }
    throw new Error(`Hunyuan selector ${selectorKey} did not resolve to a visible enabled control. ` +
        `selector=${selector}; candidates=${candidateCount}; visible=${visibleCount}; enabled=${enabledCount}; ` +
        `ancestorCandidates=${ancestorCandidateCount}; ancestorVisible=${ancestorVisibleCount}; ancestorEnabled=${ancestorEnabledCount}; ` +
        `directClickError=${formatErrorMessage(directClickError)}`);
}
async function safeLocatorCount(locator) {
    try {
        return await locator.count();
    }
    catch {
        return 0;
    }
}
async function safeIsVisible(locator) {
    try {
        return await locator.isVisible();
    }
    catch {
        return false;
    }
}
async function safeIsEnabled(locator) {
    try {
        return await locator.isEnabled();
    }
    catch {
        return false;
    }
}
async function safeHasDisabledState(locator) {
    try {
        return await locator.evaluate((element) => Boolean(element.closest('[disabled], .t-is-disabled, [aria-disabled="true"], [aria-disabled=true]')));
    }
    catch {
        return false;
    }
}
async function safeWaitForTimeout(page, timeoutMs) {
    if (typeof page.waitForTimeout === "function") {
        await page.waitForTimeout(timeoutMs);
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
function formatErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function waitForHunyuanReady(page, selector, text, timeoutMs) {
    if (hasSelector(selector)) {
        await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
        return;
    }
    if (hasSelector(text)) {
        await page.getByText(text, { exact: false }).waitFor({ timeout: timeoutMs });
        return;
    }
    throw new Error("Hunyuan ready wait requires a selector or text.");
}
async function detectHunyuanLoginState(page, selectors, timeoutMs) {
    if (hasSelector(selectors.loginRequiredSelector) && (await isSelectorVisible(page, selectors.loginRequiredSelector, 700))) {
        return { loggedIn: false, reason: "Login-required selector is visible.", matched: "loginRequiredSelector", url: page.url() };
    }
    if (hasSelector(selectors.loginRequiredText) && (await isTextVisible(page, selectors.loginRequiredText, 700))) {
        return { loggedIn: false, reason: "Login-required text is visible.", matched: "loginRequiredText", url: page.url() };
    }
    const readyChecks = [
        { key: "loginReadySelector", selector: selectors.loginReadySelector },
        { key: "loginReadyText", text: selectors.loginReadyText },
        { key: "imageTo3dTab", selector: selectors.imageTo3dTab },
        { key: "multipleImagesTab", selector: selectors.multipleImagesTab },
        { key: "addMultipleViewsButton", selector: selectors.addMultipleViewsButton }
    ];
    const configuredChecks = readyChecks.filter((check) => hasSelector(check.selector) || hasSelector(check.text));
    for (const check of configuredChecks) {
        const visible = hasSelector(check.selector)
            ? await isSelectorVisible(page, check.selector, timeoutMs)
            : await isTextVisible(page, check.text, timeoutMs);
        if (visible) {
            return { loggedIn: true, reason: "Hunyuan workflow controls are already visible.", matched: check.key, url: page.url() };
        }
    }
    return {
        loggedIn: false,
        reason: configuredChecks.length === 0 ? "No login-ready selectors are configured." : "No login-ready selectors became visible.",
        url: page.url()
    };
}
async function isSelectorVisible(page, selector, timeoutMs) {
    if (!hasSelector(selector))
        return false;
    try {
        await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
        return true;
    }
    catch {
        return false;
    }
}
async function isTextVisible(page, text, timeoutMs) {
    if (!hasSelector(text))
        return false;
    try {
        await page.getByText(text, { exact: false }).first().waitFor({ timeout: timeoutMs });
        return true;
    }
    catch {
        return false;
    }
}
