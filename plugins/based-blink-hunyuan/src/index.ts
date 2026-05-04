import path from "node:path";
import { randomUUID } from "node:crypto";
import type * as zod from "zod";
import type { ExtensionBrowserTarget, WorkflowDefinition, WorkflowSdk } from "./sdkTypes";

export type HunyuanViewField =
  | "frontImage"
  | "backImage"
  | "leftImage"
  | "rightImage"
  | "topImage"
  | "bottomImage"
  | "left45Image"
  | "right45Image";

export type HunyuanViewSelectorKey = "front" | "back" | "left" | "right" | "top" | "bottom" | "left45" | "right45";
export type HunyuanFaceCount = "1.5m" | "1m" | "500k" | "50k";
export type HunyuanRetopologyType = "triangle" | "quad";
export type HunyuanExportFormat = "obj" | "glb";

export const HUNYUAN_TENCENT_WORKFLOW_ID = "based-blink.hunyuan.image-to-model";
export const HUNYUAN_GLOBAL_WORKFLOW_ID = "based-blink.hunyuan.global.image-to-model";
export const HUNYUAN_GLOBAL_TARGET_URL = "https://3d.hunyuanglobal.com/";
const ROUTING_TOKEN_PARAM = "based-blink-tab";

export interface HunyuanViewSlot {
  field: HunyuanViewField;
  selectorKey: HunyuanViewSelectorKey;
  label: string;
  required?: boolean;
}

export interface HunyuanSelectorConfig {
  loginReadySelector?: string;
  loginReadyText?: string;
  loginRequiredSelector?: string;
  loginRequiredText?: string;
  imageTo3dTab?: string;
  multipleImagesTab?: string;
  addMultipleViewsButton?: string;
  multipleViewsConfirmButton?: string;
  viewUploadInputs?: Partial<Record<HunyuanViewSelectorKey, string>>;
  modelDropdown?: string;
  modelOptionV31?: string;
  faceCountButtons?: Partial<Record<HunyuanFaceCount, string>>;
  modelTypeGeometryTexturePhased?: string;
  promptTextbox?: string;
  generateButton?: string;
  geometryRunningSelector?: string;
  geometryRunningText?: string;
  geometryReadySelector?: string;
  geometryReadyText?: string;
  retopologyTypeButtons?: Partial<Record<HunyuanRetopologyType, string>>;
  smartRetopologyButton?: string;
  retopologyRunningSelector?: string;
  retopologyRunningText?: string;
  retopologyReadySelector?: string;
  retopologyReadyText?: string;
  generateTextureButton?: string;
  textureRunningSelector?: string;
  textureRunningText?: string;
  textureReadySelector?: string;
  textureReadyText?: string;
  autoRigButton?: string;
  autoRigRunningSelector?: string;
  autoRigRunningText?: string;
  autoRigReadySelector?: string;
  autoRigReadyText?: string;
  exportFormatDropdown?: string;
  exportFormatOptions?: Partial<Record<HunyuanExportFormat, string>>;
  downloadReadySelector?: string;
  downloadReadyText?: string;
  downloadButton?: string;
}

export interface HunyuanWorkflowInputLike {
  frontImage?: string;
  backImage?: string;
  leftImage?: string;
  rightImage?: string;
  topImage?: string;
  bottomImage?: string;
  left45Image?: string;
  right45Image?: string;
  modelFaceCount?: HunyuanFaceCount;
  retopologyType?: HunyuanRetopologyType;
  generateTexture?: boolean;
  autoRig?: boolean;
  exportFormat?: HunyuanExportFormat;
  selectors?: HunyuanSelectorConfig;
}

export type HunyuanExtensionTabTarget =
  | { mode: "any" }
  | { mode: "existing"; clientId: string; url?: string; title?: string }
  | { mode: "new"; routingToken: string; url?: string; title?: string };

export interface HunyuanViewUpload {
  field: HunyuanViewField;
  selectorKey: HunyuanViewSelectorKey;
  label: string;
  imagePath: string;
}

export const HUNYUAN_VIEW_SLOTS: HunyuanViewSlot[] = [
  { field: "frontImage", selectorKey: "front", label: "Front", required: true },
  { field: "backImage", selectorKey: "back", label: "Back" },
  { field: "leftImage", selectorKey: "left", label: "Left" },
  { field: "rightImage", selectorKey: "right", label: "Right" },
  { field: "topImage", selectorKey: "top", label: "Top" },
  { field: "bottomImage", selectorKey: "bottom", label: "Bottom" },
  { field: "left45Image", selectorKey: "left45", label: "Left 45" },
  { field: "right45Image", selectorKey: "right45", label: "Right 45" }
];

export const HUNYUAN_FACE_COUNTS: HunyuanFaceCount[] = ["1.5m", "1m", "500k", "50k"];
export const HUNYUAN_RETOPOLOGY_TYPES: HunyuanRetopologyType[] = ["triangle", "quad"];
export const HUNYUAN_EXPORT_FORMATS: HunyuanExportFormat[] = ["obj", "glb"];

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

