import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import type * as zod from "zod";
import type { WorkflowContext, WorkflowDefinition, WorkflowSdk } from "./sdkTypes";

export const MODEL_RENDER_IMAGE_WORKFLOW_ID = "based-blink.model-renderer.render-image";
export const MODEL_GEOMETRY_BOUNDS_WORKFLOW_ID = "based-blink.model-renderer.geometry-bounds";

const MODEL_RENDERER_VERSION = "0.1.0";
const MODEL_ASSET_DIR_NAME = "model-assets";
const TEXTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MODEL_EXTENSIONS = new Set([".obj", ".fbx"]);
const requireFromPlugin = createRequire(__filename);

type ModelFormat = "obj" | "fbx";

export interface Vector3Json {
  x: number;
  y: number;
  z: number;
}

export interface ModelBounds {
  min: Vector3Json;
  max: Vector3Json;
  size: Vector3Json;
  center: Vector3Json;
  boundingSphere: {
    center: Vector3Json;
    radius: number;
  };
  meshCount: number;
  vertexCount: number;
  modelFormat: ModelFormat;
}

export interface ModelAssetDiscovery {
  format: ModelFormat;
  assetDir: string;
  modelPath: string;
  modelFileName: string;
  objFileName?: string;
  mtlFileName?: string;
  textureFileNames: string[];
  assetFileNames: string[];
}

interface RenderRequest {
  model: BrowserModelDescriptor;
  rotationDegrees: Vector3Json;
  distance: number;
  width: number;
  height: number;
  backgroundColor: string;
}

interface RenderResult {
  dataUrl: string;
  bounds: ModelBounds;
}

interface BrowserModelDescriptor {
  format: ModelFormat;
  modelFileName: string;
  mtlFileName?: string;
  textureFileNames?: string[];
}

interface RegisteredModelArtifact {
  id: string;
  metadata: Record<string, unknown>;
}

