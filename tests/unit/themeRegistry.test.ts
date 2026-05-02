import { describe, expect, it } from "vitest";
import { appThemes, contrastRatio, resolveThemeId } from "../../src/renderer/lib/themes";

describe("theme registry", () => {
  it("defines unique theme ids with swatches", () => {
    const ids = appThemes.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("light");
    expect(ids).toContain("dark");
    expect(ids).toContain("tokyo-night-oled");
    expect(appThemes.every((theme) => theme.swatches.length >= 5)).toBe(true);
  });

  it("resolves persisted light and dark values for compatibility", () => {
    expect(resolveThemeId("light", true)).toBe("light");
    expect(resolveThemeId("dark", false)).toBe("dark");
  });

  it("falls back to system preference for invalid stored values", () => {
    expect(resolveThemeId("not-a-theme", true)).toBe("dark");
    expect(resolveThemeId("not-a-theme", false)).toBe("light");
    expect(resolveThemeId(null, true)).toBe("dark");
    expect(resolveThemeId(undefined, false)).toBe("light");
  });

  it("keeps core surfaces readable", () => {
    for (const theme of appThemes) {
      expect(contrastRatio(theme.tokens.foreground, theme.tokens.background), theme.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.tokens.cardForeground, theme.tokens.card), theme.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.tokens.mutedForeground, theme.tokens.muted), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
