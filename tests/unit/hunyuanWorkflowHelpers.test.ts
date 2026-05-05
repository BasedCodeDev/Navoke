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
    expect(selectors.loginReadyText).toBe("Image-to-3D");
    expect(selectors.loginRequiredSelector).toContain("email");
    expect(selectors.imageTo3dTab).toContain("Image-to-3D");
    expect(selectors.multipleImagesTab).toContain("Multiple Images");
    expect(selectors.faceCountButtons?.["50k"]).toContain(".qaUJkqcCF813NIqHGF3U:visible:has-text(\"50k\")");
    expect(selectors.modelTypeGeometryTexturePhased).toContain("Generation type");
    expect(selectors.modelTypeGeometryTexturePhased).toContain("Staged Generation");
    expect(selectors.generateButton).toContain("Generate");
    expect(selectors.geometryReadySelector).toContain("Smart Topology");
    expect(selectors.retopologyTypeButtons?.quad).toContain("Quadrilaterals");
    expect(selectors.generateTextureButton).toContain("Generate texture");
    expect(selectors.textureRunningText).toBe("Estimated time");
    expect(selectors.downloadButton).toContain("Download");
  });

  it("registers Hunyuan Global as an extension-routed workflow with a default new tab target", () => {
    const workflow = createWorkflows(createWorkflowSdk() as any).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
    if (!workflow) throw new Error("Expected Hunyuan Global workflow.");

    expect(workflow.manifest).toMatchObject({
      requiresBrowser: false,
      outputKinds: ["model", "download", "json"],
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
        return { url: "https://3d.hunyuanglobal.com/login-email", title: "Login" };
      },
      extract: async (_target: unknown, query: any) => {
        if (query.kind === "element-state") return { visible: false };
        if (query.kind === "text") {
          if (inspectCount === 1) return { text: "Start Using" };
          return { text: "Start Using HY 3D" };
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

    await expect(
      workflow.run(input, {
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
      })
    ).rejects.toThrow("still requires manual action");

    expect(manualWaits).toBe(4);
    expect(actions).toEqual([
      {
        kind: "click",
        selector: "button, a, [role='button']",
        text: "Start Using",
        textMatch: "contains",
        caseSensitive: false
      }
    ]);
  });

  it("runs the Hunyuan Global extension flow through textured OBJ package registration", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunyuan-global-flow-"));
    const downloadDir = path.join(tempDir, "downloads");
    const artifactDir = path.join(tempDir, "artifacts");
    fs.mkdirSync(downloadDir);
    fs.mkdirSync(artifactDir);
    const frontPath = path.join(tempDir, "front.png");
    const backPath = path.join(tempDir, "back.png");
    const downloadedObj = path.join(downloadDir, "hunyuan-model.obj");
    const downloadedZip = path.join(downloadDir, "hunyuan-model-package.zip");
    fs.writeFileSync(frontPath, "front");
    fs.writeFileSync(backPath, "back");
    fs.writeFileSync(downloadedObj, "o model\n");
    fs.writeFileSync(downloadedZip, "zip");

    try {
      const sdk = createWorkflowSdk() as any;
      const actions: any[] = [];
      const artifacts: any[] = [];
      const closedTabs: any[] = [];
      let downloadWatchCount = 0;
      let downloadWaitCount = 0;
      let runningTextPolls = 0;
      let runningTextMode: "generate" | "texture" = "generate";
      sdk.files.extractZip = async (_zipPath: string, targetDir: string) => {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, "package-model.obj"), "mtllib material.mtl\no model\n");
        fs.writeFileSync(path.join(targetDir, "material.mtl"), "newmtl material\n");
        fs.writeFileSync(path.join(targetDir, "texture_pbr.png"), "texture");
      };
      sdk.extension.browser = {
        ...sdk.extension.browser,
        findCompatibleClientForTarget: () => ({
          id: "tab-1",
          url: "https://3d.hunyuanglobal.com/",
          title: "Hunyuan Global",
          status: "connected",
          protocolVersion: 6,
          extensionVersion: "0.1.8",
          compatible: true,
          lastSeenAt: new Date().toISOString()
        }),
        ensureRoutedTab: async () => ({
          id: "tab-1",
          url: "https://3d.hunyuanglobal.com/",
          title: "Hunyuan Global",
          status: "connected",
          protocolVersion: 6,
          extensionVersion: "0.1.8",
          compatible: true,
          lastSeenAt: new Date().toISOString(),
          openedByController: true,
          openedAction: "open-window",
          openedTabId: 42,
          openedWindowId: 7,
          openedControllerId: "controller-1"
        }),
        closeTab: async (tabId: number, options: unknown) => {
          closedTabs.push({ tabId, options });
          return { ok: true };
        },
        stageFiles: (filePaths: string[]) =>
          filePaths.map((filePath, index) => ({
            id: `file-${index}`,
            name: path.basename(filePath),
            mimeType: "image/png",
            url: `/api/extension/files/file-${index}`
          })),
        startDownloadWatch: () => ({ id: `watch-${++downloadWatchCount}`, startedAt: new Date().toISOString() }),
        waitForDownload: async (watchId: string) => {
          downloadWaitCount += 1;
          return {
            watchId,
            filename: downloadWaitCount === 1 ? downloadedObj : downloadedZip,
            state: "complete",
            completedAt: new Date().toISOString()
          };
        },
        inspect: async () => ({ url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global" }),
        extract: async (_target: unknown, query: any) => {
          if (query.kind === "element-state") {
            const selector = String(query.selector ?? "");
            if (/loading|spinner|progress/i.test(selector)) return { count: 0, visible: false, visibleCount: 0, enabledCount: 0, disabled: false };
            return { count: 1, visible: true, visibleCount: 1, enabledCount: 1, disabled: false };
          }
          if (query.kind === "text") {
            if (query.selector) return { text: "Uploaded reference image" };
            if (runningTextPolls > 0) {
              runningTextPolls -= 1;
              return { text: runningTextMode === "texture" ? "Texture Estimated time 59 second" : "Generating Estimated remaining" };
            }
            return { text: "Image-to-3D Multiple Images Generate Smart Retopology Generate Texture Download" };
          }
          return {};
        },
        action: async (_target: unknown, action: unknown) => {
          actions.push(action);
          if (
            typeof (action as { kind?: unknown }).kind === "string" &&
            (action as { kind: string }).kind === "click" &&
            /Generate|Smart Retopology/.test(String((action as { selector?: unknown }).selector ?? ""))
          ) {
            runningTextMode = /Generate texture/.test(String((action as { selector?: unknown }).selector ?? "")) ? "texture" : "generate";
            runningTextPolls = 2;
          }
          return { ok: true };
        }
      };

      const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
      if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
      const input = workflow.inputSchema.parse({
        frontImage: frontPath,
        backImage: backPath,
        selectors: {}
      });

      const result = await workflow.run(input, {
        runId: "run-hunyuan-global",
        signal: new AbortController().signal,
        paths: {},
        artifactDir,
        step: async () => undefined,
        event: async () => undefined,
        waitForManualAction: async () => {
          throw new Error("Manual action should not be required.");
        },
        addArtifact: async (artifact) => {
          const id = `artifact-${artifacts.length + 1}`;
          artifacts.push({ id, ...artifact });
          return { id };
        }
      });

      expect(actions.map((action) => action.kind)).toContain("attach-file");
      expect(actions.some((action) => action.kind === "click" && String(action.selector).includes("download__dropdown"))).toBe(true);
      expect(actions.some((action) => action.kind === "click" && String(action.selector).includes("OBJ"))).toBe(true);
      expect(result).toMatchObject({ modelArtifactId: "artifact-1", manifestArtifactId: "artifact-2" });
      expect(artifacts[0]).toMatchObject({
        kind: "model",
        name: "package-model.obj",
        metadata: expect.objectContaining({
          mtlFileName: "material.mtl",
          textureFileNames: ["texture_pbr.png"],
          originalArchive: expect.objectContaining({ filename: "hunyuan-model-package.zip", deleted: true })
        })
      });
      expect(fs.existsSync(path.join(artifactDir, "model-assets", "package-model.obj"))).toBe(true);
      expect(fs.existsSync(path.join(artifactDir, "model-assets", "material.mtl"))).toBe(true);
      expect(fs.existsSync(path.join(artifactDir, "model-assets", "texture_pbr.png"))).toBe(true);
      expect(fs.existsSync(path.join(artifactDir, "hunyuan-global-image-to-model-manifest.json"))).toBe(true);
      expect(closedTabs).toEqual([{ tabId: 42, options: { controllerId: "controller-1", timeoutMs: 20_000 } }]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 90_000);

  it("retries only the Hunyuan Global slot that reports Detection failed before closing the multiview modal", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunyuan-global-detection-retry-"));
    const downloadDir = path.join(tempDir, "downloads");
    const artifactDir = path.join(tempDir, "artifacts");
    fs.mkdirSync(downloadDir);
    fs.mkdirSync(artifactDir);
    const frontPath = path.join(tempDir, "front.png");
    const backPath = path.join(tempDir, "back.png");
    const downloadedObj = path.join(downloadDir, "hunyuan-model.obj");
    fs.writeFileSync(frontPath, "front");
    fs.writeFileSync(backPath, "back");
    fs.writeFileSync(downloadedObj, "o model\n");

    try {
      const sdk = createWorkflowSdk() as any;
      const actions: any[] = [];
      const slotState: Record<string, "empty" | "accepted" | "failed"> = { front: "empty", back: "empty" };
      let backAttachAttempts = 0;
      let runningTextPolls = 0;
      let runningTextMode: "generate" | "texture" = "generate";
      let modalOpen = true;
      sdk.extension.browser = {
        ...sdk.extension.browser,
        ensureRoutedTab: async () => ({
          id: "tab-1",
          url: "https://3d.hunyuanglobal.com/",
          title: "Hunyuan Global",
          status: "connected",
          protocolVersion: 5,
          extensionVersion: "0.1.6",
          compatible: true,
          lastSeenAt: new Date().toISOString()
        }),
        closeTab: async () => ({ ok: true }),
        stageFiles: (filePaths: string[]) =>
          filePaths.map((filePath, index) => ({
            id: `file-${index}`,
            name: path.basename(filePath),
            mimeType: "image/png",
            url: `/api/extension/files/file-${index}`
          })),
        startDownloadWatch: () => ({ id: "watch-1", startedAt: new Date().toISOString() }),
        waitForDownload: async () => ({
          watchId: "watch-1",
          filename: downloadedObj,
          state: "complete",
          completedAt: new Date().toISOString()
        }),
        inspect: async () => ({ url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global" }),
        extract: async (_target: unknown, query: any) => {
          const selector = String(query.selector ?? "");
          if (query.kind === "element-state") {
            if (/loading|spinner|progress/i.test(selector)) return { count: 0, visible: false, visibleCount: 0, enabledCount: 0, disabled: false };
            if (/hy-upload-card--back/.test(selector) && /remove|delete|t-icon-close/i.test(selector)) {
              return { count: 0, visible: false, visibleCount: 0, enabledCount: 0, disabled: false };
            }
            if (/hy-upload-card--front/.test(selector) && /img|preview|thumbnail|t-image/i.test(selector)) {
              const visible = slotState.front === "accepted";
              return { count: visible ? 1 : 0, visible, visibleCount: visible ? 1 : 0, enabledCount: visible ? 1 : 0, disabled: false };
            }
            if (/hy-upload-card--back/.test(selector) && /img|preview|thumbnail|t-image/i.test(selector)) {
              const visible = slotState.back === "accepted" || slotState.back === "failed";
              return { count: visible ? 1 : 0, visible, visibleCount: visible ? 1 : 0, enabledCount: visible ? 1 : 0, disabled: false };
            }
            return { count: 1, visible: true, visibleCount: 1, enabledCount: 1, disabled: false };
          }
          if (query.kind === "text") {
            if (/hy-upload-card--front/.test(selector)) return { text: slotState.front === "accepted" ? "Uploaded reference image" : "" };
            if (/hy-upload-card--back/.test(selector)) {
              return { text: slotState.back === "failed" ? "Detection failed" : slotState.back === "accepted" ? "Uploaded reference image" : "" };
            }
            if (runningTextPolls > 0) {
              runningTextPolls -= 1;
              return { text: runningTextMode === "texture" ? "Texture Estimated time 59 second" : "Generating Estimated remaining" };
            }
            return {
              text: `${modalOpen ? "Add Multi-view " : ""}Image-to-3D Multiple Images Generate Smart Retopology Generate Texture Download`
            };
          }
          return {};
        },
        action: async (_target: unknown, action: any) => {
          actions.push(action);
          if (action.kind === "attach-file" && String(action.selector).includes("hy-upload-card--front")) {
            slotState.front = "accepted";
          }
          if (action.kind === "attach-file" && String(action.selector).includes("hy-upload-card--back")) {
            backAttachAttempts += 1;
            slotState.back = backAttachAttempts === 1 ? "failed" : "accepted";
          }
          if (action.kind === "click" && String(action.selector).includes("hy-upload-card--back") && /remove|delete|t-icon-close/i.test(String(action.selector))) {
            slotState.back = "empty";
          }
          if (action.kind === "click" && String(action.selector).includes("hy-multi-view-grid__header-close")) {
            modalOpen = false;
          }
          if (action.kind === "click" && /Generate|Smart Retopology/.test(String(action.selector ?? ""))) {
            runningTextMode = /Generate texture/.test(String(action.selector ?? "")) ? "texture" : "generate";
            runningTextPolls = 2;
          }
          return { ok: true };
        }
      };

      const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
      if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
      const input = workflow.inputSchema.parse({ frontImage: frontPath, backImage: backPath, selectors: {} });

      await workflow.run(input, {
        runId: "run-hunyuan-global",
        signal: new AbortController().signal,
        paths: {},
        artifactDir,
        step: async () => undefined,
        event: async () => undefined,
        waitForManualAction: async () => {
          throw new Error("Manual action should not be required.");
        },
        addArtifact: async () => ({ id: `artifact-${actions.length}` })
      });

      const frontAttachIndexes = actions
        .map((action, index) => ({ action, index }))
        .filter(({ action }) => action.kind === "attach-file" && String(action.selector).includes("hy-upload-card--front"))
        .map(({ index }) => index);
      const backAttachIndexes = actions
        .map((action, index) => ({ action, index }))
        .filter(({ action }) => action.kind === "attach-file" && String(action.selector).includes("hy-upload-card--back"))
        .map(({ index }) => index);
      const backRemoveIndex = actions.findIndex(
        (action) => action.kind === "click" && String(action.selector).includes("hy-upload-card--back") && /remove|delete|t-icon-close/i.test(String(action.selector))
      );
      const closeIndex = actions.findIndex((action) => action.kind === "click" && String(action.selector).includes("hy-multi-view-grid__header-close"));
      const generateIndex = actions.findIndex((action) => action.kind === "click" && String(action.selector).includes("Generate"));

      expect(frontAttachIndexes).toHaveLength(1);
      expect(backAttachIndexes).toHaveLength(2);
      expect(backRemoveIndex).toBe(-1);
      expect(closeIndex).toBeGreaterThan(backAttachIndexes[1]);
      expect(generateIndex).toBeGreaterThan(closeIndex);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 90_000);

  it("records diagnostics and pauses for manual recovery when Hunyuan Global detection retries are exhausted", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunyuan-global-detection-exhausted-"));
    const frontPath = path.join(tempDir, "front.png");
    const backPath = path.join(tempDir, "back.png");
    fs.writeFileSync(frontPath, "front");
    fs.writeFileSync(backPath, "back");

    try {
      const sdk = createWorkflowSdk() as any;
      const actions: any[] = [];
      const artifacts: any[] = [];
      const manualWaits: any[] = [];
      const slotState: Record<string, "empty" | "accepted" | "failed"> = { front: "empty", back: "empty" };
      let modalOpen = true;
      sdk.extension.browser = {
        ...sdk.extension.browser,
        ensureRoutedTab: async () => ({
          id: "tab-1",
          url: "https://3d.hunyuanglobal.com/",
          title: "Hunyuan Global",
          status: "connected",
          protocolVersion: 5,
          extensionVersion: "0.1.6",
          compatible: true,
          lastSeenAt: new Date().toISOString()
        }),
        closeTab: async () => ({ ok: true }),
        stageFiles: (filePaths: string[]) =>
          filePaths.map((filePath, index) => ({
            id: `file-${index}`,
            name: path.basename(filePath),
            mimeType: "image/png",
            url: `/api/extension/files/file-${index}`
          })),
        inspect: async () => ({ url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global", bodyText: "Detection failed" }),
        extract: async (_target: unknown, query: any) => {
          const selector = String(query.selector ?? "");
          if (query.kind === "element-state") {
            if (/loading|spinner|progress/i.test(selector)) return { count: 0, visible: false, visibleCount: 0, enabledCount: 0, disabled: false };
            if (/hy-upload-card--back/.test(selector) && /remove|delete|t-icon-close/i.test(selector)) {
              const visible = slotState.back === "failed";
              return { count: visible ? 1 : 0, visible, visibleCount: visible ? 1 : 0, enabledCount: visible ? 1 : 0, disabled: false };
            }
            if (/hy-upload-card--front/.test(selector) && /img|preview|thumbnail|t-image/i.test(selector)) {
              const visible = slotState.front === "accepted";
              return { count: visible ? 1 : 0, visible, visibleCount: visible ? 1 : 0, enabledCount: visible ? 1 : 0, disabled: false };
            }
            if (/hy-upload-card--back/.test(selector) && /img|preview|thumbnail|t-image/i.test(selector)) {
              const visible = slotState.back === "accepted" || slotState.back === "failed";
              return { count: visible ? 1 : 0, visible, visibleCount: visible ? 1 : 0, enabledCount: visible ? 1 : 0, disabled: false };
            }
            return { count: 1, visible: true, visibleCount: 1, enabledCount: 1, disabled: false };
          }
          if (query.kind === "text") {
            if (/hy-upload-card--front/.test(selector)) return { text: slotState.front === "accepted" ? "Uploaded reference image" : "" };
            if (/hy-upload-card--back/.test(selector)) {
              return { text: slotState.back === "failed" ? "Detection failed" : slotState.back === "accepted" ? "Uploaded reference image" : "" };
            }
            return { text: `${modalOpen ? "Add Multi-view " : ""}Image-to-3D Multiple Images Generate` };
          }
          return {};
        },
        action: async (_target: unknown, action: any) => {
          actions.push(action);
          if (action.kind === "attach-file" && String(action.selector).includes("hy-upload-card--front")) slotState.front = "accepted";
          if (action.kind === "attach-file" && String(action.selector).includes("hy-upload-card--back")) slotState.back = "failed";
          if (action.kind === "click" && String(action.selector).includes("hy-upload-card--back") && /remove|delete|t-icon-close/i.test(String(action.selector))) {
            slotState.back = "empty";
          }
          if (action.kind === "click" && String(action.selector).includes("hy-multi-view-grid__header-close")) modalOpen = false;
          if (action.kind === "click" && String(action.selector).includes("model-version-select")) throw new Error("stop after manual recovery");
          return { ok: true };
        }
      };

      const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
      if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
      const input = workflow.inputSchema.parse({ frontImage: frontPath, backImage: backPath, selectors: {} });

      await expect(
        workflow.run(input, {
          runId: "run-hunyuan-global",
          signal: new AbortController().signal,
          paths: {},
          artifactDir: tempDir,
          step: async () => undefined,
          event: async () => undefined,
          waitForManualAction: async (message, data) => {
            manualWaits.push({ message, data });
            slotState.back = "accepted";
          },
          addArtifact: async (artifact) => {
            const id = `artifact-${artifacts.length + 1}`;
            artifacts.push({ id, ...artifact });
            return { id };
          }
        })
      ).rejects.toThrow("stop after manual recovery");

      const backAttachCount = actions.filter((action) => action.kind === "attach-file" && String(action.selector).includes("hy-upload-card--back")).length;
      expect(backAttachCount).toBe(5);
      expect(manualWaits).toHaveLength(1);
      expect(manualWaits[0].message).toContain("repeatedly rejected the Back view");
      expect(manualWaits[0].data).toMatchObject({ slot: "back", attempts: 5, calibrationArtifactId: "artifact-1" });
      expect(artifacts[0]).toMatchObject({ kind: "json", metadata: expect.objectContaining({ phase: "slot-detection", slot: "back", attempts: 5 }) });
      expect(fs.existsSync(path.join(tempDir, "hunyuan-global-detection-failed-back.json"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 25_000);

  it("closes the BLINK-opened Hunyuan Global tab after workflow failure", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunyuan-global-failure-cleanup-"));
    const frontPath = path.join(tempDir, "front.png");
    const backPath = path.join(tempDir, "back.png");
    fs.writeFileSync(frontPath, "front");
    fs.writeFileSync(backPath, "back");

    try {
      const sdk = createWorkflowSdk() as any;
      const closedTabs: any[] = [];
      const events: any[] = [];
      sdk.extension.browser = {
        ...sdk.extension.browser,
        ensureRoutedTab: async () => ({
          id: "tab-1",
          url: "https://3d.hunyuanglobal.com/",
          title: "Hunyuan Global",
          status: "connected",
          protocolVersion: 6,
          extensionVersion: "0.1.8",
          compatible: true,
          lastSeenAt: new Date().toISOString(),
          openedByController: true,
          openedAction: "open-window",
          openedTabId: 42,
          openedWindowId: 7,
          openedControllerId: "controller-1"
        }),
        closeTab: async (tabId: number, options: unknown) => {
          closedTabs.push({ tabId, options });
          return { ok: true };
        },
        inspect: async () => ({ url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global" }),
        extract: async (_target: unknown, query: any) => (query.kind === "text" ? { text: "Image-to-3D Multiple Images" } : { visible: false }),
        action: async () => {
          throw new Error("primary workflow failure");
        }
      };

      const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
      if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
      const input = workflow.inputSchema.parse({ frontImage: frontPath, backImage: backPath });

      await expect(
        workflow.run(input, {
          runId: "run-hunyuan-global",
          signal: new AbortController().signal,
          paths: {},
          artifactDir: tempDir,
          step: async () => undefined,
          event: async (type, message, data) => {
            events.push({ type, message, data });
          },
          waitForManualAction: async () => {
            throw new Error("Manual action should not be required.");
          },
          addArtifact: async () => ({ id: "unused" })
        })
      ).rejects.toThrow("primary workflow failure");

      expect(closedTabs).toEqual([{ tabId: 42, options: { controllerId: "controller-1", timeoutMs: 20_000 } }]);
      expect(events).toContainEqual(expect.objectContaining({ type: "hunyuan-global.browser-cleanup" }));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not close an existing user-selected Hunyuan Global tab after workflow failure", async () => {
    const sdk = createWorkflowSdk() as any;
    sdk.extension.browser = {
      ...sdk.extension.browser,
      ensureRoutedTab: async () => ({
        id: "tab-1",
        url: "https://3d.hunyuanglobal.com/",
        title: "Hunyuan Global",
        status: "connected",
        protocolVersion: 6,
        extensionVersion: "0.1.8",
        compatible: true,
        lastSeenAt: new Date().toISOString()
      }),
      closeTab: async () => {
        throw new Error("Existing selected tabs must not be closed.");
      },
      inspect: async () => ({ url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global" }),
      extract: async (_target: unknown, query: any) => (query.kind === "text" ? { text: "Image-to-3D Multiple Images" } : { visible: false }),
      action: async () => {
        throw new Error("primary workflow failure");
      }
    };

    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
    if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
    const input = workflow.inputSchema.parse({
      frontImage: "C:\\tmp\\front.png",
      backImage: "C:\\tmp\\back.png",
      extensionTab: { mode: "existing", clientId: "tab-1" }
    });

    await expect(
      workflow.run(input, {
        runId: "run-hunyuan-global",
        signal: new AbortController().signal,
        paths: {},
        artifactDir: "C:\\tmp",
        step: async () => undefined,
        event: async () => undefined,
        waitForManualAction: async () => {
          throw new Error("Manual action should not be required.");
        },
        addArtifact: async () => ({ id: "unused" })
      })
    ).rejects.toThrow("primary workflow failure");
  });

  it("does not mask the original Hunyuan Global failure when tab cleanup fails", async () => {
    const sdk = createWorkflowSdk() as any;
    const events: any[] = [];
    sdk.extension.browser = {
      ...sdk.extension.browser,
      ensureRoutedTab: async () => ({
        id: "tab-1",
        url: "https://3d.hunyuanglobal.com/",
        title: "Hunyuan Global",
        status: "connected",
        protocolVersion: 6,
        extensionVersion: "0.1.8",
        compatible: true,
        lastSeenAt: new Date().toISOString(),
        openedByController: true,
        openedAction: "open-window",
        openedTabId: 42,
        openedWindowId: 7,
        openedControllerId: "controller-1"
      }),
      closeTab: async () => {
        throw new Error("cleanup failed");
      },
      inspect: async () => ({ url: "https://3d.hunyuanglobal.com/", title: "Hunyuan Global" }),
      extract: async (_target: unknown, query: any) => (query.kind === "text" ? { text: "Image-to-3D Multiple Images" } : { visible: false }),
      action: async () => {
        throw new Error("primary workflow failure");
      }
    };

    const workflow = createWorkflows(sdk).find((candidate) => candidate.manifest.id === HUNYUAN_GLOBAL_WORKFLOW_ID);
    if (!workflow) throw new Error("Expected Hunyuan Global workflow.");
    const input = workflow.inputSchema.parse({ frontImage: "C:\\tmp\\front.png", backImage: "C:\\tmp\\back.png" });

    await expect(
      workflow.run(input, {
        runId: "run-hunyuan-global",
        signal: new AbortController().signal,
        paths: {},
        artifactDir: "C:\\tmp",
        step: async () => undefined,
        event: async (type, message, data) => {
          events.push({ type, message, data });
        },
        waitForManualAction: async () => {
          throw new Error("Manual action should not be required.");
        },
        addArtifact: async () => ({ id: "unused" })
      })
    ).rejects.toThrow("primary workflow failure");

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "hunyuan-global.browser-cleanup-failed",
        data: expect.objectContaining({ error: "cleanup failed" })
      })
    );
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

  it("reports site-access guidance when Hunyuan Global opens but the routed page does not connect", async () => {
    const sdk = createWorkflowSdk() as any;
    const manualMessages: string[] = [];
    sdk.extension.browser = {
      ...sdk.extension.browser,
      status: () => ({
        compatible: 0,
        compatibleControllers: 1,
        connectedClients: [],
        connectedControllers: [{ id: "controller-1", compatible: true, diagnostics: { lastControllerCommand: { status: "completed" } } }],
        controllerCommandDiagnostics: { lastPollResult: "leased", lastCompletionStatus: "completed" }
      }),
      ensureRoutedTab: async () => {
        throw new Error(
          'Opened a routed BLINK browser window, but no compatible page client connected. openResult={"ok":true,"injection":{"injected":false,"reason":"Cannot access contents of url"}}'
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
        step: async () => undefined,
        event: async () => undefined,
        waitForManualAction: async (message) => {
          manualMessages.push(message);
        },
        addArtifact: async () => ({ id: "unused" })
      })
    ).rejects.toThrow("still requires manual action");

    expect(manualMessages[0]).toContain("could not connect to the routed page");
    expect(manualMessages[0]).toContain("site access");
    expect(manualMessages[0]).toContain("Cannot access contents of url");
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