export function createWorkflows(sdk: WorkflowSdk): WorkflowDefinition[] {
  const { z } = sdk.schema;

  const vectorSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number()
  });

  const boundsSchema = z.object({
    min: vectorSchema,
    max: vectorSchema,
    size: vectorSchema,
    center: vectorSchema,
    boundingSphere: z.object({
      center: vectorSchema,
      radius: z.number()
    }),
    meshCount: z.number(),
    vertexCount: z.number(),
    modelFormat: z.enum(["obj", "fbx"])
  });

  const modelFileSchema = z
    .string()
    .trim()
    .min(1, "Choose an OBJ, FBX, or ZIP model input.")
    .refine((filePath) => isSupportedModelInput(filePath), "Model input must be an .obj, .fbx, or .zip file.");

  const renderInputSchema = z.object({
    modelFile: modelFileSchema,
    rotationX: z.number().min(-360).max(360).optional().default(0),
    rotationY: z.number().min(-360).max(360).optional().default(0),
    rotationZ: z.number().min(-360).max(360).optional().default(0),
    distance: z.number().min(0.1).max(100).optional().default(3.2),
    width: z.number().int().min(64).max(4096).optional().default(1024),
    height: z.number().int().min(64).max(4096).optional().default(1024),
    backgroundColor: z.string().trim().optional().default("")
  });

  const boundsInputSchema = z.object({
    modelFile: modelFileSchema
  });

  const renderOutputSchema = z.object({
    artifactIds: z.array(z.string()),
    summary: z.string(),
    imageArtifactId: z.string(),
    metadataArtifactId: z.string(),
    modelArtifactId: z.string().optional(),
    bounds: boundsSchema,
    camera: z.object({
      rotationDegrees: vectorSchema,
      distance: z.number(),
      normalizedScene: z.literal(true)
    }),
    presentation: z.unknown().optional()
  });

  const boundsOutputSchema = z.object({
    artifactIds: z.array(z.string()),
    summary: z.string(),
    boundsArtifactId: z.string(),
    modelArtifactId: z.string().optional(),
    bounds: boundsSchema,
    modelFormat: z.enum(["obj", "fbx"]),
    modelFileName: z.string(),
    presentation: z.unknown().optional()
  });

  const modelFileField = {
    name: "modelFile",
    label: "Model file or ZIP",
    type: "fileList" as const,
    required: true,
    fileValue: "single" as const,
    maxFiles: 1,
    filePickerTitle: "Choose an OBJ, FBX, or ZIP model file",
    fileFilters: [
      { name: "Models", extensions: ["obj", "fbx", "zip"] },
      { name: "All files", extensions: ["*"] }
    ],
    help: "Use a ZIP when an OBJ needs MTL or texture sidecars. Single OBJ files render without sidecar textures."
  };

  const renderWorkflow: WorkflowDefinition<zod.infer<typeof renderInputSchema>, zod.infer<typeof renderOutputSchema>> = {
    manifest: {
      id: MODEL_RENDER_IMAGE_WORKFLOW_ID,
      title: "Model Render Image",
      description: "Render an OBJ, FBX, or Hunyuan-style model ZIP to a PNG image.",
      category: "model",
      version: MODEL_RENDERER_VERSION,
      concurrency: 1,
      requiresBrowser: true,
      outputKinds: ["image", "model", "json"],
      inputFields: [
        modelFileField,
        { name: "rotationX", label: "Camera rotation X", type: "number", defaultValue: 0, help: "Degrees. Euler order is XYZ." },
        { name: "rotationY", label: "Camera rotation Y", type: "number", defaultValue: 0, help: "Degrees. Euler order is XYZ." },
        { name: "rotationZ", label: "Camera rotation Z", type: "number", defaultValue: 0, help: "Degrees. Euler order is XYZ." },
        {
          name: "distance",
          label: "Camera distance",
          type: "number",
          defaultValue: 3.2,
          help: "Distance in the normalized render scene after the model is centered and scaled."
        },
        { name: "width", label: "Image width", type: "number", defaultValue: 1024 },
        { name: "height", label: "Image height", type: "number", defaultValue: 1024 },
        { name: "backgroundColor", label: "Background color", type: "text", defaultValue: "", placeholder: "transparent" }
      ]
    },
    inputSchema: renderInputSchema,
    outputSchema: renderOutputSchema,
    async run(input, ctx) {
      assertNotAborted(ctx.signal);
      await ctx.step("Preparing model package", 10, { modelFile: input.modelFile });
      const assets = await prepareModelAssetPackage(input.modelFile, ctx, sdk);
      const modelArtifact = await registerModelArtifact(ctx, sdk, assets, { workflow: "render-image" });
      await ctx.event("model-renderer.model-prepared", "Prepared model assets for rendering.", publicModelAssetData(assets));

      await ctx.step("Rendering model image", 55, {
        modelFileName: assets.modelFileName,
        rotationDegrees: { x: input.rotationX, y: input.rotationY, z: input.rotationZ },
        distance: input.distance
      });
      const render = await renderModelImage(sdk, ctx, assets, {
        model: browserModelDescriptor(assets),
        rotationDegrees: { x: input.rotationX, y: input.rotationY, z: input.rotationZ },
        distance: input.distance,
        width: input.width,
        height: input.height,
        backgroundColor: input.backgroundColor
      });

      const imagePath = path.join(ctx.artifactDir, "model-render.png");
      writePngDataUrl(imagePath, render.dataUrl);
      const imageArtifact = await ctx.addArtifact({
        kind: "image",
        name: "model-render.png",
        path: imagePath,
        mimeType: "image/png",
        metadata: {
          source: "model-renderer",
          workflow: "render-image",
          model: modelArtifact.metadata,
          bounds: render.bounds,
          camera: {
            rotationDegrees: { x: input.rotationX, y: input.rotationY, z: input.rotationZ },
            distance: input.distance,
            normalizedScene: true
          },
          image: { width: input.width, height: input.height, backgroundColor: input.backgroundColor || null }
        }
      });

      const metadataPath = path.join(ctx.artifactDir, "model-render-metadata.json");
      const metadata = {
        model: modelArtifact.metadata,
        bounds: render.bounds,
        camera: {
          rotationDegrees: { x: input.rotationX, y: input.rotationY, z: input.rotationZ },
          distance: input.distance,
          normalizedScene: true
        },
        image: { width: input.width, height: input.height, backgroundColor: input.backgroundColor || null },
        imageArtifactId: imageArtifact.id,
        modelArtifactId: modelArtifact.id
      };
      sdk.files.writeJson(metadataPath, metadata);
      const metadataArtifact = await ctx.addArtifact({
        kind: "json",
        name: "model-render-metadata.json",
        path: metadataPath,
        mimeType: "application/json",
        metadata: { source: "model-renderer", workflow: "render-image", imageArtifactId: imageArtifact.id, modelArtifactId: modelArtifact.id }
      });

      const artifactIds = [modelArtifact.id, imageArtifact.id, metadataArtifact.id];
      await ctx.step("Model render completed", 100, { imageArtifactId: imageArtifact.id, metadataArtifactId: metadataArtifact.id });
      return {
        artifactIds,
        summary: `Rendered ${assets.modelFileName} to ${input.width}x${input.height} PNG.`,
        imageArtifactId: imageArtifact.id,
        metadataArtifactId: metadataArtifact.id,
        modelArtifactId: modelArtifact.id,
        bounds: render.bounds,
        camera: {
          rotationDegrees: { x: input.rotationX, y: input.rotationY, z: input.rotationZ },
          distance: input.distance,
          normalizedScene: true
        },
        presentation: renderPresentation({
          imageArtifactId: imageArtifact.id,
          metadataArtifactId: metadataArtifact.id,
          modelArtifactId: modelArtifact.id,
          modelFormat: assets.format,
          bounds: render.bounds,
          cameraText: cameraText(input.rotationX, input.rotationY, input.rotationZ, input.distance)
        })
      };
    }
  };

  const boundsWorkflow: WorkflowDefinition<zod.infer<typeof boundsInputSchema>, zod.infer<typeof boundsOutputSchema>> = {
    manifest: {
      id: MODEL_GEOMETRY_BOUNDS_WORKFLOW_ID,
      title: "Model Geometry Bounds",
      description: "Extract geometry bounds from an OBJ, FBX, or Hunyuan-style model ZIP.",
      category: "model",
      version: MODEL_RENDERER_VERSION,
      concurrency: 1,
      requiresBrowser: true,
      outputKinds: ["model", "json"],
      inputFields: [modelFileField]
    },
    inputSchema: boundsInputSchema,
    outputSchema: boundsOutputSchema,
    async run(input, ctx) {
      assertNotAborted(ctx.signal);
      await ctx.step("Preparing model package", 15, { modelFile: input.modelFile });
      const assets = await prepareModelAssetPackage(input.modelFile, ctx, sdk);
      const modelArtifact = await registerModelArtifact(ctx, sdk, assets, { workflow: "geometry-bounds" });
      await ctx.event("model-renderer.model-prepared", "Prepared model assets for bounds extraction.", publicModelAssetData(assets));

      await ctx.step("Reading geometry bounds", 65, { modelFileName: assets.modelFileName, modelFormat: assets.format });
      const bounds = await readModelBounds(sdk, ctx, assets);

      const boundsPath = path.join(ctx.artifactDir, "model-bounds.json");
      const boundsPayload = {
        model: modelArtifact.metadata,
        bounds,
        modelArtifactId: modelArtifact.id
      };
      sdk.files.writeJson(boundsPath, boundsPayload);
      const boundsArtifact = await ctx.addArtifact({
        kind: "json",
        name: "model-bounds.json",
        path: boundsPath,
        mimeType: "application/json",
        metadata: { source: "model-renderer", workflow: "geometry-bounds", modelArtifactId: modelArtifact.id }
      });

      await ctx.step("Model bounds completed", 100, { boundsArtifactId: boundsArtifact.id });
      return {
        artifactIds: [modelArtifact.id, boundsArtifact.id],
        summary: `Read bounds for ${assets.modelFileName}: ${formatBoundsOneLine(bounds)}.`,
        boundsArtifactId: boundsArtifact.id,
        modelArtifactId: modelArtifact.id,
        bounds,
        modelFormat: assets.format,
        modelFileName: assets.modelFileName,
        presentation: boundsPresentation({
          boundsArtifactId: boundsArtifact.id,
          modelArtifactId: modelArtifact.id,
          modelFormat: assets.format,
          bounds
        })
      };
    }
  };

  return [renderWorkflow, boundsWorkflow];
}

