import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON,
  assignHunyuanSelectorJson,
  buildHunyuanRunInput,
  collectHunyuanInputFilePaths,
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
        selectorsJson: DEFAULT_HUNYUAN_SELECTOR_CONFIG_JSON
      })
    ).toMatchObject({
      frontImage: "C:\\input\\front.png",
      backImage: "C:\\input\\back.png",
      prompt: "Make it clean.",
      modelFaceCount: "50k",
      retopologyType: "quad",
      generateTexture: true,
      autoRig: false,
      exportFormat: "obj"
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
