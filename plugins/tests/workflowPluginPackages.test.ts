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
    await manager.installFromPath(path.join(repoRoot, "plugins", "based-blink-hunyuan"));

    expect(manager.listPlugins()[0]).toMatchObject({
      pluginId: "based-blink.hunyuan",
      version: "0.1.0",
      status: "loaded"
    });
    expect(manager.listWorkflowRegistrations().map((registration) => registration.definition.manifest.id)).toEqual([
      "based-blink.hunyuan.image-to-model",
      "based-blink.hunyuan.global.image-to-model"
    ]);
    const workflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "based-blink.hunyuan.image-to-model")!.definition;
    const globalWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "based-blink.hunyuan.global.image-to-model")!.definition;
    expect(globalWorkflow.manifest).toMatchObject({
      targetUrl: "https://3d.hunyuanglobal.com/",
      title: "Hunyuan Global Image to 3D Model",
      requiresBrowser: false,
      outputKinds: ["model", "download", "json"],
      uiCapabilities: ["extension.tabRouting"]
    });
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
      retopologyType: "quad",
      generateTexture: true,
      autoRig: false,
      exportFormat: "obj"
    });
  });

  it("loads the ChatGPT workflow package with prompt, image transform, and image sequence workflows", async () => {
    const manager = new PluginManager(tempDir());
    await manager.installFromPath(path.join(repoRoot, "plugins", "based-blink-chatgpt"));

    expect(manager.listPlugins()[0]).toMatchObject({
      pluginId: "based-blink.chatgpt",
      version: "0.1.0",
      status: "loaded"
    });
    expect(manager.listWorkflowRegistrations().map((registration) => registration.definition.manifest.id)).toEqual([
      "based-blink.chatgpt.extension-image-transform",
      "based-blink.chatgpt.extension-image-sequence",
      "based-blink.chatgpt.extension-image-prompt"
    ]);
    const workflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "based-blink.chatgpt.extension-image-transform")!.definition;
    const sequenceWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "based-blink.chatgpt.extension-image-sequence")!.definition;
    const promptWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "based-blink.chatgpt.extension-image-prompt")!.definition;
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
  });

  it("loads the Model Renderer workflow package with render and bounds workflows", async () => {
    const manager = new PluginManager(tempDir());
    await manager.installFromPath(path.join(repoRoot, "plugins", "based-blink-model-renderer"));

    expect(manager.listPlugins()[0]).toMatchObject({
      pluginId: "based-blink.model-renderer",
      version: "0.1.0",
      status: "loaded",
      capabilities: ["filesystem.artifacts", "browser"]
    });
    expect(manager.listWorkflowRegistrations().map((registration) => registration.definition.manifest.id)).toEqual([
      "based-blink.model-renderer.render-image",
      "based-blink.model-renderer.geometry-bounds"
    ]);

    const renderWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "based-blink.model-renderer.render-image")!.definition;
    const boundsWorkflow = manager
      .listWorkflowRegistrations()
      .find((registration) => registration.definition.manifest.id === "based-blink.model-renderer.geometry-bounds")!.definition;

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
    await manager.installFromPath(path.join(repoRoot, "plugins", "based-blink-hunyuan"));

    const paths = createRuntimePaths(projectDir);
    const store = await SqliteStore.open(paths.dbPath);
    const registry = createWorkflowRegistry(manager);
    const registration = registry.get("based-blink.hunyuan.image-to-model");
    if (!registration) throw new Error("Hunyuan plugin workflow did not register.");
    registration.definition.run = async () => ({ artifactIds: [], summary: "Stubbed plugin run." });
    const runner = new LocalWorkflowRunner(registry, store, paths, new RuntimeEventBus());
    const imagePath = path.join(projectDir, "input.png");
    const backImagePath = path.join(projectDir, "back.png");
    fs.writeFileSync(imagePath, "image");
    fs.writeFileSync(backImagePath, "image");

    const run = runner.enqueue({
      workflowId: "based-blink.hunyuan.image-to-model",
      name: "Hunyuan plugin snapshot",
      workflowInput: { frontImage: imagePath, backImage: backImagePath, prompt: "", profileName: "default", pauseForManualLogin: true }
    });

    expect(run.workflowId).toBe("based-blink.hunyuan.image-to-model");
    expect(run.workflowVersion).toBe("0.1.0");
    expect(run.pluginId).toBe("based-blink.hunyuan");
    expect(run.pluginVersion).toBe("0.1.0");
    await runner.deleteRun(run.id);
    store.close();
  });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blink-plugin-packages-"));
  tempDirs.push(dir);
  return dir;
}
