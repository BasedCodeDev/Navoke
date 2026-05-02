import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

class MockElement {
  tagName: string;
  textContent: string;
  disabled?: boolean;
  visible: boolean;
  attrs: Record<string, string>;
  children: MockElement[];
  parent: MockElement | null = null;

  constructor(
    tagName: string,
    attrs: Record<string, string> = {},
    options: { text?: string; disabled?: boolean; visible?: boolean; children?: MockElement[] } = {}
  ) {
    this.tagName = tagName.toUpperCase();
    this.textContent = options.text ?? "";
    this.disabled = options.disabled;
    this.visible = options.visible ?? true;
    this.attrs = attrs;
    this.children = options.children ?? [];
    for (const child of this.children) child.parent = this;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  getBoundingClientRect(): { width: number; height: number } {
    return this.visible ? { width: 36, height: 36 } : { width: 0, height: 0 };
  }

  querySelectorAll(selector: string): MockElement[] {
    return queryElements(flattenDescendants(this), selector);
  }
}

class MockImageElement extends MockElement {
  currentSrc: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  alt: string;

  constructor(src: string, options: { width?: number; height?: number; alt?: string } = {}) {
    super("img", {});
    this.currentSrc = src;
    this.src = src;
    this.naturalWidth = options.width ?? 1024;
    this.naturalHeight = options.height ?? 1024;
    this.alt = options.alt ?? "";
  }
}

function mockElement(
  tagName: string,
  attrs: Record<string, string> = {},
  options: { text?: string; disabled?: boolean; visible?: boolean; children?: MockElement[] } = {}
): MockElement {
  return new MockElement(tagName, attrs, options);
}

function mockImage(src: string, options: { width?: number; height?: number; alt?: string } = {}): MockImageElement {
  return new MockImageElement(src, options);
}

function flattenElements(elements: MockElement[]): MockElement[] {
  return elements.flatMap((element) => [element, ...flattenDescendants(element)]);
}

function flattenDescendants(element: MockElement): MockElement[] {
  return element.children.flatMap((child) => [child, ...flattenDescendants(child)]);
}

function queryElements(elements: MockElement[], selector: string): MockElement[] {
  const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
  const matches = selectors.flatMap((part) => elements.filter((element) => matchesSelector(element, part)));
  return matches.filter((element, index, all) => all.indexOf(element) === index);
}

function matchesSelector(element: MockElement, selector: string): boolean {
  if (selector.includes(" ")) {
    const [ancestorSelector, childSelector] = selector.split(/\s+/, 2);
    return matchesSelector(element, childSelector) && hasAncestor(element, ancestorSelector);
  }
  if (selector === "button") return element.tagName === "BUTTON";
  if (selector === "textarea") return element.tagName === "TEXTAREA";
  if (selector === "img") return element.tagName === "IMG";
  if (selector === "article") return element.tagName === "ARTICLE";
  if (selector === "main") return element.tagName === "MAIN";
  if (selector === "[contenteditable='true']") return element.attrs.contenteditable === "true";
  if (selector === "[data-message-author-role='assistant']") return element.attrs["data-message-author-role"] === "assistant";
  if (selector === "#prompt-textarea") return element.attrs.id === "prompt-textarea";
  if (selector === "input[type='file']") return element.tagName === "INPUT" && element.attrs.type === "file";
  if (selector === "form button[type='submit']") return element.tagName === "BUTTON" && element.attrs.type === "submit";

  const buttonAttr = selector.match(/^button\[(data-testid|aria-label)=['"]([^'"]+)['"]\]$/);
  if (buttonAttr) {
    return element.tagName === "BUTTON" && element.attrs[buttonAttr[1]] === buttonAttr[2];
  }

  return false;
}

function hasAncestor(element: MockElement, selector: string): boolean {
  let current = element.parent;
  while (current) {
    if (matchesSelector(current, selector)) return true;
    current = current.parent;
  }
  return false;
}

function loadContentScript(elements: MockElement[]) {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const contentPath = path.resolve(testDir, "../../extension/chatgpt-controller/content.js");
  const source = readFileSync(contentPath, "utf8").replace(/\nvoid pollLoop\(\);\s*$/, "\n");
  const allElements = flattenElements(elements);
  const document = {
    body: { innerText: "" },
    images: allElements.filter((element) => element instanceof MockImageElement),
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      return queryElements(allElements, selector);
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
    HTMLImageElement: MockImageElement,
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
    collectNewOutputImageCandidates: (
      beforeState: { assistantCount: number; articleCount: number; imageFingerprints: Set<string>; outputCandidateCount?: number },
      selectors: Record<string, string>
    ) => MockImageElement[];
    selectSingleOutputImage: (images: MockImageElement[], subject: { name: string }) => MockImageElement;
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

  it("deduplicates repeated image elements by fingerprint", () => {
    const first = mockImage("https://chatgpt.test/output.png", { width: 512, height: 512 });
    const duplicate = mockImage("https://chatgpt.test/output.png", { width: 512, height: 512 });
    const assistant = mockElement("article", { "data-message-author-role": "assistant" }, { children: [first, duplicate] });
    const content = loadContentScript([assistant]);

    const candidates = content.collectNewOutputImageCandidates(
      { assistantCount: 0, articleCount: 0, imageFingerprints: new Set() },
      {}
    );

    expect(candidates).toEqual([first]);
  });

  it("ignores earlier assistant images when a newer assistant response exists", () => {
    const oldImage = mockImage("https://chatgpt.test/old.png");
    const newImage = mockImage("https://chatgpt.test/new.png");
    const oldAssistant = mockElement("article", { "data-message-author-role": "assistant" }, { children: [oldImage] });
    const newAssistant = mockElement("article", { "data-message-author-role": "assistant" }, { children: [newImage] });
    const content = loadContentScript([oldAssistant, newAssistant]);

    const candidates = content.collectNewOutputImageCandidates(
      { assistantCount: 1, articleCount: 0, imageFingerprints: new Set() },
      {}
    );

    expect(candidates).toEqual([newImage]);
  });

  it("uses candidate order when ChatGPT reuses one broad assistant container", () => {
    const oldImage = mockImage("https://chatgpt.test/old.png", { alt: "Generated image" });
    const newImage = mockImage("https://chatgpt.test/new.png", { alt: "Generated image" });
    const broadAssistant = mockElement("div", { "data-message-author-role": "assistant" }, { children: [oldImage, newImage] });
    const content = loadContentScript([mockElement("main", {}, { children: [broadAssistant] })]);

    const candidates = content.collectNewOutputImageCandidates(
      {
        assistantCount: 1,
        articleCount: 0,
        imageFingerprints: new Set(["https://chatgpt.test/old.png|1024x1024"]),
        outputCandidateCount: 1
      },
      {}
    );

    expect(candidates).toEqual([newImage]);
  });

  it("does not treat a volatile prior output URL as a current output candidate", () => {
    const oldImageWithNewSignedUrl = mockImage("https://chatgpt.test/old-resigned.png", { alt: "Generated image" });
    const newImage = mockImage("https://chatgpt.test/new.png", { alt: "Generated image" });
    const broadAssistant = mockElement("div", { "data-message-author-role": "assistant" }, { children: [oldImageWithNewSignedUrl, newImage] });
    const content = loadContentScript([mockElement("main", {}, { children: [broadAssistant] })]);

    const candidates = content.collectNewOutputImageCandidates(
      {
        assistantCount: 1,
        articleCount: 0,
        imageFingerprints: new Set(["https://chatgpt.test/old-original.png|1024x1024"]),
        outputCandidateCount: 1
      },
      {}
    );

    expect(candidates).toEqual([newImage]);
  });

  it("excludes uploaded prompt images from output candidates", () => {
    const uploadedImage = mockImage("https://chatgpt.test/uploaded.png", { alt: "Uploaded image" });
    const generatedImage = mockImage("https://chatgpt.test/generated.png", { alt: "Generated image" });
    const mixedArticle = mockElement("article", {}, { children: [uploadedImage, generatedImage] });
    const content = loadContentScript([mixedArticle]);

    const candidates = content.collectNewOutputImageCandidates(
      { assistantCount: 0, articleCount: 0, imageFingerprints: new Set() },
      {}
    );

    expect(candidates).toEqual([generatedImage]);
  });

  it("accepts exactly one output image candidate", () => {
    const output = mockImage("https://chatgpt.test/output.png");
    const content = loadContentScript([]);

    expect(content.selectSingleOutputImage([output], { name: "subject.png" })).toBe(output);
  });

  it("accepts one generated output when an uploaded image is also present", () => {
    const uploadedImage = mockImage("https://chatgpt.test/uploaded.png", { alt: "Uploaded image" });
    const generatedImage = mockImage("https://chatgpt.test/generated.png", { alt: "Generated image" });
    const content = loadContentScript([]);

    expect(content.selectSingleOutputImage([uploadedImage, generatedImage], { name: "subject.png" })).toBe(generatedImage);
  });

  it("rejects multiple distinct output image candidates", () => {
    const content = loadContentScript([]);

    expect(() =>
      content.selectSingleOutputImage(
        [mockImage("https://chatgpt.test/first.png"), mockImage("https://chatgpt.test/second.png")],
        { name: "subject.png" }
      )
    ).toThrow("exactly one result per subject");
  });

  it("rejects multiple generated images appended after the baseline", () => {
    const oldImage = mockImage("https://chatgpt.test/old.png", { alt: "Generated image" });
    const firstNewImage = mockImage("https://chatgpt.test/first-new.png", { alt: "Generated image" });
    const secondNewImage = mockImage("https://chatgpt.test/second-new.png", { alt: "Generated image" });
    const broadAssistant = mockElement("div", { "data-message-author-role": "assistant" }, { children: [oldImage, firstNewImage, secondNewImage] });
    const content = loadContentScript([mockElement("main", {}, { children: [broadAssistant] })]);

    const candidates = content.collectNewOutputImageCandidates(
      {
        assistantCount: 1,
        articleCount: 0,
        imageFingerprints: new Set(["https://chatgpt.test/old.png|1024x1024"]),
        outputCandidateCount: 1
      },
      {}
    );

    expect(candidates).toEqual([firstNewImage, secondNewImage]);
    expect(() => content.selectSingleOutputImage(candidates, { name: "subject.png" })).toThrow("exactly one result per subject");
  });
});
