import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("generic browser extension content script", () => {
  const extensionDir = path.resolve(__dirname, "../../extension");

  it("does not ship site-specific hostnames or task kinds", () => {
    const files = ["content.js", "background.js", "popup.js", "manifest.json"].map((file) =>
      fs.readFileSync(path.join(extensionDir, file), "utf8")
    );
    const combined = files.join("\n");
    expect(combined).not.toMatch(/chatgpt\.com|chat\.openai\.com|hunyuanglobal|hunyuan\.tencent/i);
    expect(combined).not.toMatch(/chatgpt-image-transform|hunyuan-global-login-check/i);
    expect(combined).not.toMatch(/messageRole|data-message-author-role/i);
  });

  it("exposes only generic command routes", () => {
    const content = fs.readFileSync(path.join(extensionDir, "content.js"), "utf8");
    expect(content).toContain("/api/extension/commands/next");
    expect(content).toContain("performAction");
    expect(content).toContain("waitForCondition");
    expect(content).toContain("extract");
    expect(content).not.toContain("/api/extension/tasks/");
  });

  it("uses broad manifest coverage for plugin-owned sites", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8")) as {
      name: string;
      host_permissions: string[];
      content_scripts: Array<{ matches: string[]; run_at?: string }>;
    };
    expect(manifest.name).toBe("Based BLINK Browser Controller");
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(manifest.content_scripts[0].matches).toEqual(["<all_urls>"]);
    expect(manifest.content_scripts[0].run_at).toBe("document_start");
  });

  it("remembers a routed tab token after the site removes it from the URL", () => {
    const harness = loadContentScriptHarness(createFakeElement({ isContentEditable: true }));

    expect(harness.routingTokenForHeartbeat()).toBe("token");
    harness.location.href = "https://example.test/conversation/123";
    harness.location.hash = "";

    expect(harness.routingTokenForHeartbeat()).toBe("token");
  });

  it("reports background controller heartbeat diagnostics with tab heartbeats", async () => {
    const heartbeatBodies: Array<Record<string, unknown>> = [];
    const harness = loadContentScriptHarness(createFakeElement({ isContentEditable: true }), {
      runtimeSendMessage: async (message) => {
        if ((message as { type?: string }).type === "current-tab-info") return { ok: true, controllerId: "controller-1", tabId: 42, windowId: 7 };
        if ((message as { type?: string }).type === "controller-heartbeat") {
          return { ok: true, controllerHeartbeat: { ok: true, controllerId: "controller-1" } };
        }
        return { ok: true };
      },
      fetch: async (_url, options) => {
        heartbeatBodies.push(JSON.parse(String((options as { body?: string })?.body ?? "{}")));
        return { status: 204, ok: true, text: async () => "" };
      }
    });

    await harness.heartbeat();

    expect(heartbeatBodies[0]).toMatchObject({
      controllerId: "controller-1",
      tabId: 42,
      windowId: 7,
      controllerHeartbeatOk: true
    });
  });

  it("surfaces background controller heartbeat failures with tab heartbeats", async () => {
    const heartbeatBodies: Array<Record<string, unknown>> = [];
    const harness = loadContentScriptHarness(createFakeElement({ isContentEditable: true }), {
      runtimeSendMessage: async (message) => {
        if ((message as { type?: string }).type === "controller-heartbeat") {
          return { ok: false, controllerHeartbeat: { ok: false, error: "background controller failed" } };
        }
        return { ok: true };
      },
      fetch: async (_url, options) => {
        heartbeatBodies.push(JSON.parse(String((options as { body?: string })?.body ?? "{}")));
        return { status: 204, ok: true, text: async () => "" };
      }
    });

    await harness.heartbeat();

    expect(heartbeatBodies[0]).toMatchObject({
      controllerHeartbeatOk: false,
      controllerHeartbeatError: "background controller failed"
    });
  });

  it("fills contenteditable elements through browser text insertion and dispatches editor events", async () => {
    const insertedText: Array<{ command: string; value: string }> = [];
    const events: string[] = [];
    const element = createFakeElement({
      isContentEditable: true,
      dispatchEvent: (event) => events.push(event.type),
      onExecCommand: (value) => {
        element.textContent = value;
      }
    });
    const harness = loadContentScriptHarness(element, {
      execCommand(command, _showUi, value) {
        insertedText.push({ command, value: String(value ?? "") });
        element.execCommand(String(value ?? ""));
        return true;
      }
    });

    const result = await harness.performAction({ kind: "fill", selector: "#composer", value: "Make this image cinematic" });

    expect(result).toMatchObject({ ok: true, action: "fill", selector: "#composer", valueLength: 25, observedLength: 25, method: "insertText" });
    expect(insertedText).toEqual([{ command: "insertText", value: "Make this image cinematic" }]);
    expect(events).toEqual(["input", "change"]);
  });

  it("chooses the first visible enabled fillable element when selectors match hidden duplicates", async () => {
    const hidden = createFakeElement({ isContentEditable: true, visible: false });
    const visible = createFakeElement({
      isContentEditable: true,
      onExecCommand: (value) => {
        visible.textContent = value;
      }
    });
    const harness = loadContentScriptHarness([hidden, visible], {
      execCommand(_command, _showUi, value) {
        visible.execCommand(String(value ?? ""));
        return true;
      }
    });

    const result = await harness.performAction({ kind: "fill", selector: "[contenteditable='true']", value: "Visible editor text" });

    expect(result).toMatchObject({
      ok: true,
      selector: "[contenteditable='true']",
      candidateCount: 2,
      chosen: expect.objectContaining({ id: "visible-editor" }),
      observedLength: 19
    });
    expect(hidden.textContent).toBe("old");
    expect(visible.textContent).toBe("Visible editor text");
  });

  it("clears existing contenteditable text before insertion and reports the observed text length", async () => {
    const element = createFakeElement({
      isContentEditable: true,
      textContent: "Existing placeholder",
      onExecCommand: (value) => {
        expect(element.textContent).toBe("");
        element.textContent = value;
      }
    });
    const harness = loadContentScriptHarness(element, {
      execCommand(_command, _showUi, value) {
        element.execCommand(String(value ?? ""));
        return true;
      }
    });

    const result = await harness.performAction({ kind: "fill", selector: "#composer", value: "Replacement prompt" });

    expect(result).toMatchObject({ valueLength: 18, observedLength: 18, method: "insertText" });
    expect(element.textContent).toBe("Replacement prompt");
  });

  it("falls back when contenteditable insertion reports success without changing observed text", async () => {
    const events: string[] = [];
    const element = createFakeElement({
      isContentEditable: true,
      textContent: "placeholder",
      dispatchEvent: (event) => events.push(event.type)
    });
    const harness = loadContentScriptHarness(element, {
      execCommand() {
        return true;
      }
    });

    const result = await harness.performAction({ kind: "fill", selector: "#composer", value: "Fallback prompt" });

    expect(result).toMatchObject({ valueLength: 15, observedLength: 15, method: "fallback-textContent" });
    expect(element.textContent).toBe("Fallback prompt");
    expect(events).toEqual(["input", "change"]);
  });

  it("fills value elements through the native value setter path", async () => {
    const nativeSetValues: string[] = [];
    class FakeInput {
      ownValue = "";
      isContentEditable = false;
      focusCount = 0;
      events: string[] = [];

      get value(): string {
        return this.ownValue;
      }

      set value(value: string) {
        nativeSetValues.push(value);
        this.ownValue = value;
      }

      focus(): void {
        this.focusCount += 1;
      }

      dispatchEvent(event: { type: string }): void {
        this.events.push(event.type);
      }

      getBoundingClientRect(): { width: number; height: number; x: number; y: number } {
        return { width: 120, height: 40, x: 0, y: 0 };
      }

      getAttribute(): string | null {
        return null;
      }

      tagName = "TEXTAREA";
      id = "textarea";
    }
    const element = new FakeInput();
    const harness = loadContentScriptHarness(element);

    const result = await harness.performAction({ kind: "fill", selector: "textarea", value: "Prompt that must reach the browser" });

    expect(result).toMatchObject({ ok: true, action: "fill", selector: "textarea", valueLength: 34, observedLength: 34, method: "native-value-setter" });
    expect(nativeSetValues).toEqual(["Prompt that must reach the browser"]);
    expect(element.events).toEqual(["input", "change"]);
  });

  it("reports element state from the first visible selector match", async () => {
    const hidden = createFakeElement({ isContentEditable: false, visible: false, id: "hidden-button" });
    const visible = createFakeElement({ isContentEditable: false, visible: true, id: "visible-button", textContent: "Send" });
    const harness = loadContentScriptHarness([hidden, visible]);

    const result = await harness.extract({ kind: "element-state", selector: "button" });

    expect(result).toMatchObject({
      count: 2,
      visibleCount: 1,
      enabledCount: 2,
      visible: true,
      disabled: false,
      text: "Send"
    });
  });

  it("clicks the first visible enabled selector match", async () => {
    const clicked: string[] = [];
    const hidden = createFakeElement({ isContentEditable: false, visible: false, id: "hidden-button", onClick: () => clicked.push("hidden") });
    const visible = createFakeElement({ isContentEditable: false, visible: true, id: "visible-button", onClick: () => clicked.push("visible") });
    const harness = loadContentScriptHarness([hidden, visible]);

    const result = await harness.performAction({ kind: "click", selector: "button" });

    expect(result).toMatchObject({ ok: true, action: "click", selector: "button", candidateCount: 2, visibleCount: 1, enabledCount: 2 });
    expect(clicked).toEqual(["visible"]);
  });

  it("clicks the first visible enabled selector match with matching text", async () => {
    const clicked: string[] = [];
    const earlier = createFakeElement({ isContentEditable: false, visible: true, id: "earlier-button", textContent: "Learn More", onClick: () => clicked.push("earlier") });
    const startUsing = createFakeElement({ isContentEditable: false, visible: true, id: "start-button", textContent: "Start Using", onClick: () => clicked.push("start") });
    const harness = loadContentScriptHarness([earlier, startUsing]);

    const result = await harness.performAction({ kind: "click", selector: "button, a, [role='button']", text: "start using" });

    expect(result).toMatchObject({
      ok: true,
      action: "click",
      candidateCount: 2,
      text: "start using",
      textMatch: "contains",
      caseSensitive: false,
      textMatchCount: 1
    });
    expect(clicked).toEqual(["start"]);
  });

  it("ignores hidden or disabled text matches when clicking by text", async () => {
    const clicked: string[] = [];
    const hidden = createFakeElement({ isContentEditable: false, visible: false, textContent: "Start Using", onClick: () => clicked.push("hidden") });
    const disabled = createFakeElement({ isContentEditable: false, visible: true, disabled: true, textContent: "Start Using", onClick: () => clicked.push("disabled") });
    const visible = createFakeElement({ isContentEditable: false, visible: true, textContent: "Start Using Now", onClick: () => clicked.push("visible") });
    const harness = loadContentScriptHarness([hidden, disabled, visible]);

    const result = await harness.performAction({ kind: "click", selector: "button, a, [role='button']", text: "Start Using" });

    expect(result).toMatchObject({ candidateCount: 3, textMatchCount: 3, visibleCount: 2, enabledCount: 2 });
    expect(clicked).toEqual(["visible"]);
  });

  it("reports diagnostics when text-filtered click cannot find a visible enabled match", async () => {
    const hidden = createFakeElement({ isContentEditable: false, visible: false, textContent: "Start Using" });
    const disabled = createFakeElement({ isContentEditable: false, visible: true, disabled: true, textContent: "Start Using" });
    const harness = loadContentScriptHarness([hidden, disabled]);

    await expect(harness.performAction({ kind: "click", selector: "button, a, [role='button']", text: "Start Using" })).rejects.toThrow(
      "candidates=2; textMatches=2; visible=1; enabled=1"
    );
  });

  it("extracts image context and stable source ids without site-specific logic", async () => {
    const image = createFakeImageElement({
      src: "https://images.example.test/content?id=file_1234567890abcdef&sig=old",
      alt: "Generated image",
      parent: createFakeDomAncestor({
        tagName: "DIV",
        textContent: "Assistant produced an image",
        attributes: {
          role: "article",
          "data-example-owner": "assistant",
          "aria-label": "Assistant response"
        }
      })
    });
    const harness = loadContentScriptHarness(image);

    const result = await harness.extract({ kind: "images", selector: "img", minWidth: 128, minHeight: 128 });

    expect(result).toMatchObject({
      images: [
        expect.objectContaining({
          alt: "Generated image",
          stableSourceId: "id:file_1234567890abcdef",
          domIndex: 0,
          insideForm: false,
          insideEditable: false,
          ancestor: expect.objectContaining({
            tagName: "div",
            role: "article",
            ariaLabel: "Assistant response",
            text: "Assistant produced an image",
            attributes: expect.objectContaining({ "data-example-owner": "assistant" })
          })
        })
      ]
    });
  });
});

