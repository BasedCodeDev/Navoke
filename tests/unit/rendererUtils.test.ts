import { describe, expect, it } from "vitest";
import { isMotionActiveStatus } from "../../src/renderer/lib/utils";

describe("renderer status motion helpers", () => {
  it("marks only work-in-progress states as motion active", () => {
    expect(isMotionActiveStatus("queued")).toBe(true);
    expect(isMotionActiveStatus("running")).toBe(true);
    expect(isMotionActiveStatus("pausing")).toBe(true);
  });

  it("keeps manual, terminal, and unknown states static", () => {
    expect(isMotionActiveStatus("waiting_manual")).toBe(false);
    expect(isMotionActiveStatus("completed")).toBe(false);
    expect(isMotionActiveStatus("failed")).toBe(false);
    expect(isMotionActiveStatus("cancelled")).toBe(false);
    expect(isMotionActiveStatus("unknown")).toBe(false);
  });
});
