import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRuntimePaths } from "../../../src/main/runtime/paths";
import type { ArtifactRecord, WorkflowContext } from "../../../src/main/runtime/types";
import { createWorkflowSdk } from "../../../src/main/workflowSdk";
import {
  MODEL_GEOMETRY_BOUNDS_WORKFLOW_ID,
  MODEL_RENDER_IMAGE_WORKFLOW_ID,
  boundsText,
  createWorkflows,
  discoverModelAssets,
  formatBoundsOneLine,
  type ModelBounds
} from "../src";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("model renderer workflow helpers", () => {
  it("discovers Hunyuan-style OBJ assets with MTL and textures", () => {
    const tempDir = tempDirPath();
    fs.writeFileSync(path.join(tempDir, "model.obj"), "mtllib material.mtl\n");
    fs.writeFileSync(path.join(tempDir, "material.mtl"), "map_Kd texture.png\n");
    fs.writeFileSync(path.join(tempDir, "texture.png"), "png");
    fs.writeFileSync(path.join(tempDir, "normal.webp"), "webp");

    expect(discoverModelAssets(tempDir)).toMatchObject({
      format: "obj",
      assetDir: tempDir,
      modelPath: path.join(tempDir, "model.obj"),
      modelFileName: "model.obj",
      objFileName: "model.obj",
      mtlFileName: "material.mtl",
      textureFileNames: ["normal.webp", "texture.png"],
      assetFileNames: ["material.mtl", "model.obj", "normal.webp", "texture.png"]
    });
  });

  it("discovers FBX assets", () => {
    const tempDir = tempDirPath();
    fs.writeFileSync(path.join(tempDir, "character.fbx"), "fbx");

    expect(discoverModelAssets(tempDir)).toMatchObject({
      format: "fbx",
      assetDir: tempDir,
      modelPath: path.join(tempDir, "character.fbx"),
      modelFileName: "character.fbx",
      textureFileNames: [],
      assetFileNames: ["character.fbx"]
    });
  });

  it("rejects missing and ambiguous model inputs", () => {
    const emptyDir = tempDirPath();
    expect(() => discoverModelAssets(emptyDir)).toThrow("did not contain an OBJ or FBX file");

    const multipleDir = tempDirPath();
    fs.writeFileSync(path.join(multipleDir, "one.obj"), "obj");
    fs.writeFileSync(path.join(multipleDir, "two.fbx"), "fbx");
    expect(() => discoverModelAssets(multipleDir)).toThrow("multiple model files");
  });

  it("formats bounds for summaries and presentations", () => {
    const bounds: ModelBounds = {
      min: { x: -1, y: -2, z: -3 },
      max: { x: 4, y: 5, z: 6 },
      size: { x: 5, y: 7, z: 9 },
      center: { x: 1.5, y: 1.5, z: 1.5 },
      boundingSphere: { center: { x: 1.5, y: 1.5, z: 1.5 }, radius: 6.2249 },
      meshCount: 2,
      vertexCount: 42,
      modelFormat: "obj"
    };

    expect(formatBoundsOneLine(bounds)).toBe("min (-1, -2, -3), max (4, 5, 6), size (5, 7, 9)");
    expect(boundsText(bounds)).toContain("Bounding sphere radius: 6.2249");
    expect(boundsText(bounds)).toContain("Vertices: 42");
  });

  it("exposes render and bounds workflows with model file defaults", () => {
    const workflows = createWorkflows(fakeSdk());
    const render = workflows.find((workflow) => workflow.manifest.id === MODEL_RENDER_IMAGE_WORKFLOW_ID);
    const bounds = workflows.find((workflow) => workflow.manifest.id === MODEL_GEOMETRY_BOUNDS_WORKFLOW_ID);

    expect(render?.manifest.inputFields[0]).toMatchObject({
      name: "modelFile",
      type: "fileList",
      fileValue: "single",
      maxFiles: 1,
      fileFilters: [
        { name: "Models", extensions: ["obj", "fbx", "zip"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    expect(render?.manifest.outputKinds).toEqual(["image", "model", "json"]);
    expect(bounds?.manifest.outputKinds).toEqual(["model", "json"]);

    const parsedRender = render!.inputSchema.safeParse({ modelFile: "C:\\tmp\\hunyuan-model.zip" });
    expect(parsedRender.success).toBe(true);
    if (!parsedRender.success) throw new Error("Expected render input to parse.");
    expect(parsedRender.data).toMatchObject({
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      distance: 3.2,
      width: 1024,
      height: 1024,
      backgroundColor: ""
    });

    expect(bounds!.inputSchema.safeParse({ modelFile: "C:\\tmp\\model.fbx" }).success).toBe(true);
    expect(bounds!.inputSchema.safeParse({ modelFile: "C:\\tmp\\model.glb" }).success).toBe(false);
  });
});

describe("model renderer output images", () => {
  it("renders textured OBJ ZIPs with visible color in the generated PNG", async () => {
    const tempDir = tempDirPath();
    const runDir = path.join(tempDir, "run");
    const inputDir = path.join(runDir, "inputs");
    const artifactDir = path.join(runDir, "artifacts");
    const projectDir = path.join(tempDir, "project");
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    const modelZip = path.join(tempDir, "textured-model.zip");
    writeZip(modelZip, {
      "model.obj": [
        "mtllib material.mtl",
        "usemtl Material",
        "v -0.5 -0.5 0",
        "v 0.5 -0.5 0",
        "v 0.5 0.5 0",
        "v -0.5 0.5 0",
        "vt 0 0",
        "vt 1 0",
        "vt 1 1",
        "vt 0 1",
        "f 1/1 2/2 3/3",
        "f 1/1 3/3 4/4"
      ].join("\n"),
      "material.mtl": ["newmtl Material", "Kd 1.0 1.0 1.0", "map_Kd texture.png"].join("\n"),
      "texture.png": createPng(4, 4, [
        [230, 40, 35],
        [230, 40, 35],
        [30, 110, 230],
        [30, 110, 230],
        [230, 40, 35],
        [230, 40, 35],
        [30, 110, 230],
        [30, 110, 230],
        [20, 180, 80],
        [20, 180, 80],
        [245, 185, 20],
        [245, 185, 20],
        [20, 180, 80],
        [20, 180, 80],
        [245, 185, 20],
        [245, 185, 20]
      ])
    });

    const sdk = createWorkflowSdk();
    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === MODEL_RENDER_IMAGE_WORKFLOW_ID);
    if (!workflow) throw new Error("Model render workflow not found.");
    const artifacts: Array<{ id: string; path: string; kind: string; name: string }> = [];

    await workflow.run(
      workflow.inputSchema.parse({
        modelFile: modelZip,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        distance: 3.2,
        width: 256,
        height: 256,
        backgroundColor: "#ffffff"
      }),
      {
        runId: "color-regression",
        paths: createRuntimePaths(projectDir),
        runDir,
        inputDir,
        artifactDir,
        signal: new AbortController().signal,
        previousOutput: null,
        step: async () => undefined,
        event: async () => undefined,
        updateOutput: async () => undefined,
        isPauseRequested: () => false,
        pauseIfRequested: async () => undefined,
        addArtifact: async (artifact) => {
          const record = { id: `artifact-${artifacts.length + 1}`, runId: "color-regression", ...artifact };
          artifacts.push(record);
          return record;
        },
        waitForManualAction: async () => undefined
      }
    );

    const imageArtifact = artifacts.find((artifact) => artifact.kind === "image" && artifact.name === "model-render.png");
    if (!imageArtifact) throw new Error("Model render image artifact was not created.");
    const color = analyzePngColor(fs.readFileSync(imageArtifact.path));

    expect(color.foregroundPixels).toBeGreaterThan(1_000);
    expect(color.maxChroma).toBeGreaterThan(80);
    expect(color.coloredForegroundRatio).toBeGreaterThan(0.2);
  }, 60_000);

  it("copies sibling MTL and texture files for direct OBJ inputs", async () => {
    const tempDir = tempDirPath();
    const objPath = path.join(tempDir, "direct-model.obj");
    fs.writeFileSync(
      objPath,
      [
        "mtllib material.mtl",
        "usemtl Material",
        "v -0.5 -0.5 0",
        "v 0.5 -0.5 0",
        "v 0.5 0.5 0",
        "v -0.5 0.5 0",
        "vt 0 0",
        "vt 1 0",
        "vt 1 1",
        "vt 0 1",
        "f 1/1 2/2 3/3",
        "f 1/1 3/3 4/4"
      ].join("\n")
    );
    fs.writeFileSync(path.join(tempDir, "material.mtl"), ["newmtl Material", "Kd 1.0 1.0 1.0", "map_Kd texture.png"].join("\n"));
    fs.writeFileSync(
      path.join(tempDir, "texture.png"),
      createPng(2, 2, [
        [230, 40, 35],
        [30, 110, 230],
        [20, 180, 80],
        [245, 185, 20]
      ])
    );

    const sdk = createWorkflowSdk();
    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === MODEL_RENDER_IMAGE_WORKFLOW_ID);
    if (!workflow) throw new Error("Model render workflow not found.");
    const renderRun = createTestWorkflowContext(tempDir, "direct-obj-sidecars");

    await workflow.run(
      workflow.inputSchema.parse({
        modelFile: objPath,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        distance: 3.2,
        width: 256,
        height: 256,
        backgroundColor: "#ffffff"
      }),
      renderRun.context
    );

    const modelArtifact = renderRun.artifacts.find((artifact) => artifact.kind === "model");
    expect(modelArtifact?.metadata).toMatchObject({
      mtlFileName: "material.mtl",
      textureFileNames: ["texture.png"]
    });
    const imageArtifact = renderRun.artifacts.find((artifact) => artifact.kind === "image" && artifact.name === "model-render.png");
    if (!imageArtifact) throw new Error("Direct OBJ render image artifact was not created.");
    const color = analyzePngColor(fs.readFileSync(imageArtifact.path));

    expect(color.foregroundPixels).toBeGreaterThan(1_000);
    expect(color.maxChroma).toBeGreaterThan(80);
    expect(color.coloredForegroundRatio).toBeGreaterThan(0.2);
  }, 60_000);

  it("rejects direct OBJ inputs that reference a missing MTL file", async () => {
    const tempDir = tempDirPath();
    const objPath = path.join(tempDir, "missing-material.obj");
    fs.writeFileSync(
      objPath,
      ["mtllib output.mtl", "v -0.5 -0.5 0", "v 0.5 -0.5 0", "v 0.5 0.5 0", "f 1 2 3"].join("\n")
    );

    const sdk = createWorkflowSdk();
    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === MODEL_RENDER_IMAGE_WORKFLOW_ID);
    if (!workflow) throw new Error("Model render workflow not found.");
    const renderRun = createTestWorkflowContext(tempDir, "direct-obj-missing-mtl");

    await expect(
      workflow.run(
        workflow.inputSchema.parse({
          modelFile: objPath,
          rotationX: 0,
          rotationY: 0,
          rotationZ: 0,
          distance: 3.2,
          width: 256,
          height: 256,
          backgroundColor: "#ffffff"
        }),
        renderRun.context
      )
    ).rejects.toThrow('OBJ file references missing material library "output.mtl"');
  });

  it("uses the discovered diffuse texture when an OBJ material is otherwise untextured", async () => {
    const tempDir = tempDirPath();
    const modelZip = path.join(tempDir, "hunyuan-pbr-fallback.zip");
    writeZip(modelZip, {
      "model.obj": [
        "mtllib material.mtl",
        "usemtl Material",
        "v -0.5 -0.5 0",
        "v 0.5 -0.5 0",
        "v 0.5 0.5 0",
        "v -0.5 0.5 0",
        "vt 0 0",
        "vt 1 0",
        "vt 1 1",
        "vt 0 1",
        "f 1/1 2/2 3/3",
        "f 1/1 3/3 4/4"
      ].join("\n"),
      "material.mtl": [
        "newmtl Material",
        "Kd 0.0 0.0 0.0",
        "Ke 0.0 0.0 0.0",
        "illum 2",
        "map_Pm texture_pbr_20250901_metallic.png",
        "map_Pr texture_pbr_20250901_roughness.png",
        "map_Bump -bm 1.0 texture_pbr_20250901_normal.png"
      ].join("\n"),
      "texture_pbr_20250901.png": createPng(4, 4, [
        [225, 40, 35],
        [225, 40, 35],
        [30, 105, 230],
        [30, 105, 230],
        [225, 40, 35],
        [225, 40, 35],
        [30, 105, 230],
        [30, 105, 230],
        [20, 175, 80],
        [20, 175, 80],
        [245, 185, 25],
        [245, 185, 25],
        [20, 175, 80],
        [20, 175, 80],
        [245, 185, 25],
        [245, 185, 25]
      ]),
      "texture_pbr_20250901_metallic.png": createSolidPng(4, 4, [0, 0, 0]),
      "texture_pbr_20250901_roughness.png": createSolidPng(4, 4, [128, 128, 128]),
      "texture_pbr_20250901_normal.png": createSolidPng(4, 4, [128, 128, 255])
    });

    const sdk = createWorkflowSdk();
    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === MODEL_RENDER_IMAGE_WORKFLOW_ID);
    if (!workflow) throw new Error("Model render workflow not found.");
    const renderRun = createTestWorkflowContext(tempDir, "obj-diffuse-fallback");

    await workflow.run(
      workflow.inputSchema.parse({
        modelFile: modelZip,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        distance: 3.2,
        width: 256,
        height: 256,
        backgroundColor: "#ffffff"
      }),
      renderRun.context
    );

    const imageArtifact = renderRun.artifacts.find((artifact) => artifact.kind === "image" && artifact.name === "model-render.png");
    if (!imageArtifact) throw new Error("OBJ fallback render image artifact was not created.");
    const color = analyzePngColor(fs.readFileSync(imageArtifact.path));

    expect(color.foregroundPixels).toBeGreaterThan(1_000);
    expect(color.maxChroma).toBeGreaterThan(80);
    expect(color.coloredForegroundRatio).toBeGreaterThan(0.2);
  }, 60_000);

  it("renders FBX assets with visible color, reads bounds, and accepts single-FBX ZIPs", async () => {
    const tempDir = tempDirPath();
    const fbxPath = path.join(tempDir, "color-plane.fbx");
    const fbxZipPath = path.join(tempDir, "color-plane.zip");
    const sdk = createWorkflowSdk();
    const workflows = createWorkflows(sdk);
    const renderWorkflow = workflows.find((candidate) => candidate.manifest.id === MODEL_RENDER_IMAGE_WORKFLOW_ID);
    const boundsWorkflow = workflows.find((candidate) => candidate.manifest.id === MODEL_GEOMETRY_BOUNDS_WORKFLOW_ID);
    if (!renderWorkflow) throw new Error("Model render workflow not found.");
    if (!boundsWorkflow) throw new Error("Model geometry bounds workflow not found.");

    fs.writeFileSync(fbxPath, createColorPlaneFbx());
    writeZip(fbxZipPath, { "color-plane.fbx": createColorPlaneFbx() });

    const boundsRun = createTestWorkflowContext(tempDir, "fbx-bounds");
    const boundsOutput = (await boundsWorkflow.run(boundsWorkflow.inputSchema.parse({ modelFile: fbxPath }), boundsRun.context)) as {
      bounds: ModelBounds;
    };

    expect(boundsOutput.bounds.modelFormat).toBe("fbx");
    expect(boundsOutput.bounds.meshCount).toBe(1);
    expect(boundsOutput.bounds.vertexCount).toBe(6);
    expect(boundsOutput.bounds.size.x).toBeCloseTo(1);
    expect(boundsOutput.bounds.size.y).toBeCloseTo(1);
    expect(boundsOutput.bounds.boundingSphere.radius).toBeGreaterThan(0);

    const zipBoundsRun = createTestWorkflowContext(tempDir, "fbx-zip-bounds");
    const zipBoundsOutput = (await boundsWorkflow.run(boundsWorkflow.inputSchema.parse({ modelFile: fbxZipPath }), zipBoundsRun.context)) as {
      bounds: ModelBounds;
    };
    expect(zipBoundsOutput.bounds.modelFormat).toBe("fbx");
    expect(zipBoundsOutput.bounds.meshCount).toBe(1);
    expect(zipBoundsOutput.bounds.vertexCount).toBe(6);

    const renderRun = createTestWorkflowContext(tempDir, "fbx-render");
    await renderWorkflow.run(
      renderWorkflow.inputSchema.parse({
        modelFile: fbxPath,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        distance: 3.2,
        width: 256,
        height: 256,
        backgroundColor: "#ffffff"
      }),
      renderRun.context
    );

    const imageArtifact = renderRun.artifacts.find((artifact) => artifact.kind === "image" && artifact.name === "model-render.png");
    if (!imageArtifact) throw new Error("FBX model render image artifact was not created.");
    const color = analyzePngColor(fs.readFileSync(imageArtifact.path));

    expect(color.foregroundPixels).toBeGreaterThan(1_000);
    expect(color.maxChroma).toBeGreaterThan(50);
    expect(color.coloredForegroundRatio).toBeGreaterThan(0.2);
  }, 60_000);
});

function createTestWorkflowContext(tempDir: string, runId: string): { context: WorkflowContext; artifacts: ArtifactRecord[] } {
  const runDir = path.join(tempDir, runId);
  const inputDir = path.join(runDir, "inputs");
  const artifactDir = path.join(runDir, "artifacts");
  const projectDir = path.join(tempDir, "project");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  const artifacts: ArtifactRecord[] = [];
  const context: WorkflowContext = {
    runId,
    paths: createRuntimePaths(projectDir),
    runDir,
    inputDir,
    artifactDir,
    signal: new AbortController().signal,
    previousOutput: null,
    step: async () => undefined,
    event: async () => undefined,
    updateOutput: async () => undefined,
    isPauseRequested: () => false,
    pauseIfRequested: async () => undefined,
    addArtifact: async (artifact) => {
      const record: ArtifactRecord = {
        id: `artifact-${artifacts.length + 1}`,
        runId,
        kind: artifact.kind,
        name: artifact.name,
        path: artifact.path,
        mimeType: artifact.mimeType ?? null,
        size: fs.existsSync(artifact.path) ? fs.statSync(artifact.path).size : 0,
        metadata: artifact.metadata ?? null,
        createdAt: new Date(0).toISOString()
      };
      artifacts.push(record);
      return record;
    },
    waitForManualAction: async () => undefined
  };

  return { context, artifacts };
}

function fakeSdk(): Parameters<typeof createWorkflows>[0] {
  return {
    schema: { z },
    files: {
      inferMimeType: () => null,
      writeJson: () => undefined,
      extractZip: async () => undefined
    },
    browser: {
      launchPersistentProfile: async () => {
        throw new Error("Browser should not be launched by helper tests.");
      }
    },
    packages: {
      resolvePackageRoot: () => {
        throw new Error("Package root should not be resolved by helper tests.");
      }
    },
    errors: {
      WorkflowConfigurationError: Error
    }
  };
}

function tempDirPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blink-model-renderer-"));
  tempDirs.push(dir);
  return dir;
}