const HUNYUAN_GLOBAL_TEXT = {
  login: "Start Using",
  emailLogin: "Start Using HY 3D",
  imageTo3d: "Image to 3D",
  multipleImages: "Multiple Images",
  addMultipleViews: "Add Multi-view",
  uploading: "Uploading",
  modelFaceCount: "Model",
  modelType: "Model Type",
  geometryTexturePhased: "Texture",
  generate: "Generate",
  generating: "Generating",
  estimatedRemaining: "Estimated",
  v31: "V3.1",
  triangle: "Triangle",
  quad: "Quad",
  smartRetopology: "Smart Retopology",
  generateTexture: "Generate Texture",
  autoRig: "Auto Rig",
  download: "Download"
};

function hunyuanEnabledButtonSelector(label: string): string {
  return `:is(button, .t-button):not(.t-is-disabled):not([disabled]):has-text("${label}")`;
}

export const DEFAULT_HUNYUAN_SELECTOR_CONFIG: HunyuanSelectorConfig = {
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
    triangle: `.model-dialog__content__operation:has(.model-dialog__content__operation__heading:has-text("${HUNYUAN_TEXT.smartRetopology}")) .topology-panel .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_TEXT.triangle}")`,
    quad: `.model-dialog__content__operation:has(.model-dialog__content__operation__heading:has-text("${HUNYUAN_TEXT.smartRetopology}")) .topology-panel .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_TEXT.quad}")`
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
  exportFormatDropdown: "button.download__dropdown__btn",
  exportFormatOptions: {
    obj: '.download__dropdown li.t-dropdown__item:has-text("OBJ")',
    glb: '.download__dropdown li.t-dropdown__item:has-text("GLB")'
  },
  downloadReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download),
  downloadButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download)
};

export const DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG: HunyuanSelectorConfig = {
  loginReadySelector: `label.t-radio-button:has-text("${HUNYUAN_GLOBAL_TEXT.imageTo3d}")`,
  loginRequiredSelector: `button.login-btn:has-text("${HUNYUAN_GLOBAL_TEXT.login}"), input[placeholder*="email" i]`,
  loginRequiredText: HUNYUAN_GLOBAL_TEXT.emailLogin,
  imageTo3dTab: `label.t-radio-button:has-text("${HUNYUAN_GLOBAL_TEXT.imageTo3d}")`,
  multipleImagesTab: `text=/${HUNYUAN_GLOBAL_TEXT.multipleImages}/i`,
  addMultipleViewsButton: ".hy-multiple-views-upload-v2",
  multipleViewsConfirmButton: ".hy-multi-view-grid__header-close",
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
  modelOptionV31: `li.t-select-option:has-text("${HUNYUAN_GLOBAL_TEXT.v31}")`,
  faceCountButtons: {
    "1.5m": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("1.5m")`,
    "1m": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("1m")`,
    "500k": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("500k")`,
    "50k": `div.generation-type-select:visible .qaUJkqcCF813NIqHGF3U:visible:has-text("50k")`
  },
  modelTypeGeometryTexturePhased: `div.generation-type-select:visible:has(.generation-type-select-title:has-text("${HUNYUAN_GLOBAL_TEXT.modelType}")) .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_GLOBAL_TEXT.geometryTexturePhased}")`,
  generateButton: `.sideBarLeft-generateBtn:not(.t-is-disabled):not([disabled]):has-text("${HUNYUAN_GLOBAL_TEXT.generate}")`,
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
  textureRunningText: HUNYUAN_GLOBAL_TEXT.generating,
  textureReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download),
  autoRigButton: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.autoRig),
  autoRigRunningText: HUNYUAN_GLOBAL_TEXT.generating,
  autoRigReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download),
  exportFormatDropdown: "button.download__dropdown__btn",
  exportFormatOptions: {
    obj: '.download__dropdown li.t-dropdown__item:has-text("OBJ")',
    glb: '.download__dropdown li.t-dropdown__item:has-text("GLB")'
  },
  downloadReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download),
  downloadButton: hunyuanEnabledButtonSelector(HUNYUAN_GLOBAL_TEXT.download)
};

interface HunyuanSiteDefinition {
  workflowId: string;
  title: string;
  description: string;
  targetUrl: string;
  source: string;
  selectorDefaults: HunyuanSelectorConfig;
  uploadingText: string;
  addMultipleViewsText: string;
}

const HUNYUAN_SITES: HunyuanSiteDefinition[] = [
  {
    workflowId: HUNYUAN_TENCENT_WORKFLOW_ID,
    title: "Hunyuan Image to 3D Model",
    description: "Generates one textured, retopologized model from multiple Hunyuan reference views.",
    targetUrl: "https://3d.hunyuan.tencent.com/",
    source: "hunyuan",
    selectorDefaults: DEFAULT_HUNYUAN_SELECTOR_CONFIG,
    uploadingText: HUNYUAN_TEXT.uploading,
    addMultipleViewsText: HUNYUAN_TEXT.addMultipleViews
  }
];