function loadContentScriptHarness(
  elementOrElements: unknown | unknown[],
  options: {
    execCommand?(command: string, showUi: boolean, value: unknown): boolean;
    runtimeSendMessage?(message: unknown): Promise<unknown>;
    fetch?(url: string, options?: unknown): Promise<{ status: number; ok: boolean; text(): Promise<string> }>;
  } = {}
): {
  performAction(action: unknown): Promise<unknown>;
  extract(query: unknown): Promise<unknown>;
  heartbeat(): Promise<void>;
  routingTokenForHeartbeat(): string | undefined;
  location: { href: string; search: string; hash: string };
} {
  const content = fs.readFileSync(path.join(path.resolve(__dirname, "../../extension"), "content.js"), "utf8");
  const storage = new Map<string, string>();
  const elements = Array.isArray(elementOrElements) ? elementOrElements : [elementOrElements];
  const context = {
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.1.0" }),
        sendMessage: options.runtimeSendMessage ?? (async () => ({ ok: true }))
      }
    },
    crypto: {
      randomUUID: () => "client-test"
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    },
    location: {
      href: "https://example.test/#based-blink-tab=token",
      search: "",
      hash: "#based-blink-tab=token"
    },
    document: {
      title: "Test page",
      body: { innerText: "", textContent: "" },
      querySelector: () => elements[0] ?? null,
      querySelectorAll: () => elements,
      createRange: () => ({
        selectNodeContents: (element: { textContent?: string }) => {
          element.textContent = "";
        }
      }),
      execCommand: options.execCommand ?? (() => false)
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    HTMLImageElement: Object,
    InputEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    Event: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    File: class {},
    FileReader: class {},
    fetch:
      options.fetch ??
      (async () => {
        throw new Error("No API server in unit test.");
      }),
    setInterval: () => 0,
    getSelection: () => ({
      removeAllRanges: () => undefined,
      addRange: () => undefined
    }),
    URLSearchParams,
    URL,
    console
  };
  vm.runInNewContext(content, context);
  const testApi = (context as unknown as {
    __BasedBlinkBrowserControllerTest: {
      performAction(action: unknown): Promise<unknown>;
      extract(query: unknown): Promise<unknown>;
      heartbeat(): Promise<void>;
      routingTokenForHeartbeat(): string | undefined;
    };
  }).__BasedBlinkBrowserControllerTest;
  return {
    ...testApi,
    location: context.location
  } as {
    performAction(action: unknown): Promise<unknown>;
    extract(query: unknown): Promise<unknown>;
    heartbeat(): Promise<void>;
    routingTokenForHeartbeat(): string | undefined;
    location: { href: string; search: string; hash: string };
  };
}

