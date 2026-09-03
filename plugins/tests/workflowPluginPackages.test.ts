import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../../src/main/db/sqliteStore";
import { PluginManager } from "../../src/main/plugins/pluginManager";
import { RuntimeEventBus } from "../../src/main/runtime/eventBus";
import { LocalWorkflowRunner } from "../../src/main/runtime/localWorkflowRunner";
import { createRuntimePaths } from "../../src/main/runtime/paths";
import { createWorkflowRegistry } from "../../src/main/workflows";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "../..");

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("workflow plugin packages", () => {
  it("loads the Hunyuan workflow package with the renamed workflow id", async () => {
    const manager = new PluginManager(tempDir());
    await manager.installFromPath(path.join(repoRoot, "plugins", "navoke-hunyuan"));

    expect(manager.listPlugins()[0]).toMatchObject({
      pluginId: "navoke.hunyuan",
      version: "0.2.0",
      status: "loaded"
    });
    expect(manager.listWorkflowRegistrations().map((registration) => registration.definition.manifest.id)).toEqual([
      "navoke.hunyuan.image-to-model",
      "navoke.hunyuan.global.image-to-model"
    ]);
    const workflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.hunyuan.image-to-model")!.definition;
    const globalWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.hunyuan.global.image-to-model")!.definition;
    expect(globalWorkflow.manifest).toMatchObject({
      version: "0.1.0",
      targetUrl: "https://3d.hunyuanglobal.com/",
      title: "Hunyuan Global Image to 3D Model",
      requiresBrowser: false,
      outputKinds: ["model", "download", "json"],
      uiCapabilities: ["extension.tabRouting"]
    });
    expect(workflow.manifest.version).toBe("0.2.0");
    const tencentInputFields = workflow.manifest.inputFields.map((field) => field.name);
    expect(tencentInputFields).not.toContain("prompt");
    expect(tencentInputFields).not.toContain("retopologyType");
    expect(tencentInputFields).not.toContain("generateTexture");
    expect(tencentInputFields).not.toContain("autoRig");
    expect(manager.listPlugins()[0].capabilities).toContain("extension.browser");
    expect(workflow.inputSchema.safeParse({ frontImage: "C:\\tmp\\front.png" }).success).toBe(false);
    const parsed = workflow.inputSchema.safeParse({
      frontImage: "C:\\tmp\\front.png",
      backImage: "C:\\tmp\\back.png"
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Expected Hunyuan input defaults to parse.");
    expect(parsed.data).toMatchObject({
      modelFaceCount: "50k",
      exportFormat: "obj"
    });
    expect(parsed.data).not.toHaveProperty("retopologyType");
    expect(parsed.data).not.toHaveProperty("generateTexture");
    expect(parsed.data).not.toHaveProperty("autoRig");
  });

  it("loads the ChatGPT workflow package with prompt, image transform, and image sequence workflows", async () => {
    const manager = new PluginManager(tempDir());
    await manager.installFromPath(path.join(repoRoot, "plugins", "navoke-chatgpt"));

    expect(manager.listPlugins()[0]).toMatchObject({
      pluginId: "navoke.chatgpt",
      version: "0.1.0",
      status: "loaded"
    });
    expect(manager.listWorkflowRegistrations().map((registration) => registration.definition.manifest.id)).toEqual([
      "navoke.chatgpt.extension-image-transform",
      "navoke.chatgpt.extension-image-sequence",
      "navoke.chatgpt.extension-image-prompt",
      "navoke.chatgpt.extension-image-prompt-transform"
    ]);
    const workflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.chatgpt.extension-image-transform")!.definition;
    const sequenceWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.chatgpt.extension-image-sequence")!.definition;
    const promptWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.chatgpt.extension-image-prompt")!.definition;
    const imagePromptWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.chatgpt.extension-image-prompt-transform")!.definition;
    expect(workflow.inputSchema.safeParse({ referenceImages: [], subjectImages: [], masterPrompt: "" }).success).toBe(false);
    expect(
      workflow.inputSchema.safeParse({
        referenceImages: [],
        subjectImages: ["C:\\tmp\\subject.png"],
        masterPrompt: "Respond with READY.",
        subjectInstruction: "",
        extensionTab: { mode: "existing", clientId: "client-1" }
      }).success
    ).toBe(true);
    expect(sequenceWorkflow.inputSchema.safeParse({ sourceImages: [], prompts: ["Back"] }).success).toBe(false);
    expect(sequenceWorkflow.inputSchema.safeParse({ sourceImages: ["C:\\tmp\\one.png", "C:\\tmp\\two.png"], prompts: ["Back"] }).success).toBe(false);
    expect(sequenceWorkflow.inputSchema.safeParse({ sourceImages: ["C:\\tmp\\one.png"], prompts: ["", "   "] }).success).toBe(false);
    expect(
      sequenceWorkflow.inputSchema.safeParse({
        sourceImages: ["C:\\tmp\\one.png"],
        prompts: ["  Back view  ", "Side view"],
        masterPrompt: "",
        extensionTab: { mode: "existing", clientId: "client-1" }
      }).success
    ).toBe(true);
    expect(promptWorkflow.inputSchema.safeParse({ prompt: "" }).success).toBe(false);
    expect(
      promptWorkflow.inputSchema.safeParse({
        prompt: "Generate a small brass key on a white background.",
        extensionTab: { mode: "existing", clientId: "client-1" }
      }).success
    ).toBe(true);
    expect(imagePromptWorkflow.inputSchema.safeParse({ image: "", prompt: "Remove the background." }).success).toBe(false);
    expect(imagePromptWorkflow.inputSchema.safeParse({ image: "C:\\tmp\\source.png", prompt: "" }).success).toBe(false);
    expect(
      imagePromptWorkflow.inputSchema.safeParse({
        image: "C:\\tmp\\source.png",
        prompt: "Remove the background.",
        extensionTab: { mode: "existing", clientId: "client-1" }
      }).success
    ).toBe(true);
  });

  it("loads the Model Renderer workflow package with render and bounds workflows", async () => {
    const manager = new PluginManager(tempDir());
    await manager.installFromPath(path.join(repoRoot, "plugins", "navoke-model-renderer"));

    expect(manager.listPlugins()[0]).toMatchObject({
      pluginId: "navoke.model-renderer",
      version: "0.1.0",
      status: "loaded",
      capabilities: ["filesystem.artifacts", "browser"]
    });
    expect(manager.listWorkflowRegistrations().map((registration) => registration.definition.manifest.id)).toEqual([
      "navoke.model-renderer.render-image",
      "navoke.model-renderer.geometry-bounds"
    ]);

    const renderWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.model-renderer.render-image")!.definition;
    const boundsWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "navoke.model-renderer.geometry-bounds")!.definition;

    expect(renderWorkflow.manifest).toMatchObject({
      title: "Model Render Image",
      requiresBrowser: true,
      outputKinds: ["image", "model", "json"]
    });
    expect(renderWorkflow.manifest.inputFields[0]).toMatchObject({
      name: "modelFile",
      type: "fileList",
      fileValue: "single",
      maxFiles: 1,
      fileFilters: [
        { name: "Models", extensions: ["obj", "fbx", "zip"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    const parsedRender = renderWorkflow.inputSchema.safeParse({ modelFile: "C:\\tmp\\model.zip" });
    expect(parsedRender.success).toBe(true);
    if (!parsedRender.success) throw new Error("Expected model render input defaults to parse.");
    expect(parsedRender.data).toMatchObject({
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      distance: 3.2,
      width: 1024,
      height: 1024
    });
    expect(boundsWorkflow.inputSchema.safeParse({ modelFile: "C:\\tmp\\model.fbx" }).success).toBe(true);
    expect(boundsWorkflow.inputSchema.safeParse({ modelFile: "C:\\tmp\\model.png" }).success).toBe(false);
  });

  it("snapshots renamed plugin workflow metadata on new runs", async () => {
    const userDataDir = tempDir();
    const projectDir = tempDir();
    const manager = new PluginManager(userDataDir);
    await manager.installFromPath(path.join(repoRoot, "plugins", "navoke-hunyuan"));

    const paths = createRuntimePaths(projectDir);
    const store = await SqliteStore.open(paths.dbPath);
    const registry = createWorkflowRegistry(manager);
    const registration = registry.get("navoke.hunyuan.image-to-model");
    if (!registration) throw new Error("Hunyuan plugin workflow did not register.");
    registration.definition.run = async () => ({ artifactIds: [], summary: "Stubbed plugin run." });
    const runner = new LocalWorkflowRunner(registry, store, paths, new RuntimeEventBus());
    const imagePath = path.join(projectDir, "input.png");
    const backImagePath = path.join(projectDir, "back.png");
    fs.writeFileSync(imagePath, "image");
    fs.writeFileSync(backImagePath, "image");

    const run = runner.enqueue({
      workflowId: "navoke.hunyuan.image-to-model",
      name: "Hunyuan plugin snapshot",
      workflowInput: { frontImage: imagePath, backImage: backImagePath, prompt: "", profileName: "default", pauseForManualLogin: true }
    });

    expect(run.workflowId).toBe("navoke.hunyuan.image-to-model");
    expect(run.workflowVersion).toBe("0.2.0");
    expect(run.pluginId).toBe("navoke.hunyuan");
    expect(run.pluginVersion).toBe("0.2.0");
    await runner.deleteRun(run.id);
    store.close();
  });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-plugin-packages-"));
  tempDirs.push(dir);
  return dir;
}
