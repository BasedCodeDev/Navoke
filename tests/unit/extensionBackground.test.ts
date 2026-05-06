import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("generic browser extension background controller", () => {
  it("handles open-tab controller commands through chrome.tabs.create", async () => {
    const createdTabs: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async (input: unknown) => {
        createdTabs.push(input);
        return { id: 42, windowId: 7, url: (input as { url: string }).url, title: "Opened tab" };
      }
    });

    const result = await harness.performControllerCommand({
      id: "command-1",
      kind: "controller-command",
      protocolVersion: 6,
      command: { kind: "open-tab", url: "https://example.test/#based-blink-tab=route-1", active: true }
    });

    expect(createdTabs).toEqual([{ url: "https://example.test/#based-blink-tab=route-1", active: true }]);
    expect(result).toMatchObject({ ok: true, action: "open-tab", tabId: 42, windowId: 7 });
  });

  it("injects the generic content script into opened tabs", async () => {
    const injected: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async (input: unknown) => ({ id: 42, windowId: 7, url: (input as { url: string }).url, title: "Opened tab" }),
      tabsGet: async (tabId) => ({ id: tabId, windowId: 7, url: "https://example.test/#based-blink-tab=route-1", status: "complete" }),
      scriptingExecuteScript: async (input: unknown) => {
        injected.push(input);
        return [];
      }
    });

    const result = await harness.performControllerCommand({
      id: "command-1",
      kind: "controller-command",
      protocolVersion: 6,
      command: { kind: "open-tab", url: "https://example.test/#based-blink-tab=route-1", active: true }
    });

    expect(injected).toEqual([{ target: { tabId: 42 }, files: ["content.js"] }]);
    expect(result).toMatchObject({ injection: { injected: true } });
  });

  it("injects the generic content script when a tab finishes loading", async () => {
    const injected: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      tabsGet: async (tabId) => ({ id: tabId, windowId: 7, url: "https://example.test/", status: "complete" }),
      scriptingExecuteScript: async (input: unknown) => {
        injected.push(input);
        return [];
      }
    });

    await harness.sendTabUpdated(42, { status: "complete" }, { url: "https://example.test/" });

    expect(injected).toEqual([{ target: { tabId: 42 }, files: ["content.js"] }]);
  });

  it("handles open-window controller commands through chrome.windows.create", async () => {
    const createdWindows: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => {
        throw new Error("tabs.create should not be used for open-window.");
      },
      windowsCreate: async (input: unknown) => {
        createdWindows.push(input);
        return {
          id: 9,
          tabs: [{ id: 43, windowId: 9, url: (input as { url: string }).url, title: "Opened window" }]
        };
      }
    });

    const result = await harness.performControllerCommand({
      id: "command-1",
      kind: "controller-command",
      protocolVersion: 6,
      command: { kind: "open-window", url: "https://example.test/#based-blink-tab=route-1", focused: true }
    });

    expect(createdWindows).toEqual([{ url: "https://example.test/#based-blink-tab=route-1", focused: true }]);
    expect(result).toMatchObject({ ok: true, action: "open-window", tabId: 43, windowId: 9 });
  });

  it("handles focus-tab controller commands through chrome tab and window updates", async () => {
    const updatedTabs: unknown[] = [];
    const updatedWindows: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      tabsUpdate: async (tabId, input) => {
        updatedTabs.push({ tabId, input });
        return { id: tabId, windowId: 7, url: "https://example.test/", title: "Focused" };
      },
      windowsUpdate: async (windowId, input) => {
        updatedWindows.push({ windowId, input });
        return {};
      }
    });

    const result = await harness.performControllerCommand({
      id: "command-1",
      kind: "controller-command",
      protocolVersion: 6,
      command: { kind: "focus-tab", tabId: 42, windowId: 7, focused: true }
    });

    expect(updatedTabs).toEqual([{ tabId: 42, input: { active: true } }]);
    expect(updatedWindows).toEqual([{ windowId: 7, input: { focused: true } }]);
    expect(result).toMatchObject({ ok: true, action: "focus-tab", tabId: 42, windowId: 7 });
  });

  it("handles close-tab controller commands through chrome.tabs.remove", async () => {
    const removedTabs: number[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      tabsRemove: async (tabId) => {
        removedTabs.push(tabId);
      }
    });

    const result = await harness.performControllerCommand({
      id: "command-1",
      kind: "controller-command",
      protocolVersion: 6,
      command: { kind: "close-tab", tabId: 42 }
    });

    expect(removedTabs).toEqual([42]);
    expect(result).toMatchObject({ ok: true, action: "close-tab", tabId: 42 });
  });

  it("treats an already-closed tab as successful close-tab cleanup", async () => {
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      tabsRemove: async () => {
        throw new Error("No tab with id: 42.");
      }
    });

    await expect(
      harness.performControllerCommand({
        id: "command-1",
        kind: "controller-command",
        protocolVersion: 6,
        command: { kind: "close-tab", tabId: 42 }
      })
    ).resolves.toMatchObject({ ok: true, action: "close-tab", tabId: 42, alreadyClosed: true });
  });

  it("returns controller and tab metadata to content-script heartbeats", async () => {
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 })
    });

    await expect(
      harness.sendRuntimeMessage({ type: "current-tab-info" }, { tab: { id: 42, windowId: 7 } })
    ).resolves.toMatchObject({ ok: true, controllerId: "controller-id", tabId: 42, windowId: 7 });
  });

  it("surfaces controller heartbeat success through runtime messages", async () => {
    const requestedUrls: string[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      fetch: async (url) => {
        requestedUrls.push(url);
        return url.includes("/commands/next")
          ? { status: 204, ok: true, text: async () => "" }
          : {
              status: 200,
              ok: true,
              text: async () => JSON.stringify({ ok: true, compatible: true, controllerId: "controller-id", requiredProtocolVersion: 6 })
            };
      }
    });

    await expect(harness.sendRuntimeMessage({ type: "controller-heartbeat" })).resolves.toMatchObject({
      ok: true,
      controllerHeartbeat: {
        ok: true,
        controllerId: "controller-id",
        compatible: true,
        capabilities: ["open-tab", "open-window", "focus-tab", "close-tab"]
      }
    });
    expect(requestedUrls.some((url) => url.includes("/api/extension/controller/commands/next"))).toBe(true);
  });

  it("surfaces controller heartbeat failures through runtime messages", async () => {
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      fetch: async () => ({
        status: 500,
        ok: false,
        text: async () => JSON.stringify({ error: "BLINK app is down" })
      })
    });

    await expect(harness.sendRuntimeMessage({ type: "controller-heartbeat" })).resolves.toMatchObject({
      ok: false,
      controllerHeartbeat: {
        ok: false,
        error: "BLINK app is down",
        capabilities: ["open-tab", "open-window", "focus-tab", "close-tab"]
      }
    });
  });

  it("relays content-script API fetches through the background service worker", async () => {
    const requests: Array<{ url: string; options?: unknown }> = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      fetch: async (url, options) => {
        requests.push({ url, options });
        return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true, echoed: true }) };
      }
    });

    await expect(
      harness.sendRuntimeMessage({
        type: "api-fetch",
        path: "/api/extension/heartbeat",
        options: { method: "POST", body: JSON.stringify({ clientId: "tab-1" }) }
      })
    ).resolves.toMatchObject({
      type: "api-fetch-result",
      status: 200,
      ok: true,
      body: { ok: true, echoed: true }
    });
    expect(requests[0]).toMatchObject({
      url: "http://127.0.0.1:39201/api/extension/heartbeat",
      options: expect.objectContaining({ method: "POST", body: JSON.stringify({ clientId: "tab-1" }) })
    });
  });

  it("rejects content-script API relay paths outside extension routes", async () => {
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 })
    });

    await expect(harness.sendRuntimeMessage({ type: "api-fetch", path: "/api/runs" })).resolves.toMatchObject({
      type: "api-fetch-error",
      status: 400,
      error: "Unsupported BLINK extension API relay path."
    });
  });

  it("relays staged file bytes for content-script file uploads", async () => {
    const requests: string[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      fetch: async (url) => {
        requests.push(url);
        return {
          status: 200,
          ok: true,
          headers: { get: () => "image/png" },
          text: async () => "",
          arrayBuffer: async () => Buffer.from("file-bytes").buffer
        } as any;
      }
    });

    await expect(harness.apiFetchBinaryForContent("/api/extension/files/file-1")).resolves.toMatchObject({
      type: "api-fetch-binary-result",
      status: 200,
      ok: true,
      base64: expect.any(String)
    });
    expect(requests[0]).toBe("http://127.0.0.1:39201/api/extension/files/file-1");
  });

  it("rejects binary relay paths outside staged extension and lab files", async () => {
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 })
    });

    await expect(harness.apiFetchBinaryForContent("/api/runs/1")).resolves.toMatchObject({
      type: "api-fetch-binary-error",
      status: 400,
      error: "Unsupported BLINK binary relay path."
    });
  });

  it("posts Chrome download completion events back to Electron", async () => {
    const postedBodies: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      fetch: async (url, options) => {
        if (url.includes("/api/extension/downloads/event")) {
          postedBodies.push(JSON.parse(String((options as { body?: string })?.body ?? "{}")));
        }
        return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true }) };
      }
    });

    await harness.postDownloadEvent({
      type: "complete",
      downloadId: 42,
      state: "complete",
      filename: "C:\\tmp\\model.zip",
      receivedAt: "2026-05-05T00:00:00.000Z"
    });

    expect(postedBodies[0]).toMatchObject({ downloadId: 42, state: "complete", filename: "C:\\tmp\\model.zip" });
    expect(harness.lastDownloadEvent()).toMatchObject({ status: "complete", downloadId: 42 });
  });

  it("records controller command completion metadata after polling a pending command", async () => {
    let enableCommand = false;
    const completed: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 42, windowId: 7, url: "https://example.test/#based-blink-tab=route-1", title: "Opened tab" }),
      fetch: async (url, options) => {
        if (url.includes("/commands/next")) {
          if (!enableCommand) return { status: 204, ok: true, text: async () => "" };
          enableCommand = false;
          return {
            status: 200,
            ok: true,
            text: async () =>
              JSON.stringify({
                id: "command-1",
                kind: "controller-command",
                protocolVersion: 6,
                command: { kind: "open-tab", url: "https://example.test/#based-blink-tab=route-1", active: true }
              })
          };
        }
        if (url.includes("/commands/command-1/complete")) {
          completed.push(options);
          return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true }) };
        }
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ ok: true, compatible: true, controllerId: "controller-id", requiredProtocolVersion: 6 })
        };
      }
    });

    enableCommand = true;
    await expect(harness.pollControllerCommands()).resolves.toMatchObject({ ok: true, action: "open-tab" });

    expect(completed).toHaveLength(1);
    expect(harness.lastControllerCommand()).toMatchObject({
      status: "completed",
      commandId: "command-1",
      commandKind: "open-tab",
      result: expect.objectContaining({ action: "open-tab", tabId: 42 })
    });
  });

  it("registers an alarm to wake controller polling while the service worker is idle", () => {
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 })
    });

    expect(harness.createdAlarms).toEqual([{ name: "based-blink-controller-poll", input: { periodInMinutes: 1 } }]);
  });
});

