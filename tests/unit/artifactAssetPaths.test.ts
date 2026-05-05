import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveArtifactAssetPath } from "../../src/main/api/server";

describe("artifact asset paths", () => {
  it("resolves sibling model assets under the artifact directory", () => {
    const artifactPath = path.join("C:\\runs", "run-1", "artifacts", "model-assets", "model.obj");

    expect(resolveArtifactAssetPath(artifactPath, "material.mtl")).toBe(
      path.join("C:\\runs", "run-1", "artifacts", "model-assets", "material.mtl")
    );
  });

  it("rejects traversal outside the artifact asset directory", () => {
    const artifactPath = path.join("C:\\runs", "run-1", "artifacts", "model-assets", "model.obj");

    expect(() => resolveArtifactAssetPath(artifactPath, "..\\trace.zip")).toThrow("outside the artifact directory");
  });
});
