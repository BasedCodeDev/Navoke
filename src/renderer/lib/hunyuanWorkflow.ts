export const HUNYUAN_WORKFLOW_ID = "based-blink.hunyuan.image-to-model";

export type HunyuanViewField =
  | "frontImage"
  | "backImage"
  | "leftImage"
  | "rightImage"
  | "topImage"
  | "bottomImage"
  | "left45Image"
  | "right45Image";

export type HunyuanFaceCount = "1.5m" | "1m" | "500k" | "50k";
export type HunyuanRetopologyType = "triangle" | "quad";
export type HunyuanExportFormat = "obj" | "glb";

export interface HunyuanViewFieldDefinition {
  field: HunyuanViewField;
  selectorKey: string;
  label: string;
  chooseLabel: string;
  required?: boolean;
}

export type HunyuanViewFiles = Record<HunyuanViewField, string[]>;

export interface HunyuanRunFormState {
  viewFiles: HunyuanViewFiles;
  prompt: string;
  profileName: string;
  pauseForManualLogin: boolean;
  modelFaceCount: HunyuanFaceCount;
  retopologyType: HunyuanRetopologyType;
  generateTexture: boolean;
  autoRig: boolean;
  exportFormat: HunyuanExportFormat;
  selectorsJson: string;
}

export interface HunyuanSelectorAssignment {
  key: string;
  label: string;
  path: string[];
}

export const HUNYUAN_VIEW_FIELDS: HunyuanViewFieldDefinition[] = [
  { field: "frontImage", selectorKey: "front", label: "Front image", chooseLabel: "Choose front", required: true },
  { field: "backImage", selectorKey: "back", label: "Back image", chooseLabel: "Choose back" },
  { field: "leftImage", selectorKey: "left", label: "Left image", chooseLabel: "Choose left" },
  { field: "rightImage", selectorKey: "right", label: "Right image", chooseLabel: "Choose right" },
  { field: "topImage", selectorKey: "top", label: "Top image", chooseLabel: "Choose top" },
  { field: "bottomImage", selectorKey: "bottom", label: "Bottom image", chooseLabel: "Choose bottom" },
  { field: "left45Image", selectorKey: "left45", label: "Left 45 image", chooseLabel: "Choose left 45" },
  { field: "right45Image", selectorKey: "right45", label: "Right 45 image", chooseLabel: "Choose right 45" }
];

export const HUNYUAN_FACE_COUNTS: HunyuanFaceCount[] = ["1.5m", "1m", "500k", "50k"];
export const HUNYUAN_EXPORT_FORMATS: HunyuanExportFormat[] = ["obj", "glb"];

export const EMPTY_HUNYUAN_VIEW_FILES: HunyuanViewFiles = {
  frontImage: [],
  backImage: [],
  leftImage: [],
  rightImage: [],
  topImage: [],
  bottomImage: [],
  left45Image: [],
  right45Image: []
};

const HUNYUAN_TEXT = {
  login: "\u767b\u5f55",
  imageTo3d: "\u56fe\u751f3D",
  multipleImages: "\u591a\u5f20\u56fe\u7247",
  addMultipleViews: "\u6dfb\u52a0\u591a\u89c6\u56fe",
  modelFaceCount: "\u6a21\u578b\u9762\u6570",
  modelType: "\u6a21\u578b\u7c7b\u578b",
  geometryTexturePhased: "\u51e0\u4f55\u3001\u7eb9\u7406\u5206\u9636\u6bb5",
  generate: "\u7acb\u5373\u751f\u6210",
  generating: "\u751f\u6210\u4e2d",
  v31: "3D\u751f\u6210-V3.1",
  triangle: "\u4e09\u89d2\u9762",
  quad: "\u56db\u8fb9\u9762",
  smartRetopology: "\u667a\u80fd\u62d3\u6251",
  generateTexture: "\u751f\u6210\u7eb9\u7406",
  autoRig: "\u81ea\u52a8\u7ed1\u9aa8",
  download: "\u4e0b\u8f7d"
};

function hunyuanEnabledButtonSelector(label: string): string {
  return `:is(button, .t-button):not(.t-is-disabled):not([disabled]):has-text("${label}")`;
}

