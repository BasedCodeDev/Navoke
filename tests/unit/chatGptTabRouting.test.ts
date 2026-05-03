import { describe, expect, it } from "vitest";
import { resolveChatGptTabSelection } from "../../src/renderer/lib/chatGptTabRouting";

describe("ChatGPT tab routing selection", () => {
  const newTabValue = "__new__";

  it("defaults to a new tab when no tab is selected", () => {
    expect(resolveChatGptTabSelection("", ["tab-1"], newTabValue)).toBe(newTabValue);
  });

  it("preserves an explicitly selected compatible tab", () => {
    expect(resolveChatGptTabSelection("tab-1", ["tab-1", "tab-2"], newTabValue)).toBe("tab-1");
  });

  it("falls back to a new tab when the selected tab is stale", () => {
    expect(resolveChatGptTabSelection("missing-tab", ["tab-1"], newTabValue)).toBe(newTabValue);
  });
});
