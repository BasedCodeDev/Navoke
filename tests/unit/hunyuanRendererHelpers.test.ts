import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON,
  HUNYUAN_EXPORT_FORMATS,
  HUNYUAN_GLOBAL_WORKFLOW_ID,
  assignHunyuanSelectorJson,
  buildHunyuanArtifactViewModel,
  buildHunyuanRunInput,
  collectHunyuanInputFilePaths,
  defaultHunyuanSelectorConfigJsonForWorkflow,
  emptyHunyuanViewFiles,
  isHunyuanObjModelArtifact
} from "../../src/renderer/lib/hunyuanWorkflow";
import type { ArtifactRecord } from "../../src/renderer/lib/api";

describe("Hunyuan renderer helpers", () => {
  it("defaults the export dropdown to OBJ", () => {
    expect(HUNYUAN_EXPORT_FORMATS[0]).toBe("obj");
  });

  it("builds explicit view inputs and default settings", () => {
    const viewFiles = emptyHunyuanViewFiles();
    viewFiles.frontImage = ["C:\\input\\front.png"];
    viewFiles.backImage = ["C:\\input\\back.png"];

    expect(
      buildHunyuanRunInput({
        viewFiles,
        prompt: "Make it clean.",
        profileName: "artist",
        pauseForManualLogin: false,
        modelFaceCount: "50k",
        retopologyType: "quad",
        generateTexture: true,
        autoRig: false,
        exportFormat: "obj",
        selectorsJson: DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON,
        extensionTab: { mode: "new", routingToken: "token-1", url: "https://3d.hunyuanglobal.com/#based-blink-tab=token-1" }
      })
    ).toMatchObject({
      frontImage: "C:\\input\\front.png",
      backImage: "C:\\input\\back.png",
      prompt: "Make it clean.",
      modelFaceCount: "50k",
      retopologyType: "quad",
      generateTexture: true,
      autoRig: false,
      exportFormat: "obj",
      extensionTab: { mode: "new", routingToken: "token-1" }
    });
  });

  it("assigns Workflow Lab selectors into the Hunyuan JSON preset", () => {
    const assigned = assignHunyuanSelectorJson(DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON, "viewUploadInputs.left45", "input.left45");
    expect(JSON.parse(assigned)).toMatchObject({
      viewUploadInputs: {
        left45: "input.left45"
      }
    });
  });

  it("selects the English selector preset for Hunyuan Global runs", () => {
    const globalJson = defaultHunyuanSelectorConfigJsonForWorkflow(HUNYUAN_GLOBAL_WORKFLOW_ID);
    const parsed = JSON.parse(globalJson);

    expect(parsed).toMatchObject({
      loginStartSelector: "button, a, [role='button']",
      loginStartText: "Start Using",
      loginReadyText: "Image to 3D",
      loginRequiredText: "Start Using HY 3D",
      generateButton: expect.stringContaining("Generate"),
      downloadButton: expect.stringContaining("Download")
    });
    expect(parsed.imageTo3dTab).toContain("Image to 3D");
    expect(parsed.modelOptionV31).toContain("V3.1");
  });

  it("collects all explicit Hunyuan input paths", () => {
    expect(
      collectHunyuanInputFilePaths({
        frontImage: "front.png",
        backImage: "back.png",
        left45Image: "left45.png"
      })
    ).toEqual(["front.png", "back.png", "left45.png"]);
  });

  it("builds the Hunyuan artifact view model with inputs, primary model, and supporting artifacts", () => {
    const model = artifact("model-1", "model", "model.obj", {
      modelFormat: "obj",
      objFileName: "model.obj",
      mtlFileName: "material.mtl",
      textureFileNames: ["texture.png"]
    });
    const prompts = artifact("prompts-1", "json", "prompts.json");
    const trace = artifact("trace-1", "trace", "trace.zip");

    const viewModel = buildHunyuanArtifactViewModel(
      { frontImage: "C:\\input\\front.png", backImage: "C:\\input\\back.png" },
      { modelArtifactId: "model-1" },
      [prompts, model, trace]
    );

    expect(viewModel.inputImages.map((entry) => ({ field: entry.field, filePath: entry.filePath, index: entry.index }))).toEqual([
      { field: "frontImage", filePath: "C:\\input\\front.png", index: 0 },
      { field: "backImage", filePath: "C:\\input\\back.png", index: 0 }
    ]);
    expect(viewModel.modelArtifact?.id).toBe("model-1");
    expect(viewModel.supportingArtifacts.map((item) => item.id)).toEqual(["prompts-1", "trace-1"]);
    expect(isHunyuanObjModelArtifact(model)).toBe(true);
  });
});

function artifact(
  id: string,
  kind: ArtifactRecord["kind"],
  name: string,
  metadata: ArtifactRecord["metadata"] = null
): ArtifactRecord {
  return {
    id,
    runId: "run-1",
    kind,
    name,
    path: `C:\\run\\artifacts\\${name}`,
    mimeType: name.endsWith(".obj") ? "model/obj" : null,
    size: 1,
    metadata,
    createdAt: "2026-05-05T00:00:00.000Z"
  };
}