export function discoverModelAssets(assetRoot: string): ModelAssetDiscovery {
  const extractedFiles = listFiles(assetRoot);
  const modelPaths = extractedFiles.filter((filePath) => MODEL_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  if (modelPaths.length === 0) {
    throw new Error("The model input did not contain an OBJ or FBX file.");
  }
  if (modelPaths.length > 1) {
    throw new Error(`The model input contained multiple model files: ${modelPaths.map((filePath) => path.basename(filePath)).join(", ")}`);
  }

  const modelPath = modelPaths[0];
  const assetDir = path.dirname(modelPath);
  const siblingFiles = fs
    .readdirSync(assetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(assetDir, entry.name));
  const format = path.extname(modelPath).toLowerCase() === ".obj" ? "obj" : "fbx";
  const mtlPath = format === "obj" ? siblingFiles.find((filePath) => path.extname(filePath).toLowerCase() === ".mtl") : undefined;
  const textureFileNames = siblingFiles
    .filter((filePath) => TEXTURE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => path.basename(filePath))
    .sort();

  return {
    format,
    assetDir,
    modelPath,
    modelFileName: path.basename(modelPath),
    ...(format === "obj" ? { objFileName: path.basename(modelPath) } : {}),
    ...(mtlPath ? { mtlFileName: path.basename(mtlPath) } : {}),
    textureFileNames,
    assetFileNames: siblingFiles.map((filePath) => path.basename(filePath)).sort()
  };
}

export function formatBoundsOneLine(bounds: ModelBounds): string {
  return `min ${formatVector(bounds.min)}, max ${formatVector(bounds.max)}, size ${formatVector(bounds.size)}`;
}

export function boundsText(bounds: ModelBounds): string {
  return [
    `Min: ${formatVector(bounds.min)}`,
    `Max: ${formatVector(bounds.max)}`,
    `Size: ${formatVector(bounds.size)}`,
    `Center: ${formatVector(bounds.center)}`,
    `Bounding sphere radius: ${formatNumber(bounds.boundingSphere.radius)}`,
    `Meshes: ${bounds.meshCount}`,
    `Vertices: ${bounds.vertexCount}`,
    ...(bounds.modelFormat ? [`Model format: ${bounds.modelFormat}`] : [])
  ].join("\n");
}

async function prepareModelAssetPackage(modelFile: string, ctx: WorkflowContext, sdk: WorkflowSdk): Promise<ModelAssetDiscovery> {
  const sourcePath = path.resolve(modelFile);
  if (!fs.existsSync(sourcePath)) {
    throw new sdk.errors.WorkflowConfigurationError(`Model file not found: ${sourcePath}`);
  }

  const assetRoot = path.join(ctx.artifactDir, MODEL_ASSET_DIR_NAME);
  fs.rmSync(assetRoot, { recursive: true, force: true });
  fs.mkdirSync(assetRoot, { recursive: true });

  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === ".zip") {
    await sdk.files.extractZip(sourcePath, assetRoot);
    return discoverModelAssets(assetRoot);
  }

  if (!MODEL_EXTENSIONS.has(ext)) {
    throw new sdk.errors.WorkflowConfigurationError("Model input must be an .obj, .fbx, or .zip file.");
  }

  if (ext === ".obj") {
    copyObjWithSidecars(sourcePath, assetRoot, sdk);
    return discoverModelAssets(assetRoot);
  }

  const targetPath = path.join(assetRoot, stripRunInputPrefix(path.basename(sourcePath)));
  fs.copyFileSync(sourcePath, targetPath);
  return discoverModelAssets(assetRoot);
}

