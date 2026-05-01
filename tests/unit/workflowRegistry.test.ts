import { describe, expect, it } from "vitest";
import { createWorkflowRegistry } from "../../src/main/workflows";

describe("workflow registry", () => {
  it("registers browser workflows with unique IDs", () => {
    const registry = createWorkflowRegistry();
    expect(registry.has("chatgpt.extension-image-transform")).toBe(true);
    expect(registry.has("hunyuan.image-to-model")).toBe(true);
    expect(registry.size).toBe(new Set([...registry.keys()]).size);
  });

  it("validates required ChatGPT extension inputs", () => {
    const workflow = createWorkflowRegistry().get("chatgpt.extension-image-transform");
    expect(workflow).toBeDefined();
    const result = workflow!.inputSchema.safeParse({ images: [], masterPrompt: "" });
    expect(result.success).toBe(false);
  });

  it("validates required Hunyuan inputs", () => {
    const workflow = createWorkflowRegistry().get("hunyuan.image-to-model");
    expect(workflow).toBeDefined();
    const result = workflow!.inputSchema.safeParse({ images: [] });
    expect(result.success).toBe(false);
  });
});