export const DEFAULT_HUNYUAN_SELECTOR_CONFIG = {
  loginReadySelector: `label.t-radio-button:has-text("${HUNYUAN_TEXT.imageTo3d}")`,
  loginReadyText: "",
  loginRequiredSelector: `button.login-btn:has-text("${HUNYUAN_TEXT.login}")`,
  loginRequiredText: "",
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
  promptTextbox: "",
  generateButton: `.sideBarLeft-generateBtn:not(.t-is-disabled):not([disabled]):has-text("${HUNYUAN_TEXT.generate}")`,
  geometryRunningSelector: "",
  geometryRunningText: HUNYUAN_TEXT.generating,
  geometryReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.smartRetopology),
  geometryReadyText: "",
  retopologyTypeButtons: {
    triangle: `.topology-panel .topo-type-select .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_TEXT.triangle}")`,
    quad: `.topology-panel .topo-type-select .qaUJkqcCF813NIqHGF3U:visible:has-text("${HUNYUAN_TEXT.quad}")`
  },
  smartRetopologyButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.smartRetopology),
  retopologyRunningSelector: "",
  retopologyRunningText: HUNYUAN_TEXT.generating,
  retopologyReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.generateTexture),
  retopologyReadyText: "",
  generateTextureButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.generateTexture),
  textureRunningSelector: "",
  textureRunningText: HUNYUAN_TEXT.generating,
  textureReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download),
  textureReadyText: "",
  autoRigButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.autoRig),
  autoRigRunningSelector: "",
  autoRigRunningText: HUNYUAN_TEXT.generating,
  autoRigReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download),
  autoRigReadyText: "",
  exportFormatDropdown: 'div.t-select:has-text("OBJ")',
  exportFormatOptions: {
    obj: 'li.t-select-option:has-text("OBJ")',
    glb: 'li.t-select-option:has-text("GLB")'
  },
  downloadReadySelector: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download),
  downloadReadyText: "",
  downloadButton: hunyuanEnabledButtonSelector(HUNYUAN_TEXT.download)
};

export const DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON = `${JSON.stringify(DEFAULT_HUNYUAN_SELECTOR_CONFIG, null, 2)}\n`;

export const HUNYUAN_SELECTOR_ASSIGNMENTS: HunyuanSelectorAssignment[] = [
  { key: "loginReadySelector", label: "Login ready selector", path: ["loginReadySelector"] },
  { key: "loginReadyText", label: "Login ready text", path: ["loginReadyText"] },
  { key: "loginRequiredSelector", label: "Login required selector", path: ["loginRequiredSelector"] },
  { key: "loginRequiredText", label: "Login required text", path: ["loginRequiredText"] },
  { key: "imageTo3dTab", label: "Image-to-3D tab", path: ["imageTo3dTab"] },
  { key: "multipleImagesTab", label: "Multiple Images tab", path: ["multipleImagesTab"] },
  { key: "addMultipleViewsButton", label: "Add Multiple Views", path: ["addMultipleViewsButton"] },
  { key: "multipleViewsConfirmButton", label: "Multiple Views confirm", path: ["multipleViewsConfirmButton"] },
  ...HUNYUAN_VIEW_FIELDS.map((field) => ({
    key: `viewUploadInputs.${field.selectorKey}`,
    label: `${field.label} upload input`,
    path: ["viewUploadInputs", field.selectorKey]
  })),
  { key: "modelDropdown", label: "Model dropdown", path: ["modelDropdown"] },
  { key: "modelOptionV31", label: "3D generate V3.1 option", path: ["modelOptionV31"] },
  ...HUNYUAN_FACE_COUNTS.map((count) => ({
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

export function emptyHunyuanViewFiles(): HunyuanViewFiles {
  return { ...EMPTY_HUNYUAN_VIEW_FILES };
}

export function buildHunyuanRunInput(state: HunyuanRunFormState): Record<string, unknown> {
  return compactObject({
    frontImage: firstFile(state.viewFiles.frontImage),
    backImage: firstFile(state.viewFiles.backImage),
    leftImage: firstFile(state.viewFiles.leftImage),
    rightImage: firstFile(state.viewFiles.rightImage),
    topImage: firstFile(state.viewFiles.topImage),
    bottomImage: firstFile(state.viewFiles.bottomImage),
    left45Image: firstFile(state.viewFiles.left45Image),
    right45Image: firstFile(state.viewFiles.right45Image),
    prompt: state.prompt,
    profileName: state.profileName,
    pauseForManualLogin: state.pauseForManualLogin,
    modelFaceCount: state.modelFaceCount,
    retopologyType: state.retopologyType,
    generateTexture: state.generateTexture,
    autoRig: state.autoRig,
    exportFormat: state.exportFormat,
    selectors: parseHunyuanSelectorsJson(state.selectorsJson)
  });
}

export function parseHunyuanSelectorsJson(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hunyuan selector config must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function assignHunyuanSelectorJson(currentJson: string, assignmentKey: string, selector: string): string {
  const assignment = HUNYUAN_SELECTOR_ASSIGNMENTS.find((candidate) => candidate.key === assignmentKey);
  if (!assignment) throw new Error(`Unknown Hunyuan selector target: ${assignmentKey}`);
  const config = { ...DEFAULT_HUNYUAN_SELECTOR_CONFIG, ...parseHunyuanSelectorsJson(currentJson) } as Record<string, unknown>;
  assignNestedValue(config, assignment.path, selector);
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function collectHunyuanInputFilePaths(input: Record<string, unknown>): string[] {
  return HUNYUAN_VIEW_FIELDS.map((field) => input[field.field]).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function firstFile(files: string[]): string {
  return files[0] ?? "";
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== "" && entry !== undefined));
}

function assignNestedValue(target: Record<string, unknown>, path: string[], value: string): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}