function copyObjWithSidecars(sourcePath: string, assetRoot: string, sdk: WorkflowSdk): void {
  const sourceDir = path.dirname(sourcePath);
  const objTargetPath = path.join(assetRoot, stripRunInputPrefix(path.basename(sourcePath)));
  fs.copyFileSync(sourcePath, objTargetPath);

  const objText = fs.readFileSync(sourcePath, "utf8");
  for (const materialFileName of objMaterialLibraryNames(objText, sourceDir)) {
    const materialSourcePath = path.resolve(sourceDir, materialFileName);
    if (!isSameOrChildPath(sourceDir, materialSourcePath) || !fs.existsSync(materialSourcePath) || !fs.statSync(materialSourcePath).isFile()) {
      throw new sdk.errors.WorkflowConfigurationError(
        `OBJ file references missing material library "${materialFileName}". Use a ZIP or include the MTL and texture sidecar files with the OBJ.`
      );
    }

    fs.copyFileSync(materialSourcePath, path.join(assetRoot, path.basename(materialSourcePath)));
    const materialDir = path.dirname(materialSourcePath);
    const materialText = fs.readFileSync(materialSourcePath, "utf8");
    for (const textureFileName of mtlTextureFileNames(materialText)) {
      const textureSourcePath = path.resolve(materialDir, textureFileName);
      if (!isSameOrChildPath(materialDir, textureSourcePath) || !fs.existsSync(textureSourcePath) || !fs.statSync(textureSourcePath).isFile()) {
        throw new sdk.errors.WorkflowConfigurationError(
          `MTL file references missing texture "${textureFileName}". Use a ZIP or include the texture sidecar files with the OBJ.`
        );
      }
      fs.copyFileSync(textureSourcePath, path.join(assetRoot, path.basename(textureSourcePath)));
    }
  }
}

async function registerModelArtifact(
  ctx: WorkflowContext,
  sdk: WorkflowSdk,
  assets: ModelAssetDiscovery,
  extraMetadata: Record<string, unknown>
): Promise<RegisteredModelArtifact> {
  const metadata = {
    source: "model-renderer",
    modelFormat: assets.format,
    modelFileName: assets.modelFileName,
    objFileName: assets.objFileName,
    mtlFileName: assets.mtlFileName,
    textureFileNames: assets.textureFileNames,
    assetFileNames: assets.assetFileNames,
    ...extraMetadata
  };
  const artifact = await ctx.addArtifact({
    kind: "model",
    name: assets.modelFileName,
    path: assets.modelPath,
    mimeType: sdk.files.inferMimeType(assets.modelPath),
    metadata
  });
  return { id: artifact.id, metadata };
}

async function renderModelImage(
  sdk: WorkflowSdk,
  ctx: WorkflowContext,
  assets: ModelAssetDiscovery,
  request: RenderRequest
): Promise<RenderResult> {
  const result = await withRendererPage(sdk, ctx, assets, request.width, request.height, async (page) => {
    assertNotAborted(ctx.signal);
    return (await page.evaluate((renderRequest: RenderRequest) => {
      return (window as any).blinkModelRenderer.render(renderRequest) as Promise<RenderResult>;
    }, request)) as RenderResult;
  });
  return { ...result, bounds: withModelFormat(result.bounds, assets.format) };
}

