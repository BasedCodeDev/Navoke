import { describe, expect, it } from "vitest";
import type { RunRecord, SystemInfo, WorkflowSummary } from "../../src/renderer/lib/api";
import { isRecoverableFailedChatGptRun, resolveChatGptFocusTarget } from "../../src/renderer/lib/chatGptTabFocus";

type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];
const chatGptWorkflow = {
  manifest: { uiCapabilities: ["chatgpt.focusTarget"] }
} as WorkflowSummary;

function chatGptRun(input: unknown): RunRecord {
  return {
    id: "run-1",
    workflowId: "based-blink.chatgpt.extension-image-transform",
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
    protocolVersion: input.protocolVersion ?? 8,
    extensionVersion: input.extensionVersion ?? "0.8.0",
    routingToken: input.routingToken,
    compatible: input.compatible ?? true,
    incompatibilityReason: input.incompatibilityReason,
    lastSeenAt: input.lastSeenAt ?? "2026-01-01T00:00:00.000Z"
  };
}

describe("ChatGPT tab focus target resolver", () => {
  it("resolves existing client-id targets", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({ chatGptTab: { mode: "existing", clientId: "tab-1", url: "https://chatgpt.com/c/1" } }),
      [client({ id: "tab-1" })],
      chatGptWorkflow
    );

    expect(target).toMatchObject({
      action: "focus",
      clientId: "tab-1",
      disabledReason: null
    });
  });

  it("resolves new-tab routing tokens to connected clients", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({ chatGptTab: { mode: "new", routingToken: "run-token-1" } }),
      [client({ id: "tab-1" }), client({ id: "tab-2", routingToken: "run-token-1" })],
      chatGptWorkflow
    );

    expect(target).toMatchObject({
      action: "focus",
      clientId: "tab-2",
      disabledReason: null
    });
  });

  it("resolves connected tabs by tracked URL after the original client id is stale", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({
        chatGptTab: { mode: "existing", clientId: "stale-tab", url: "https://chatgpt.com/c/abc" }
      }),
      [client({ id: "fresh-tab", url: "https://chatgpt.com/c/abc" })],
      chatGptWorkflow
    );

    expect(target).toMatchObject({
      action: "focus",
      clientId: "fresh-tab",
      disabledReason: null
    });
  });

  it("opens the tracked URL when no connected tab is available", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({
        chatGptTab: { mode: "new", routingToken: "run-token-1", url: "https://chatgpt.com/c/abc" },
        chatGptPage: { url: "https://chatgpt.com/c/abc", routingToken: "run-token-1", capturedAt: "2026-01-01T00:00:00.000Z" }
      }),
      [],
      chatGptWorkflow
    );

    expect(target).toMatchObject({
      action: "open",
      clientId: null,
      buttonLabel: "Open ChatGPT tab",
      disabledReason: null
    });
    expect(target?.url).toContain("https://chatgpt.com/c/abc");
    expect(target?.url).toContain("based-blink-tab=run-token-1");
  });

  it("uses completed run page metadata when input target details are missing", () => {
    const target = resolveChatGptFocusTarget(
      {
        ...chatGptRun({ chatGptTab: { mode: "any" } }),
        output: {
          chatGptPage: {
            url: "https://chatgpt.com/c/completed",
            clientId: "completed-tab",
            capturedAt: "2026-01-01T00:00:00.000Z"
          }
        }
      },
      [client({ id: "completed-tab", url: "https://chatgpt.com/c/completed" })],
      chatGptWorkflow
    );

    expect(target).toMatchObject({
      action: "focus",
      clientId: "completed-tab",
      disabledReason: null
    });
  });

  it("disables focus for missing or untargeted ChatGPT tabs", () => {
    expect(resolveChatGptFocusTarget(chatGptRun({}), [], chatGptWorkflow)).toMatchObject({
      action: "disabled",
      clientId: null,
      disabledReason: "This run did not record a specific ChatGPT tab target."
    });
    expect(
      resolveChatGptFocusTarget(chatGptRun({ chatGptTab: { mode: "existing", clientId: "missing" } }), [], chatGptWorkflow)
    ).toMatchObject({
      clientId: null,
      disabledReason: "The selected ChatGPT tab is not connected."
    });
    expect(resolveChatGptFocusTarget(chatGptRun({ chatGptTab: { mode: "any" } }), [], chatGptWorkflow)).toMatchObject({
      action: "disabled",
      clientId: null,
      disabledReason: "This run did not target a specific ChatGPT tab."
    });
  });

  it("disables focus for incompatible connected clients", () => {
    const target = resolveChatGptFocusTarget(
      chatGptRun({ chatGptTab: { mode: "existing", clientId: "tab-1" } }),
      [client({ id: "tab-1", compatible: false, incompatibilityReason: "Reload the extension." })],
      chatGptWorkflow
    );

    expect(target).toMatchObject({
      action: "disabled",
      clientId: null,
      disabledReason: "Reload the extension."
    });
  });

  it("identifies recoverable failed ChatGPT runs for the Run Details Resume action", () => {
    const failedWithUrl = {
      ...chatGptRun({ chatGptTab: { mode: "existing", clientId: "tab-1", url: "https://chatgpt.com/c/abc" } }),
      status: "failed" as const,
      error: "App exited before this run finished."
    };
    const failedWithCheckpoint = {
      ...chatGptRun({ chatGptTab: { mode: "existing", clientId: "tab-1" } }),
      status: "failed" as const,
      output: {
        artifactIds: [],
        summary: "Checkpoint",
        checkpoint: { setupCompleted: true, completedSubjectIndexes: [], outputMappings: [] }
      }
    };

    expect(isRecoverableFailedChatGptRun(failedWithUrl, chatGptWorkflow)).toBe(true);
    expect(isRecoverableFailedChatGptRun(failedWithCheckpoint, chatGptWorkflow)).toBe(true);
    expect(isRecoverableFailedChatGptRun(failedWithUrl)).toBe(false);
    expect(isRecoverableFailedChatGptRun({ ...failedWithUrl, status: "completed" }, chatGptWorkflow)).toBe(false);
    expect(isRecoverableFailedChatGptRun({ ...failedWithUrl, input: { chatGptTab: { mode: "any" } }, output: null }, chatGptWorkflow)).toBe(false);
  });
});
