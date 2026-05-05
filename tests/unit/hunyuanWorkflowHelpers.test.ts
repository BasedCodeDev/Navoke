import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHunyuanViewUploadPlan,
  clickHunyuanActionButton,
  clickHunyuanGenerateButton,
  clickVisibleHunyuanControl,
  DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG,
  discoverHunyuanModelAssets,
  dismissHunyuanQuotaPopup,
  HUNYUAN_GLOBAL_WORKFLOW_ID,
  inferHunyuanArtifactKind,
  mergeHunyuanSelectorConfig,
  missingHunyuanSelectorKeys,
  resolveHunyuanExportFormat,
  createWorkflows
} from "../../plugins/based-blink-hunyuan/src";
import { createWorkflowSdk } from "../../src/main/workflowSdk";

describe("Hunyuan workflow helpers", () => {
  it("orders front, back, side, top, bottom, and 45-degree upload slots", () => {
    expect(
      buildHunyuanViewUploadPlan({
        frontImage: "front.png",
        right45Image: "right45.png",
        backImage: "back.png",
        leftImage: "left.png",
        bottomImage: "bottom.png"
      }).map((upload) => upload.selectorKey)
    ).toEqual(["front", "back", "left", "bottom", "right45"]);
  });

  it("provides default selectors for front plus secondary runs", () => {
    const selectors = mergeHunyuanSelectorConfig({});
    expect(
      missingHunyuanSelectorKeys({
        frontImage: "front.png",
        backImage: "back.png",
        modelFaceCount: "50k",
        retopologyType: "quad",
        exportFormat: "obj",
        generateTexture: true,
        selectors
      })
    ).toEqual([]);
    expect(selectors.viewUploadInputs).toMatchObject({
      front: '.hy-upload-card--front input[type="file"]',
      back: '.hy-upload-card--back input[type="file"]'
    });
  });

  it("targets visible segmented controls for default settings selectors", () => {
    const selectors = mergeHunyuanSelectorConfig({});
    expect(selectors.multipleViewsConfirmButton).toContain(".hy-multi-view-grid__header-close");
    expect(selectors.faceCountButtons?.["50k"]).toContain(".generation-type-select-title:has-text(\"模型面数\")");
    expect(selectors.faceCountButtons?.["50k"]).toContain(".qaUJkqcCF813NIqHGF3U:visible:has-text(\"50k\")");
    expect(selectors.faceCountButtons?.["50k"]).not.toContain("label.t-radio-button");
    expect(selectors.faceCountButtons?.["50k"]).not.toContain(">> text=");
    expect(selectors.modelTypeGeometryTexturePhased).toContain(".generation-type-select-title:has-text(\"模型类型\")");
    expect(selectors.modelTypeGeometryTexturePhased).toContain(".qaUJkqcCF813NIqHGF3U:visible");
    expect(selectors.modelTypeGeometryTexturePhased).not.toContain(">> text=");
    expect(selectors.generateButton).toContain(":not(.t-is-disabled):not([disabled])");
    expect(selectors.quotaExhaustedPopupText).toContain("已用完");
    expect(selectors.quotaExhaustedPopupCloseButton).toContain(".invite-tooltip-full");
    expect(selectors.quotaExhaustedPopupCloseButton).toContain(".t-icon-close");
    expect(selectors.geometryReadySelector).toContain(":not(.t-is-disabled):not([disabled])");
    expect(selectors.retopologyTypeButtons?.quad).toContain(".model-dialog__content__operation__heading");
    expect(selectors.retopologyTypeButtons?.quad).toContain(".topology-panel .qaUJkqcCF813NIqHGF3U");
    expect(selectors.retopologyTypeButtons?.quad).toContain(".qaUJkqcCF813NIqHGF3U:visible:has-text(\"四边面\")");
    expect(selectors.retopologyTypeButtons?.quad).not.toContain(":is(button, .t-button)");
    expect(selectors.exportFormatDropdown).toBe("button.download__dropdown__btn");
    expect(selectors.exportFormatOptions?.obj).toContain("OBJ");
    expect(selectors.exportFormatOptions?.obj).toContain("li.t-dropdown__item");
    expect(selectors.exportFormatOptions?.obj).toContain(".t-popup");
    expect(selectors.smartRetopologyButton).toContain(":not(.t-is-disabled):not([disabled])");
    expect(selectors.generateTextureButton).toContain(":not(.t-is-disabled):not([disabled])");
    expect(selectors.downloadButton).toContain(":not(.t-is-disabled):not([disabled])");
  });

  it("discovers an extracted OBJ, MTL, and texture asset set", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunyuan-assets-"));
    try {
      fs.writeFileSync(path.join(tempDir, "model.obj"), "mtllib material.mtl\n");
      fs.writeFileSync(path.join(tempDir, "material.mtl"), "map_Kd texture.png\n");
      fs.writeFileSync(path.join(tempDir, "texture.png"), "png");
      fs.writeFileSync(path.join(tempDir, "texture_normal.webp"), "webp");

      expect(discoverHunyuanModelAssets(tempDir)).toMatchObject({
        assetDir: tempDir,
        objPath: path.join(tempDir, "model.obj"),
        objFileName: "model.obj",
        mtlFileName: "material.mtl",
        textureFileNames: ["texture.png", "texture_normal.webp"],
        assetFileNames: ["material.mtl", "model.obj", "texture.png", "texture_normal.webp"]
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports a clear error when extracted Hunyuan assets contain no OBJ", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunyuan-assets-empty-"));
    try {
      fs.writeFileSync(path.join(tempDir, "material.mtl"), "newmtl Material\n");
      expect(() => discoverHunyuanModelAssets(tempDir)).toThrow("did not contain an OBJ file");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("provides English defaults for the Hunyuan Global source", () => {
    const selectors = mergeHunyuanSelectorConfig({}, DEFAULT_HUNYUAN_GLOBAL_SELECTOR_CONFIG);

    expect(
      missingHunyuanSelectorKeys({
        frontImage: "front.png",
        backImage: "back.png",
        modelFaceCount: "50k",
        retopologyType: "quad",
        exportFormat: "obj",
        generateTexture: true,
        selectors
      })
    ).toEqual([]);
    expect(selectors.loginStartSelector).toBe("button, a, [role='button']");
    expect(selectors.loginStartText).toBe("Start Using");
    expect(selectors.loginReadyText).toBe("Image to 3D");
    expect(selectors.loginRequiredSelector).toContain("email");
    expect(selectors.imageTo3dTab).toContain("Image to 3D");
    expect(selectors.multipleImagesTab).toContain("Multiple Images");
    expect(selectors.faceCountButtons?.["50k"]).toContain(".qaUJkqcCF813NIqHGF3U:visible:has-text(\"50k\")");
    expect(selectors.modelTypeGeometryTexturePhased).toContain("Texture");
    expect(selectors.generateButton).toContain("Generate");
    expect(selectors.retopologyTypeButtons?.quad).toContain("Quad");
    expect(selectors.downloadButton).toContain("Download");
  });

  it("registers Hunyuan Global as an extension-routed workflow with a default new tab target", () => {
    const workflow = createWorkflows(createWorkflowSdk() as any).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
    if (!workflow) throw new Error("Expected Hunyuan Global workflow.");

    expect(workflow.manifest).toMatchObject({
      requiresBrowser: false,
      outputKinds: ["json"],
      uiCapabilities: ["extension.tabRouting"],
      targetUrl: "https://3d.hunyuanglobal.com/"
    });
    const parsed = workflow.inputSchema.safeParse({
      frontImage: "C:\\tmp\\front.png",
      backImage: "C:\\tmp\\back.png"
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      modelFaceCount: "50k",
      retopologyType: "quad",
      generateTexture: true,
      autoRig: false,
      exportFormat: "obj",
      extensionTab: {
        mode: "new",
        routingToken: expect.any(String),
        url: expect.stringContaining("https://3d.hunyuanglobal.com/#based-blink-tab="),
        openMode: "window"
      }
    });
  });

  it("pauses Hunyuan Global at the login checkpoint without requiring generation selectors", async () => {
    const sdk = createWorkflowSdk() as any;
    let inspectCount = 0;
    let manualWaits = 0;
    const actions: unknown[] = [];
    sdk.extension.browser = {
      ...sdk.extension.browser,
      findCompatibleClientForTarget: () => ({
        id: "tab-1",
        url: "https://3d.hunyuanglobal.com/",
        title: "Hunyuan Global",
        status: "connected",
        protocolVersion: 1,
        extensionVersion: "0.1.0",
        compatible: true,
        lastSeenAt: new Date().toISOString()
      }),
      ensureRoutedTab: async () => ({
        id: "tab-1",
        url: "https://3d.hunyuanglobal.com/",
        title: "Hunyuan Global",
        status: "connected",
        protocolVersion: 1,
        extensionVersion: "0.1.0",
        compatible: true,
        lastSeenAt: new Date().toISOString()
      }),
      openTab: async () => ({ ok: true }),
      inspect: async () => {
        inspectCount += 1;
        if (inspectCount === 1) return { url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global" };
        if (inspectCount === 2) return { url: "https://3d.hunyuanglobal.com/login-email", title: "Login" };
        return { url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global" };
      },
      extract: async (_target: unknown, query: any) => {
        if (query.kind === "element-state") return { visible: false };
        if (query.kind === "text") {
          if (inspectCount === 1) return { text: "Start Using" };
          if (inspectCount === 2) return { text: "Start Using HY 3D" };
          return { text: "Image to 3D" };
        }
        return {};
      },
      action: async (_target: unknown, action: unknown) => {
        actions.push(action);
        return { ok: true };
      }
    };

    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
    if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
    const input = workflow.inputSchema.parse({
      frontImage: "C:\\tmp\\front.png",
      backImage: "C:\\tmp\\back.png",
      selectors: {}
    });

    const result = await workflow.run(input, {
      runId: "run-hunyuan",
      signal: new AbortController().signal,
      paths: {},
      artifactDir: "C:\\tmp",
      step: async () => undefined,
      event: async () => undefined,
      waitForManualAction: async () => {
        manualWaits += 1;
      },
      addArtifact: async () => ({ id: "unused" })
    });

    expect(manualWaits).toBe(1);
    expect(actions).toEqual([
      {
        kind: "click",
        selector: "button, a, [role='button']",
        text: "Start Using",
        textMatch: "contains",
        caseSensitive: false
      }
    ]);
    expect(result).toMatchObject({
      artifactIds: [],
      summary: expect.stringContaining("authenticated")
    });
  });

  it("reports a profile-safe manual action when Hunyuan Global has tabs but no browser controller", async () => {
    const sdk = createWorkflowSdk() as any;
    const manualMessages: string[] = [];
    const steps: string[] = [];
    sdk.extension.browser = {
      ...sdk.extension.browser,
      status: () => ({
        compatible: 1,
        compatibleControllers: 0,
        connectedClients: [
          {
            id: "tab-1",
            url: "https://chatgpt.com/",
            title: "Wrong site",
            compatible: true,
            controllerHeartbeatOk: false,
            controllerHeartbeatError: "controller failed"
          }
        ],
        connectedControllers: [],
        controllerDiagnostics: { compatibleTabsWithController: 0, compatibleTabsWithoutController: 1 }
      }),
      ensureRoutedTab: async () => {
        throw new Error(
          "No compatible BLINK browser controller with open-window support is connected. Do not open chrome.exe or paste routed workflow URLs into another Chrome profile."
        );
      }
    };

    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
    if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
    const input = workflow.inputSchema.parse({
      frontImage: "C:\\tmp\\front.png",
      backImage: "C:\\tmp\\back.png",
      selectors: {}
    });

    await expect(
      workflow.run(input, {
        runId: "run-hunyuan",
        signal: new AbortController().signal,
        paths: {},
        artifactDir: "C:\\tmp",
        step: async (message) => {
          steps.push(message);
        },
        event: async () => undefined,
        waitForManualAction: async (message) => {
          manualMessages.push(message);
        },
        addArtifact: async () => ({ id: "unused" })
      })
    ).rejects.toThrow("still requires manual action");

    expect(steps.some((message) => message.includes("tabs are connected, but the browser controller is not connected"))).toBe(true);
    expect(manualMessages[0]).toContain("Do not open chrome.exe");
    expect(manualMessages[0]).toContain("intended Chrome profile");
  });

  it("clicks a visible later candidate when the first matching setting candidate is hidden", async () => {
    const hiddenText = new FakeHunyuanLocatorNode({ visible: false });
    const visibleControl = new FakeHunyuanLocatorNode({ visible: true });
    const page = new FakeHunyuanPage([hiddenText, visibleControl]);

    await clickVisibleHunyuanControl(page, "text=50k", "faceCountButtons.50k");

    expect(hiddenText.clicks).toBe(0);
    expect(visibleControl.clicks).toBe(1);
  });

  it("clicks a visible clickable ancestor when the matched setting text is hidden", async () => {
    const visibleAncestor = new FakeHunyuanLocatorNode({ visible: true });
    const hiddenText = new FakeHunyuanLocatorNode({ visible: false, ancestor: visibleAncestor });
    const page = new FakeHunyuanPage([hiddenText]);

    await clickVisibleHunyuanControl(page, "text=50k", "faceCountButtons.50k");

    expect(hiddenText.clicks).toBe(0);
    expect(visibleAncestor.clicks).toBe(1);
  });

  it("reports selector diagnostics when no setting candidate is clickable", async () => {
    const page = new FakeHunyuanPage([new FakeHunyuanLocatorNode({ visible: false }), new FakeHunyuanLocatorNode({ visible: true, enabled: false })]);

    await expect(clickVisibleHunyuanControl(page, "text=50k", "faceCountButtons.50k")).rejects.toThrow(
      "candidates=2; visible=1; enabled=0"
    );
  });

  it("skips disabled generate controls before clicking the enabled generate control", async () => {
    const disabledControl = new FakeHunyuanLocatorNode({ visible: true, disabledState: true });
    const enabledControl = new FakeHunyuanLocatorNode({ visible: true });
    const page = new FakeHunyuanPage([disabledControl, enabledControl]);

    await clickHunyuanGenerateButton(page, ".sideBarLeft-generateBtn:has-text(\"立即生成\")", 100);

    expect(disabledControl.clicks).toBe(0);
    expect(enabledControl.clicks).toBe(1);
  });

  it("uses the same disabled-safe action click for downstream Hunyuan buttons", async () => {
    const disabledControl = new FakeHunyuanLocatorNode({ visible: true, disabledState: true });
    const enabledControl = new FakeHunyuanLocatorNode({ visible: true });
    const page = new FakeHunyuanPage([disabledControl, enabledControl]);

    await clickHunyuanActionButton(page, "button:has-text(\"生成纹理\")", "generateTextureButton", 100);

    expect(disabledControl.clicks).toBe(0);
    expect(enabledControl.clicks).toBe(1);
  });

  it("dismisses the Hunyuan quota exhausted invite popup when it is visible", async () => {
    const closeControl = new FakeHunyuanLocatorNode({ visible: true });
    const page = new FakeHunyuanPage([closeControl], "生成次数已用完");

    await expect(
      dismissHunyuanQuotaPopup(page, {
        quotaExhaustedPopupText: "生成次数已用完",
        quotaExhaustedPopupCloseButton: ".invite-tooltip-full .t-icon-close"
      })
    ).resolves.toBe(true);
    expect(closeControl.clicks).toBe(1);
  });

  it("preserves calibrated overrides over defaults", () => {
    expect(
      mergeHunyuanSelectorConfig({
        viewUploadInputs: { front: "input.front" },
        faceCountButtons: { "50k": "button.50k" }
      })
    ).toMatchObject({
      viewUploadInputs: { front: "input.front" },
      faceCountButtons: { "50k": "button.50k" }
    });
  });

  it("infers model artifacts from model MIME types", () => {
    expect(inferHunyuanArtifactKind("model.glb", () => "model/gltf-binary")).toBe("model");
    expect(inferHunyuanArtifactKind("model.obj", () => "model/obj")).toBe("model");
    expect(inferHunyuanArtifactKind("model.zip", () => "application/zip")).toBe("download");
  });

  it("falls back to OBJ when GLB is requested but the Hunyuan menu does not offer GLB", () => {
    expect(resolveHunyuanExportFormat("glb", ["OBJ", "FBX", "STL", "USDZ", "MP4", "GIF"])).toMatchObject({
      requested: "glb",
      actual: "obj",
      fallbackReason: expect.stringContaining("OBJ")
    });
  });

  it("keeps GLB when Hunyuan offers a visible GLB export option", () => {
    expect(resolveHunyuanExportFormat("glb", ["OBJ", "GLB"])).toMatchObject({
      requested: "glb",
      actual: "glb"
    });
  });
});

class FakeHunyuanPage {
  constructor(
    private readonly nodes: FakeHunyuanLocatorNode[],
    private readonly visibleText = ""
  ) {}

  locator(): FakeHunyuanLocatorGroup {
    return new FakeHunyuanLocatorGroup(this.nodes);
  }

  async waitForTimeout(): Promise<void> {}

  async evaluate(_callback: unknown, argument?: unknown): Promise<boolean> {
    return typeof argument === "string" ? this.visibleText.includes(argument) && this.nodes.every((node) => node.clicks === 0) : false;
  }
}

class FakeHunyuanLocatorGroup {
  constructor(private readonly nodes: FakeHunyuanLocatorNode[]) {}

  first(): FakeHunyuanLocatorNode {
    return this.nth(0);
  }

  nth(index: number): FakeHunyuanLocatorNode {
    return this.nodes[index] ?? new FakeHunyuanLocatorNode({ visible: false });
  }

  async count(): Promise<number> {
    return this.nodes.length;
  }
}

class FakeHunyuanLocatorNode {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly disabledState: boolean;
  readonly ancestor?: FakeHunyuanLocatorNode;
  clicks = 0;

  constructor(input: { visible: boolean; enabled?: boolean; disabledState?: boolean; ancestor?: FakeHunyuanLocatorNode }) {
    this.visible = input.visible;
    this.enabled = input.enabled ?? true;
    this.disabledState = input.disabledState ?? false;
    this.ancestor = input.ancestor;
  }

  async click(): Promise<void> {
    if (!this.visible || !this.enabled) throw new Error("Fake candidate is not clickable.");
    this.clicks += 1;
  }

  locator(): FakeHunyuanLocatorGroup {
    return new FakeHunyuanLocatorGroup(this.ancestor ? [this.ancestor] : []);
  }

  first(): FakeHunyuanLocatorNode {
    return this;
  }

  async isVisible(): Promise<boolean> {
    return this.visible;
  }

  async isEnabled(): Promise<boolean> {
    return this.enabled;
  }

  async evaluate(): Promise<boolean> {
    return this.disabledState;
  }
}