async function readModelBounds(sdk: WorkflowSdk, ctx: WorkflowContext, assets: ModelAssetDiscovery): Promise<ModelBounds> {
  const descriptor = browserModelDescriptor(assets);
  const bounds = await withRendererPage(sdk, ctx, assets, 256, 256, async (page) => {
    assertNotAborted(ctx.signal);
    return (await page.evaluate((model: BrowserModelDescriptor) => {
      return (window as any).blinkModelRenderer.bounds(model) as Promise<ModelBounds>;
    }, descriptor)) as ModelBounds;
  });
  return withModelFormat(bounds, assets.format);
}

function withModelFormat(bounds: ModelBounds, modelFormat: ModelFormat): ModelBounds {
  return { ...bounds, modelFormat };
}

async function withRendererPage<T>(
  sdk: WorkflowSdk,
  ctx: WorkflowContext,
  assets: ModelAssetDiscovery,
  width: number,
  height: number,
  run: (page: any) => Promise<T>
): Promise<T> {
  const threeRoot = resolveAppPackageRoot(sdk, "three");
  const rendererServer = await startRendererServer(threeRoot, assets.assetDir);
  const context = await sdk.browser.launchPersistentProfile({
    paths: ctx.paths,
    workflowId: "model-renderer",
    profileName: ctx.runId,
    headless: true
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width, height });
    await page.goto(rendererServer.url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as any).blinkModelRenderer), undefined, { timeout: 30_000 });
    return await run(page);
  } finally {
    await context.close().catch(() => undefined);
    await rendererServer.close();
  }
}

