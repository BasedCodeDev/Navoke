import { describe, expect, it } from "vitest";
import type { RunRecord, SystemInfo } from "../../src/renderer/lib/api";
import { resolveChatGptFocusTarget } from "../../src/renderer/lib/chatGptTabFocus";

type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];

function chatGptRun(input: unknown): RunRecord {
  return {
    id: "run-1",
    workflowId: "chatgpt.extension-image-transform",
    name: "ChatGPT run",
    runDir: null,
    status: "completed",
    currentStep: null,
    progress: 100,
    input,
    output: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function client(input: Partial<ExtensionClient> & { id: string }): ExtensionClient {
  return {
    id: input.id,
    url: input.url ?? "https://chatgpt.com/",
    title: input.title ?? "ChatGPT",
    status: input.status ?? "ready",
    protocolVersion: input.protocolVersion ?? 7,
    extensionVersion: input.extensionVersion ?? "0.7.0",
    routingToken: input.routingToken,
    compatible: input.compatible ?? true,
    incompatibilityReason: input.incompatibilityReason,
    lastSeenAt: input.lastSeenAt ?? "2026-01-01T00:00:00.000Z"
  };
}

describe("ChatGPT tab focus target resolver", () => {
  it("resolves existing client-id targets", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({ chatGptTab: { mode: "existing", clientId: "tab-1" } }),
      [client({ id: "tab-1" })]
    );

    expect(target).toMatchObject({
      clientId: "tab-1",
      disabledReason: null
    });
  });

  it("resolves new-tab routing tokens to connected clients", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({ chatGptTab: { mode: "new", routingToken: "run-token-1" } }),
      [client({ id: "tab-1" }), client({ id: "tab-2", routingToken: "run-token-1" })]
    );

    expect(target).toMatchObject({
      clientId: "tab-2",
      disabledReason: null
    });
  });

  it("disables focus for missing or untargeted ChatGPT tabs", () => {
    expect(resolveChatGptFocusTarget(chatGptRun({}), [])).toMatchObject({
      clientId: null,
      disabledReason: "This run did not record a specific ChatGPT tab target."
    });
    expect(
      resolveChatGptFocusTarget(chatGptRun({ chatGptTab: { mode: "existing", clientId: "missing" } }), [])
    ).toMatchObject({
      clientId: null,
      disabledReason: "The selected ChatGPT tab is not connected."
    });
    expect(resolveChatGptFocusTarget(chatGptRun({ chatGptTab: { mode: "any" } }), [])).toMatchObject({
      clientId: null,
      disabledReason: "This run did not target a specific ChatGPT tab."
    });
  });

  it("disables focus for incompatible connected clients", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({ chatGptTab: { mode: "existing", clientId: "tab-1" } }),
      [client({ id: "tab-1", compatible: false, incompatibilityReason: "Reload the extension." })]
    );

    expect(target).toMatchObject({
      clientId: null,
      disabledReason: "Reload the extension."
    });
  });
});