export function buildHunyuanViewUploadPlan(input: HunyuanWorkflowInputLike): HunyuanViewUpload[] {
  return HUNYUAN_VIEW_SLOTS.flatMap((slot) => {
    const value = input[slot.field];
    const imagePath = typeof value === "string" ? value.trim() : "";
    return imagePath ? [{ field: slot.field, selectorKey: slot.selectorKey, label: slot.label, imagePath }] : [];
  });
}

export function mergeHunyuanSelectorConfig(
  selectors: HunyuanSelectorConfig | undefined,
  defaults: HunyuanSelectorConfig = DEFAULT_HUNYUAN_SELECTOR_CONFIG
): HunyuanSelectorConfig {
  return {
    ...defaults,
    ...compactSelectorObject(selectors),
    viewUploadInputs: mergeSelectorRecord(defaults.viewUploadInputs, selectors?.viewUploadInputs),
    faceCountButtons: mergeSelectorRecord(defaults.faceCountButtons, selectors?.faceCountButtons),
    retopologyTypeButtons: mergeSelectorRecord(defaults.retopologyTypeButtons, selectors?.retopologyTypeButtons),
    exportFormatOptions: mergeSelectorRecord(defaults.exportFormatOptions, selectors?.exportFormatOptions)
  };
}

export function missingHunyuanSelectorKeys(input: HunyuanWorkflowInputLike): string[] {
  const selectors = input.selectors ?? {};
  const missing: string[] = [];
  const requireSelector = (key: string, value: unknown): void => {
    if (!hasSelector(value)) missing.push(key);
  };
  const requireWait = (label: string, selector?: string, text?: string): void => {
    if (!hasSelector(selector) && !hasSelector(text)) missing.push(`${label}Selector or ${label}Text`);
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

export function inferHunyuanArtifactKind(filePath: string, inferMimeType: (filePath: string) => string | null): "model" | "download" {
  return inferMimeType(filePath)?.startsWith("model/") ? "model" : "download";
}

export function createWorkflows(sdk: WorkflowSdk): WorkflowDefinition[] {
  const { z } = sdk.schema;
  const { launchPersistentProfile, saveScreenshot, startTrace, stopTrace, timeoutMinutes } = sdk.browser;
  const { WorkflowConfigurationError } = sdk.errors;
  const { inferMimeType, writeJson } = sdk.files;
  const browserExtension = sdk.extension.browser;

  const stringSelectorSchema = z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().trim().min(1).optional()
  );
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

  const extensionTabSchema = z.union([
    z.object({ mode: z.literal("any") }),
    z.object({
      mode: z.literal("existing"),
      clientId: z.string().trim().min(1),
      url: z.string().optional(),
      title: z.string().optional()
    }),
    z.object({
      mode: z.literal("new"),
      routingToken: z.string().trim().min(1),
      url: z.string().optional(),
      title: z.string().optional()
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
    manifestArtifactId: z.string().optional()
  });

  function createHunyuanImageToModelWorkflow(
    site: HunyuanSiteDefinition
  ): WorkflowDefinition<zod.infer<typeof inputSchema>, zod.infer<typeof outputSchema>> {
    return {
    manifest: {
      id: site.workflowId,
      title: site.title,
      description: site.description,
      category: "hunyuan",
      version: "0.1.0",
      concurrency: 1,
      requiresBrowser: true,
      targetUrl: site.targetUrl,
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
          options: HUNYUAN_FACE_COUNTS.map((value) => ({ label: value, value }))
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
      const artifactIds: string[] = [];
      const phaseEvents: Array<{ phase: string; completedAt: string; data?: unknown }> = [];
      const uploadPlan = buildHunyuanViewUploadPlan(input);
      const selectors = mergeHunyuanSelectorConfig(input.selectors, site.selectorDefaults);
      const context = await launchPersistentProfile({
        paths: ctx.paths,
        workflowId: "hunyuan",
        profileName: input.profileName,
        headless: input.headless
      });
      const tracePath = await startTrace(context, ctx.artifactDir);

      function recordPhase(phase: string, data?: unknown): void {
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
          } else {
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
            name: path.basename(screenshot),
            path: screenshot,
            mimeType: "image/png",
            metadata: { source: site.source, missingSelectors }
          });
          artifactIds.push(screenshotArtifact.id);
          throw new WorkflowConfigurationError(
            `Hunyuan selectors are not configured. Missing selector keys: ${missingSelectors.join(", ")}. Use Workflow Lab to inspect the page controls and calibrate selector support.`
          );
        }

        await clickSelector(page, selectors.imageTo3dTab!);
        await clickSelector(page, selectors.multipleImagesTab!);
        await clickSelector(page, selectors.addMultipleViewsButton!);

        await ctx.step("Uploading multiview images", 15, { views: uploadPlan.map((upload) => upload.selectorKey) });
        for (const upload of uploadPlan) {
          await page.locator(selectors.viewUploadInputs![upload.selectorKey]!).first().setInputFiles(upload.imagePath);
          recordPhase(`uploaded-${upload.selectorKey}`, { imagePath: upload.imagePath });
        }

        await ctx.step("Waiting for Hunyuan uploads", 20, { views: uploadPlan.map((upload) => upload.selectorKey) });
        await waitForHunyuanUploadProcessingComplete(page, timeoutMinutes(input.timeoutMinutes), site.uploadingText);
        await closeHunyuanMultipleViewsModal(page, selectors, site.addMultipleViewsText);

        await ctx.step("Applying Hunyuan settings", 25, {
          modelFaceCount: input.modelFaceCount,
          retopologyType: input.retopologyType,
          generateTexture: input.generateTexture,
          autoRig: input.autoRig,
          exportFormat: input.exportFormat
        });
        try {
          await clickSelector(page, selectors.modelDropdown!);
          await clickSelector(page, selectors.modelOptionV31!);
          await clickVisibleHunyuanControl(page, selectors.faceCountButtons![input.modelFaceCount]!, `faceCountButtons.${input.modelFaceCount}`);
          await clickVisibleHunyuanControl(page, selectors.modelTypeGeometryTexturePhased!, "modelTypeGeometryTexturePhased");
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
        } catch (error) {
          const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-settings-calibration.png");
          const screenshotArtifact = await ctx.addArtifact({
            kind: "screenshot",
            name: path.basename(screenshot),
            path: screenshot,
            mimeType: "image/png",
            metadata: {
              source: site.source,
              phase: "settings",
              modelFaceCount: input.modelFaceCount,
              retopologyType: input.retopologyType,
              exportFormat: input.exportFormat
            }
          });
          artifactIds.push(screenshotArtifact.id);
          throw new WorkflowConfigurationError(
            `Hunyuan settings selector failed. Saved calibration screenshot artifact ${screenshotArtifact.id}. ${formatErrorMessage(error)}`
          );
        }

        await ctx.step("Starting geometry generation", 35);
        try {
          await clickHunyuanGenerateButton(page, selectors.generateButton!, 120_000);
          await waitForHunyuanGenerationStarted(page, selectors, 60_000);
          recordPhase("geometry-started", { url: page.url() });
        } catch (error) {
          const screenshot = await saveScreenshot(page, ctx.artifactDir, "hunyuan-generate-calibration.png");
          const screenshotArtifact = await ctx.addArtifact({
            kind: "screenshot",
            name: path.basename(screenshot),
            path: screenshot,
            mimeType: "image/png",
            metadata: {
              source: site.source,
              phase: "generate",
              selector: selectors.generateButton,
              modelFaceCount: input.modelFaceCount,
              retopologyType: input.retopologyType,
              exportFormat: input.exportFormat
            }
          });
          artifactIds.push(screenshotArtifact.id);
          throw new WorkflowConfigurationError(
            `Hunyuan generate button failed. Saved calibration screenshot artifact ${screenshotArtifact.id}. ${formatErrorMessage(error)}`
          );
        }
        await waitForHunyuanReady(page, selectors.geometryReadySelector, selectors.geometryReadyText, timeoutMinutes(input.timeoutMinutes));
        recordPhase("geometry-ready", { url: page.url() });

        await ctx.step("Running smart retopology", 55, { retopologyType: input.retopologyType });
        await clickVisibleHunyuanControl(page, selectors.retopologyTypeButtons![input.retopologyType]!, `retopologyTypeButtons.${input.retopologyType}`);
        await clickAndVerifyHunyuanActionStarted(page, {
          selector: selectors.smartRetopologyButton!,
          selectorKey: "smartRetopologyButton",
          runningSelector: selectors.retopologyRunningSelector,
          runningText: selectors.retopologyRunningText,
          readySelector: selectors.retopologyReadySelector,
          readyText: selectors.retopologyReadyText
        });
        await waitForHunyuanReadyAfterRunning(
          page,
          selectors.retopologyRunningSelector,
          selectors.retopologyRunningText,
          selectors.retopologyReadySelector,
          selectors.retopologyReadyText,
          timeoutMinutes(input.timeoutMinutes)
        );
        recordPhase("retopology-ready", { retopologyType: input.retopologyType });

        if (input.generateTexture) {
          await ctx.step("Generating texture", 72);
          await clickAndVerifyHunyuanActionStarted(page, {
            selector: selectors.generateTextureButton!,
            selectorKey: "generateTextureButton",
            runningSelector: selectors.textureRunningSelector,
            runningText: selectors.textureRunningText,
            readySelector: selectors.textureReadySelector,
            readyText: selectors.textureReadyText
          });
          await waitForHunyuanReadyAfterRunning(
            page,
            selectors.textureRunningSelector,
            selectors.textureRunningText,
            selectors.textureReadySelector,
            selectors.textureReadyText,
            timeoutMinutes(input.timeoutMinutes)
          );
          recordPhase("texture-ready");
        }

        if (input.autoRig) {
          await ctx.step("Running auto-rig", 80);
          await clickAndVerifyHunyuanActionStarted(page, {
            selector: selectors.autoRigButton!,
            selectorKey: "autoRigButton",
            runningSelector: selectors.autoRigRunningSelector,
            runningText: selectors.autoRigRunningText,
            readySelector: selectors.autoRigReadySelector,
            readyText: selectors.autoRigReadyText
          });
          await waitForHunyuanReadyAfterRunning(
            page,
            selectors.autoRigRunningSelector,
            selectors.autoRigRunningText,
            selectors.autoRigReadySelector,
            selectors.autoRigReadyText,
            timeoutMinutes(input.timeoutMinutes)
          );
          recordPhase("auto-rig-ready");
        }

        await ctx.step("Preparing download", 88, { exportFormat: input.exportFormat });
        if (hasSelector(selectors.downloadReadySelector) || hasSelector(selectors.downloadReadyText)) {
          await waitForHunyuanReady(page, selectors.downloadReadySelector, selectors.downloadReadyText, timeoutMinutes(input.timeoutMinutes));
        }
        await clickSelector(page, selectors.exportFormatDropdown!);
        await clickSelector(page, selectors.exportFormatOptions![input.exportFormat]!);

        await ctx.step("Downloading result", 94);
        const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
        await clickHunyuanActionButton(page, selectors.downloadButton!, "downloadButton", 120_000);
        const download = await downloadPromise;
        const targetPath = path.join(ctx.artifactDir, download.suggestedFilename());
        await download.saveAs(targetPath);
        const modelArtifact = await ctx.addArtifact({
          kind: inferHunyuanArtifactKind(targetPath, inferMimeType),
          name: path.basename(targetPath),
          path: targetPath,
          mimeType: inferMimeType(targetPath),
          metadata: { source: site.source, pageUrl: page.url(), exportFormat: input.exportFormat, phases: phaseEvents }
        });
        artifactIds.push(modelArtifact.id);
        recordPhase("downloaded", { targetPath, artifactId: modelArtifact.id });

        const manifestPath = path.join(ctx.artifactDir, "hunyuan-image-to-model-manifest.json");
        writeJson(manifestPath, {
          source: site.source,
          workflowId: site.workflowId,
          targetUrl: site.targetUrl,
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
            filename: path.basename(targetPath),
            mimeType: inferMimeType(targetPath)
          }
        });
        const manifestArtifact = await ctx.addArtifact({
          kind: "json",
          name: path.basename(manifestPath),
          path: manifestPath,
          mimeType: "application/json",
          metadata: { source: site.source, modelArtifactId: modelArtifact.id }
        });
        artifactIds.push(manifestArtifact.id);

        return {
          artifactIds,
          modelArtifactId: modelArtifact.id,
          manifestArtifactId: manifestArtifact.id,
          summary: `${site.title} completed.`
        };
      } finally {
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

  function createHunyuanGlobalExtensionWorkflow(): WorkflowDefinition<zod.infer<typeof globalInputSchema>, zod.infer<typeof outputSchema>> {
    return {
      manifest: {
        id: HUNYUAN_GLOBAL_WORKFLOW_ID,
        title: "Hunyuan Global Image to 3D Model",
        description: "Opens Hunyuan Global in your normal browser and pauses at the email login checkpoint.",
        category: "hunyuan",
        version: "0.1.0",
        concurrency: 1,
        requiresBrowser: false,
        targetUrl: HUNYUAN_GLOBAL_TARGET_URL,
        outputKinds: ["json"],
        uiCapabilities: ["extension.tabRouting"],
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
            options: HUNYUAN_FACE_COUNTS.map((value) => ({ label: value, value }))
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
            help: "Workflow Lab can override the built-in Hunyuan Global selector preset if the page changes."
          }
        ]
      },
      inputSchema: globalInputSchema,
      outputSchema,
      async run(input, ctx) {
        const selectors = mergeHunyuanSelectorConfig(input.selectors, DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG);
        const loginSelectors = {
          startUsingButton: selectors.loginRequiredSelector,
          loginReadySelector: selectors.loginReadySelector,
          loginReadyText: selectors.loginReadyText,
          imageTo3dTab: selectors.imageTo3dTab,
          multipleImagesTab: selectors.multipleImagesTab
        };
        let lastMetadata: Record<string, unknown> = {};

        for (let attempt = 1; attempt <= 4; attempt += 1) {
          await ctx.step(attempt === 1 ? "Opening Hunyuan Global login" : "Checking Hunyuan Global login", 8, {
            target: redactHunyuanTarget(input.extensionTab),
            attempt
          });

          try {
            await browserExtension.ensureRoutedTab(input.extensionTab, { signal: ctx.signal, timeoutMs: 45_000 });
          } catch (error) {
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

          await ctx.step("Hunyuan Global authenticated", 100, {
            url: stringValue(lastMetadata.url),
            target: redactHunyuanTarget(input.extensionTab)
          });
          return {
            artifactIds: [],
            summary: "Hunyuan Global authenticated. Model generation was not started in this login slice."
          };
        }

        throw new Error("Hunyuan Global still requires manual action after multiple resume attempts.");
      }
    };
  }

  async function checkHunyuanGlobalLoginState(
    target: ExtensionBrowserTarget,
    selectors: Record<string, string | undefined>,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
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

      if (!startUsingClicked && selectors.startUsingButton && (await extensionSelectorVisible(target, selectors.startUsingButton, signal))) {
        await browserExtension.action(target, { kind: "click", selector: selectors.startUsingButton }, { signal, timeoutMs: 30_000 });
        startUsingClicked = true;
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 750);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(new Error("Operation cancelled"));
          },
          { once: true }
        );
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

  async function extensionSelectorVisible(
    target: ExtensionBrowserTarget,
    selector: string | undefined,
    signal: AbortSignal
  ): Promise<boolean> {
    if (!selector) return false;
    try {
      const state = normalizeRecord(
        await browserExtension.extract(target, { kind: "element-state", selector }, { signal, timeoutMs: 10_000 })
      );
      return state.visible === true;
    } catch {
      return false;
    }
  }

  async function extensionTextPresent(
    target: ExtensionBrowserTarget,
    text: string | undefined,
    signal: AbortSignal
  ): Promise<boolean> {
    if (!text) return false;
    try {
      const result = normalizeRecord(
        await browserExtension.extract(target, { kind: "text" }, { signal, timeoutMs: 10_000 })
      );
      return stringValue(result.text).toLowerCase().includes(text.toLowerCase());
    } catch {
      return false;
    }
  }

  return [...HUNYUAN_SITES.map((site) => createHunyuanImageToModelWorkflow(site)), createHunyuanGlobalExtensionWorkflow()];
}

function hasSelector(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compactSelectorObject<T extends object>(selectors: T | undefined): Partial<T> {
  if (!selectors) return {};
  return Object.fromEntries(
    Object.entries(selectors).filter(([, value]) => {
      if (typeof value === "string") return hasSelector(value);
      return value !== undefined;
    })
  ) as Partial<T>;
}

function mergeSelectorRecord<T extends string>(
  defaults: Partial<Record<T, string>> | undefined,
  selectors: Partial<Record<T, string>> | undefined
): Partial<Record<T, string>> {
  return { ...(defaults ?? {}), ...compactSelectorObject(selectors) };
}

async function clickSelector(page: any, selector: string): Promise<void> {
  await page.locator(selector).first().click();
}

const HUNYUAN_GENERATE_BUTTON_READY_SELECTOR = `.sideBarLeft-generateBtn:not(.t-is-disabled):not([disabled]):has-text("${HUNYUAN_TEXT.generate}")`;
const HUNYUAN_GENERATE_BUTTON_ANY_SELECTOR = `.sideBarLeft-generateBtn:has-text("${HUNYUAN_TEXT.generate}")`;

export async function clickHunyuanGenerateButton(page: any, selector: string, timeoutMs = 120_000): Promise<void> {
  await clickHunyuanActionButton(page, selector, "generateButton", timeoutMs, [HUNYUAN_GENERATE_BUTTON_READY_SELECTOR, HUNYUAN_GENERATE_BUTTON_ANY_SELECTOR]);
}

export async function clickHunyuanActionButton(
  page: any,
  selector: string,
  selectorKey: string,
  timeoutMs = 120_000,
  fallbackSelectors: string[] = []
): Promise<void> {
  const resolvedSelectors = Array.from(new Set([selector, ...fallbackSelectors].filter(hasSelector)));
  const deadline = Date.now() + timeoutMs;
  let diagnostics: HunyuanGenerateButtonDiagnostic[] = [];

  while (Date.now() < deadline) {
    diagnostics = [];

    for (const candidateSelector of resolvedSelectors) {
      const locator = page.locator(candidateSelector);
      const candidateCount = await safeLocatorCount(locator);
      const diagnostic: HunyuanGenerateButtonDiagnostic = {
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
        if (visible) diagnostic.visible += 1;
        const enabled = await safeIsEnabled(candidate);
        if (enabled) diagnostic.enabled += 1;
        const disabled = await safeHasDisabledState(candidate);
        if (disabled) diagnostic.disabled += 1;

        if (visible && enabled && !disabled) {
          diagnostic.actionable += 1;
          try {
            await candidate.click({ timeout: 5_000 });
            return;
          } catch (error) {
            diagnostic.lastClickError = formatErrorMessage(error);
          }
        }
      }

      diagnostics.push(diagnostic);
    }

    await safeWaitForTimeout(page, 250);
  }

  throw new Error(
    `Hunyuan action ${selectorKey} did not become clickable before timeout. ` +
      diagnostics
        .map(
          (diagnostic) =>
            `selector=${diagnostic.selector}; candidates=${diagnostic.candidates}; visible=${diagnostic.visible}; enabled=${diagnostic.enabled}; disabled=${diagnostic.disabled}; actionable=${diagnostic.actionable}; lastClickError=${diagnostic.lastClickError ?? ""}`
        )
        .join(" | ")
  );
}

interface HunyuanGenerateButtonDiagnostic {
  selector: string;
  candidates: number;
  visible: number;
  enabled: number;
  disabled: number;
  actionable: number;
  lastClickError?: string;
}

async function waitForHunyuanGenerationStarted(page: any, selectors: HunyuanSelectorConfig, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (hasSelector(selectors.geometryRunningSelector) && (await isSelectorVisible(page, selectors.geometryRunningSelector, 500))) return;
    if (hasSelector(selectors.geometryRunningText) && (await isTextVisible(page, selectors.geometryRunningText, 500))) return;
    if ((await hasVisibleText(page, HUNYUAN_TEXT.generating)) || (await hasVisibleText(page, HUNYUAN_TEXT.estimatedRemaining))) return;

    const configuredGenerateVisible = await isSelectorVisible(page, selectors.generateButton, 250);
    const anyGenerateVisible = await isSelectorVisible(page, HUNYUAN_GENERATE_BUTTON_ANY_SELECTOR, 250);
    if (!configuredGenerateVisible && !anyGenerateVisible) return;

    await safeWaitForTimeout(page, 500);
  }

  throw new Error(
    `Hunyuan did not enter geometry generation after clicking generate. ` +
      `runningSelector=${selectors.geometryRunningSelector ?? ""}; runningText=${selectors.geometryRunningText ?? ""}; generateSelector=${selectors.generateButton ?? ""}`
  );
}

async function clickAndVerifyHunyuanActionStarted(
  page: any,
  input: {
    selector: string;
    selectorKey: string;
    runningSelector?: string;
    runningText?: string;
    readySelector?: string;
    readyText?: string;
  },
  startTimeoutMs = 60_000
): Promise<void> {
  await clickHunyuanActionButton(page, input.selector, input.selectorKey, 120_000);
  await waitForHunyuanActionStarted(page, input, startTimeoutMs);
}

async function waitForHunyuanActionStarted(
  page: any,
  input: {
    selector: string;
    selectorKey: string;
    runningSelector?: string;
    runningText?: string;
    readySelector?: string;
    readyText?: string;
  },
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (hasSelector(input.runningSelector) && (await isSelectorVisible(page, input.runningSelector, 500))) return;
    if (hasSelector(input.runningText) && (await isTextVisible(page, input.runningText, 500))) return;
    if ((await hasVisibleText(page, HUNYUAN_TEXT.generating)) || (await hasVisibleText(page, HUNYUAN_TEXT.estimatedRemaining))) return;
    if (!(await isSelectorVisible(page, input.selector, 250))) return;

    await safeWaitForTimeout(page, 500);
  }

  throw new Error(
    `Hunyuan action ${input.selectorKey} did not enter a running or ready state after clicking. ` +
      `selector=${input.selector}; runningSelector=${input.runningSelector ?? ""}; runningText=${input.runningText ?? ""}; ` +
      `readySelector=${input.readySelector ?? ""}; readyText=${input.readyText ?? ""}`
  );
}

