import { describe, expect, it } from "vitest";
import { resolveExtensionTabSelection } from "../../src/renderer/lib/extensionTabRouting";

describe("extension tab routing", () => {
  it("keeps a selected compatible tab", () => {
    expect(resolveExtensionTabSelection("tab-1", ["tab-1"], "__new__")).toBe("tab-1");
  });

  it("falls back to new routed tab when selection is stale", () => {
    expect(resolveExtensionTabSelection("missing", ["tab-1"], "__new__")).toBe("__new__");
  });
});
