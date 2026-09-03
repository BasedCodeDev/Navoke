import { describe, expect, it } from "vitest";
import { appThemes, contrastRatio, resolveThemeId } from "../../src/renderer/lib/themes";

describe("theme registry", () => {
  it("defines unique theme ids with swatches", () => {
    const ids = appThemes.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("light");
    expect(ids).toContain("dark");
    expect(ids).toContain("based-code");
    expect(ids).toContain("graphite-lavender");
    expect(ids).toContain("tokyo-night-oled");
    expect(appThemes.every((theme) => theme.swatches.length >= 5)).toBe(true);
  });

  it("resolves persisted light and dark values for compatibility", () => {
    expect(resolveThemeId("light")).toBe("light");
    expect(resolveThemeId("dark")).toBe("dark");
    expect(resolveThemeId("matte-purple")).toBe("based-code");
    expect(resolveThemeId("codex-graphite")).toBe("graphite-lavender");
  });

  it("uses Based Code when no valid theme is stored", () => {
    expect(resolveThemeId("not-a-theme")).toBe("based-code");
    expect(resolveThemeId(null)).toBe("based-code");
    expect(resolveThemeId(undefined)).toBe("based-code");
  });

  it("keeps core surfaces readable", () => {
    for (const theme of appThemes) {
      expect(contrastRatio(theme.tokens.foreground, theme.tokens.background), theme.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.tokens.cardForeground, theme.tokens.card), theme.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.tokens.mutedForeground, theme.tokens.muted), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
