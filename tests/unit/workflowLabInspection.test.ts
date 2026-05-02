import { describe, expect, it } from "vitest";
import {
  buildInteractiveElements,
  buildSelectorCandidates,
  sanitizeDomSnapshot,
  sanitizeText,
  type LabRawDomNode,
  type LabRawInteractiveElement
} from "../../src/main/lab/pageInspection";

describe("Workflow Lab page inspection helpers", () => {
  it("sanitizes DOM snapshots without scripts, control characters, or unbounded depth", () => {
    const raw: LabRawDomNode = {
      tagName: "body",
      text: "",
      children: [
        { tagName: "script", text: "alert('x')" },
        {
          tagName: "main",
          text: "Visible\u0001 text    with   spacing",
          children: [
            {
              tagName: "button",
              text: "Generate image",
              id: "send"
            }
          ]
        }
      ]
    };

    const snapshot = sanitizeDomSnapshot(raw, { maxDepth: 2, maxNodes: 10 });

    expect(snapshot?.children).toHaveLength(1);
    expect(snapshot?.children?.[0]).toMatchObject({
      tagName: "main",
      text: "Visible text with spacing"
    });
    expect(sanitizeText("a\n\nb\tc")).toBe("a b c");
  });

  it("builds stable selector candidates from semantic attributes first", () => {
    const element: LabRawInteractiveElement = {
      tagName: "button",
      text: "Send",
      id: "send prompt",
      ariaLabel: "Send prompt",
      attributes: {
        id: "send prompt",
        "data-testid": "send-button",
        class: "css-123 Button_root"
      }
    };

    const selectors = buildSelectorCandidates(element);

    expect(selectors[0]).toMatchObject({ selector: "#send\\ prompt", source: "id" });
    expect(selectors.some((candidate) => candidate.selector === '[data-testid="send-button"]')).toBe(true);
    expect(selectors.some((candidate) => candidate.engine === "role")).toBe(false);
  });

  it("normalizes interactive elements with selector candidates", () => {
    const [element] = buildInteractiveElements([
      {
        tagName: "input",
        type: "file",
        visible: true,
        attributes: { type: "file", name: "upload" }
      }
    ]);

    expect(element.label).toBe("upload");
    expect(element.selectors.map((candidate) => candidate.selector)).toContain('input[type="file"]');
  });
});