function loadBackgroundHarness(options: {
  tabsCreate(input: unknown): Promise<unknown>;
  tabsGet?: (tabId: number) => Promise<unknown>;
  tabsRemove?: (tabId: number) => Promise<void>;
  tabsUpdate?: (tabId: number, input: unknown) => Promise<unknown>;
  windowsCreate?: (input: unknown) => Promise<unknown>;
  windowsUpdate?: (windowId: number, input: unknown) => Promise<unknown>;
  scriptingExecuteScript?: (input: unknown) => Promise<unknown>;
  fetch?: (url: string, options?: unknown) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;
}): {
  performControllerCommand(payload: unknown): Promise<unknown>;
  apiFetchBinaryForContent(path: string): Promise<unknown>;
  pollControllerCommands(): Promise<unknown>;
  tickController(): Promise<unknown>;
  postDownloadEvent(event: unknown): Promise<void>;
  sendRuntimeMessage(message: unknown, sender?: unknown): Promise<unknown>;
  sendTabUpdated(tabId: number, changeInfo: unknown, tab: unknown): Promise<void>;
  lastControllerCommand(): unknown;
  lastDownloadEvent(): unknown;
  createdAlarms: Array<{ name: string; input: unknown }>;
} {
  const background = fs.readFileSync(path.resolve(__dirname, "../../extension/background.js"), "utf8");
  const listeners: Array<(message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean> = [];
  const tabUpdatedListeners: Array<(tabId: number, changeInfo: unknown, tab: unknown) => void> = [];
  const alarmListeners: Array<(alarm: unknown) => void> = [];
  const createdAlarms: Array<{ name: string; input: unknown }> = [];
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => "controller-id" },
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    fetch: vi.fn(options.fetch ?? (async () => ({ status: 204, ok: true, text: async () => "" }))),
    setInterval: vi.fn(),
    setTimeout,
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.1.0" }),
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: (listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean) => listeners.push(listener) }
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined)
        }
      },
      tabs: {
        create: options.tabsCreate,
        get: options.tabsGet ?? vi.fn(),
        remove: options.tabsRemove ?? vi.fn(async () => undefined),
        update: options.tabsUpdate ?? vi.fn(),
        onUpdated: { addListener: (listener: (tabId: number, changeInfo: unknown, tab: unknown) => void) => tabUpdatedListeners.push(listener) }
      },
      windows: {
        create: options.windowsCreate ?? vi.fn(),
        update: options.windowsUpdate ?? vi.fn()
      },
      scripting: options.scriptingExecuteScript
        ? {
            executeScript: options.scriptingExecuteScript
          }
        : undefined,
      alarms: {
        create: (name: string, input: unknown) => {
          createdAlarms.push({ name, input });
        },
        onAlarm: { addListener: (listener: (alarm: unknown) => void) => alarmListeners.push(listener) }
      },
      downloads: {
        onCreated: { addListener: vi.fn() },
        onChanged: { addListener: vi.fn() },
        search: vi.fn(async () => [])
      }
    },
    globalThis: {}
  });
  context.globalThis = context;
  vm.runInContext(background, context);
  const api = context.__BasedBlinkBrowserControllerBackgroundTest as {
    performControllerCommand(payload: unknown): Promise<unknown>;
    apiFetchForContent(path: string, options?: unknown): Promise<unknown>;
    apiFetchBinaryForContent(path: string): Promise<unknown>;
    pollControllerCommands(): Promise<unknown>;
    tickController(): Promise<unknown>;
    postDownloadEvent(event: unknown): Promise<void>;
    lastControllerCommand(): unknown;
    lastDownloadEvent(): unknown;
  };
  return {
    ...api,
    createdAlarms,
    sendRuntimeMessage(message: unknown, sender?: unknown): Promise<unknown> {
      return new Promise((resolve) => {
        const handled = listeners.some((listener) => listener(message, sender ?? {}, resolve));
        if (!handled) resolve(undefined);
      });
    },
    async sendTabUpdated(tabId: number, changeInfo: unknown, tab: unknown): Promise<void> {
      for (const listener of tabUpdatedListeners) listener(tabId, changeInfo, tab);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
}