function createFakeDomAncestor(input: {
  tagName: string;
  textContent?: string;
  attributes?: Record<string, string>;
  parentElement?: unknown;
}): {
  tagName: string;
  textContent: string;
  innerText: string;
  parentElement?: unknown;
  attributes: Array<{ name: string; value: string }>;
  getAttribute(name: string): string | null;
} {
  const attributes = input.attributes ?? {};
  return {
    tagName: input.tagName,
    textContent: input.textContent ?? "",
    innerText: input.textContent ?? "",
    parentElement: input.parentElement,
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    getAttribute: (name) => attributes[name] ?? null
  };
}

function createFakeImageElement(input: {
  src: string;
  alt?: string;
  parent?: ReturnType<typeof createFakeDomAncestor>;
}): {
  currentSrc: string;
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  parentElement?: ReturnType<typeof createFakeDomAncestor>;
  attributes: Array<{ name: string; value: string }>;
  getBoundingClientRect(): { width: number; height: number; x: number; y: number };
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
} {
  return {
    currentSrc: input.src,
    src: input.src,
    alt: input.alt ?? "",
    naturalWidth: 512,
    naturalHeight: 512,
    parentElement: input.parent,
    attributes: [],
    getBoundingClientRect: () => ({ width: 256, height: 256, x: 10, y: 20 }),
    getAttribute: () => null,
    closest: (selector) => {
      if (selector === "form" || selector.includes("contenteditable") || selector.includes("button") || selector.includes("a[href]")) {
        return null;
      }
      return null;
    }
  };
}