function createColorPlaneFbx(): string {
  // The fixture starts with whitespace because FBXLoader samples the opening bytes when distinguishing ASCII from binary FBX.
  return fs.readFileSync(path.join(__dirname, "fixtures", "color-plane.fbx"), "utf8");
}

function createPng(width: number, height: number, pixels: Array<[number, number, number]>): Buffer {
  if (pixels.length !== width * height) throw new Error("Pixel count must match PNG dimensions.");
  const rawRows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixels[y * width + x];
      const offset = 1 + x * 4;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = 255;
    }
    rawRows.push(row);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([uint32be(width), uint32be(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createSolidPng(width: number, height: number, color: [number, number, number]): Buffer {
  return createPng(
    width,
    height,
    Array.from({ length: width * height }, () => color)
  );
}

function analyzePngColor(png: Buffer): { foregroundPixels: number; coloredForegroundRatio: number; maxChroma: number } {
  const decoded = decodePng(png);
  let foregroundPixels = 0;
  let coloredForegroundPixels = 0;
  let maxChroma = 0;
  for (let index = 0; index < decoded.rgba.length; index += 4) {
    const r = decoded.rgba[index];
    const g = decoded.rgba[index + 1];
    const b = decoded.rgba[index + 2];
    const a = decoded.rgba[index + 3];
    if (a < 32) continue;
    if (r > 245 && g > 245 && b > 245) continue;
    foregroundPixels += 1;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    maxChroma = Math.max(maxChroma, chroma);
    if (chroma >= 30) coloredForegroundPixels += 1;
  }

  return {
    foregroundPixels,
    coloredForegroundRatio: foregroundPixels === 0 ? 0 : coloredForegroundPixels / foregroundPixels,
    maxChroma
  };
}

function decodePng(png: Buffer): { width: number; height: number; rgba: Buffer } {
  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("Invalid PNG signature.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}.`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilterPngRow(row, previous, bytesPerPixel, filter);
    for (let x = 0; x < width; x += 1) {
      const src = x * bytesPerPixel;
      const dst = (y * width + x) * 4;
      rgba[dst] = row[src];
      rgba[dst + 1] = row[src + 1];
      rgba[dst + 2] = row[src + 2];
      rgba[dst + 3] = colorType === 6 ? row[src + 3] : 255;
    }
    row.copy(previous);
  }

  return { width, height, rgba };
}

function unfilterPngRow(row: Buffer, previous: Buffer, bytesPerPixel: number, filter: number): void {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    if (filter === 1) {
      row[index] = (row[index] + left) & 0xff;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 0xff;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter: ${filter}.`);
    }
  }
}

function writeZip(zipPath: string, files: Record<string, string | Buffer>): void {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name.replace(/\\/g, "/"));
    const data = typeof content === "string" ? Buffer.from(content) : content;
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...localParts, centralDirectory, end]));
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([uint32be(data.length), typeBuffer, data, uint32be(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32be(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}
