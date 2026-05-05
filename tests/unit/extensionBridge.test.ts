import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLINK_EXTENSION_PROTOCOL_VERSION, ExtensionBridge } from "../../src/main/extension/extensionBridge";

const CONTROLLER_CAPABILITIES = ["open-tab", "open-window", "focus-tab", "close-tab"];

describe("ExtensionBridge", () => {
  it("registers compatible browser extension clients", () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "tab-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/#based-blink-tab=route-1",
      title: "Example",
      controllerId: "controller-1",
      tabId: 42,
      windowId: 7,
      controllerHeartbeatOk: true,
      controllerHeartbeatAt: "2026-05-05T00:00:00.000Z"
    });
    bridge.heartbeat({
      clientId: "stale-tab",
      protocolVersion: 999,
      extensionVersion: "0.0.1"
    });

    expect(BLINK_EXTENSION_PROTOCOL_VERSION).toBe(6);
    expect(bridge.status()).toMatchObject({
      requiredProtocolVersion: 6,
      connected: 2,
      compatible: 1,
      incompatible: 1,
      controllerDiagnostics: expect.objectContaining({
        compatibleTabsWithController: 1,
        compatibleTabsWithoutController: 0,
        latestControllerHeartbeatOk: true
      }),
      clients: expect.arrayContaining([
        expect.objectContaining({ compatible: false, incompatibilityReason: expect.stringContaining("protocol 6") }),
        expect.objectContaining({ compatible: true, controllerId: "controller-1", tabId: 42, windowId: 7 })
      ])
    });
    expect(bridge.findCompatibleClientForTarget({ mode: "new", routingToken: "route-1" })).toMatchObject({
      id: "tab-1",
      routingToken: "route-1",
      compatible: true
    });
  });

  it("queues, leases, and completes generic browser commands", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "tab-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });

    const wait = bridge.executeCommand({
      clientId: "tab-1",
      command: { kind: "inspect" },
      timeoutMs: 1_000
    });
    const command = bridge.nextCommand("tab-1");
    expect(command).toMatchObject({
      kind: "browser-command",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      command: { kind: "inspect" }
    });

    bridge.completeCommand(command!.id, { url: "https://example.test/", interactiveElements: [] });
    await expect(wait).resolves.toMatchObject({ url: "https://example.test/" });
  });

  it("targets commands through routing token lookup", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "other",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });
    bridge.heartbeat({
      clientId: "routed",
      routingToken: "run-token",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });

    const wait = bridge.executeCommandForTarget({
      target: { mode: "new", routingToken: "run-token" },
      command: { kind: "wait", condition: { kind: "document-ready" } },
      timeoutMs: 1_000
    });

    expect(bridge.nextCommand("other")).toBeNull();
    const command = bridge.nextCommand("routed");
    expect(command?.command).toEqual({ kind: "wait", condition: { kind: "document-ready" } });
    bridge.completeCommand(command!.id, { satisfied: true });
    await expect(wait).resolves.toMatchObject({ satisfied: true });
  });

  it("registers browser controllers and exposes controller status", () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES,
      diagnostics: { lastControllerCommand: { status: "none" } }
    });
    bridge.controllerHeartbeat({
      controllerId: "old-controller",
      protocolVersion: 999,
      extensionVersion: "0.0.1",
      capabilities: CONTROLLER_CAPABILITIES
    });

    expect(bridge.status()).toMatchObject({
      compatibleControllers: 1,
      incompatibleControllers: 1,
      connectedControllers: expect.arrayContaining([
        expect.objectContaining({ id: "controller-1", diagnostics: expect.objectContaining({ lastControllerCommand: { status: "none" } }) }),
        expect.objectContaining({ id: "old-controller" })
      ]),
      controllerCommandDiagnostics: expect.objectContaining({
        pendingCount: 0,
        runningCount: 0,
        recentCommands: []
      })
    });
  });

  it("rejects browser controllers that do not advertise close-tab support", () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "stale-controller",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.7",
      capabilities: ["open-tab", "open-window", "focus-tab"]
    });

    expect(bridge.status()).toMatchObject({
      compatibleControllers: 0,
      incompatibleControllers: 1,
      connectedControllers: [
        expect.objectContaining({
          id: "stale-controller",
          compatible: false,
          incompatibilityReason: expect.stringContaining("close-tab")
        })
      ]
    });
  });

  it("queues open-tab commands through a compatible browser controller", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.openTabWithController({ url: "https://example.test/#based-blink-tab=route-1", timeoutMs: 1_000 });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command).toMatchObject({
      kind: "controller-command",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      command: { kind: "open-tab", url: "https://example.test/#based-blink-tab=route-1", active: true }
    });

    bridge.completeControllerCommand(command!.id, { ok: true, tabId: 1 });
    await expect(wait).resolves.toMatchObject({ ok: true, tabId: 1 });
  });

  it("queues open-window commands through a compatible browser controller", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.openWindowWithController({ url: "https://example.test/#based-blink-tab=route-1", timeoutMs: 1_000 });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command).toMatchObject({
      kind: "controller-command",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      command: { kind: "open-window", url: "https://example.test/#based-blink-tab=route-1", focused: true }
    });

    bridge.completeControllerCommand(command!.id, { ok: true, tabId: 1, windowId: 2 });
    await expect(wait).resolves.toMatchObject({ ok: true, tabId: 1, windowId: 2 });
  });

  it("queues close-tab commands through the opening browser controller", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.closeTabWithController({ tabId: 42, controllerId: "controller-1", timeoutMs: 1_000 });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command).toMatchObject({
      kind: "controller-command",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      command: { kind: "close-tab", tabId: 42 }
    });

    bridge.completeControllerCommand(command!.id, { ok: true, action: "close-tab", tabId: 42 });
    await expect(wait).resolves.toMatchObject({ ok: true, action: "close-tab", tabId: 42, controllerId: "controller-1" });
  });

  it("reports close-tab command timeout diagnostics without corrupting controller bookkeeping", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.closeTabWithController({ tabId: 42, controllerId: "controller-1", timeoutMs: 5 });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command?.command).toMatchObject({ kind: "close-tab", tabId: 42 });

    await expect(wait).rejects.toThrow(/to complete/);
    expect(bridge.status().controllerCommandDiagnostics).toMatchObject({
      lastPollResult: "leased",
      lastPollCommandId: command!.id,
      recentCommands: [expect.objectContaining({ commandKind: "close-tab", status: "failed", tabId: 42 })]
    });
  });

  it("opens a routed window through the controller and waits for the page client", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.ensureRoutedTab({
      target: { mode: "new", routingToken: "route-1", url: "https://example.test/#based-blink-tab=route-1" },
      timeoutMs: 1_000
    });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command?.command).toMatchObject({ kind: "open-window", url: "https://example.test/#based-blink-tab=route-1" });
    bridge.completeControllerCommand(command!.id, { ok: true, action: "open-window", tabId: 1, windowId: 2 });
    bridge.heartbeat({
      clientId: "routed-tab",
      routingToken: "route-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/"
    });

    await expect(wait).resolves.toMatchObject({
      id: "routed-tab",
      routingToken: "route-1",
      openedByController: true,
      openedAction: "open-window",
      openedTabId: 1,
      openedWindowId: 2,
      openedControllerId: "controller-1"
    });
  });

  it("does not mark pre-existing routed clients as controller-opened", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "routed-tab",
      routingToken: "route-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/"
    });

    await expect(
      bridge.ensureRoutedTab({
        target: { mode: "new", routingToken: "route-1", url: "https://example.test/#based-blink-tab=route-1" },
        timeoutMs: 1_000
      })
    ).resolves.toMatchObject({ id: "routed-tab", routingToken: "route-1" });
    expect(
      await bridge.ensureRoutedTab({
        target: { mode: "new", routingToken: "route-1", url: "https://example.test/#based-blink-tab=route-1" },
        timeoutMs: 1_000
      })
    ).not.toHaveProperty("openedByController");
  });

  it("reports pending controller command diagnostics when the controller does not pick up a command", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    await expect(bridge.openWindowWithController({ url: "https://example.test/#based-blink-tab=route-1", timeoutMs: 5 })).rejects.toThrow(
      /to be picked up/
    );

    expect(bridge.status().controllerCommandDiagnostics).toMatchObject({
      pendingCount: 0,
      runningCount: 0,
      recentCommands: [expect.objectContaining({ commandKind: "open-window", status: "failed" })]
    });
  });

  it("reports running controller command diagnostics when the controller does not complete a leased command", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.openWindowWithController({ url: "https://example.test/#based-blink-tab=route-1", timeoutMs: 5 });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command?.command.kind).toBe("open-window");

    await expect(wait).rejects.toThrow(/to complete/);
    expect(bridge.status().controllerCommandDiagnostics).toMatchObject({
      lastPollResult: "leased",
      lastPollCommandId: command!.id,
      recentCommands: [expect.objectContaining({ commandKind: "open-window", status: "failed" })]
    });
  });

  it("reports routed-client diagnostics after the controller opens a window but no routed page checks in", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.ensureRoutedTab({
      target: { mode: "new", routingToken: "route-1", url: "https://example.test/#based-blink-tab=route-1" },
      timeoutMs: 10
    });
    const command = bridge.nextControllerCommand("controller-1");
    bridge.completeControllerCommand(command!.id, {
      ok: true,
      action: "open-window",
      tabId: 1,
      windowId: 2,
      injection: { injected: false, reason: "Cannot access contents of url" }
    });

    await expect(wait).rejects.toThrow(/Opened a routed BLINK browser window, but no compatible page client connected.*Cannot access contents of url/s);
  });

  it("does not match arbitrary same-url tabs for routed run-owned targets", () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "same-url",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/conversation/123"
    });

    expect(
      bridge.findCompatibleClientForTarget({
        mode: "new",
        routingToken: "missing-route",
        url: "https://example.test/conversation/123"
      })
    ).toBeUndefined();
  });

  it("reopens a missing recorded routed client by routing token", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });

    const wait = bridge.ensureRoutedTab({
      target: {
        mode: "new",
        clientId: "closed-client",
        routingToken: "route-1",
        url: "https://example.test/#based-blink-tab=route-1"
      },
      timeoutMs: 1_000
    });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command?.command).toMatchObject({ kind: "open-window" });
    bridge.completeControllerCommand(command!.id, { ok: true });
    bridge.heartbeat({
      clientId: "replacement-client",
      routingToken: "route-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/"
    });

    await expect(wait).resolves.toMatchObject({ id: "replacement-client", routingToken: "route-1" });
  });

  it("fails routed tab opening when no compatible browser controller is connected", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "tab-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/",
      controllerHeartbeatOk: false,
      controllerHeartbeatError: "background controller failed"
    });
    await expect(
      bridge.ensureRoutedTab({
        target: { mode: "new", routingToken: "route-1", url: "https://example.test/#based-blink-tab=route-1" },
        timeoutMs: 1_000
      })
    ).rejects.toThrow(/Do not open chrome\.exe/);
  });

  it("keeps a routed tab matched after the page removes the routing token from its URL", () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "routed",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/#based-blink-tab=run-token",
      title: "Routed start"
    });
    bridge.heartbeat({
      clientId: "routed",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/conversation/123",
      title: "Conversation"
    });

    expect(bridge.findCompatibleClientForTarget({ mode: "new", routingToken: "run-token" })).toMatchObject({
      id: "routed",
      routingToken: "run-token",
      url: "https://example.test/conversation/123"
    });
  });

  it("falls back to a fresh same-url client after the original client command channel times out", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "stuck",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/conversation/123",
      title: "Conversation"
    });
    bridge.heartbeat({
      clientId: "fresh",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      url: "https://example.test/conversation/123",
      title: "Conversation"
    });

    const wait = bridge.executeCommand({
      clientId: "stuck",
      command: { kind: "inspect" },
      timeoutMs: 5
    });
    const timedOutCommand = bridge.nextCommand("stuck");
    expect(timedOutCommand).toBeTruthy();
    await expect(wait).rejects.toThrow(/Timed out waiting for browser extension command/);
    bridge.completeCommand(timedOutCommand!.id, { late: true });

    expect(
      bridge.findCompatibleClientForTarget({
        mode: "existing",
        clientId: "stuck",
        url: "https://example.test/conversation/123"
      })
    ).toMatchObject({ id: "fresh" });
  });

  it("stages files for generic attach-file commands", () => {
    const bridge = new ExtensionBridge();
    const filePath = path.join(process.cwd(), "package.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const [file] = bridge.stageFiles([filePath]);
    expect(file).toMatchObject({ name: "package.json", url: expect.stringContaining("/api/extension/files/") });
    expect(bridge.getStagedFilePath(file.id)).toBe(filePath);
  });

  it("resolves extension download watches from completed Chrome download events", async () => {
    const bridge = new ExtensionBridge();
    const watch = bridge.startDownloadWatch();
    const wait = bridge.waitForDownload({ watchId: watch.id, timeoutMs: 1_000 });

    expect(
      bridge.recordDownloadEvent({
        downloadId: 42,
        state: "complete",
        filename: "C:\\tmp\\model.zip",
        mime: "application/zip",
        totalBytes: 123,
        exists: true,
        receivedAt: "2026-05-05T00:00:00.000Z"
      })
    ).toMatchObject({ ok: true, matchedWatchId: watch.id });

    await expect(wait).resolves.toMatchObject({
      watchId: watch.id,
      downloadId: 42,
      filename: "C:\\tmp\\model.zip",
      state: "complete",
      mime: "application/zip",
      totalBytes: 123,
      exists: true
    });
  });

  it("rejects extension download watches when Chrome reports an interrupted download", async () => {
    const bridge = new ExtensionBridge();
    const watch = bridge.startDownloadWatch();
    const wait = bridge.waitForDownload({ watchId: watch.id, timeoutMs: 1_000 });

    bridge.recordDownloadEvent({ downloadId: 42, state: "interrupted", filename: "C:\\tmp\\model.zip", error: "NETWORK_FAILED" });

    await expect(wait).rejects.toThrow("NETWORK_FAILED");
  });

  it("queues focus commands for selected tabs", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "tab-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });

    const wait = bridge.focusClient("tab-1");
    const command = bridge.nextFocusCommand("tab-1");
    expect(command).toMatchObject({ kind: "focus-tab", protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION });
    bridge.completeFocusCommand(command!.id, { ok: true });
    await expect(wait).resolves.toMatchObject({ ok: true });
  });

  it("focuses known tab ids through the browser controller", async () => {
    const bridge = new ExtensionBridge();
    bridge.controllerHeartbeat({
      controllerId: "controller-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: CONTROLLER_CAPABILITIES
    });
    bridge.heartbeat({
      clientId: "tab-1",
      routingToken: "route-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      tabId: 42,
      windowId: 7,
      controllerId: "controller-1"
    });

    const wait = bridge.focusTarget({ target: { mode: "new", routingToken: "route-1" }, timeoutMs: 1_000 });
    const command = bridge.nextControllerCommand("controller-1");
    expect(command).toMatchObject({
      kind: "controller-command",
      command: { kind: "focus-tab", tabId: 42, windowId: 7, focused: true }
    });
    bridge.completeControllerCommand(command!.id, { ok: true, action: "focus-tab" });
    await expect(wait).resolves.toMatchObject({ ok: true, action: "focus-tab" });
  });

  it("fails commands with clear errors", async () => {
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      clientId: "tab-1",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.1.0"
    });

    const wait = bridge.executeCommand({ clientId: "tab-1", command: { kind: "inspect" }, timeoutMs: 1_000 });
    const command = bridge.nextCommand("tab-1");
    bridge.failCommand(command!.id, "Page command failed.");
    await expect(wait).rejects.toThrow("Page command failed.");
  });
});