async function waitForHunyuanReadyAfterRunning(
  page: any,
  runningSelector: string | undefined,
  runningText: string | undefined,
  readySelector: string | undefined,
  readyText: string | undefined,
  timeoutMs: number
): Promise<void> {
  if (!hasSelector(readySelector) && !hasSelector(readyText)) {
    throw new Error("Hunyuan ready-after-running wait requires a ready selector or ready text.");
  }

  const deadline = Date.now() + timeoutMs;
  let stableReadySince = 0;

  while (Date.now() < deadline) {
    const running =
      (hasSelector(runningSelector) && (await isSelectorVisible(page, runningSelector, 500))) ||
      (hasSelector(runningText) && (await isTextVisible(page, runningText, 500))) ||
      (await hasVisibleText(page, HUNYUAN_TEXT.generating)) ||
      (await hasVisibleText(page, HUNYUAN_TEXT.estimatedRemaining));

    if (running) {
      stableReadySince = 0;
      await safeWaitForTimeout(page, 500);
      continue;
    }

    const ready =
      (hasSelector(readySelector) && (await isSelectorVisible(page, readySelector, 500))) ||
      (hasSelector(readyText) && (await isTextVisible(page, readyText, 500)));

    if (ready) {
      stableReadySince ||= Date.now();
      if (Date.now() - stableReadySince >= 1_000) return;
    } else {
      stableReadySince = 0;
    }

    await safeWaitForTimeout(page, 500);
  }

  throw new Error(
    `Timed out waiting for Hunyuan action to finish. runningSelector=${runningSelector ?? ""}; runningText=${runningText ?? ""}; ` +
      `readySelector=${readySelector ?? ""}; readyText=${readyText ?? ""}`
  );
}

