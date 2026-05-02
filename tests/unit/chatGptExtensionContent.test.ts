import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface MockElement {
  tagName: string;
  textContent: string;
  disabled?: boolean;
  visible: boolean;
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number };
}

function mockElement(
  tagName: string,
  attrs: Record<string, string> = {},
  options: { text?: string; disabled?: boolean; visible?: boolean } = {}
): MockElement {
  return {
    tagName: tagName.toUpperCase(),
    textContent: options.text ?? "",
    disabled: options.disabled,
    visible: options.visible ?? true,
    attrs,
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    getBoundingClientRect() {
      return this.visible ? { width: 36, height: 36 } : { width: 0, height: 0 };
    }
  };
}

function matchesSelector(element: MockElement, selector: string): boolean {
  if (selector === "button") return element.tagName === "BUTTON";
  if (selector === "textarea") return element.tagName === "TEXTAREA";
  if (selector === "[contenteditable='true']") return element.attrs.contenteditable === "true";
  if (selector === "#prompt-textarea") return element.attrs.id === "prompt-textarea";
  if (selector === "input[type='file']") return element.tagName === "INPUT" && element.attrs.type === "file";
  if (selector === "form button[type='submit']") return element.tagName === "BUTTON" && element.attrs.type === "submit";

  const buttonAttr = selector.match(/^button\[(data-testid|aria-label)=['"]([^'"]+)['"]\]$/);
  if (buttonAttr) {
    return element.tagName === "BUTTON" && element.attrs[buttonAttr[1]] === buttonAttr[2];
  }

  return false;
}

function loadContentScript(elements: MockElement[]) {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const contentPath = path.resolve(testDir, "../../extension/chatgpt-controller/content.js");
  const source = readFileSync(contentPath, "utf8").replace(/\nvoid pollLoop\(\);\s*$/, "\n");
  const document = {
    body: { innerText: "" },
    images: [],
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      return elements.filter((element) => matchesSelector(element, selector));
    }
  };
  const context = {
    chrome: {
      runtime: { getManifest: () => ({ version: "test" }) },
      storage: { local: { get: (_keys: string[], callback: (value: Record<string, unknown>) => void) => callback({}) } }
    },
    crypto: { randomUUID: () => "test-client" },
    sessionStorage: {
      getItem: () => null,
      setItem: () => undefined
    },
    location: { search: "", hash: "", href: "https://chatgpt.com/", pathname: "/" },
    history: { replaceState: () => undefined, state: null },
    URL,
    URLSearchParams,
    document,
    getComputedStyle: (element: MockElement) => ({
      visibility: element.visible ? "visible" : "hidden",
      display: element.visible ? "block" : "none"
    }),
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(source, context);
  return context as typeof context & {
    findStopButton: (selectors: Record<string, string>) => MockElement | null;
    collectChatGptSubmitReadyState: (selectors: Record<string, string>) => { stopButtonVisible: boolean; stopButtonLabel: string | null };
    evaluateChatGptSubmitReadyState: (state: unknown) => { satisfied: boolean; reason: string };
  };
}

describe("ChatGPT extension content predicates", () => {
  it("does not treat historical Stopped thinking controls as active stop buttons", () => {
    const composer = mockElement("div", { id: "prompt-textarea", contenteditable: "true" });
    const send = mockElement("button", { "data-testid": "send-button", "aria-label": "Send prompt" });
    const stoppedThinking = mockElement("button", {}, { text: "Stopped thinking" });
    const fileInput = mockElement("input", { type: "file" });
    const content = loadContentScript([composer, send, stoppedThinking, fileInput]);

    expect(content.findStopButton({})).toBeNull();
    expect(content.collectChatGptSubmitReadyState({})).toMatchObject({
      stopButtonVisible: false,
      stopButtonLabel: null
    });
    expect(content.evaluateChatGptSubmitReadyState(content.collectChatGptSubmitReadyState({}))).toMatchObject({
      satisfied: true,
      reason: "ChatGPT submit button is ready."
    });
  });

  it("detects the active composer stop button by stable selector", () => {
    const stop = mockElement("button", { "data-testid": "stop-button" });
    const content = loadContentScript([stop]);

    expect(content.findStopButton({})).toBe(stop);
  });
});
