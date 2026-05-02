import { describe, expect, it } from "vitest";
import { CHATGPT_EXTENSION_PROTOCOL_VERSION, ExtensionBridge } from "../../src/main/extension/extensionBridge";

describe("ExtensionBridge", () => {
  it("queues, leases, and completes a ChatGPT extension conversation task", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      id: "client-1",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });
    const task = bridge.createChatGptConversationTask({
      runId: "run-1",
      masterPrompt: "convert these",
      referenceImagePaths: ["C:\\tmp\\reference.png"],
      subjectImagePaths: ["C:\\tmp\\subject-a.png", "C:\\tmp\\subject-b.png"],
      subjectInstruction: "Apply the transform.",
      selectors: { composer: "#prompt-textarea" }
    });

    expect(bridge.status().pending).toBe(1);
    const leased = bridge.nextTask("client-1");
    expect(leased?.id).toBe(task.id);
    expect(leased?.protocolVersion).toBe(CHATGPT_EXTENSION_PROTOCOL_VERSION);
    expect(leased?.referenceImages).toHaveLength(1);
    expect(leased?.subjectImages).toHaveLength(2);
    expect(leased?.subjectInstruction).toBe("Apply the transform.");
    expect(bridge.getTaskImagePath(task.id, "reference", 0)).toBe("C:\\tmp\\reference.png");
    expect(bridge.getTaskImagePath(task.id, "subject", 1)).toBe("C:\\tmp\\subject-b.png");
    expect(bridge.status().running).toBe(1);

    const wait = bridge.waitForTask(task.id, {
      signal: new AbortController().signal,
      timeoutMs: 1_000
    });
    bridge.completeTask(task.id, {
      outputs: [
        {
          subjectIndex: 0,
          subjectName: "subject-a.png",
          mimeType: "image/png",
          base64: Buffer.from("image").toString("base64")
        }
      ]
    });

    await expect(wait).resolves.toMatchObject({ outputs: expect.any(Array) });
  });

  it("marks compatible and incompatible extension clients", () => {
    const bridge = new ExtensionBridge();

    bridge.heartbeat({
      id: "compatible",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });
    bridge.heartbeat({
      id: "stale",
      extensionVersion: "0.0.1"
    });

    const clients = bridge.status().connectedClients;
    expect(clients.find((client) => client.id === "compatible")).toMatchObject({
      compatible: true,
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });
    expect(clients.find((client) => client.id === "stale")).toMatchObject({
      compatible: false,
      protocolVersion: null,
      extensionVersion: "0.0.1"
    });
  });

  it("refuses to lease tasks to missing or incompatible extension clients", () => {
    const bridge = new ExtensionBridge();
    const task = bridge.createChatGptConversationTask({
      runId: "run-1",
      masterPrompt: "convert these",
      referenceImagePaths: [],
      subjectImagePaths: ["C:\\tmp\\subject-a.png"],
      subjectInstruction: "",
      selectors: {}
    });

    expect(() => bridge.nextTask("")).toThrow(/client id/i);
    expect(() => bridge.nextTask("missing")).toThrow(/has not checked in/i);

    bridge.heartbeat({ id: "stale", extensionVersion: "0.0.1" });
    expect(() => bridge.nextTask("stale")).toThrow(/Reload the unpacked Chrome extension/i);
    expect(bridge.status().pending).toBe(1);

    bridge.heartbeat({
      id: "compatible",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });
    expect(bridge.nextTask("compatible")?.id).toBe(task.id);
  });

  it("leases a targeted task only to the selected ChatGPT tab", () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      id: "client-1",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.3.0"
    });
    bridge.heartbeat({
      id: "client-2",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.3.0"
    });
    const task = bridge.createChatGptConversationTask({
      runId: "run-1",
      masterPrompt: "convert these",
      referenceImagePaths: [],
      subjectImagePaths: ["C:\\tmp\\subject-a.png"],
      subjectInstruction: "",
      selectors: {},
      target: { mode: "existing", clientId: "client-2" }
    });

    expect(bridge.nextTask("client-1")).toBeNull();
    expect(bridge.status().pending).toBe(1);
    expect(bridge.nextTask("client-2")?.id).toBe(task.id);
  });

  it("leases a new-tab task only to the matching routing token", () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      id: "existing-tab",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.3.0"
    });
    bridge.heartbeat({
      id: "new-tab",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.3.0",
      routingToken: "run-token-1"
    });
    const task = bridge.createChatGptConversationTask({
      runId: "run-1",
      masterPrompt: "convert these",
      referenceImagePaths: [],
      subjectImagePaths: ["C:\\tmp\\subject-a.png"],
      subjectInstruction: "",
      selectors: {},
      target: { mode: "new", routingToken: "run-token-1" }
    });

    expect(bridge.findCompatibleClientForTarget({ mode: "new", routingToken: "run-token-1" })?.id).toBe("new-tab");
    expect(bridge.nextTask("existing-tab")).toBeNull();
    expect(bridge.status().pending).toBe(1);
    expect(bridge.nextTask("new-tab")?.id).toBe(task.id);
  });
});