async function closeHunyuanMultipleViewsModal(page: any, selectors: HunyuanSelectorConfig, addMultipleViewsText: string): Promise<void> {
  let closeError: unknown;
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
    } catch (error: unknown) {
      closeError = error;
    }
  }

  try {
    await page.evaluate(() => {
      const closeButton = document.querySelector<HTMLElement | SVGElement>(".hy-multi-view-grid__header-close");
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await waitForHunyuanMultipleViewsModalHidden(page, addMultipleViewsText, 10_000);
    return;
  } catch (error: unknown) {
    closeError = error;
  }

  try {
    await page.keyboard.press("Escape");
    await waitForHunyuanMultipleViewsModalHidden(page, addMultipleViewsText, 10_000);
    return;
  } catch (error: unknown) {
    throw new Error(
      `Hunyuan multiview modal did not close after uploads. Configure multipleViewsConfirmButton. ` +
        `closeSelector=${selectors.multipleViewsConfirmButton ?? ""}; fallbackSelectors=${closeSelectors.join(", ")}; ` +
        `closeError=${formatErrorMessage(closeError)}; waitError=${formatErrorMessage(error)}`
    );
  }
}

async function waitForHunyuanMultipleViewsModalHidden(page: any, addMultipleViewsText: string, timeoutMs: number): Promise<void> {
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

async function waitForHunyuanUploadProcessingComplete(page: any, timeoutMs: number, uploadingText: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableSince = 0;

  while (Date.now() < deadline) {
    const uploadingVisible = await hasVisibleText(page, uploadingText);
    if (!uploadingVisible) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince >= 1_000) return;
    } else {
      stableSince = 0;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for Hunyuan upload processing to finish. Visible text still matched "${uploadingText}".`);
}

async function hasVisibleText(page: any, text: string): Promise<boolean> {
  return page.evaluate((needle: string) => {
    function isVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    }

    return Array.from(document.body.querySelectorAll("*")).some((element) => isVisible(element) && (element.textContent ?? "").includes(needle));
  }, text);
}

const HUNYUAN_CLICKABLE_ANCESTOR_XPATH =
  "xpath=ancestor-or-self::*[self::button or self::label or @role='button' or @role='radio' or contains(concat(' ', normalize-space(@class), ' '), ' qaUJkqcCF813NIqHGF3U ') or contains(concat(' ', normalize-space(@class), ' '), ' t-radio-button ') or contains(concat(' ', normalize-space(@class), ' '), ' t-button ')][1]";

export async function clickVisibleHunyuanControl(page: any, selector: string, selectorKey: string): Promise<void> {
  const locator = page.locator(selector);
  let directClickError: unknown;
  try {
    await locator.first().click({ timeout: 1_500 });
    return;
  } catch (error) {
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

  throw new Error(
    `Hunyuan selector ${selectorKey} did not resolve to a visible enabled control. ` +
      `selector=${selector}; candidates=${candidateCount}; visible=${visibleCount}; enabled=${enabledCount}; ` +
      `ancestorCandidates=${ancestorCandidateCount}; ancestorVisible=${ancestorVisibleCount}; ancestorEnabled=${ancestorEnabledCount}; ` +
      `directClickError=${formatErrorMessage(directClickError)}`
  );
}

async function safeLocatorCount(locator: any): Promise<number> {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function safeIsVisible(locator: any): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function safeIsEnabled(locator: any): Promise<boolean> {
  try {
    return await locator.isEnabled();
  } catch {
    return false;
  }
}

async function safeHasDisabledState(locator: any): Promise<boolean> {
  try {
    return await locator.evaluate((element: Element) =>
      Boolean(element.closest('[disabled], .t-is-disabled, [aria-disabled="true"], [aria-disabled=true]'))
    );
  } catch {
    return false;
  }
}

async function safeWaitForTimeout(page: any, timeoutMs: number): Promise<void> {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(timeoutMs);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hunyuanControllerManualMessage(error: unknown): string {
  const message = formatErrorMessage(error);
  if (/controller/i.test(message)) {
    return "Reload or install the Based BLINK browser extension in the intended browser profile, open any page or the extension popup so the controller connects, then resume this run.";
  }
  return "The Based BLINK browser controller could not open or connect to the routed Hunyuan Global tab. Reload the extension in the intended browser profile, then resume this run.";
}

function createDefaultHunyuanGlobalTab(): HunyuanExtensionTabTarget {
  const routingToken = randomUUID();
  const url = new URL(HUNYUAN_GLOBAL_TARGET_URL);
  url.hash = `${ROUTING_TOKEN_PARAM}=${encodeURIComponent(routingToken)}`;
  return { mode: "new", routingToken, url: url.toString() };
}

function redactHunyuanTarget(target: HunyuanExtensionTabTarget): Record<string, unknown> {
  return {
    mode: target.mode,
    ...(target.mode === "existing" ? { clientId: target.clientId, url: target.url, title: target.title } : {}),
    ...(target.mode === "new" ? { routingToken: target.routingToken, url: target.url, title: target.title } : {})
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}


async function waitForHunyuanReady(page: any, selector: string | undefined, text: string | undefined, timeoutMs: number): Promise<void> {
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

export async function detectHunyuanLoginState(
  page: any,
  selectors: HunyuanSelectorConfig,
  timeoutMs: number
): Promise<{ loggedIn: boolean; reason: string; matched?: string; url: string }> {
  if (hasSelector(selectors.loginRequiredSelector) && (await isSelectorVisible(page, selectors.loginRequiredSelector, 700))) {
    return { loggedIn: false, reason: "Login-required selector is visible.", matched: "loginRequiredSelector", url: page.url() };
  }

  if (hasSelector(selectors.loginRequiredText) && (await isTextVisible(page, selectors.loginRequiredText, 700))) {
    return { loggedIn: false, reason: "Login-required text is visible.", matched: "loginRequiredText", url: page.url() };
  }

  const readyChecks: Array<{ key: string; selector?: string; text?: string }> = [
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

async function isSelectorVisible(page: any, selector: string | undefined, timeoutMs: number): Promise<boolean> {
  if (!hasSelector(selector)) return false;
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function isTextVisible(page: any, text: string | undefined, timeoutMs: number): Promise<boolean> {
  if (!hasSelector(text)) return false;
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