function resolveAppPackageRoot(sdk: WorkflowSdk, packageName: string): string {
  if (sdk.packages?.resolvePackageRoot) {
    return sdk.packages.resolvePackageRoot(packageName);
  }

  try {
    const entrypoint = requireFromPlugin.resolve(packageName, {
      paths: [process.cwd(), __dirname]
    });
    let current = path.dirname(entrypoint);
    for (;;) {
      if (fs.existsSync(path.join(current, "package.json"))) return current;
      const parent = path.dirname(current);
      if (parent === current) return path.dirname(entrypoint);
      current = parent;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve bundled package "${packageName}". Restart BLINK after updating the app. ${message}`);
  }
}

async function startRendererServer(threeRoot: string, assetRoot: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(rendererHtml());
        return;
      }
      if (url.pathname.startsWith("/three/")) {
        serveStaticFile(res, threeRoot, url.pathname.slice("/three/".length));
        return;
      }
      if (url.pathname.startsWith("/model/")) {
        serveStaticFile(res, assetRoot, url.pathname.slice("/model/".length));
        return;
      }
      res.statusCode = 404;
      res.end("missing");
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Renderer server did not expose a TCP port.");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}

function serveStaticFile(res: http.ServerResponse, root: string, encodedRelativePath: string): void {
  const relativePath = decodeURIComponent(encodedRelativePath).replace(/\\/g, "/");
  const candidate = path.resolve(root, relativePath);
  if (!isSameOrChildPath(root, candidate)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    res.statusCode = 404;
    res.end("missing");
    return;
  }
  res.setHeader("content-type", contentTypeForPath(candidate));
  fs.createReadStream(candidate).pipe(res);
}

function rendererHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head>
<body>
  <canvas id="render-canvas"></canvas>
  <script type="module">
    import * as THREE from "three";
    import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
    import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
    import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

    function modelUrl(fileName) {
      return "/model/" + String(fileName).split(/[\\\\/]+/).filter(Boolean).map(encodeURIComponent).join("/");
    }

    function loadWith(loader, url) {
      return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
    }

    function waitForManagerIdle(manager, timeoutMs = 20000) {
      return new Promise((resolve, reject) => {
        let sawLoadingWork = false;
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("Timed out loading model textures."));
        }, timeoutMs);
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        };
        const fail = (url) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("Failed to load model asset: " + url));
        };
        manager.onStart = () => {
          sawLoadingWork = true;
        };
        manager.onLoad = finish;
        manager.onError = fail;
        window.setTimeout(() => {
          if (!sawLoadingWork) finish();
        }, 0);
      });
    }

    async function loadModel(model) {
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        if (/^(?:https?:|data:|blob:)/i.test(url)) return url;
        if (url.startsWith("/model/")) return url;
        return modelUrl(url.replace(/^\\.\\//, ""));
      });
      if (model.format === "obj") {
        const objLoader = new OBJLoader(manager);
        let assetsLoaded = waitForManagerIdle(manager);
        if (model.mtlFileName) {
          const mtlLoader = new MTLLoader(manager);
          mtlLoader.setPath("/model/");
          mtlLoader.setResourcePath("/model/");
          const materials = await loadWith(mtlLoader, model.mtlFileName);
          assetsLoaded = waitForManagerIdle(manager);
          materials.preload();
          objLoader.setMaterials(materials);
        }
        const object = await loadWith(objLoader, modelUrl(model.modelFileName));
        await applyDiffuseTextureFallback(object, model, manager);
        await assetsLoaded;
        await waitForTextureImages(object);
        return object;
      }
      if (model.format === "fbx") {
        const assetsLoaded = waitForManagerIdle(manager);
        const object = await loadWith(new FBXLoader(manager), modelUrl(model.modelFileName));
        await assetsLoaded;
        await waitForTextureImages(object);
        return object;
      }
      throw new Error("Unsupported model format: " + model.format);
    }

    function vectorJson(vector) {
      return { x: vector.x, y: vector.y, z: vector.z };
    }

    function computeBounds(object) {
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) throw new Error("Model geometry bounds are empty.");
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      let meshCount = 0;
      let vertexCount = 0;
      object.traverse((child) => {
        if (child.isMesh || child.isLine || child.isPoints) {
          meshCount += 1;
          const position = child.geometry && child.geometry.getAttribute ? child.geometry.getAttribute("position") : null;
          if (position) vertexCount += position.count;
        }
      });
      return {
        min: vectorJson(box.min),
        max: vectorJson(box.max),
        size: vectorJson(size),
        center: vectorJson(center),
        boundingSphere: { center: vectorJson(sphere.center), radius: sphere.radius },
        meshCount,
        vertexCount
      };
    }

    function normalizeForRender(object) {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const maxDimension = Math.max(size.x, size.y, size.z);
      if (maxDimension > 0) object.scale.setScalar(2.2 / maxDimension);
      object.updateMatrixWorld(true);
    }

    function ensureGeometryNormals(object) {
      object.traverse((child) => {
        if (!child.isMesh || !child.geometry || !child.geometry.getAttribute) return;
        if (!child.geometry.getAttribute("normal") && child.geometry.computeVertexNormals) {
          child.geometry.computeVertexNormals();
        }
      });
    }

    function materialList(material) {
      if (!material) return [];
      return Array.isArray(material) ? material : [material];
    }

    function waitForTextureImages(object, timeoutMs = 20000) {
      const textures = new Set();
      object.traverse((child) => {
        if (!child.isMesh) return;
        for (const material of materialList(child.material)) {
          for (const value of Object.values(material)) {
            if (value && value.isTexture) {
              textures.add(value);
            }
          }
        }
      });
      if (textures.size === 0) return Promise.resolve();

      return Promise.all([...textures].map((texture) => waitForTextureImageDecode(texture, timeoutMs))).then(() => waitForRenderFrame());
    }

    function waitForRenderFrame() {
      return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
    }

    function waitForTextureImageDecode(texture, timeoutMs) {
      const startedAt = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          const image = texture.image;
          if (image instanceof HTMLImageElement) {
            waitForImageDecode(image).then(resolve, reject);
            return;
          }
          if (image) {
            resolve();
            return;
          }
          if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error("Timed out loading model texture image data."));
            return;
          }
          window.setTimeout(check, 25);
        };
        check();
      });
    }

    function waitForImageDecode(image) {
      if (image.complete && image.naturalWidth > 0) {
        return typeof image.decode === "function" ? image.decode().catch(() => undefined) : Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const finish = () => {
          cleanup();
          resolve();
        };
        const fail = () => {
          cleanup();
          reject(new Error("Failed to decode model texture: " + (image.currentSrc || image.src || "unknown texture")));
        };
        const cleanup = () => {
          image.removeEventListener("load", finish);
          image.removeEventListener("error", fail);
        };
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", fail, { once: true });
      });
    }

    function selectDiffuseTextureFileName(textureFileNames) {
      if (!Array.isArray(textureFileNames) || textureFileNames.length === 0) return null;
      const candidates = textureFileNames.filter((fileName) => !isNonDiffuseTextureFileName(fileName));
      if (candidates.length === 0) return null;
      return candidates.find((fileName) => /(?:^|[_\\-.])(albedo|basecolor|base_color|diffuse|color|texture_pbr)(?:[_\\-.]|$)/i.test(fileName)) || candidates[0] || null;
    }

    function isNonDiffuseTextureFileName(fileName) {
      return /(?:^|[_\\-.])(normal|roughness|rough|metallic|metalness|metal|specular|ao|occlusion|opacity|alpha|bump|height|displacement|disp)(?:[_\\-.]|$)/i.test(fileName);
    }

    function objectNeedsDiffuseTextureFallback(object) {
      let needsFallback = false;
      object.traverse((child) => {
        if (needsFallback || !child.isMesh || !child.geometry || !child.geometry.getAttribute) return;
        if (!child.geometry.getAttribute("uv") || child.geometry.getAttribute("color")) return;
        needsFallback = materialList(child.material).some((material) => material && !material.vertexColors && !material.map);
      });
      return needsFallback;
    }

    function loadTexture(loader, url) {
      return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
    }

    async function applyDiffuseTextureFallback(object, model, manager) {
      if (!objectNeedsDiffuseTextureFallback(object)) return false;
      const textureFileName = selectDiffuseTextureFileName(model.textureFileNames);
      if (!textureFileName) return false;
      const texture = await loadTexture(new THREE.TextureLoader(manager), modelUrl(textureFileName));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      object.traverse((child) => {
        if (!child.isMesh || !child.geometry || !child.geometry.getAttribute) return;
        if (!child.geometry.getAttribute("uv") || child.geometry.getAttribute("color")) return;
        for (const material of materialList(child.material)) {
          if (!material || material.vertexColors || material.map === undefined || material.map) continue;
          material.map = texture;
          if (material.color) material.color.setRGB(1, 1, 1);
          material.needsUpdate = true;
        }
      });
      return true;
    }

    function colorLuminance(color) {
      return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    }

    function preparePreviewMaterials(object) {
      const neutralPreviewColor = new THREE.Color(0xb8b8b8);
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = false;
        for (const material of materialList(child.material)) {
          if (!material) continue;
          material.side = THREE.DoubleSide;
          if (material.color) {
            const luminance = colorLuminance(material.color);
            if (material.map) {
              material.color.setRGB(1, 1, 1);
            } else if (!material.map && luminance < 0.16) {
              material.color.lerp(neutralPreviewColor, 0.85);
            }
          }
          if (material.emissive && (!material.map || colorLuminance(material.emissive) < 0.02)) {
            material.emissive.setRGB(0.04, 0.04, 0.04);
          }
          if ("roughness" in material && typeof material.roughness === "number") {
            material.roughness = Math.min(Math.max(material.roughness, 0.35), 0.78);
          }
          if ("metalness" in material && typeof material.metalness === "number") {
            material.metalness = Math.min(material.metalness, 0.35);
          }
          material.needsUpdate = true;
        }
      });
    }

    function cameraDirection(rotationDegrees) {
      const toRadians = Math.PI / 180;
      const euler = new THREE.Euler(
        rotationDegrees.x * toRadians,
        rotationDegrees.y * toRadians,
        rotationDegrees.z * toRadians,
        "XYZ"
      );
      const direction = new THREE.Vector3(0, 0, 1).applyEuler(euler);
      if (direction.lengthSq() === 0) direction.set(0, 0, 1);
      return direction.normalize();
    }

    async function render(request) {
      const canvas = document.getElementById("render-canvas");
      canvas.width = request.width;
      canvas.height = request.height;
      canvas.style.width = request.width + "px";
      canvas.style.height = request.height + "px";

      const object = await loadModel(request.model);
      const bounds = computeBounds(object);
      ensureGeometryNormals(object);
      normalizeForRender(object);
      preparePreviewMaterials(object);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, request.width / request.height, 0.01, 1000);
      camera.position.copy(cameraDirection(request.rotationDegrees).multiplyScalar(request.distance));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      scene.add(camera);

      scene.add(object);
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc4, 0.8));
      const cameraVector = camera.position.clone().normalize();
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
      keyLight.position.copy(camera.position).add(new THREE.Vector3(1.2, 1.8, 1.4));
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
      fillLight.position.copy(camera.position).multiplyScalar(0.45).add(new THREE.Vector3(-1.6, 0.8, -0.5));
      scene.add(fillLight);
      const rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
      rimLight.position.copy(cameraVector.multiplyScalar(-request.distance)).add(new THREE.Vector3(0, 1.2, 0));
      scene.add(rimLight);

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !request.backgroundColor });
      renderer.setSize(request.width, request.height, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      if (request.backgroundColor) {
        renderer.setClearColor(new THREE.Color(request.backgroundColor), 1);
      } else {
        renderer.setClearColor(0x000000, 0);
      }
      await waitForRenderFrame();
      renderer.render(scene, camera);
      await waitForRenderFrame();
      renderer.render(scene, camera);
      const dataUrl = canvas.toDataURL("image/png");
      renderer.dispose();
      return { dataUrl, bounds };
    }

    window.blinkModelRenderer = {
      bounds: async (model) => computeBounds(await loadModel(model)),
      render
    };
  </script>
</body>
</html>`;
}

function browserModelDescriptor(assets: ModelAssetDiscovery): BrowserModelDescriptor {
  return {
    format: assets.format,
    modelFileName: assets.modelFileName,
    ...(assets.mtlFileName ? { mtlFileName: assets.mtlFileName } : {}),
    ...(assets.textureFileNames.length > 0 ? { textureFileNames: assets.textureFileNames } : {})
  };
}

function publicModelAssetData(assets: ModelAssetDiscovery): Record<string, unknown> {
  return {
    modelFormat: assets.format,
    modelFileName: assets.modelFileName,
    objFileName: assets.objFileName,
    mtlFileName: assets.mtlFileName,
    textureFileNames: assets.textureFileNames,
    assetFileNames: assets.assetFileNames
  };
}

function renderPresentation(input: {
  imageArtifactId: string;
  metadataArtifactId: string;
  modelArtifactId: string;
  modelFormat: ModelFormat;
  bounds: ModelBounds;
  cameraText: string;
}): unknown {
  return {
    title: "Model render",
    groups: [
      {
        id: "render",
        title: "Rendered image",
        items: [
          { kind: "artifact", label: "PNG render", artifactId: input.imageArtifactId, preview: "image" },
          { kind: "text", label: "Camera", value: input.cameraText }
        ]
      },
      {
        id: "model",
        title: "Model",
        items: [
          {
            kind: "artifact",
            label: "Prepared model",
            artifactId: input.modelArtifactId,
            preview: "model"
          },
          { kind: "text", label: "Bounds", value: boundsText(input.bounds) },
          { kind: "artifact", label: "Render metadata", artifactId: input.metadataArtifactId }
        ]
      }
    ]
  };
}

function boundsPresentation(input: {
  boundsArtifactId: string;
  modelArtifactId: string;
  modelFormat: ModelFormat;
  bounds: ModelBounds;
}): unknown {
  return {
    title: "Model geometry bounds",
    groups: [
      {
        id: "bounds",
        title: "Bounds",
        items: [
          { kind: "text", label: "Geometry bounds", value: boundsText(input.bounds) },
          { kind: "artifact", label: "Bounds JSON", artifactId: input.boundsArtifactId },
          {
            kind: "artifact",
            label: "Prepared model",
            artifactId: input.modelArtifactId,
            preview: "model"
          }
        ]
      }
    ]
  };
}

function cameraText(rotationX: number, rotationY: number, rotationZ: number, distance: number): string {
  return [`Euler XYZ degrees: ${rotationX}, ${rotationY}, ${rotationZ}`, `Normalized distance: ${distance}`].join("\n");
}

function writePngDataUrl(filePath: string, dataUrl: string): void {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error("Renderer returned an invalid PNG data URL.");
  fs.writeFileSync(filePath, Buffer.from(dataUrl.slice(prefix.length), "base64"));
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function isSupportedModelInput(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".zip" || MODEL_EXTENSIONS.has(ext);
}

function stripRunInputPrefix(fileName: string): string {
  return fileName.replace(/^\d{2}-/, "") || fileName;
}

function objMaterialLibraryNames(objText: string, sourceDir: string): string[] {
  const names = new Set<string>();
  for (const line of objText.split(/\r?\n/)) {
    const trimmed = stripInlineComment(line).trim();
    if (!trimmed.toLowerCase().startsWith("mtllib ")) continue;
    const value = trimmed.slice("mtllib ".length).trim();
    if (!value) continue;
    const wholePath = path.resolve(sourceDir, value);
    if (fs.existsSync(wholePath)) {
      names.add(value);
      continue;
    }
    for (const token of value.split(/\s+/).filter(Boolean)) {
      names.add(token);
    }
  }
  return [...names];
}

function mtlTextureFileNames(mtlText: string): string[] {
  const names = new Set<string>();
  for (const line of mtlText.split(/\r?\n/)) {
    const trimmed = stripInlineComment(line).trim();
    if (!trimmed) continue;
    const [key = "", ...tokens] = trimmed.split(/\s+/);
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.startsWith("map_") && !["bump", "norm", "disp", "decal", "refl"].includes(normalizedKey)) continue;
    const textureFileName = lastTextureToken(tokens);
    if (textureFileName) names.add(textureFileName);
  }
  return [...names];
}

function lastTextureToken(tokens: string[]): string | null {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token || token.startsWith("-")) continue;
    return token;
  }
  return null;
}

function stripInlineComment(value: string): string {
  const commentIndex = value.indexOf("#");
  return commentIndex === -1 ? value : value.slice(0, commentIndex);
}

function formatVector(vector: Vector3Json): string {
  return `(${formatNumber(vector.x)}, ${formatNumber(vector.y)}, ${formatNumber(vector.z)})`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".wasm") return "application/wasm";
  if (ext === ".json") return "application/json";
  if (ext === ".obj" || ext === ".mtl") return "text/plain; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function isSameOrChildPath(parent: string, candidate: string): boolean {
  const parentKey = pathComparisonKey(parent);
  const candidateKey = pathComparisonKey(candidate);
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}${path.sep}`);
}

function pathComparisonKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Workflow run was cancelled.");
}
