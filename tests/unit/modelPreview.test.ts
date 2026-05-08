import { describe, expect, it } from "vitest";
import {
  isObjModelArtifact,
  isPreviewableModelArtifact,
  modelArtifactFormat,
  selectDiffuseTextureFileName
} from "../../src/renderer/lib/modelPreview";

describe("model preview helpers", () => {
  it("detects OBJ artifacts by extension, model format, or OBJ metadata", () => {
    expect(modelArtifactFormat(artifact("castle.obj"))).toBe("obj");
    expect(modelArtifactFormat(artifact("model.bin", { modelFormat: "OBJ" }))).toBe("obj");
    expect(modelArtifactFormat(artifact("model", { objFileName: "mesh.obj" }))).toBe("obj");
    expect(isPreviewableModelArtifact(artifact("castle.obj"))).toBe(true);
    expect(isObjModelArtifact(artifact("castle.obj"))).toBe(true);
  });

  it("detects FBX artifacts by extension or model format", () => {
    expect(modelArtifactFormat(artifact("character.fbx"))).toBe("fbx");
    expect(modelArtifactFormat(artifact("model.bin", { modelFormat: "FBX" }))).toBe("fbx");
    expect(modelArtifactFormat(artifact("model.bin", { modelFileName: "embedded.FBX" }))).toBe("fbx");
    expect(isPreviewableModelArtifact(artifact("character.fbx"))).toBe(true);
    expect(isObjModelArtifact(artifact("character.fbx"))).toBe(false);
  });

  it("leaves non-previewable model artifacts on the generic model card path", () => {
    expect(modelArtifactFormat(artifact("scene.glb"))).toBeNull();
    expect(modelArtifactFormat(artifact("model.bin", { modelFormat: "glb" }))).toBeNull();
    expect(isPreviewableModelArtifact(artifact("scene.glb"))).toBe(false);
  });

  it("selects likely diffuse textures before PBR sidecar maps", () => {
    expect(
      selectDiffuseTextureFileName([
        "texture_pbr_20250901_metallic.png",
        "texture_pbr_20250901_roughness.png",
        "texture_pbr_20250901_normal.png",
        "texture_pbr_20250901.png"
      ])
    ).toBe("texture_pbr_20250901.png");
    expect(selectDiffuseTextureFileName(["character_normal.png", "character_roughness.png"])).toBeNull();
  });
});

function artifact(name: string, metadata?: unknown): { name: string; metadata?: unknown } {
  return { name, metadata };
}
