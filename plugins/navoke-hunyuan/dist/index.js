"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG = exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG = exports.HUNYUAN_EXPORT_FORMATS = exports.HUNYUAN_RETOPOLOGY_TYPES = exports.HUNYUAN_FACE_COUNTS = exports.HUNYUAN_VIEW_SLOTS = exports.HUNYUAN_GLOBAL_TARGET_URL = exports.HUNYUAN_GLOBAL_WORKFLOW_ID = exports.HUNYUAN_TENCENT_WORKFLOW_ID = void 0;
exports.buildHunyuanViewUploadPlan = buildHunyuanViewUploadPlan;
exports.mergeHunyuanSelectorConfig = mergeHunyuanSelectorConfig;
exports.missingHunyuanSelectorKeys = missingHunyuanSelectorKeys;
exports.missingHunyuanGlobalSelectorKeys = missingHunyuanGlobalSelectorKeys;
exports.inferHunyuanArtifactKind = inferHunyuanArtifactKind;
exports.discoverHunyuanModelAssets = discoverHunyuanModelAssets;
exports.resolveHunyuanExportFormat = resolveHunyuanExportFormat;
exports.createWorkflows = createWorkflows;
exports.dismissHunyuanQuotaPopup = dismissHunyuanQuotaPopup;
exports.downloadHunyuanExportFormat = downloadHunyuanExportFormat;
exports.clickHunyuanGenerateButton = clickHunyuanGenerateButton;
exports.clickHunyuanActionButton = clickHunyuanActionButton;
exports.clickVisibleHunyuanControl = clickVisibleHunyuanControl;
exports.ensureHunyuanEditorReady = ensureHunyuanEditorReady;
exports.detectHunyuanLoginState = detectHunyuanLoginState;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
exports.HUNYUAN_TENCENT_WORKFLOW_ID = "navoke.hunyuan.image-to-model";
exports.HUNYUAN_GLOBAL_WORKFLOW_ID = "navoke.hunyuan.global.image-to-model";
exports.HUNYUAN_GLOBAL_TARGET_URL = "https://3d.hunyuanglobal.com/";
const ROUTING_TOKEN_PARAM = "navoke-tab";
const HUNYUAN_MULTIVIEW_UPLOAD_SETTLE_DELAY_MS = 1500;
const HUNYUAN_SLOT_DETECTION_MAX_ATTEMPTS = 5;
const HUNYUAN_SLOT_DETECTION_STATE_TIMEOUT_MS = 120_000;
const HUNYUAN_GLOBAL_TEXTURE_PACKAGE_DOWNLOAD_TIMEOUT_MS = 300_000;
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
const HUNYUAN_VIEW_SLOT_CONTAINER_SELECTORS = {
    front: ".hy-upload-card--front",
    back: ".hy-upload-card--back",
    left: ".hy-upload-card--left",
    right: ".hy-upload-card--right",
    top: ".hy-upload-card--top",
    bottom: ".hy-upload-card--bottom",
    left45: ".hy-upload-card--left-front",
    right45: ".hy-upload-card--right-front"
};
exports.HUNYUAN_FACE_COUNTS = ["1.5m", "1m", "500k", "50k"];
exports.HUNYUAN_RETOPOLOGY_TYPES = ["triangle", "quad"];
exports.HUNYUAN_EXPORT_FORMATS = ["obj", "glb"];
const HUNYUAN_MODEL_ASSET_DIR_NAME = "model-assets";
const HUNYUAN_TEXTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const HUNYUAN_TEXT = {
    login: "\u767b\u5f55",
    imageTo3d: "图生3D|3D graphics",
    multipleImages: "多张图片|Multiple images",
    addMultipleViews: "添加多视图",
    uploading: "上传中",
    detectionFailed: "检测失败",
    modelFaceCount: "\u6a21\u578b\u9762\u6570",
    modelType: "\u6a21\u578b\u7c7b\u578b",
    geometryTexturePhased: "\u51e0\u4f55\u3001\u7eb9\u7406\u5206\u9636\u6bb5",
    generate: "\u7acb\u5373\u751f\u6210",
    generating: "\u751f\u6210\u4e2d",
    estimatedRemaining: "\u9884\u8ba1\u8fd8\u9700",
    v31: "V3.1",
    triangle: "\u4e09\u89d2\u9762",
    quad: "\u56db\u8fb9\u9762",
    smartRetopology: "\u667a\u80fd\u62d3\u6251",
    generateTexture: "\u751f\u6210\u7eb9\u7406",
    autoRig: "\u81ea\u52a8\u7ed1\u9aa8",
    download: "\u4e0b\u8f7d",
    quotaExhausted: "\u751f\u6210\u6b21\u6570\u5df2\u7528\u5b8c"
};
const HUNYUAN_GLOBAL_TEXT = {
    login: "Start Using",
    emailLogin: "Start Using HY 3D",
    imageTo3d: "Image-to-3D",
    multipleImages: "Multiple Images",
    addMultipleViews: "Add Multi-view",
    uploading: "Uploading",
    detectionFailed: "Detection failed",
    modelFaceCount: "Model",
    modelType: "Generation type",
    geometryTexturePhased: "Staged Generation",
    generate: "Generate",
    generating: "Generating",
    estimatedRemaining: "Estimated",
    textureEstimatedTime: "Estimated time",
    v31: "V3.1",
    triangle: "Triangle",
    quad: "Quadrilaterals",
    smartRetopology: "Smart Topology",
    generateTexture: "Generate texture",
    autoRig: "Auto Rig",
    download: "Download"
};
function hunyuanExportOptionSelector(label) {
    const escapedLabel = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `:is(.download__dropdown, .t-popup, .t-dropdown__menu) :is(li.t-dropdown__item, [role="menuitem"]):has-text("${escapedLabel}"), li.t-dropdown__item:has-text("${escapedLabel}")`;
}
function hunyuanEnabledButtonSelector(label) {
    return `:is(button, .t-button):not(.t-is-disabled):not([disabled]):has-text("${label}")`;
}
exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG = {
    loginReadySelector: ":is(.v3-home, .v3-sidebar-left)",
    loginRequiredSelector: 'button.login-btn, input[type="email"]',
    landingReadySelector: ".v3-home",
    enterEditorButton: ".v3-home .start-but",
    editorReadySelector: ".v3-sidebar-left",
    quotaExhaustedPopupText: HUNYUAN_TEXT.quotaExhausted,
    quotaExhaustedPopupCloseButton: `:is(.invite-tooltip-full, .invite-tooltip-content):has-text("${HUNYUAN_TEXT.quotaExhausted}") .t-icon-close`,
    imageTo3dTab: `text=/${HUNYUAN_TEXT.imageTo3d}/i`,
    multipleImagesTab: `text=/${HUNYUAN_TEXT.multipleImages}/i`,
    addMultipleViewsButton: ".hy-multiple-views-upload-v2",
    multipleViewsConfirmButton: ".hy-multi-view-grid__header .hy-multi-view-grid__header-close",
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
    viewSlotContainers: HUNYUAN_VIEW_SLOT_CONTAINER_SELECTORS,
    slotDetectionFailedText: HUNYUAN_TEXT.detectionFailed,
    slotDetectionRunningSelector: '.t-loading, .t-loading__spinner, [class*="loading" i], [class*="spinner" i], [class*="progress" i]',
    slotAcceptedThumbnailSelector: 'img, canvas, .t-image, [class*="preview" i], [class*="thumbnail" i]',
    slotRemoveButtonSelector: 'button[aria-label*="remove" i], button[aria-label*="delete" i], [role="button"][aria-label*="remove" i], [role="button"][aria-label*="delete" i], .hy-upload-card__delete, .hy-upload-card__remove, .t-icon-delete, .t-icon-close',
    slotEmptySelector: "",
    modelDropdown: ".model-version-select:visible",
    modelOptionV31: `:is(.model-version-dropdown__popup, .t-select__dropdown):visible :is(li.t-select-option, .t-select-option):has-text("${HUNYUAN_TEXT.v31}")`,
    faceCountButtons: {
        "1.5m": `.v3-sidebar-left .generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("1.5m")`,
        "1m": `.v3-sidebar-left .generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("1m")`,
        "500k": `.v3-sidebar-left .generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("500k")`,
        "50k": `.v3-sidebar-left .generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("50k")`
    },
    generateButton: ".v3-sidebar-left .sideBarLeft-generateBtn:not(.t-is-disabled):not([disabled])",
    geometryRunningSelector: ".v3-sidebar-left .sideBarLeft-generateBtn:is(.t-is-disabled, [disabled])",
    geometryRunningText: "Generating",
    geometryReadySelector: "button.native-edit__viewport-actionBar-download:visible",
    exportFormatDropdown: "button.native-edit__viewport-actionBar-download:visible",
    exportFormatOptions: {
        obj: '.v3-download-panel .v3-download-panel__item:visible:has-text("OBJ")',
        glb: '.v3-download-panel .v3-download-panel__item:visible:has-text("GLB")'
    },
    downloadReadySelector: "button.native-edit__viewport-actionBar-download:visible"
};
exports.DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG = {
    loginStartSelector: "button, a, [role='button']",
    loginStartText: HUNYUAN_GLOBAL_TEXT.login,
    loginReadySelector: "",
    loginReadyText: HUNYUAN_GLOBAL_TEXT.imageTo3d,
    loginRequiredSelector: `input[type="email"], input[placeholder*="email" i]`,
    loginRequiredText: HUNYUAN_GLOBAL_TEXT.emailLogin,
    quotaExhaustedPopupText: "",
    quotaExhaustedPopupCloseButton: "",
    imageTo3dTab: `label.t-radio-button:has-text("${HUNYUAN_GLOBAL_TEXT.imageTo3d}")`,
    multipleImagesTab: `text=/${HUNYUAN_GLOBAL_TEXT.multipleImages}/i`,
    addMultipleViewsButton: ".hy-multiple-views-upload-v2",
    multipleViewsConfirmButton: 'button:has(.hy-multi-view-grid__header-close), [role="button"]:has(.hy-multi-view-grid__header-close), .t-dialog__close, .hy-multi-view-grid__header-close',
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
    viewSlotContainers: HUNYUAN_VIEW_SLOT_CONTAINER_SELECTORS,
    slotDetectionFailedText: HUNYUAN_GLOBAL_TEXT.detectionFailed,
    slotDetectionRunningSelector: '.t-loading, .t-loading__spinner, [class*="loading" i], [class*="spinner" i], [class*="progress" i]',
    slotAcceptedThumbnailSelector: 'img, canvas, .t-image, [class*="preview" i], [class*="thumbnail" i]',
    slotRemoveButtonSelector: 'button[aria-label*="remove" i], button[aria-label*="delete" i], [role="button"][aria-label*="remove" i], [role="button"][aria-label*="delete" i], .hy-upload-card__delete, .hy-upload-card__remove, .t-icon-delete, .t-icon-close',
    slotEmptySelector: "",
    modelDropdown: ".model-version-select:visible",
    modelOptionV31: `li.t-select-option:has-text("${HUNYUAN_GLOBAL_TEXT.v31}")`,
    faceCountButtons: {
        "1.5m": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("1.5m")`,
        "1m": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("1m")`,
        "500k": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("500k")`,
        "50k": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("50k")`
    },
    modelTypeGeometryTexturePhased: `div.generation-type-select:visible:has(.generation-type-select-title:has-text("${HUNYUAN_GLOBAL_TEXT.modelType}")) .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_GLOBAL_TEXT.geometryTexturePhased}")`,
    generateButton: `:is(button, .t-button, [role="button"], .sideBarLeft-generateBtn):not(.t-is-disabled):not([disabled]):has-text("${HUNYUAN_GLOBAL_TEXT.generate}")`,
    geometryRunningText: HUNYUAN_GLOBAL_TEXT.generating,
    geometryReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.smartRetopology),
    retopologyTypeButtons: {
        triangle: `.model-dialog__content__operation:has(.model-dialog__content__operation__heading:has-text("${HUNYUAN_GLOBAL_TEXT.smartRetopology}")) .topology-panel .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_GLOBAL_TEXT.triangle}")`,
        quad: `.model-dialog__content__operation:has(.model-dialog__content__operation__heading:has-text("${HUNYUAN_GLOBAL_TEXT.smartRetopology}")) .topology-panel .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_GLOBAL_TEXT.quad}")`
    },
    smartRetopologyButton: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.smartRetopology),
    retopologyRunningText: HUNYUAN_GLOBAL_TEXT.generating,
    retopologyReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.generateTexture),
    generateTextureButton: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.generateTexture),
    textureRunningText: HUNYUAN_GLOBAL_TEXT.textureEstimatedTime,
    textureReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download),
    autoRigButton: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.autoRig),
    autoRigRunningText: HUNYUAN_GLOBAL_TEXT.generating,
    autoRigReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download),
    exportFormatDropdown: "button.download__dropdown__btn",
    exportFormatOptions: {
        obj: hunyuanExportOptionSelector("OBJ"),
        glb: hunyuanExportOptionSelector("GLB")
    },
    downloadReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download),
    downloadButton: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download)
};
const HUNYUAN_GLOBAL_SELECTOR_ASSIGNMENTS = [
    { key: "loginStartSelector", label: "Login start selector", path: ["loginStartSelector"] },
    { key: "loginStartText", label: "Login start text", path: ["loginStartText"] },
    { key: "loginReadySelector", label: "Login ready selector", path: ["loginReadySelector"] },
    { key: "loginReadyText", label: "Login ready text", path: ["loginReadyText"] },
    { key: "loginRequiredSelector", label: "Login required selector", path: ["loginRequiredSelector"] },
    { key: "loginRequiredText", label: "Login required text", path: ["loginRequiredText"] },
    { key: "quotaExhaustedPopupText", label: "Quota popup text", path: ["quotaExhaustedPopupText"] },
    { key: "quotaExhaustedPopupCloseButton", label: "Quota popup close", path: ["quotaExhaustedPopupCloseButton"] },
    { key: "imageTo3dTab", label: "Image-to-3D tab", path: ["imageTo3dTab"] },
    { key: "multipleImagesTab", label: "Multiple Images tab", path: ["multipleImagesTab"] },
    { key: "addMultipleViewsButton", label: "Add Multiple Views", path: ["addMultipleViewsButton"] },
    { key: "multipleViewsConfirmButton", label: "Multiple Views confirm", path: ["multipleViewsConfirmButton"] },
    ...exports.HUNYUAN_VIEW_SLOTS.map((slot) => ({
        key: `viewUploadInputs.${slot.selectorKey}`,
        label: `${slot.label} upload input`,
        path: ["viewUploadInputs", slot.selectorKey]
    })),
    ...exports.HUNYUAN_VIEW_SLOTS.map((slot) => ({
        key: `viewSlotContainers.${slot.selectorKey}`,
        label: `${slot.label} slot container`,
        path: ["viewSlotContainers", slot.selectorKey]
    })),
    { key: "slotDetectionFailedText", label: "Slot detection failed text", path: ["slotDetectionFailedText"] },
    { key: "slotDetectionRunningSelector", label: "Slot detection running selector", path: ["slotDetectionRunningSelector"] },
    { key: "slotAcceptedThumbnailSelector", label: "Slot accepted thumbnail", path: ["slotAcceptedThumbnailSelector"] },
    { key: "slotRemoveButtonSelector", label: "Slot remove button", path: ["slotRemoveButtonSelector"] },
    { key: "slotEmptySelector", label: "Slot empty selector", path: ["slotEmptySelector"] },
    { key: "modelDropdown", label: "Model dropdown", path: ["modelDropdown"] },
    { key: "modelOptionV31", label: "3D generate V3.1 option", path: ["modelOptionV31"] },
    ...exports.HUNYUAN_FACE_COUNTS.map((count) => ({
        key: `faceCountButtons.${count}`,
        label: `${count} face button`,
        path: ["faceCountButtons", count]
    })),
    { key: "modelTypeGeometryTexturePhased", label: "Geometry + texture phased option", path: ["modelTypeGeometryTexturePhased"] },
    { key: "promptTextbox", label: "Prompt textbox", path: ["promptTextbox"] },
    { key: "generateButton", label: "Initial generate button", path: ["generateButton"] },
    { key: "geometryRunningSelector", label: "Geometry running selector", path: ["geometryRunningSelector"] },
    { key: "geometryRunningText", label: "Geometry running text", path: ["geometryRunningText"] },
    { key: "geometryReadySelector", label: "Geometry ready selector", path: ["geometryReadySelector"] },
    { key: "retopologyTypeButtons.triangle", label: "Triangle retopology option", path: ["retopologyTypeButtons", "triangle"] },
    { key: "retopologyTypeButtons.quad", label: "Quad retopology option", path: ["retopologyTypeButtons", "quad"] },
    { key: "smartRetopologyButton", label: "Smart retopology button", path: ["smartRetopologyButton"] },
    { key: "retopologyRunningSelector", label: "Retopology running selector", path: ["retopologyRunningSelector"] },
    { key: "retopologyRunningText", label: "Retopology running text", path: ["retopologyRunningText"] },
    { key: "retopologyReadySelector", label: "Retopology ready selector", path: ["retopologyReadySelector"] },
    { key: "generateTextureButton", label: "Generate texture button", path: ["generateTextureButton"] },
    { key: "textureRunningSelector", label: "Texture running selector", path: ["textureRunningSelector"] },
    { key: "textureRunningText", label: "Texture running text", path: ["textureRunningText"] },
    { key: "textureReadySelector", label: "Texture ready selector", path: ["textureReadySelector"] },
    { key: "autoRigButton", label: "Auto-rig button", path: ["autoRigButton"] },
    { key: "autoRigRunningSelector", label: "Auto-rig running selector", path: ["autoRigRunningSelector"] },
    { key: "autoRigRunningText", label: "Auto-rig running text", path: ["autoRigRunningText"] },
    { key: "autoRigReadySelector", label: "Auto-rig ready selector", path: ["autoRigReadySelector"] },
    { key: "exportFormatDropdown", label: "Export format dropdown", path: ["exportFormatDropdown"] },
    { key: "exportFormatOptions.obj", label: "OBJ export option", path: ["exportFormatOptions", "obj"] },
    { key: "exportFormatOptions.glb", label: "GLB export option", path: ["exportFormatOptions", "glb"] },
    { key: "downloadReadySelector", label: "Download ready selector", path: ["downloadReadySelector"] },
    { key: "downloadButton", label: "Download button", path: ["downloadButton"] }
];
const HUNYUAN_TENCENT_SELECTOR_ASSIGNMENTS = [
    { key: "loginReadySelector", label: "Authenticated page selector", path: ["loginReadySelector"] },
    { key: "loginRequiredSelector", label: "Login-required selector", path: ["loginRequiredSelector"] },
    { key: "landingReadySelector", label: "Product landing selector", path: ["landingReadySelector"] },
    { key: "enterEditorButton", label: "Start editor button", path: ["enterEditorButton"] },
    { key: "editorReadySelector", label: "Sheng3D editor selector", path: ["editorReadySelector"] },
    { key: "quotaExhaustedPopupText", label: "Quota popup text", path: ["quotaExhaustedPopupText"] },
    { key: "quotaExhaustedPopupCloseButton", label: "Quota popup close", path: ["quotaExhaustedPopupCloseButton"] },
    { key: "imageTo3dTab", label: "3D graphics tab", path: ["imageTo3dTab"] },
    { key: "multipleImagesTab", label: "Multiple Images tab", path: ["multipleImagesTab"] },
    { key: "addMultipleViewsButton", label: "Add Multiple Views", path: ["addMultipleViewsButton"] },
    { key: "multipleViewsConfirmButton", label: "Multiple Views confirm", path: ["multipleViewsConfirmButton"] },
    ...exports.HUNYUAN_VIEW_SLOTS.map((slot) => ({
        key: `viewUploadInputs.${slot.selectorKey}`,
        label: `${slot.label} upload input`,
        path: ["viewUploadInputs", slot.selectorKey]
    })),
    ...exports.HUNYUAN_VIEW_SLOTS.map((slot) => ({
        key: `viewSlotContainers.${slot.selectorKey}`,
        label: `${slot.label} slot container`,
        path: ["viewSlotContainers", slot.selectorKey]
    })),
    { key: "slotDetectionFailedText", label: "Slot detection failed text", path: ["slotDetectionFailedText"] },
    { key: "slotDetectionRunningSelector", label: "Slot detection running selector", path: ["slotDetectionRunningSelector"] },
    { key: "slotAcceptedThumbnailSelector", label: "Slot accepted thumbnail", path: ["slotAcceptedThumbnailSelector"] },
    { key: "slotRemoveButtonSelector", label: "Slot remove button", path: ["slotRemoveButtonSelector"] },
    { key: "slotEmptySelector", label: "Slot empty selector", path: ["slotEmptySelector"] },
    { key: "modelDropdown", label: "Model dropdown", path: ["modelDropdown"] },
    { key: "modelOptionV31", label: "Sheng3D V3.1 option", path: ["modelOptionV31"] },
    ...exports.HUNYUAN_FACE_COUNTS.map((count) => ({
        key: `faceCountButtons.${count}`,
        label: `${count} face button`,
        path: ["faceCountButtons", count]
    })),
    { key: "generateButton", label: "Generate button", path: ["generateButton"] },
    { key: "geometryRunningSelector", label: "Generation running selector", path: ["geometryRunningSelector"] },
    { key: "geometryRunningText", label: "Generation running text", path: ["geometryRunningText"] },
    { key: "downloadReadySelector", label: "Generated result selector", path: ["downloadReadySelector"] },
    { key: "downloadReadyText", label: "Generated result text", path: ["downloadReadyText"] },
    { key: "exportFormatDropdown", label: "Download menu button", path: ["exportFormatDropdown"] },
    { key: "exportFormatOptions.obj", label: "OBJ download option", path: ["exportFormatOptions", "obj"] },
    { key: "exportFormatOptions.glb", label: "GLB download option", path: ["exportFormatOptions", "glb"] }
];
const HUNYUAN_SITES = [
    {
        workflowId: exports.HUNYUAN_TENCENT_WORKFLOW_ID,
        title: "Hunyuan Image to 3D Model",
        description: "Generates one textured Sheng3D model from multiple Hunyuan reference views.",
        targetUrl: "https://3d.hunyuan.tencent.com/",
        source: "hunyuan",
        selectorDefaults: exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG,
        uploadingText: HUNYUAN_TEXT.uploading,
        addMultipleViewsText: HUNYUAN_TEXT.addMultipleViews
    }
];
function buildHunyuanViewUploadPlan(input) {
    return exports.HUNYUAN_VIEW_SLOTS.flatMap((slot) => {
        const value = input[slot.field];
        const imagePath = typeof value === "string" ? value.trim() : "";
        return imagePath ? [{ field: slot.field, selectorKey: slot.selectorKey, label: slot.label, imagePath }] : [];
    });
}
function mergeHunyuanSelectorConfig(selectors, defaults = exports.DEFAULT_HUNYUAN_SELECTOR_CONFIG) {
    return {
        ...defaults,
        ...compactSelectorObject(selectors),
        viewUploadInputs: mergeSelectorRecord(defaults.viewUploadInputs, selectors?.viewUploadInputs),
        viewSlotContainers: mergeSelectorRecord(defaults.viewSlotContainers, selectors?.viewSlotContainers),
        faceCountButtons: mergeSelectorRecord(defaults.faceCountButtons, selectors?.faceCountButtons),
        retopologyTypeButtons: mergeSelectorRecord(defaults.retopologyTypeButtons, selectors?.retopologyTypeButtons),
        exportFormatOptions: mergeSelectorRecord(defaults.exportFormatOptions, selectors?.exportFormatOptions)
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
    requireSelector("landingReadySelector", selectors.landingReadySelector);
    requireSelector("enterEditorButton", selectors.enterEditorButton);
    requireSelector("editorReadySelector", selectors.editorReadySelector);
    requireSelector("imageTo3dTab", selectors.imageTo3dTab);
    requireSelector("multipleImagesTab", selectors.multipleImagesTab);
    requireSelector("addMultipleViewsButton", selectors.addMultipleViewsButton);
    for (const upload of buildHunyuanViewUploadPlan(input)) {
        requireSelector(`viewUploadInputs.${upload.selectorKey}`, selectors.viewUploadInputs?.[upload.selectorKey]);
    }
    requireSelector("modelDropdown", selectors.modelDropdown);
    requireSelector("modelOptionV31", selectors.modelOptionV31);
    requireSelector(`faceCountButtons.${input.modelFaceCount ?? "50k"}`, selectors.faceCountButtons?.[input.modelFaceCount ?? "50k"]);
    requireSelector("generateButton", selectors.generateButton);
    requireWait("downloadReady", selectors.downloadReadySelector, selectors.downloadReadyText);
    requireSelector("exportFormatDropdown", selectors.exportFormatDropdown);
    requireSelector(`exportFormatOptions.${input.exportFormat ?? "obj"}`, selectors.exportFormatOptions?.[input.exportFormat ?? "obj"]);
    return missing;
}
function missingHunyuanGlobalSelectorKeys(input) {
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
function discoverHunyuanModelAssets(assetDir) {
    const extractedFiles = listFiles(assetDir);
    const objPaths = extractedFiles.filter((filePath) => node_path_1.default.extname(filePath).toLowerCase() === ".obj");
    if (objPaths.length === 0) {
        throw new Error("The Hunyuan archive did not contain an OBJ file.");
    }
    if (objPaths.length > 1) {
        throw new Error(`The Hunyuan archive contained multiple OBJ files: ${objPaths.map((filePath) => node_path_1.default.basename(filePath)).join(", ")}`);
    }
    const objPath = objPaths[0];
    const modelAssetDir = node_path_1.default.dirname(objPath);
    const siblingFiles = node_fs_1.default
        .readdirSync(modelAssetDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => node_path_1.default.join(modelAssetDir, entry.name));
    const mtlPath = siblingFiles.find((filePath) => node_path_1.default.extname(filePath).toLowerCase() === ".mtl");
    const textureFileNames = siblingFiles
        .filter((filePath) => HUNYUAN_TEXTURE_EXTENSIONS.has(node_path_1.default.extname(filePath).toLowerCase()))
        .map((filePath) => node_path_1.default.basename(filePath))
        .sort();
    return {
        assetDir: modelAssetDir,
        objPath,
        objFileName: node_path_1.default.basename(objPath),
        ...(mtlPath ? { mtlFileName: node_path_1.default.basename(mtlPath) } : {}),
        textureFileNames,
        assetFileNames: siblingFiles.map((filePath) => node_path_1.default.basename(filePath)).sort()
    };
}
function listFiles(dir) {
    if (!node_fs_1.default.existsSync(dir))
        return [];
    return node_fs_1.default.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = node_path_1.default.join(dir, entry.name);
        if (entry.isDirectory())
            return listFiles(entryPath);
        return entry.isFile() ? [entryPath] : [];
    });
}
function resolveHunyuanExportFormat(requested, availableOptions) {
    const normalizedOptions = new Set(availableOptions.map((option) => option.trim().toUpperCase()).filter(Boolean));
    const requestedLabel = requested.toUpperCase();
    if (normalizedOptions.size === 0 || normalizedOptions.has(requestedLabel)) {
        return { requested, actual: requested, availableOptions };
    }
    if (requested !== "obj" && normalizedOptions.has("OBJ")) {
        return {
            requested,
            actual: "obj",
            availableOptions,
            fallbackReason: `Requested ${requestedLabel} export was not visible; using OBJ because Hunyuan offered it.`
        };
    }
    return { requested, actual: requested, availableOptions };
}
class HunyuanSlotDetectionRetryExhaustedError extends Error {
    upload;
    attempts;
    lastSnapshot;
    constructor(upload, attempts, lastSnapshot) {
        super(`Hunyuan detection failed repeatedly for ${upload.label} (${upload.selectorKey}) after ${attempts} attempts.`);
        this.name = "HunyuanSlotDetectionRetryExhaustedError";
        this.upload = upload;
        this.attempts = attempts;
        this.lastSnapshot = lastSnapshot;
    }
}
async function ensurePlaywrightHunyuanSlotAccepted(page, upload, selectors, uploadingText, timeoutMs, signal, recordPhase) {
    let lastSnapshot;
    const fileName = node_path_1.default.basename(upload.imagePath);
    for (let attempt = 1; attempt <= HUNYUAN_SLOT_DETECTION_MAX_ATTEMPTS; attempt += 1) {
        await page.locator(selectors.viewUploadInputs[upload.selectorKey]).first().setInputFiles(upload.imagePath);
        recordPhase(`uploaded-${upload.selectorKey}`, { imagePath: upload.imagePath, fileName, attempt });
        await waitForHunyuanUploadProcessingComplete(page, timeoutMs, uploadingText);
        const snapshot = await waitForPlaywrightHunyuanSlotDetectionState(page, upload, selectors, uploadingText, Math.min(timeoutMs, HUNYUAN_SLOT_DETECTION_STATE_TIMEOUT_MS), signal);
        lastSnapshot = snapshot;
        recordPhase(`slot-detection-${upload.selectorKey}`, { ...snapshot, attempt, fileName });
        if (snapshot.state === "accepted") {
            return { slot: upload.selectorKey, label: upload.label, attempts: attempt, fileName };
        }
        if (attempt < HUNYUAN_SLOT_DETECTION_MAX_ATTEMPTS) {
            recordPhase(`slot-detection-retry-${upload.selectorKey}`, { ...snapshot, attempt, fileName });
            await clearPlaywrightHunyuanSlotUpload(page, upload, selectors, signal);
            continue;
        }
    }
    throw new HunyuanSlotDetectionRetryExhaustedError(upload, HUNYUAN_SLOT_DETECTION_MAX_ATTEMPTS, lastSnapshot);
}
async function waitForPlaywrightHunyuanSlotDetectionState(page, upload, selectors, uploadingText, timeoutMs, signal) {
    const deadline = Date.now() + timeoutMs;
    let lastSnapshot;
    while (Date.now() < deadline) {
        const snapshot = await readPlaywrightHunyuanSlotDetectionSnapshot(page, upload, selectors, uploadingText);
        lastSnapshot = snapshot;
        if (snapshot.state === "accepted" || snapshot.state === "failed")
            return snapshot;
        await sleepWithSignal(500, signal);
    }
    throw new Error(`Timed out waiting for Hunyuan slot detection state. slot=${upload.selectorKey}; ` +
        `lastState=${lastSnapshot?.state ?? "unknown"}; text=${lastSnapshot?.text ?? ""}`);
}
async function readPlaywrightHunyuanSlotDetectionSnapshot(page, upload, selectors, uploadingText) {
    const containerSelector = hunyuanSlotContainerSelector(selectors, upload.selectorKey);
    const text = await readPlaywrightText(page, containerSelector);
    const failureText = selectors.slotDetectionFailedText;
    const runningSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotDetectionRunningSelector);
    const acceptedSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotAcceptedThumbnailSelector);
    const emptySelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotEmptySelector);
    const failed = textIncludes(text, failureText);
    const runningVisible = await isSelectorVisible(page, runningSelector, 250);
    const thumbnailVisible = await isSelectorVisible(page, acceptedSelector, 250);
    const emptyVisible = await isSelectorVisible(page, emptySelector, 250);
    const processing = runningVisible || textIncludes(text, uploadingText);
    const state = failed
        ? "failed"
        : processing
            ? "processing"
            : thumbnailVisible
                ? "accepted"
                : emptyVisible
                    ? "empty"
                    : "processing";
    return {
        slot: upload.selectorKey,
        label: upload.label,
        state,
        containerSelector,
        text,
        ...(failed && failureText ? { failureText } : {}),
        thumbnailVisible,
        runningVisible,
        emptyVisible
    };
}
async function clearPlaywrightHunyuanSlotUpload(page, upload, selectors, signal) {
    const containerSelector = hunyuanSlotContainerSelector(selectors, upload.selectorKey);
    const thumbnailSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotAcceptedThumbnailSelector);
    const removeSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotRemoveButtonSelector);
    if (!hasSelector(removeSelector)) {
        await clickPlaywrightOptional(page, thumbnailSelector);
        await clickPlaywrightOptional(page, containerSelector);
        await sleepWithSignal(250, signal);
        return;
    }
    for (let round = 0; round < 2; round += 1) {
        if (round > 0) {
            await clickPlaywrightOptional(page, thumbnailSelector);
            await clickPlaywrightOptional(page, containerSelector);
            await sleepWithSignal(250, signal);
        }
        try {
            await page.locator(removeSelector).first().click({ timeout: 2_000 });
            await sleepWithSignal(500, signal);
            return;
        }
        catch {
        }
    }
    await sleepWithSignal(250, signal);
}
async function clickPlaywrightOptional(page, selector) {
    if (!hasSelector(selector))
        return;
    await page.locator(selector).first().click({ timeout: 1_000 }).catch(() => undefined);
}
async function readPlaywrightText(page, selector) {
    try {
        const text = await page.locator(selector).first().textContent({ timeout: 1_000 });
        return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    }
    catch {
        return "";
    }
}
function hunyuanSlotContainerSelector(selectors, slot) {
    return selectors.viewSlotContainers?.[slot] ?? HUNYUAN_VIEW_SLOT_CONTAINER_SELECTORS[slot];
}
function scopeHunyuanSlotSelector(containerSelector, selector) {
    if (!hasSelector(selector))
        return undefined;
    if (selector.trim().startsWith("text="))
        return selector;
    return splitSelectorList(selector)
        .map((part) => {
        if (part.startsWith(":scope"))
            return `${containerSelector}${part.slice(":scope".length)}`;
        if (part.startsWith(containerSelector))
            return part;
        return `${containerSelector} ${part}`;
    })
        .join(", ");
}
function splitSelectorList(selector) {
    const parts = [];
    let current = "";
    let quote = null;
    let depth = 0;
    for (const char of selector) {
        if (quote) {
            current += char;
            if (char === quote)
                quote = null;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        if (char === "(" || char === "[") {
            depth += 1;
            current += char;
            continue;
        }
        if (char === ")" || char === "]") {
            depth = Math.max(0, depth - 1);
            current += char;
            continue;
        }
        if (char === "," && depth === 0) {
            if (current.trim())
                parts.push(current.trim());
            current = "";
            continue;
        }
        current += char;
    }
    if (current.trim())
        parts.push(current.trim());
    return parts;
}
function textIncludes(text, needle) {
    return hasSelector(needle) && text.toLowerCase().includes(needle.toLowerCase());
}
function createWorkflows(sdk) {
    const { z } = sdk.schema;
    const { launchPersistentProfile, saveScreenshot, startTrace, stopTrace, timeoutMinutes } = sdk.browser;
    const { WorkflowConfigurationError } = sdk.errors;
    const { extractZip, inferMimeType, writeJson } = sdk.files;
    const browserExtension = sdk.extension.browser;
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
    const viewSlotContainerSelectorsSchema = viewUploadSelectorsSchema;
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
        loginStartSelector: stringSelectorSchema,
        loginStartText: stringSelectorSchema,
        loginReadySelector: stringSelectorSchema,
        loginReadyText: stringSelectorSchema,
        loginRequiredSelector: stringSelectorSchema,
        loginRequiredText: stringSelectorSchema,
        landingReadySelector: stringSelectorSchema,
        enterEditorButton: stringSelectorSchema,
        editorReadySelector: stringSelectorSchema,
        quotaExhaustedPopupText: stringSelectorSchema,
        quotaExhaustedPopupCloseButton: stringSelectorSchema,
        multipleImagesTab: stringSelectorSchema,
        addMultipleViewsButton: stringSelectorSchema,
        multipleViewsConfirmButton: stringSelectorSchema,
        viewUploadInputs: viewUploadSelectorsSchema,
        viewSlotContainers: viewSlotContainerSelectorsSchema,
        slotDetectionFailedText: stringSelectorSchema,
        slotDetectionRunningSelector: stringSelectorSchema,
        slotAcceptedThumbnailSelector: stringSelectorSchema,
        slotRemoveButtonSelector: stringSelectorSchema,
        slotEmptySelector: stringSelectorSchema,
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
        profileName: z.string().optional().default("default"),
        headless: z.boolean().optional().default(false),
        pauseForManualLogin: z.boolean().optional().default(true),
        timeoutMinutes: z.number().min(1).max(240).optional().default(90),
        modelFaceCount: z.enum(["1.5m", "1m", "500k", "50k"]).optional().default("50k"),
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
    const extensionTabSchema = z.union([
        z.object({ mode: z.literal("any") }),
        z.object({
            mode: z.literal("existing"),
            clientId: z.string().trim().min(1),
            url: z.string().optional(),
            title: z.string().optional(),
            tabId: z.number().optional(),
            windowId: z.number().optional(),
            controllerId: z.string().optional()
        }),
        z.object({
            mode: z.literal("new"),
            routingToken: z.string().trim().min(1),
            url: z.string().optional(),
            title: z.string().optional(),
            openMode: z.enum(["window", "tab"]).optional().default("window"),
            clientId: z.string().optional(),
            tabId: z.number().optional(),
            windowId: z.number().optional(),
            controllerId: z.string().optional()
        })
    ]);
    const globalInputSchema = z
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
        timeoutMinutes: z.number().min(1).max(240).optional().default(90),
        modelFaceCount: z.enum(["1.5m", "1m", "500k", "50k"]).optional().default("50k"),
        retopologyType: z.enum(["triangle", "quad"]).optional().default("quad"),
        generateTexture: z.boolean().optional().default(true),
        autoRig: z.boolean().optional().default(false),
        exportFormat: z.enum(["obj", "glb"]).optional().default("obj"),
        selectors: selectorsSchema,
        extensionTab: extensionTabSchema.optional().default(createDefaultHunyuanGlobalTab)
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
        manifestArtifactId: z.string().optional(),
        presentation: z.unknown().optional()
    });
    function createHunyuanImageToModelWorkflow(site) {
        return {
            manifest: {
                id: site.workflowId,
                title: site.title,
                description: site.description,
                category: "hunyuan",
                version: "0.2.0",
                concurrency: 1,
                requiresBrowser: true,
                targetUrl: site.targetUrl,
                outputKinds: ["model", "download", "trace", "screenshot", "json"],
                uiCapabilities: ["browser.profile"],
                calibrationPresets: [
                    {
                        id: `${site.workflowId}.selectors`,
                        label: `${site.title} selectors`,
                        targetField: "selectors",
                        defaultValue: site.selectorDefaults,
                        assignments: HUNYUAN_TENCENT_SELECTOR_ASSIGNMENTS
                    }
                ],
                inputFields: [
                    { name: "frontImage", label: "Front image", type: "fileList", required: true, fileValue: "single", maxFiles: 1 },
                    { name: "backImage", label: "Back image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "leftImage", label: "Left image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "rightImage", label: "Right image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "topImage", label: "Top image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "bottomImage", label: "Bottom image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "left45Image", label: "Left 45 image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "right45Image", label: "Right 45 image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    {
                        name: "modelFaceCount",
                        label: "Model face count",
                        type: "select",
                        defaultValue: "50k",
                        options: exports.HUNYUAN_FACE_COUNTS.map((value) => ({ label: value, value }))
                    },
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
                        defaultValue: site.selectorDefaults,
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
                const selectors = mergeHunyuanSelectorConfig(input.selectors, site.selectorDefaults);
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
                    await ctx.step("Opening Hunyuan", 5, { url: site.targetUrl, source: site.source });
                    await page.goto(site.targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
                    if (await dismissHunyuanQuotaPopup(page, selectors)) {
                        await ctx.event("hunyuan.quota-popup-dismissed", "Dismissed Hunyuan quota/invite popup after page load.", {
                            phase: "startup",
                            text: selectors.quotaExhaustedPopupText
                        });
                    }
                    const missingSelectors = missingHunyuanSelectorKeys({ ...input, selectors });
                    if (missingSelectors.length > 0) {
                        const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-selector-calibration.png");
                        const screenshotArtifact = await ctx.addArtifact({
                            kind: "screenshot",
                            name: node_path_1.default.basename(screenshot),
                            path: screenshot,
                            mimeType: "image/png",
                            metadata: { source: site.source, missingSelectors }
                        });
                        artifactIds.push(screenshotArtifact.id);
                        throw new WorkflowConfigurationError(`Hunyuan selectors are not configured. Missing selector keys: ${missingSelectors.join(", ")}. Use Workflow Lab to inspect the page controls and calibrate selector support.`);
                    }
                    const editorState = await ensureHunyuanEditorReady(page, selectors, 60_000);
                    await ctx.step("Using Hunyuan Sheng3D editor", 10, editorState);
                    await clickSelector(page, selectors.imageTo3dTab);
                    await clickSelector(page, selectors.multipleImagesTab);
                    await clickSelector(page, selectors.addMultipleViewsButton);
                    await ctx.step("Uploading and validating multiview images", 15, { views: uploadPlan.map((upload) => upload.selectorKey) });
                    const acceptedSlots = [];
                    for (let index = 0; index < uploadPlan.length; index += 1) {
                        const upload = uploadPlan[index];
                        try {
                            acceptedSlots.push(await ensurePlaywrightHunyuanSlotAccepted(page, upload, selectors, site.uploadingText, timeoutMinutes(input.timeoutMinutes), ctx.signal, recordPhase));
                        }
                        catch (error) {
                            if (!(error instanceof HunyuanSlotDetectionRetryExhaustedError))
                                throw error;
                            const screenshot = await saveScreenshot(page, ctx.artifactDir, `hunyuan-detection-failed-${upload.selectorKey}.png`);
                            const screenshotArtifact = await ctx.addArtifact({
                                kind: "screenshot",
                                name: node_path_1.default.basename(screenshot),
                                path: screenshot,
                                mimeType: "image/png",
                                metadata: {
                                    source: site.source,
                                    phase: "slot-detection",
                                    slot: upload.selectorKey,
                                    label: upload.label,
                                    attempts: error.attempts,
                                    lastSnapshot: error.lastSnapshot
                                }
                            });
                            artifactIds.push(screenshotArtifact.id);
                            await ctx.waitForManualAction(`Hunyuan repeatedly rejected the ${upload.label} view. Clear that slot, re-upload the same image, wait until it is accepted, then resume this run.`, {
                                source: site.source,
                                slot: upload.selectorKey,
                                label: upload.label,
                                imagePath: upload.imagePath,
                                attempts: error.attempts,
                                screenshotArtifactId: screenshotArtifact.id,
                                lastSnapshot: error.lastSnapshot
                            });
                            const manualSnapshot = await waitForPlaywrightHunyuanSlotDetectionState(page, upload, selectors, site.uploadingText, Math.min(timeoutMinutes(input.timeoutMinutes), HUNYUAN_SLOT_DETECTION_STATE_TIMEOUT_MS), ctx.signal);
                            if (manualSnapshot.state !== "accepted")
                                throw error;
                            acceptedSlots.push({
                                slot: upload.selectorKey,
                                label: upload.label,
                                attempts: error.attempts,
                                fileName: node_path_1.default.basename(upload.imagePath)
                            });
                        }
                        if (index < uploadPlan.length - 1) {
                            await sleepWithSignal(HUNYUAN_MULTIVIEW_UPLOAD_SETTLE_DELAY_MS, ctx.signal);
                        }
                    }
                    await ctx.step("Hunyuan multiview images accepted", 20, { slots: acceptedSlots });
                    await closeHunyuanMultipleViewsModal(page, selectors, site.addMultipleViewsText);
                    await ctx.step("Applying Hunyuan settings", 25, {
                        modelFaceCount: input.modelFaceCount,
                        exportFormat: input.exportFormat
                    });
                    try {
                        await clickSelector(page, selectors.modelDropdown);
                        await clickSelector(page, selectors.modelOptionV31);
                        await clickVisibleHunyuanControl(page, selectors.faceCountButtons[input.modelFaceCount], `faceCountButtons.${input.modelFaceCount}`);
                        recordPhase("settings-applied", {
                            modelFaceCount: input.modelFaceCount,
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
                                source: site.source,
                                phase: "settings",
                                modelFaceCount: input.modelFaceCount,
                                exportFormat: input.exportFormat
                            }
                        });
                        artifactIds.push(screenshotArtifact.id);
                        throw new WorkflowConfigurationError(`Hunyuan settings selector failed. Saved calibration screenshot artifact ${screenshotArtifact.id}. ${formatErrorMessage(error)}`);
                    }
                    await ctx.step("Starting Sheng3D generation", 35);
                    try {
                        await startHunyuanGeometryGeneration(page, selectors, async (data) => {
                            await ctx.waitForManualAction("Hunyuan reports that generation quota is exhausted. Add generation quota, switch account, or resolve the account check in the browser, then resume this run.", data);
                        });
                        recordPhase("generation-started", { url: page.url() });
                    }
                    catch (error) {
                        const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-generate-calibration.png");
                        const screenshotArtifact = await ctx.addArtifact({
                            kind: "screenshot",
                            name: node_path_1.default.basename(screenshot),
                            path: screenshot,
                            mimeType: "image/png",
                            metadata: {
                                source: site.source,
                                phase: "generate",
                                selector: selectors.generateButton,
                                modelFaceCount: input.modelFaceCount,
                                exportFormat: input.exportFormat
                            }
                        });
                        artifactIds.push(screenshotArtifact.id);
                        throw new WorkflowConfigurationError(`Hunyuan generate button failed. Saved calibration screenshot artifact ${screenshotArtifact.id}. ${formatErrorMessage(error)}`);
                    }
                    await ctx.step("Waiting for the Sheng3D model", 55);
                    if (hasSelector(selectors.downloadReadySelector) || hasSelector(selectors.downloadReadyText)) {
                        await waitForHunyuanReady(page, selectors.downloadReadySelector, selectors.downloadReadyText, timeoutMinutes(input.timeoutMinutes));
                    }
                    recordPhase("generation-ready", { url: page.url() });
                    await ctx.step("Downloading result", 92, { exportFormat: input.exportFormat });
                    let exportSelection;
                    let download;
                    try {
                        const directDownload = await downloadHunyuanExportFormat(page, selectors, input.exportFormat, 120_000);
                        exportSelection = directDownload.resolution;
                        download = directDownload.download;
                        if (exportSelection.fallbackReason) {
                            await ctx.event("hunyuan.export-format-fallback", exportSelection.fallbackReason, {
                                requestedExportFormat: exportSelection.requested,
                                actualExportFormat: exportSelection.actual,
                                availableOptions: exportSelection.availableOptions
                            });
                        }
                        recordPhase("export-download-started", {
                            requestedExportFormat: exportSelection.requested,
                            actualExportFormat: exportSelection.actual,
                            availableOptions: exportSelection.availableOptions,
                            fallbackReason: exportSelection.fallbackReason
                        });
                    }
                    catch (error) {
                        const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-export-calibration.png");
                        const screenshotArtifact = await ctx.addArtifact({
                            kind: "screenshot",
                            name: node_path_1.default.basename(screenshot),
                            path: screenshot,
                            mimeType: "image/png",
                            metadata: {
                                source: site.source,
                                phase: "export",
                                requestedExportFormat: input.exportFormat
                            }
                        });
                        artifactIds.push(screenshotArtifact.id);
                        throw new WorkflowConfigurationError(`Hunyuan export format selection failed. Saved calibration screenshot artifact ${screenshotArtifact.id}. ${formatErrorMessage(error)}`);
                    }
                    const targetPath = node_path_1.default.join(ctx.artifactDir, node_path_1.default.basename(download.suggestedFilename()));
                    await download.saveAs(targetPath);
                    const downloadedModel = {
                        path: targetPath,
                        filename: node_path_1.default.basename(targetPath),
                        mimeType: inferMimeType(targetPath),
                        exportFormat: exportSelection.actual,
                        requestedExportFormat: exportSelection.requested
                    };
                    recordPhase("downloaded", downloadedModel);
                    let modelManifest;
                    let modelArtifact;
                    try {
                        if (exportSelection.actual === "obj" && node_path_1.default.extname(targetPath).toLowerCase() === ".zip") {
                            await ctx.step("Unpacking model archive", 96, { filename: downloadedModel.filename });
                            const extractDir = node_path_1.default.join(ctx.artifactDir, HUNYUAN_MODEL_ASSET_DIR_NAME);
                            node_fs_1.default.rmSync(extractDir, { recursive: true, force: true });
                            await extractZip(targetPath, extractDir);
                            const modelAssets = discoverHunyuanModelAssets(extractDir);
                            recordPhase("archive-unpacked", {
                                assetDir: modelAssets.assetDir,
                                objFileName: modelAssets.objFileName,
                                mtlFileName: modelAssets.mtlFileName,
                                textureFileNames: modelAssets.textureFileNames
                            });
                            node_fs_1.default.unlinkSync(targetPath);
                            modelManifest = {
                                format: "obj",
                                artifactPath: modelAssets.objPath,
                                assetDir: modelAssets.assetDir,
                                objFileName: modelAssets.objFileName,
                                mtlFileName: modelAssets.mtlFileName,
                                textureFileNames: modelAssets.textureFileNames,
                                assetFileNames: modelAssets.assetFileNames,
                                originalArchive: { ...downloadedModel, deleted: true }
                            };
                            modelArtifact = await ctx.addArtifact({
                                kind: "model",
                                name: modelAssets.objFileName,
                                path: modelAssets.objPath,
                                mimeType: inferMimeType(modelAssets.objPath),
                                metadata: {
                                    source: site.source,
                                    pageUrl: page.url(),
                                    modelFormat: "obj",
                                    objFileName: modelAssets.objFileName,
                                    mtlFileName: modelAssets.mtlFileName,
                                    textureFileNames: modelAssets.textureFileNames,
                                    assetFileNames: modelAssets.assetFileNames,
                                    originalArchive: { ...downloadedModel, deleted: true },
                                    requestedExportFormat: exportSelection.requested,
                                    exportFormat: exportSelection.actual,
                                    phases: phaseEvents
                                }
                            });
                        }
                        else {
                            modelManifest = {
                                format: exportSelection.actual,
                                artifactPath: targetPath,
                                filename: node_path_1.default.basename(targetPath),
                                mimeType: inferMimeType(targetPath),
                                originalDownload: downloadedModel
                            };
                            modelArtifact = await ctx.addArtifact({
                                kind: inferHunyuanArtifactKind(targetPath, inferMimeType),
                                name: node_path_1.default.basename(targetPath),
                                path: targetPath,
                                mimeType: inferMimeType(targetPath),
                                metadata: {
                                    source: site.source,
                                    pageUrl: page.url(),
                                    modelFormat: exportSelection.actual,
                                    requestedExportFormat: exportSelection.requested,
                                    exportFormat: exportSelection.actual,
                                    phases: phaseEvents
                                }
                            });
                        }
                    }
                    catch (error) {
                        const downloadArtifact = await ctx.addArtifact({
                            kind: "download",
                            name: node_path_1.default.basename(targetPath),
                            path: targetPath,
                            mimeType: inferMimeType(targetPath),
                            metadata: {
                                source: site.source,
                                pageUrl: page.url(),
                                requestedExportFormat: exportSelection.requested,
                                exportFormat: exportSelection.actual,
                                extractionError: formatErrorMessage(error),
                                phases: phaseEvents
                            }
                        });
                        artifactIds.push(downloadArtifact.id);
                        throw new WorkflowConfigurationError(`Hunyuan model archive extraction failed. Kept downloaded artifact ${downloadArtifact.id}. ${formatErrorMessage(error)}`);
                    }
                    artifactIds.push(modelArtifact.id);
                    recordPhase("model-artifact-registered", { artifactId: modelArtifact.id });
                    const manifestPath = node_path_1.default.join(ctx.artifactDir, "hunyuan-image-to-model-manifest.json");
                    writeJson(manifestPath, {
                        source: site.source,
                        workflowId: site.workflowId,
                        targetUrl: site.targetUrl,
                        pageUrl: page.url(),
                        viewImages: uploadPlan.map(({ field, selectorKey, label, imagePath }) => ({ field, selectorKey, label, imagePath })),
                        settings: {
                            modelFaceCount: input.modelFaceCount,
                            exportFormat: exportSelection.actual,
                            requestedExportFormat: exportSelection.requested
                        },
                        phases: phaseEvents,
                        model: {
                            artifactId: modelArtifact.id,
                            ...modelManifest
                        },
                        download: downloadedModel
                    });
                    const manifestArtifact = await ctx.addArtifact({
                        kind: "json",
                        name: node_path_1.default.basename(manifestPath),
                        path: manifestPath,
                        mimeType: "application/json",
                        metadata: { source: site.source, modelArtifactId: modelArtifact.id }
                    });
                    artifactIds.push(manifestArtifact.id);
                    return {
                        artifactIds,
                        modelArtifactId: modelArtifact.id,
                        manifestArtifactId: manifestArtifact.id,
                        presentation: buildModelPresentation(uploadPlan, modelArtifact.id, manifestArtifact.id),
                        summary: `${site.title} completed.`
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
    }
    function createHunyuanGlobalExtensionWorkflow() {
        return {
            manifest: {
                id: exports.HUNYUAN_GLOBAL_WORKFLOW_ID,
                title: "Hunyuan Global Image to 3D Model",
                description: "Generates one textured, retopologized OBJ model from multiple Hunyuan Global reference views.",
                category: "hunyuan",
                version: "0.1.0",
                concurrency: 1,
                requiresBrowser: false,
                targetUrl: exports.HUNYUAN_GLOBAL_TARGET_URL,
                outputKinds: ["model", "download", "json"],
                uiCapabilities: ["extension.tabRouting"],
                calibrationPresets: [
                    {
                        id: `${exports.HUNYUAN_GLOBAL_WORKFLOW_ID}.selectors`,
                        label: "Hunyuan Global selectors",
                        targetField: "selectors",
                        defaultValue: exports.DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG,
                        assignments: HUNYUAN_GLOBAL_SELECTOR_ASSIGNMENTS
                    }
                ],
                inputFields: [
                    { name: "frontImage", label: "Front image", type: "fileList", required: true, fileValue: "single", maxFiles: 1 },
                    { name: "backImage", label: "Back image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "leftImage", label: "Left image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "rightImage", label: "Right image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "topImage", label: "Top image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "bottomImage", label: "Bottom image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "left45Image", label: "Left 45 image", type: "fileList", fileValue: "single", maxFiles: 1 },
                    { name: "right45Image", label: "Right 45 image", type: "fileList", fileValue: "single", maxFiles: 1 },
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
                    {
                        name: "selectors",
                        label: "Selector config",
                        type: "json",
                        defaultValue: exports.DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG,
                        help: "Workflow Lab can override the built-in Hunyuan Global selector preset if the page changes."
                    }
                ]
            },
            inputSchema: globalInputSchema,
            outputSchema,
            async run(input, ctx) {
                const selectors = mergeHunyuanSelectorConfig(input.selectors, exports.DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG);
                const loginSelectors = {
                    startUsingSelector: selectors.loginStartSelector,
                    startUsingText: selectors.loginStartText,
                    loginReadySelector: selectors.loginReadySelector,
                    loginReadyText: selectors.loginReadyText,
                    imageTo3dTab: selectors.imageTo3dTab,
                    multipleImagesTab: selectors.multipleImagesTab
                };
                let lastMetadata = {};
                let ownedSurface;
                try {
                    for (let attempt = 1; attempt <= 4; attempt += 1) {
                        await ctx.step(attempt === 1 ? "Opening Hunyuan Global login" : "Checking Hunyuan Global login", 8, {
                            target: redactHunyuanTarget(input.extensionTab),
                            attempt
                        });
                        const extensionStatus = typeof browserExtension.status === "function" ? normalizeRecord(browserExtension.status()) : {};
                        if (Number(extensionStatus.compatible ?? 0) > 0 && Number(extensionStatus.compatibleControllers ?? 0) === 0) {
                            await ctx.step("Navoke extension tabs are connected, but the browser controller is not connected. Open the Navoke extension popup in the intended Chrome profile until it reports at least 1 browser controller. Do not open chrome.exe or paste the routed URL into another profile.", 8, {
                                phase: "extension-controller",
                                extensionStatus,
                                target: redactHunyuanTarget(input.extensionTab)
                            });
                        }
                        try {
                            const routedClient = await browserExtension.ensureRoutedTab(input.extensionTab, { signal: ctx.signal, timeoutMs: 120_000 });
                            ownedSurface ??= hunyuanOwnedSurfaceFromRoutedClient(input.extensionTab, routedClient);
                        }
                        catch (error) {
                            ownedSurface ??= hunyuanOwnedSurfaceFromError(input.extensionTab, error);
                            await ctx.waitForManualAction(hunyuanControllerManualMessage(error), {
                                phase: "extension-tab",
                                target: redactHunyuanTarget(input.extensionTab)
                            });
                            continue;
                        }
                        lastMetadata = await checkHunyuanGlobalLoginState(input.extensionTab, loginSelectors, Math.min(timeoutMinutes(input.timeoutMinutes), 120_000), ctx.signal);
                        const manualAction = normalizeRecord(lastMetadata.manualActionRequired);
                        if (manualAction.required === true) {
                            await ctx.waitForManualAction("Complete Hunyuan Global login in the browser, then resume this run.", {
                                ...manualAction,
                                target: redactHunyuanTarget(input.extensionTab)
                            });
                            continue;
                        }
                        if (lastMetadata.authenticated !== true) {
                            throw new Error("Hunyuan Global login check completed without authenticated or manual-action metadata.");
                        }
                        await ctx.step("Hunyuan Global authenticated", 12, {
                            url: stringValue(lastMetadata.url),
                            target: redactHunyuanTarget(input.extensionTab)
                        });
                        return await runHunyuanGlobalExtensionGeneration(input, ctx, selectors, stringValue(lastMetadata.url));
                    }
                    throw new Error("Hunyuan Global still requires manual action after multiple resume attempts.");
                }
                finally {
                    await cleanupHunyuanOwnedBrowserSurface(ownedSurface, ctx);
                }
            }
        };
    }
    async function runHunyuanGlobalExtensionGeneration(input, ctx, selectors, authenticatedUrl) {
        const artifactIds = [];
        const phaseEvents = [];
        const uploadPlan = buildHunyuanViewUploadPlan(input);
        const target = input.extensionTab;
        function recordPhase(phase, data) {
            phaseEvents.push({ phase, completedAt: new Date().toISOString(), ...(data === undefined ? {} : { data }) });
        }
        const missingSelectors = missingHunyuanGlobalSelectorKeys({ ...input, selectors });
        if (missingSelectors.length > 0) {
            const calibrationPath = node_path_1.default.join(ctx.artifactDir, "hunyuan-global-selector-calibration.json");
            const inspection = await browserExtension.inspect(target, { signal: ctx.signal, timeoutMs: 30_000 }).catch((error) => ({
                inspectionError: formatErrorMessage(error)
            }));
            writeJson(calibrationPath, {
                source: "hunyuan-global",
                phase: "selector-check",
                missingSelectors,
                inspection
            });
            const calibrationArtifact = await ctx.addArtifact({
                kind: "json",
                name: node_path_1.default.basename(calibrationPath),
                path: calibrationPath,
                mimeType: "application/json",
                metadata: { source: "hunyuan-global", missingSelectors }
            });
            artifactIds.push(calibrationArtifact.id);
            throw new WorkflowConfigurationError(`Hunyuan Global selectors are not configured. Missing selector keys: ${missingSelectors.join(", ")}. Saved calibration artifact ${calibrationArtifact.id}. Use Workflow Lab to inspect the page controls and calibrate selector support.`);
        }
        await ctx.step("Selecting Hunyuan Global multiview mode", 15, { url: authenticatedUrl });
        await extensionClickHunyuanControl(target, selectors.imageTo3dTab, "imageTo3dTab", ctx.signal);
        await extensionClickHunyuanControl(target, selectors.multipleImagesTab, "multipleImagesTab", ctx.signal);
        await extensionClickHunyuanControl(target, selectors.addMultipleViewsButton, "addMultipleViewsButton", ctx.signal);
        recordPhase("multiview-opened");
        await ctx.step("Uploading and validating Hunyuan Global multiview images", 22, { views: uploadPlan.map((upload) => upload.selectorKey) });
        const acceptedSlots = [];
        for (let index = 0; index < uploadPlan.length; index += 1) {
            const upload = uploadPlan[index];
            try {
                acceptedSlots.push(await ensureExtensionHunyuanSlotAccepted(target, upload, selectors, HUNYUAN_GLOBAL_TEXT.uploading, timeoutMinutes(input.timeoutMinutes), ctx.signal, recordPhase));
            }
            catch (error) {
                if (!(error instanceof HunyuanSlotDetectionRetryExhaustedError))
                    throw error;
                const calibrationPath = node_path_1.default.join(ctx.artifactDir, `hunyuan-global-detection-failed-${upload.selectorKey}.json`);
                const inspection = await browserExtension.inspect(target, { signal: ctx.signal, timeoutMs: 30_000 }).catch((inspectError) => ({
                    inspectionError: formatErrorMessage(inspectError)
                }));
                writeJson(calibrationPath, {
                    source: "hunyuan-global",
                    phase: "slot-detection",
                    slot: upload.selectorKey,
                    label: upload.label,
                    imagePath: upload.imagePath,
                    attempts: error.attempts,
                    lastSnapshot: error.lastSnapshot,
                    inspection
                });
                const calibrationArtifact = await ctx.addArtifact({
                    kind: "json",
                    name: node_path_1.default.basename(calibrationPath),
                    path: calibrationPath,
                    mimeType: "application/json",
                    metadata: {
                        source: "hunyuan-global",
                        phase: "slot-detection",
                        slot: upload.selectorKey,
                        attempts: error.attempts
                    }
                });
                artifactIds.push(calibrationArtifact.id);
                await ctx.waitForManualAction(`Hunyuan Global repeatedly rejected the ${upload.label} view. Clear that slot, re-upload the same image, wait until it is accepted, then resume this run.`, {
                    source: "hunyuan-global",
                    slot: upload.selectorKey,
                    label: upload.label,
                    imagePath: upload.imagePath,
                    attempts: error.attempts,
                    calibrationArtifactId: calibrationArtifact.id,
                    lastSnapshot: error.lastSnapshot
                });
                const manualSnapshot = await waitForExtensionHunyuanSlotDetectionState(target, upload, selectors, HUNYUAN_GLOBAL_TEXT.uploading, Math.min(timeoutMinutes(input.timeoutMinutes), HUNYUAN_SLOT_DETECTION_STATE_TIMEOUT_MS), ctx.signal);
                if (manualSnapshot.state !== "accepted")
                    throw error;
                acceptedSlots.push({
                    slot: upload.selectorKey,
                    label: upload.label,
                    attempts: error.attempts,
                    fileName: node_path_1.default.basename(upload.imagePath)
                });
            }
            if (index < uploadPlan.length - 1) {
                await sleepWithSignal(HUNYUAN_MULTIVIEW_UPLOAD_SETTLE_DELAY_MS, ctx.signal);
            }
        }
        await ctx.step("Hunyuan Global multiview images accepted", 28, { slots: acceptedSlots });
        await closeExtensionHunyuanMultipleViewsModal(target, selectors, ctx.signal);
        await ctx.step("Applying Hunyuan Global settings", 35, {
            modelFaceCount: input.modelFaceCount,
            retopologyType: input.retopologyType,
            generateTexture: input.generateTexture,
            autoRig: input.autoRig,
            exportFormat: input.exportFormat
        });
        await extensionClickHunyuanControl(target, selectors.modelDropdown, "modelDropdown", ctx.signal);
        try {
            await extensionClickHunyuanControl(target, selectors.modelOptionV31, "modelOptionV31", ctx.signal);
        }
        catch (error) {
            recordPhase("model-option-skipped", { selectorKey: "modelOptionV31", reason: formatErrorMessage(error) });
        }
        await extensionClickHunyuanControl(target, selectors.faceCountButtons[input.modelFaceCount], `faceCountButtons.${input.modelFaceCount}`, ctx.signal);
        await extensionClickHunyuanControl(target, selectors.modelTypeGeometryTexturePhased, "modelTypeGeometryTexturePhased", ctx.signal);
        if (input.prompt.trim() && hasSelector(selectors.promptTextbox)) {
            await browserExtension.action(target, { kind: "fill", selector: selectors.promptTextbox, value: input.prompt.trim() }, { signal: ctx.signal, timeoutMs: 30_000 });
        }
        recordPhase("settings-applied", {
            modelFaceCount: input.modelFaceCount,
            retopologyType: input.retopologyType,
            generateTexture: input.generateTexture,
            autoRig: input.autoRig,
            exportFormat: input.exportFormat
        });
        await ctx.step("Starting Hunyuan Global geometry generation", 42);
        await extensionClickAndVerifyActionStarted(target, {
            selector: selectors.generateButton,
            selectorKey: "generateButton",
            runningSelector: selectors.geometryRunningSelector,
            runningText: selectors.geometryRunningText,
            readySelector: selectors.geometryReadySelector,
            readyText: selectors.geometryReadyText
        }, ctx.signal);
        recordPhase("geometry-started");
        await extensionWaitForHunyuanReady(target, selectors.geometryReadySelector, selectors.geometryReadyText, timeoutMinutes(input.timeoutMinutes), ctx.signal);
        recordPhase("geometry-ready");
        await ctx.step("Running Hunyuan Global smart retopology", 60, { retopologyType: input.retopologyType });
        await extensionClickHunyuanControl(target, selectors.retopologyTypeButtons[input.retopologyType], `retopologyTypeButtons.${input.retopologyType}`, ctx.signal);
        await extensionClickHunyuanControl(target, selectors.smartRetopologyButton, "smartRetopologyButton", ctx.signal);
        await waitWithSignal(3_000, ctx.signal);
        await extensionWaitForHunyuanReady(target, selectors.retopologyReadySelector, selectors.retopologyReadyText, Math.min(timeoutMinutes(input.timeoutMinutes), 30_000), ctx.signal);
        recordPhase("retopology-ready", { retopologyType: input.retopologyType });
        if (input.generateTexture) {
            await ctx.step("Generating Hunyuan Global texture", 76);
            const textureStartState = await extensionClickAndVerifyActionStarted(target, {
                selector: selectors.generateTextureButton,
                selectorKey: "generateTextureButton",
                runningSelector: selectors.textureRunningSelector,
                runningText: selectors.textureRunningText,
                readySelector: selectors.textureReadySelector,
                readyText: selectors.textureReadyText,
                requireRunningBeforeReady: true
            }, ctx.signal);
            await extensionWaitForHunyuanReadyAfterRunning(target, textureStartState, selectors.textureRunningSelector, selectors.textureRunningText, selectors.textureReadySelector, selectors.textureReadyText, timeoutMinutes(input.timeoutMinutes), ctx.signal);
            recordPhase("texture-ready");
        }
        if (input.autoRig) {
            await ctx.step("Running Hunyuan Global auto-rig", 84);
            const autoRigStartState = await extensionClickAndVerifyActionStarted(target, {
                selector: selectors.autoRigButton,
                selectorKey: "autoRigButton",
                runningSelector: selectors.autoRigRunningSelector,
                runningText: selectors.autoRigRunningText,
                readySelector: selectors.autoRigReadySelector,
                readyText: selectors.autoRigReadyText
            }, ctx.signal);
            await extensionWaitForHunyuanReadyAfterRunning(target, autoRigStartState, selectors.autoRigRunningSelector, selectors.autoRigRunningText, selectors.autoRigReadySelector, selectors.autoRigReadyText, timeoutMinutes(input.timeoutMinutes), ctx.signal);
            recordPhase("auto-rig-ready");
        }
        await ctx.step("Preparing Hunyuan Global OBJ download", 90, { exportFormat: input.exportFormat });
        if (hasSelector(selectors.downloadReadySelector) || hasSelector(selectors.downloadReadyText)) {
            await extensionWaitForHunyuanReady(target, selectors.downloadReadySelector, selectors.downloadReadyText, timeoutMinutes(input.timeoutMinutes), ctx.signal);
        }
        const exportSelection = await selectExtensionHunyuanExportFormat(target, selectors, input.exportFormat, ctx.signal);
        recordPhase("export-format-selected", exportSelection);
        await ctx.step("Downloading Hunyuan Global result", 94);
        const downloadWatch = browserExtension.startDownloadWatch();
        await extensionClickHunyuanControl(target, selectors.downloadButton, "downloadButton", ctx.signal);
        const initialDownload = await browserExtension.waitForDownload(downloadWatch.id, { signal: ctx.signal, timeoutMs: 180_000 });
        const downloadSelection = await selectHunyuanGlobalDownloadPackage(initialDownload, {
            exportFormat: exportSelection.actual,
            generateTexture: input.generateTexture,
            signal: ctx.signal,
            step: ctx.step,
            recordPhase,
            browserExtension
        });
        const download = downloadSelection.download;
        const downloadedModel = await copyExtensionDownloadToArtifactDir(download, ctx.artifactDir, inferMimeType);
        if (downloadSelection.relatedDownloads.length > 0 || downloadSelection.packageWaitError) {
            downloadedModel.relatedDownloads = downloadSelection.relatedDownloads;
            if (downloadSelection.packageWaitError)
                downloadedModel.packageWaitError = downloadSelection.packageWaitError;
        }
        recordPhase("downloaded", downloadedModel);
        let modelManifest;
        let modelArtifact;
        try {
            if (exportSelection.actual === "obj" && node_path_1.default.extname(downloadedModel.path).toLowerCase() === ".zip") {
                await ctx.step("Unpacking Hunyuan Global model archive", 97, { filename: downloadedModel.filename });
                const extractDir = node_path_1.default.join(ctx.artifactDir, HUNYUAN_MODEL_ASSET_DIR_NAME);
                node_fs_1.default.rmSync(extractDir, { recursive: true, force: true });
                await extractZip(downloadedModel.path, extractDir);
                const modelAssets = discoverHunyuanModelAssets(extractDir);
                node_fs_1.default.unlinkSync(downloadedModel.path);
                recordPhase("archive-unpacked", {
                    assetDir: modelAssets.assetDir,
                    objFileName: modelAssets.objFileName,
                    mtlFileName: modelAssets.mtlFileName,
                    textureFileNames: modelAssets.textureFileNames
                });
                modelManifest = {
                    format: "obj",
                    artifactPath: modelAssets.objPath,
                    assetDir: modelAssets.assetDir,
                    objFileName: modelAssets.objFileName,
                    mtlFileName: modelAssets.mtlFileName,
                    textureFileNames: modelAssets.textureFileNames,
                    assetFileNames: modelAssets.assetFileNames,
                    originalArchive: { ...downloadedModel, deleted: true }
                };
                modelArtifact = await ctx.addArtifact({
                    kind: "model",
                    name: modelAssets.objFileName,
                    path: modelAssets.objPath,
                    mimeType: inferMimeType(modelAssets.objPath),
                    metadata: {
                        source: "hunyuan-global",
                        pageUrl: authenticatedUrl,
                        modelFormat: "obj",
                        objFileName: modelAssets.objFileName,
                        mtlFileName: modelAssets.mtlFileName,
                        textureFileNames: modelAssets.textureFileNames,
                        assetFileNames: modelAssets.assetFileNames,
                        originalArchive: { ...downloadedModel, deleted: true },
                        requestedExportFormat: exportSelection.requested,
                        exportFormat: exportSelection.actual,
                        phases: phaseEvents
                    }
                });
            }
            else {
                modelManifest = {
                    format: exportSelection.actual,
                    artifactPath: downloadedModel.path,
                    filename: downloadedModel.filename,
                    mimeType: downloadedModel.mimeType,
                    originalDownload: downloadedModel
                };
                modelArtifact = await ctx.addArtifact({
                    kind: inferHunyuanArtifactKind(downloadedModel.path, inferMimeType),
                    name: downloadedModel.filename,
                    path: downloadedModel.path,
                    mimeType: downloadedModel.mimeType,
                    metadata: {
                        source: "hunyuan-global",
                        pageUrl: authenticatedUrl,
                        modelFormat: exportSelection.actual,
                        requestedExportFormat: exportSelection.requested,
                        exportFormat: exportSelection.actual,
                        phases: phaseEvents
                    }
                });
            }
        }
        catch (error) {
            const downloadArtifact = await ctx.addArtifact({
                kind: "download",
                name: downloadedModel.filename,
                path: downloadedModel.path,
                mimeType: downloadedModel.mimeType,
                metadata: {
                    source: "hunyuan-global",
                    pageUrl: authenticatedUrl,
                    requestedExportFormat: exportSelection.requested,
                    exportFormat: exportSelection.actual,
                    extractionError: formatErrorMessage(error),
                    phases: phaseEvents
                }
            });
            artifactIds.push(downloadArtifact.id);
            throw new WorkflowConfigurationError(`Hunyuan Global model archive extraction failed. Kept downloaded artifact ${downloadArtifact.id}. ${formatErrorMessage(error)}`);
        }
        artifactIds.push(modelArtifact.id);
        recordPhase("model-artifact-registered", { artifactId: modelArtifact.id });
        const manifestPath = node_path_1.default.join(ctx.artifactDir, "hunyuan-global-image-to-model-manifest.json");
        writeJson(manifestPath, {
            source: "hunyuan-global",
            workflowId: exports.HUNYUAN_GLOBAL_WORKFLOW_ID,
            targetUrl: exports.HUNYUAN_GLOBAL_TARGET_URL,
            pageUrl: authenticatedUrl,
            viewImages: uploadPlan.map(({ field, selectorKey, label, imagePath }) => ({ field, selectorKey, label, imagePath })),
            settings: {
                modelFaceCount: input.modelFaceCount,
                retopologyType: input.retopologyType,
                generateTexture: input.generateTexture,
                autoRig: input.autoRig,
                exportFormat: exportSelection.actual,
                requestedExportFormat: exportSelection.requested
            },
            phases: phaseEvents,
            model: {
                artifactId: modelArtifact.id,
                ...modelManifest
            },
            download: downloadedModel
        });
        const manifestArtifact = await ctx.addArtifact({
            kind: "json",
            name: node_path_1.default.basename(manifestPath),
            path: manifestPath,
            mimeType: "application/json",
            metadata: { source: "hunyuan-global", modelArtifactId: modelArtifact.id }
        });
        artifactIds.push(manifestArtifact.id);
        await ctx.step("Hunyuan Global completed", 100, { modelArtifactId: modelArtifact.id });
        return {
            artifactIds,
            modelArtifactId: modelArtifact.id,
            manifestArtifactId: manifestArtifact.id,
            presentation: buildModelPresentation(uploadPlan, modelArtifact.id, manifestArtifact.id),
            summary: "Hunyuan Global Image to 3D Model completed."
        };
    }
    function buildModelPresentation(uploadPlan, modelArtifactId, manifestArtifactId) {
        return {
            title: "Model output",
            groups: [
                {
                    id: "inputs",
                    title: "Input views",
                    items: uploadPlan.map((upload) => ({
                        kind: "inputFile",
                        label: upload.label,
                        field: upload.field,
                        index: 0,
                        path: upload.imagePath
                    }))
                },
                {
                    id: "model",
                    title: "Generated model",
                    items: [{ kind: "artifact", label: "Model", artifactId: modelArtifactId, preview: "model" }]
                },
                {
                    id: "support",
                    title: "Supporting artifacts",
                    items: [{ kind: "artifact", label: "Manifest", artifactId: manifestArtifactId }]
                }
            ]
        };
    }
    async function checkHunyuanGlobalLoginState(target, selectors, timeoutMs, signal) {
        const startedAt = Date.now();
        let startUsingClicked = false;
        while (Date.now() - startedAt < timeoutMs) {
            const page = normalizeRecord(await browserExtension.inspect(target, { signal, timeoutMs: 30_000 }));
            const url = stringValue(page.url);
            const title = stringValue(page.title);
            if (await extensionSelectorVisible(target, selectors.loginReadySelector, signal)) {
                return { authenticated: true, url, title };
            }
            if (await extensionTextPresent(target, selectors.loginReadyText, signal)) {
                return { authenticated: true, url, title };
            }
            if (url.includes("/login-email") || (await extensionTextPresent(target, selectors.loginRequiredText, signal))) {
                return {
                    manualActionRequired: {
                        required: true,
                        phase: "login-email",
                        url,
                        title,
                        reason: "Complete Hunyuan Global email login in the browser."
                    }
                };
            }
            if (!startUsingClicked &&
                selectors.startUsingSelector &&
                selectors.startUsingText &&
                (await extensionTextPresent(target, selectors.startUsingText, signal))) {
                try {
                    await browserExtension.action(target, {
                        kind: "click",
                        selector: selectors.startUsingSelector,
                        text: selectors.startUsingText,
                        textMatch: "contains",
                        caseSensitive: false
                    }, { signal, timeoutMs: 30_000 });
                    startUsingClicked = true;
                }
                catch {
                    // The landing page can re-render while the button is appearing. Keep polling until the login checkpoint is visible.
                }
            }
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(resolve, 750);
                signal.addEventListener("abort", () => {
                    clearTimeout(timeout);
                    reject(new Error("Operation cancelled"));
                }, { once: true });
            });
        }
        const page = normalizeRecord(await browserExtension.inspect(target, { signal, timeoutMs: 30_000 }));
        return {
            manualActionRequired: {
                required: true,
                phase: "login-check",
                url: stringValue(page.url),
                title: stringValue(page.title),
                reason: "Hunyuan Global did not reach an authenticated state before the login-check timeout."
            }
        };
    }
    async function extensionSelectorVisible(target, selector, signal) {
        if (!selector)
            return false;
        try {
            const state = normalizeRecord(await browserExtension.extract(target, { kind: "element-state", selector }, { signal, timeoutMs: 10_000 }));
            return state.visible === true;
        }
        catch {
            return false;
        }
    }
    async function extensionTextPresent(target, text, signal) {
        if (!text)
            return false;
        try {
            const result = normalizeRecord(await browserExtension.extract(target, { kind: "text" }, { signal, timeoutMs: 10_000 }));
            return stringValue(result.text).toLowerCase().includes(text.toLowerCase());
        }
        catch {
            return false;
        }
    }
    async function ensureExtensionHunyuanSlotAccepted(target, upload, selectors, uploadingText, timeoutMs, signal, recordPhase) {
        let lastSnapshot;
        const fileName = node_path_1.default.basename(upload.imagePath);
        for (let attempt = 1; attempt <= HUNYUAN_SLOT_DETECTION_MAX_ATTEMPTS; attempt += 1) {
            const files = browserExtension.stageFiles([upload.imagePath]);
            await browserExtension.action(target, { kind: "attach-file", selector: selectors.viewUploadInputs[upload.selectorKey], files }, { signal, timeoutMs: 60_000 });
            recordPhase(`uploaded-${upload.selectorKey}`, { imagePath: upload.imagePath, fileName, attempt });
            await waitForExtensionTextAbsentStable(target, uploadingText, timeoutMs, signal);
            const snapshot = await waitForExtensionHunyuanSlotDetectionState(target, upload, selectors, uploadingText, Math.min(timeoutMs, HUNYUAN_SLOT_DETECTION_STATE_TIMEOUT_MS), signal);
            lastSnapshot = snapshot;
            recordPhase(`slot-detection-${upload.selectorKey}`, { ...snapshot, attempt, fileName });
            if (snapshot.state === "accepted") {
                return { slot: upload.selectorKey, label: upload.label, attempts: attempt, fileName };
            }
            if (attempt < HUNYUAN_SLOT_DETECTION_MAX_ATTEMPTS) {
                recordPhase(`slot-detection-retry-${upload.selectorKey}`, { ...snapshot, attempt, fileName });
                await clearExtensionHunyuanSlotUpload(target, upload, selectors, signal);
                continue;
            }
        }
        throw new HunyuanSlotDetectionRetryExhaustedError(upload, HUNYUAN_SLOT_DETECTION_MAX_ATTEMPTS, lastSnapshot);
    }
    async function waitForExtensionHunyuanSlotDetectionState(target, upload, selectors, uploadingText, timeoutMs, signal) {
        const deadline = Date.now() + timeoutMs;
        let lastSnapshot;
        while (Date.now() < deadline) {
            const snapshot = await readExtensionHunyuanSlotDetectionSnapshot(target, upload, selectors, uploadingText, signal);
            lastSnapshot = snapshot;
            if (snapshot.state === "accepted" || snapshot.state === "failed")
                return snapshot;
            await waitWithSignal(500, signal);
        }
        throw new Error(`Timed out waiting for Hunyuan Global slot detection state. slot=${upload.selectorKey}; ` +
            `lastState=${lastSnapshot?.state ?? "unknown"}; text=${lastSnapshot?.text ?? ""}`);
    }
    async function readExtensionHunyuanSlotDetectionSnapshot(target, upload, selectors, uploadingText, signal) {
        const containerSelector = hunyuanSlotContainerSelector(selectors, upload.selectorKey);
        const text = await extensionExtractText(target, containerSelector, signal);
        const failureText = selectors.slotDetectionFailedText;
        const runningSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotDetectionRunningSelector);
        const acceptedSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotAcceptedThumbnailSelector);
        const emptySelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotEmptySelector);
        const failed = textIncludes(text, failureText);
        const runningVisible = await extensionSelectorVisible(target, runningSelector, signal);
        const thumbnailVisible = await extensionSelectorVisible(target, acceptedSelector, signal);
        const emptyVisible = await extensionSelectorVisible(target, emptySelector, signal);
        const processing = runningVisible || textIncludes(text, uploadingText);
        const state = failed
            ? "failed"
            : processing
                ? "processing"
                : thumbnailVisible
                    ? "accepted"
                    : emptyVisible
                        ? "empty"
                        : "processing";
        return {
            slot: upload.selectorKey,
            label: upload.label,
            state,
            containerSelector,
            text,
            ...(failed && failureText ? { failureText } : {}),
            thumbnailVisible,
            runningVisible,
            emptyVisible
        };
    }
    async function clearExtensionHunyuanSlotUpload(target, upload, selectors, signal) {
        const containerSelector = hunyuanSlotContainerSelector(selectors, upload.selectorKey);
        const thumbnailSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotAcceptedThumbnailSelector);
        const removeSelector = scopeHunyuanSlotSelector(containerSelector, selectors.slotRemoveButtonSelector);
        if (!hasSelector(removeSelector)) {
            await browserExtension.action(target, { kind: "click", selector: thumbnailSelector ?? containerSelector }, { signal, timeoutMs: 10_000 }).catch(() => undefined);
            await waitWithSignal(250, signal);
            return;
        }
        for (let round = 0; round < 2; round += 1) {
            if (await extensionSelectorVisible(target, removeSelector, signal)) {
                try {
                    await extensionClickHunyuanControl(target, removeSelector, "slotRemoveButtonSelector", signal, 30_000);
                    await waitWithSignal(500, signal);
                    return;
                }
                catch {
                }
            }
            await browserExtension.action(target, { kind: "click", selector: thumbnailSelector ?? containerSelector }, { signal, timeoutMs: 10_000 }).catch(() => undefined);
            await waitWithSignal(250, signal);
        }
        await waitWithSignal(250, signal);
    }
    async function extensionExtractText(target, selector, signal) {
        try {
            const result = normalizeRecord(await browserExtension.extract(target, { kind: "text", selector }, { signal, timeoutMs: 10_000 }));
            return stringValue(result.text).replace(/\s+/g, " ").trim();
        }
        catch {
            return "";
        }
    }
    async function extensionClickHunyuanControl(target, selector, selectorKey, signal, timeoutMs = 120_000) {
        try {
            await browserExtension.action(target, { kind: "click", selector }, { signal, timeoutMs });
        }
        catch (error) {
            throw new Error(`Hunyuan Global selector ${selectorKey} could not be clicked. selector=${selector}; ${formatErrorMessage(error)}`);
        }
    }
    async function closeExtensionHunyuanMultipleViewsModal(target, selectors, signal) {
        const modalOpen = await extensionTextPresent(target, HUNYUAN_GLOBAL_TEXT.addMultipleViews, signal);
        if (!modalOpen &&
            (await extensionSelectorVisible(target, selectors.modelDropdown, signal)) &&
            (await extensionSelectorVisible(target, selectors.generateButton, signal))) {
            return;
        }
        const closeSelectors = [selectors.multipleViewsConfirmButton, ".hy-multi-view-grid__header-close"].filter(hasSelector);
        let lastError;
        for (const closeSelector of closeSelectors) {
            try {
                await extensionClickHunyuanControl(target, closeSelector, "multipleViewsConfirmButton", signal, 30_000);
                await waitForExtensionTextAbsentStable(target, HUNYUAN_GLOBAL_TEXT.addMultipleViews, 15_000, signal);
                return;
            }
            catch (error) {
                lastError = error;
            }
        }
        if (!(await extensionTextPresent(target, HUNYUAN_GLOBAL_TEXT.addMultipleViews, signal))) {
            return;
        }
        throw new Error(`Hunyuan Global multiview modal did not close after uploads. Configure multipleViewsConfirmButton. ` +
            `closeSelector=${selectors.multipleViewsConfirmButton ?? ""}; fallbackSelectors=${closeSelectors.join(", ")}; ` +
            `lastError=${lastError ? formatErrorMessage(lastError) : ""}`);
    }
    async function waitForExtensionTextAbsentStable(target, text, timeoutMs, signal) {
        if (!hasSelector(text))
            return;
        const deadline = Date.now() + timeoutMs;
        let stableSince = 0;
        while (Date.now() < deadline) {
            const present = await extensionTextPresent(target, text, signal);
            if (!present) {
                stableSince ||= Date.now();
                if (Date.now() - stableSince >= 1_000)
                    return;
            }
            else {
                stableSince = 0;
            }
            await waitWithSignal(250, signal);
        }
        throw new Error(`Timed out waiting for Hunyuan Global text to disappear: ${text}`);
    }
    async function extensionWaitForHunyuanReady(target, selector, text, timeoutMs, signal) {
        if (!hasSelector(selector) && !hasSelector(text)) {
            throw new Error("Hunyuan Global ready wait requires a selector or text.");
        }
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await extensionSelectorVisible(target, selector, signal))
                return;
            if (await extensionTextPresent(target, text, signal))
                return;
            await waitWithSignal(750, signal);
        }
        throw new Error(`Timed out waiting for Hunyuan Global ready state. selector=${selector ?? ""}; text=${text ?? ""}`);
    }
    async function extensionClickAndVerifyActionStarted(target, input, signal) {
        await extensionClickHunyuanControl(target, input.selector, input.selectorKey, signal, 120_000);
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            if (await extensionSelectorVisible(target, input.runningSelector, signal))
                return "running";
            if (await extensionTextPresent(target, input.runningText, signal))
                return "running";
            const actionStillVisible = await extensionSelectorVisible(target, input.selector, signal);
            const ready = (await extensionSelectorVisible(target, input.readySelector, signal)) ||
                (await extensionTextPresent(target, input.readyText, signal));
            if (!actionStillVisible)
                return ready && !input.requireRunningBeforeReady ? "ready" : "control-hidden";
            await waitWithSignal(750, signal);
        }
        throw new Error(`Hunyuan Global action ${input.selectorKey} did not enter a running or ready state after clicking. selector=${input.selector}; runningSelector=${input.runningSelector ?? ""}; runningText=${input.runningText ?? ""}; readySelector=${input.readySelector ?? ""}; readyText=${input.readyText ?? ""}`);
    }
    async function extensionWaitForHunyuanReadyAfterRunning(target, startState, runningSelector, runningText, readySelector, readyText, timeoutMs, signal) {
        if (!hasSelector(readySelector) && !hasSelector(readyText)) {
            throw new Error("Hunyuan Global ready-after-running wait requires a ready selector or ready text.");
        }
        const deadline = Date.now() + timeoutMs;
        let stableReadySince = 0;
        let observedRunning = startState === "running";
        while (Date.now() < deadline) {
            const running = (await extensionSelectorVisible(target, runningSelector, signal)) ||
                (await extensionTextPresent(target, runningText, signal)) ||
                (await extensionTextPresent(target, HUNYUAN_GLOBAL_TEXT.generating, signal)) ||
                (await extensionTextPresent(target, HUNYUAN_GLOBAL_TEXT.estimatedRemaining, signal));
            if (running) {
                observedRunning = true;
                stableReadySince = 0;
                await waitWithSignal(750, signal);
                continue;
            }
            const ready = (await extensionSelectorVisible(target, readySelector, signal)) || (await extensionTextPresent(target, readyText, signal));
            if (ready && (observedRunning || startState === "ready")) {
                stableReadySince ||= Date.now();
                if (Date.now() - stableReadySince >= 1_000)
                    return;
            }
            else {
                stableReadySince = 0;
            }
            await waitWithSignal(750, signal);
        }
        throw new Error(`Timed out waiting for Hunyuan Global action to finish. runningSelector=${runningSelector ?? ""}; runningText=${runningText ?? ""}; readySelector=${readySelector ?? ""}; readyText=${readyText ?? ""}`);
    }
    async function selectExtensionHunyuanExportFormat(target, selectors, requested, signal) {
        await extensionClickHunyuanControl(target, selectors.exportFormatDropdown, "exportFormatDropdown", signal, 30_000);
        if (await tryClickExtensionHunyuanExportOption(target, selectors, requested, signal)) {
            return { requested, actual: requested, availableOptions: [] };
        }
        if (requested !== "obj" && (await tryClickExtensionHunyuanExportOption(target, selectors, "obj", signal))) {
            return {
                requested,
                actual: "obj",
                availableOptions: [],
                fallbackReason: `Requested ${requested.toUpperCase()} export could not be clicked; using OBJ fallback.`
            };
        }
        throw new Error(`Hunyuan Global export format ${requested.toUpperCase()} could not be selected. requestedSelector=${selectors.exportFormatOptions?.[requested] ?? ""}; objSelector=${selectors.exportFormatOptions?.obj ?? ""}`);
    }
    async function tryClickExtensionHunyuanExportOption(target, selectors, format, signal) {
        const optionSelector = selectors.exportFormatOptions?.[format] ?? hunyuanExportOptionSelector(format.toUpperCase());
        try {
            await extensionClickHunyuanControl(target, optionSelector, `exportFormatOptions.${format}`, signal, 30_000);
            return true;
        }
        catch {
            return false;
        }
    }
    async function selectHunyuanGlobalDownloadPackage(initialDownload, input) {
        const initialExtension = node_path_1.default.extname(initialDownload.filename).toLowerCase();
        if (input.exportFormat !== "obj" || !input.generateTexture || initialExtension === ".zip") {
            return { download: initialDownload, relatedDownloads: [] };
        }
        input.recordPhase("downloaded-intermediate", {
            filename: node_path_1.default.basename(initialDownload.filename),
            chromeDownload: initialDownload,
            reason: "textured OBJ exports may complete as a later package archive"
        });
        await input.step("Waiting for Hunyuan Global texture package", 95, {
            firstDownload: node_path_1.default.basename(initialDownload.filename),
            expectedArchive: "zip",
            timeoutMs: HUNYUAN_GLOBAL_TEXTURE_PACKAGE_DOWNLOAD_TIMEOUT_MS
        });
        const packageWatch = input.browserExtension.startDownloadWatch();
        try {
            const packageDownload = await input.browserExtension.waitForDownload(packageWatch.id, {
                signal: input.signal,
                timeoutMs: HUNYUAN_GLOBAL_TEXTURE_PACKAGE_DOWNLOAD_TIMEOUT_MS
            });
            if (node_path_1.default.extname(packageDownload.filename).toLowerCase() === ".zip") {
                input.recordPhase("download-package-selected", {
                    initialDownload: node_path_1.default.basename(initialDownload.filename),
                    packageDownload: node_path_1.default.basename(packageDownload.filename)
                });
                return { download: packageDownload, relatedDownloads: [initialDownload] };
            }
            input.recordPhase("download-package-ignored", {
                initialDownload: node_path_1.default.basename(initialDownload.filename),
                extraDownload: node_path_1.default.basename(packageDownload.filename),
                reason: "extra download was not a zip archive"
            });
            return { download: initialDownload, relatedDownloads: [packageDownload] };
        }
        catch (error) {
            const packageWaitError = formatErrorMessage(error);
            input.recordPhase("download-package-wait-failed", {
                initialDownload: node_path_1.default.basename(initialDownload.filename),
                error: packageWaitError
            });
            return { download: initialDownload, relatedDownloads: [], packageWaitError };
        }
    }
    async function copyExtensionDownloadToArtifactDir(download, artifactDir, inferMime) {
        if (!download.filename || !node_fs_1.default.existsSync(download.filename)) {
            throw new Error(`Chrome reported a completed download, but the file was not found: ${download.filename || "(missing filename)"}`);
        }
        const targetPath = node_path_1.default.join(artifactDir, node_path_1.default.basename(download.filename));
        if (node_path_1.default.resolve(download.filename) !== node_path_1.default.resolve(targetPath)) {
            node_fs_1.default.copyFileSync(download.filename, targetPath);
        }
        const reportedMime = typeof download.mime === "string" ? download.mime : null;
        return {
            path: targetPath,
            filename: node_path_1.default.basename(targetPath),
            mimeType: inferMime(targetPath) ?? reportedMime,
            chromeDownload: download
        };
    }
    function hunyuanOwnedSurfaceFromRoutedClient(target, client) {
        if (target.mode !== "new" || client.openedByController !== true || typeof client.openedTabId !== "number")
            return undefined;
        return {
            tabId: client.openedTabId,
            ...(client.openedWindowId !== undefined ? { windowId: client.openedWindowId } : {}),
            ...(client.openedControllerId ? { controllerId: client.openedControllerId } : client.controllerId ? { controllerId: client.controllerId } : {}),
            routingToken: target.routingToken,
            source: "routed-client"
        };
    }
    function hunyuanOwnedSurfaceFromError(target, error) {
        if (target.mode !== "new" || !error || typeof error !== "object")
            return undefined;
        const openedSurface = normalizeRecord(error.openedSurface);
        const tabId = numberValue(openedSurface.openedTabId);
        if (tabId === undefined)
            return undefined;
        const windowId = numberValue(openedSurface.openedWindowId);
        const controllerId = stringValue(openedSurface.openedControllerId);
        return {
            tabId,
            ...(windowId !== undefined ? { windowId } : {}),
            ...(controllerId ? { controllerId } : {}),
            routingToken: target.routingToken,
            source: "routed-open-error"
        };
    }
    async function cleanupHunyuanOwnedBrowserSurface(surface, ctx) {
        if (!surface)
            return;
        try {
            await browserExtension.closeTab(surface.tabId, {
                controllerId: surface.controllerId,
                timeoutMs: 20_000
            });
            await ctx.event("hunyuan-global.browser-cleanup", "Closed Navoke-owned Hunyuan Global browser tab.", surface).catch(() => undefined);
        }
        catch (error) {
            await ctx
                .event("hunyuan-global.browser-cleanup-failed", "Could not close Navoke-owned Hunyuan Global browser tab.", {
                ...surface,
                error: formatErrorMessage(error)
            })
                .catch(() => undefined);
        }
    }
    function waitWithSignal(timeoutMs, signal) {
        if (signal.aborted)
            return Promise.reject(new Error("Operation cancelled"));
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, timeoutMs);
            signal.addEventListener("abort", () => {
                clearTimeout(timeout);
                reject(new Error("Operation cancelled"));
            }, { once: true });
        });
    }
    return [...HUNYUAN_SITES.map((site) => createHunyuanImageToModelWorkflow(site)), createHunyuanGlobalExtensionWorkflow()];
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
async function startHunyuanGeometryGeneration(page, selectors, waitForQuotaResolution) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        await dismissHunyuanQuotaPopup(page, selectors);
        try {
            await clickHunyuanGenerateButton(page, selectors.generateButton, 120_000);
            await waitForHunyuanGenerationStarted(page, selectors, 60_000);
            return;
        }
        catch (error) {
            lastError = error;
            if (!(await isHunyuanQuotaPopupVisible(page, selectors)))
                throw error;
            await waitForQuotaResolution({
                phase: "generation-quota",
                url: page.url(),
                attempt,
                quotaExhaustedPopupText: selectors.quotaExhaustedPopupText,
                reason: "Hunyuan showed the generation quota exhausted popup."
            });
        }
    }
    throw lastError instanceof Error ? lastError : new Error(formatErrorMessage(lastError));
}
async function dismissHunyuanQuotaPopup(page, selectors) {
    if (!(await isHunyuanQuotaPopupVisible(page, selectors)))
        return false;
    if (hasSelector(selectors.quotaExhaustedPopupCloseButton)) {
        try {
            await clickVisibleHunyuanControl(page, selectors.quotaExhaustedPopupCloseButton, "quotaExhaustedPopupCloseButton");
            await waitForHunyuanQuotaPopupHidden(page, selectors, 2_000);
            return true;
        }
        catch {
            // Fall through to DOM dispatch fallback; some Hunyuan close icons are SVG-only controls.
        }
    }
    const text = selectors.quotaExhaustedPopupText;
    if (!hasSelector(text))
        return false;
    const clicked = await page.evaluate((needle) => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        const roots = Array.from(document.querySelectorAll(".invite-tooltip-full, .invite-tooltip-content, .t-popup, [class*='tooltip']"));
        const root = roots.find((candidate) => isVisible(candidate) && (candidate.textContent ?? "").includes(needle));
        const closeControl = root?.querySelector(".t-icon-close, [class*='close']");
        if (!closeControl)
            return false;
        closeControl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
    }, text);
    if (clicked) {
        await waitForHunyuanQuotaPopupHidden(page, selectors, 2_000);
        return true;
    }
    return false;
}
async function isHunyuanQuotaPopupVisible(page, selectors) {
    if (hasSelector(selectors.quotaExhaustedPopupText) && (await hasVisibleText(page, selectors.quotaExhaustedPopupText))) {
        return true;
    }
    if (hasSelector(selectors.quotaExhaustedPopupCloseButton)) {
        const closeLocator = page.locator(selectors.quotaExhaustedPopupCloseButton);
        const count = await safeLocatorCount(closeLocator);
        for (let index = 0; index < count; index += 1) {
            if (await safeIsVisible(closeLocator.nth(index)))
                return true;
        }
    }
    return false;
}
async function waitForHunyuanQuotaPopupHidden(page, selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!(await isHunyuanQuotaPopupVisible(page, selectors)))
            return;
        await safeWaitForTimeout(page, 100);
    }
}
async function downloadHunyuanExportFormat(page, selectors, requested, timeoutMs = 120_000) {
    if (!hasSelector(selectors.exportFormatDropdown)) {
        throw new Error("Hunyuan export format dropdown selector is not configured.");
    }
    await clickVisibleHunyuanControl(page, selectors.exportFormatDropdown, "exportFormatDropdown");
    const availableOptions = await collectVisibleHunyuanExportOptions(page);
    let resolution = resolveHunyuanExportFormat(requested, availableOptions);
    let download = await tryDownloadHunyuanExportOption(page, selectors, resolution.actual, timeoutMs);
    if (download)
        return { resolution, download };
    if (requested !== "obj" && resolution.actual !== "obj") {
        download = await tryDownloadHunyuanExportOption(page, selectors, "obj", timeoutMs);
        if (download) {
            resolution = {
                requested,
                actual: "obj",
                availableOptions,
                fallbackReason: `Requested ${requested.toUpperCase()} export could not be clicked; using OBJ fallback.`
            };
            return { resolution, download };
        }
    }
    throw new Error(`Hunyuan export format ${requested.toUpperCase()} could not start a download. ` +
        `actualAttempt=${resolution.actual.toUpperCase()}; availableOptions=${formatHunyuanExportOptions(availableOptions)}; ` +
        `requestedSelector=${selectors.exportFormatOptions?.[requested] ?? ""}; objSelector=${selectors.exportFormatOptions?.obj ?? ""}`);
}
async function tryDownloadHunyuanExportOption(page, selectors, format, timeoutMs) {
    const optionSelector = selectors.exportFormatOptions?.[format] ?? hunyuanExportOptionSelector(format.toUpperCase());
    if (!hasSelector(optionSelector))
        return undefined;
    const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
    try {
        await clickVisibleHunyuanControl(page, optionSelector, `exportFormatOptions.${format}`);
    }
    catch {
        void downloadPromise.catch(() => undefined);
        return undefined;
    }
    return downloadPromise;
}
async function selectHunyuanExportFormat(page, selectors, requested) {
    if (!hasSelector(selectors.exportFormatDropdown)) {
        throw new Error("Hunyuan export format dropdown selector is not configured.");
    }
    await clickVisibleHunyuanControl(page, selectors.exportFormatDropdown, "exportFormatDropdown");
    const availableOptions = await collectVisibleHunyuanExportOptions(page);
    const resolution = resolveHunyuanExportFormat(requested, availableOptions);
    const selected = await tryClickHunyuanExportOption(page, selectors, resolution.actual);
    if (selected)
        return resolution;
    if (requested !== "obj" && resolution.actual !== "obj") {
        const fallbackSelected = await tryClickHunyuanExportOption(page, selectors, "obj");
        if (fallbackSelected) {
            return {
                requested,
                actual: "obj",
                availableOptions,
                fallbackReason: `Requested ${requested.toUpperCase()} export could not be clicked; using OBJ fallback.`
            };
        }
    }
    throw new Error(`Hunyuan export format ${requested.toUpperCase()} could not be selected. ` +
        `actualAttempt=${resolution.actual.toUpperCase()}; availableOptions=${formatHunyuanExportOptions(availableOptions)}; ` +
        `requestedSelector=${selectors.exportFormatOptions?.[requested] ?? ""}; objSelector=${selectors.exportFormatOptions?.obj ?? ""}`);
}
async function tryClickHunyuanExportOption(page, selectors, format) {
    const optionSelector = selectors.exportFormatOptions?.[format] ?? hunyuanExportOptionSelector(format.toUpperCase());
    if (!hasSelector(optionSelector))
        return false;
    try {
        await clickVisibleHunyuanControl(page, optionSelector, `exportFormatOptions.${format}`);
        return true;
    }
    catch {
        return false;
    }
}
async function collectVisibleHunyuanExportOptions(page) {
    try {
        return await page.evaluate(() => {
            const selectors = [
                ".v3-download-panel .v3-download-panel__item",
                ".v3-download-panel__item",
                ".download__dropdown li.t-dropdown__item",
                ".t-popup li.t-dropdown__item",
                ".t-dropdown__menu li.t-dropdown__item",
                "li.t-dropdown__item",
                "[role='menuitem']"
            ];
            const elements = [];
            for (const selector of selectors) {
                for (const element of Array.from(document.querySelectorAll(selector))) {
                    if (!elements.includes(element))
                        elements.push(element);
                }
            }
            const isVisible = (element) => {
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
            };
            return elements
                .filter(isVisible)
                .map((element) => (element.textContent ?? "").trim())
                .filter((text, index, all) => text.length > 0 && all.indexOf(text) === index);
        });
    }
    catch {
        return [];
    }
}
function formatHunyuanExportOptions(options) {
    return options.length > 0 ? options.join(", ") : "(none detected)";
}
const HUNYUAN_GENERATE_BUTTON_READY_SELECTOR = ".v3-sidebar-left .sideBarLeft-generateBtn:not(.t-is-disabled):not([disabled])";
const HUNYUAN_GENERATE_BUTTON_ANY_SELECTOR = ".v3-sidebar-left .sideBarLeft-generateBtn";
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
async function closeHunyuanMultipleViewsModal(page, selectors, addMultipleViewsText) {
    let closeError;
    const closeSelectors = [
        selectors.multipleViewsConfirmButton,
        `.hy-multi-view-grid__header:has-text("${addMultipleViewsText}") .hy-multi-view-grid__header-close`,
        ".hy-multi-view-grid__header-close"
    ].filter(hasSelector);
    for (const closeSelector of closeSelectors) {
        try {
            await page.locator(closeSelector).first().click({ timeout: 2_000 });
            await waitForHunyuanMultipleViewsModalHidden(page, addMultipleViewsText, 10_000);
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
        await waitForHunyuanMultipleViewsModalHidden(page, addMultipleViewsText, 10_000);
        return;
    }
    catch (error) {
        closeError = error;
    }
    try {
        await page.keyboard.press("Escape");
        await waitForHunyuanMultipleViewsModalHidden(page, addMultipleViewsText, 10_000);
        return;
    }
    catch (error) {
        throw new Error(`Hunyuan multiview modal did not close after uploads. Configure multipleViewsConfirmButton. ` +
            `closeSelector=${selectors.multipleViewsConfirmButton ?? ""}; fallbackSelectors=${closeSelectors.join(", ")}; ` +
            `closeError=${formatErrorMessage(closeError)}; waitError=${formatErrorMessage(error)}`);
    }
}
async function waitForHunyuanMultipleViewsModalHidden(page, addMultipleViewsText, timeoutMs) {
    const popup = page.locator(".hy-multiple-views-upload-v2-popup").first();
    if ((await safeLocatorCount(popup)) > 0) {
        await popup.waitFor({ state: "hidden", timeout: timeoutMs });
        return;
    }
    await page.locator(`.hy-multi-view-grid__header-title:has-text("${addMultipleViewsText}")`).first().waitFor({
        state: "hidden",
        timeout: timeoutMs
    });
}
async function waitForHunyuanUploadProcessingComplete(page, timeoutMs, uploadingText) {
    const deadline = Date.now() + timeoutMs;
    let stableSince = 0;
    while (Date.now() < deadline) {
        const uploadingVisible = await hasVisibleText(page, uploadingText);
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
    throw new Error(`Timed out waiting for Hunyuan upload processing to finish. Visible text still matched "${uploadingText}".`);
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
function sleepWithSignal(timeoutMs, signal) {
    if (signal.aborted)
        return Promise.reject(new Error("Operation cancelled"));
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, timeoutMs);
        signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Operation cancelled"));
        }, { once: true });
    });
}
function formatErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function hunyuanControllerManualMessage(error) {
    const message = formatErrorMessage(error);
    if (/No compatible Navoke browser controller/i.test(message)) {
        return `The Navoke browser controller for the intended Chrome profile is not connected. Do not open chrome.exe or paste the routed Hunyuan Global URL into another Chrome profile; that bypasses the Navoke extension controller and can open the wrong profile. Open the Navoke extension popup in the Chrome profile that has the unpacked Navoke extension, wait until it reports at least 1 browser controller, then resume this run. ${message}`;
    }
    if (/controller command was not completed|Timed out waiting for Navoke browser controller command/i.test(message)) {
        return `The Navoke browser controller is connected, but it did not complete the command to open the Hunyuan Global window. Do not open chrome.exe or paste the routed URL into another Chrome profile. Open the Navoke extension popup in the intended Chrome profile to wake the controller, confirm it reports at least 1 browser controller, then resume this run. ${message}`;
    }
    return `The Navoke browser controller opened Hunyuan Global but could not connect to the routed page. Do not open chrome.exe or paste the routed URL into another Chrome profile. Confirm the extension has site access for 3d.hunyuanglobal.com in the controller-owned window, open the Navoke extension popup in that profile, refresh the opened Hunyuan page, then resume this run. ${message}`;
}
function createDefaultHunyuanGlobalTab() {
    const routingToken = (0, node_crypto_1.randomUUID)();
    const url = new URL(exports.HUNYUAN_GLOBAL_TARGET_URL);
    url.hash = `${ROUTING_TOKEN_PARAM}=${encodeURIComponent(routingToken)}`;
    return { mode: "new", routingToken, url: url.toString(), openMode: "window" };
}
function redactHunyuanTarget(target) {
    return {
        mode: target.mode,
        ...(target.mode === "existing"
            ? { clientId: target.clientId, url: target.url, title: target.title, tabId: target.tabId, windowId: target.windowId, controllerId: target.controllerId }
            : {}),
        ...(target.mode === "new"
            ? {
                routingToken: target.routingToken,
                url: target.url,
                title: target.title,
                openMode: target.openMode,
                clientId: target.clientId,
                tabId: target.tabId,
                windowId: target.windowId,
                controllerId: target.controllerId
            }
            : {})
    };
}
function normalizeRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function stringValue(value) {
    return typeof value === "string" ? value : "";
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
async function ensureHunyuanEditorReady(page, selectors, timeoutMs) {
    if (!hasSelector(selectors.editorReadySelector)) {
        throw new Error("Hunyuan editor-ready selector is not configured.");
    }
    if (await isSelectorVisible(page, selectors.editorReadySelector, 1_000)) {
        return { enteredFrom: "editor", url: page.url() };
    }
    const landingVisible = await isSelectorVisible(page, selectors.landingReadySelector, 1_000);
    const enterEditorVisible = await isSelectorVisible(page, selectors.enterEditorButton, landingVisible ? 10_000 : 1_000);
    if (!landingVisible && !enterEditorVisible) {
        await page.locator(selectors.editorReadySelector).first().waitFor({ state: "visible", timeout: timeoutMs });
        return { enteredFrom: "editor", url: page.url() };
    }
    if (!hasSelector(selectors.enterEditorButton)) {
        throw new Error("Hunyuan landing page is visible but the editor-entry selector is not configured.");
    }
    await clickVisibleHunyuanControl(page, selectors.enterEditorButton, "enterEditorButton");
    await page.locator(selectors.editorReadySelector).first().waitFor({ state: "visible", timeout: timeoutMs });
    return { enteredFrom: "landing", url: page.url() };
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
