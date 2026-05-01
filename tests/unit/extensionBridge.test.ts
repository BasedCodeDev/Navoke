import { describe, expect, it } from "vitest";
import { ExtensionBridge } from "../../src/main/extension/extensionBridge";

describe("ExtensionBridge", () => {
  it("queues, leases, and completes a ChatGPT extension task", async () => {
    const bridge = new ExtensionBridge();
    const task = bridge.createChatGptImageTask({
      runId: "run-1",
      prompt: "convert this",
      imagePath: "C:\\tmp\\input.png",
      selectors: { composer: "#prompt-textarea" }
    });

    expect(bridge.status().pending).toBe(1);
    expect(bridge.nextTask()?.id).toBe(task.id);
    expect(bridge.status().running).toBe(1);

    const wait = bridge.waitForTask(task.id, {
      signal: new AbortController().signal,
      timeoutMs: 1_000
    });
    bridge.completeTask(task.id, {
      outputs: [{ mimeType: "image/png", base64: Buffer.from("image").toString("base64") }]
    });

    await expect(wait).resolves.toMatchObject({ outputs: expect.any(Array) });
  });
});