function createFakeElement(input: {
  isContentEditable: boolean;
  visible?: boolean;
  disabled?: boolean;
  id?: string;
  textContent?: string;
  onExecCommand?(value: string): void;
  onClick?(): void;
  dispatchEvent?(event: { type: string }): void;
}): {
  isContentEditable: boolean;
  id: string;
  textContent: string;
  focus(): void;
  click(): void;
  execCommand(value: string): void;
  getBoundingClientRect(): { width: number; height: number; x: number; y: number };
  getAttribute(name: string): string | null;
  tagName: string;
  role: string;
  dispatchEvent(event: { type: string }): void;
} {
  const visible = input.visible ?? true;
  return {
    isContentEditable: input.isContentEditable,
    id: input.id ?? (visible ? "visible-editor" : "hidden-editor"),
    textContent: input.textContent ?? "old",
    disabled: input.disabled ?? false,
    tagName: "DIV",
    role: "textbox",
    focus: () => undefined,
    click: () => input.onClick?.(),
    execCommand: (value) => input.onExecCommand?.(value),
    getBoundingClientRect: () => ({ width: visible ? 120 : 0, height: visible ? 40 : 0, x: 0, y: 0 }),
    getAttribute: (name) => (name === "aria-disabled" && input.disabled ? "true" : name === "role" ? "textbox" : null),
    dispatchEvent: input.dispatchEvent ?? (() => undefined)
  } as {
    isContentEditable: boolean;
    id: string;
    textContent: string;
    disabled: boolean;
    tagName: string;
    role: string;
    focus(): void;
    click(): void;
    execCommand(value: string): void;
    getBoundingClientRect(): { width: number; height: number; x: number; y: number };
    getAttribute(name: string): string | null;
    dispatchEvent(event: { type: string }): void;
  };
}
