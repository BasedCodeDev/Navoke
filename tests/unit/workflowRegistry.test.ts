import { describe, expect, it } from "vitest";
import { createBuiltInWorkflowRegistry, createWorkflowRegistry } from "../../src/main/workflows";

describe("workflow registry", () => {
  it("starts without built-in workflow registrations", () => {
    const registry = createBuiltInWorkflowRegistry();
    expect(registry.size).toBe(0);
  });

  it("creates a registry with unique IDs", () => {
    const registry = createWorkflowRegistry();
    expect(registry.size).toBe(new Set([...registry.keys()]).size);
  });
});
