import { describe, expect, it } from "vitest";
import {
  buildHunyuanViewUploadPlan,
  clickHunyuanActionButton,
  clickHunyuanGenerateButton,
  clickVisibleHunyuanControl,
  inferHunyuanArtifactKind,
  mergeHunyuanSelectorConfig,
  missingHunyuanSelectorKeys
} from "../../plugins/based-blink-hunyuan/src";

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
    expect(selectors.geometryReadySelector).toContain(":not(.t-is-disabled):not([disabled])");
    expect(selectors.retopologyTypeButtons?.quad).toContain(".model-dialog__content__operation__heading");
    expect(selectors.retopologyTypeButtons?.quad).toContain(".topology-panel .qaUJkqcCF813NIqHGF3U");
    expect(selectors.retopologyTypeButtons?.quad).toContain(".qaUJkqcCF813NIqHGF3U:visible:has-text(\"四边面\")");
    expect(selectors.retopologyTypeButtons?.quad).not.toContain(":is(button, .t-button)");
    expect(selectors.exportFormatDropdown).toBe("button.download__dropdown__btn");
    expect(selectors.exportFormatOptions?.obj).toBe('.download__dropdown li.t-dropdown__item:has-text("OBJ")');
    expect(selectors.smartRetopologyButton).toContain(":not(.t-is-disabled):not([disabled])");
    expect(selectors.generateTextureButton).toContain(":not(.t-is-disabled):not([disabled])");
    expect(selectors.downloadButton).toContain(":not(.t-is-disabled):not([disabled])");
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
    expect(inferHunyuanArtifactKind("model.zip", () => "application/zip")).toBe("download");
  });
});

class FakeHunyuanPage {
  constructor(private readonly nodes: FakeHunyuanLocatorNode[]) {}

  locator(): FakeHunyuanLocatorGroup {
    return new FakeHunyuanLocatorGroup(this.nodes);
  }

  async waitForTimeout(): Promise<void> {}
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
