import { describe, expect, it } from "vitest";
import { appFonts, resolveFontId } from "../../src/renderer/lib/fonts";

describe("font registry", () => {
  it("defines unique font ids", () => {
    const ids = appFonts.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("jetbrains-mono");
  });

  it("resolves persisted font values", () => {
    expect(resolveFontId("jetbrains-mono")).toBe("jetbrains-mono");
    expect(resolveFontId("system")).toBe("system");
  });

  it("falls back to the default app font for invalid values", () => {
    expect(resolveFontId("not-a-font")).toBe("inter");
    expect(resolveFontId(null)).toBe("inter");
    expect(resolveFontId(undefined)).toBe("inter");
  });

  it("includes concrete CSS font stacks", () => {
    for (const font of appFonts) {
      expect(font.family.trim().length, font.id).toBeGreaterThan(0);
    }
  });
});
