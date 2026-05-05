import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON,
  HUNYUAN_GLOBAL_WORKFLOW_ID,
  assignHunyuanSelectorJson,
  buildHunyuanRunInput,
  collectHunyuanInputFilePaths,
  defaultHunyuanSelectorConfigJsonForWorkflow,
  emptyHunyuanViewFiles
} from "../../src/renderer/lib/hunyuanWorkflow";

describe("Hunyuan renderer helpers", () => {
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
});
