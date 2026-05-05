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
      protocolVersion: 4,
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
      protocolVersion: 4,
      command: { kind: "open-tab", url: "https://example.test/#based-blink-tab=route-1", active: true }
    });

    expect(injected).toEqual([{ target: { tabId: 42 }, files: ["content.js"] }]);
    expect(result).toMatchObject({ injection: { injected: true } });
  });

  it("injects the generic content script when a tab finishes loading", async () => {
    const injected: unknown[] = [];
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 }),
      tabsGet: async (tabId) => ({ id: tabId, windowId: 7, url: "https://3d.hunyuanglobal.com/", status: "complete" }),
      scriptingExecuteScript: async (input: unknown) => {
        injected.push(input);
        return [];
      }
    });

    await harness.sendTabUpdated(42, { status: "complete" }, { url: "https://3d.hunyuanglobal.com/" });

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
      protocolVersion: 4,
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
      protocolVersion: 4,
      command: { kind: "focus-tab", tabId: 42, windowId: 7, focused: true }
    });

    expect(updatedTabs).toEqual([{ tabId: 42, input: { active: true } }]);
    expect(updatedWindows).toEqual([{ windowId: 7, input: { focused: true } }]);
    expect(result).toMatchObject({ ok: true, action: "focus-tab", tabId: 42, windowId: 7 });
  });

  it("returns controller and tab metadata to content-script heartbeats", async () => {
    const harness = loadBackgroundHarness({
      tabsCreate: async () => ({ id: 1 })
    });

    await expect(
      harness.sendRuntimeMessage({ type: "current-tab-info" }, { tab: { id: 42, windowId: 7 } })
    ).resolves.toMatchObject({ ok: true, controllerId: "controller-id", tabId: 42, windowId: 7 });
  });
});

function loadBackgroundHarness(options: {
  tabsCreate(input: unknown): Promise<unknown>;
  tabsGet?: (tabId: number) => Promise<unknown>;
  tabsUpdate?: (tabId: number, input: unknown) => Promise<unknown>;
  windowsCreate?: (input: unknown) => Promise<unknown>;
  windowsUpdate?: (windowId: number, input: unknown) => Promise<unknown>;
  scriptingExecuteScript?: (input: unknown) => Promise<unknown>;
}): {
  performControllerCommand(payload: unknown): Promise<unknown>;
  sendRuntimeMessage(message: unknown, sender?: unknown): Promise<unknown>;
  sendTabUpdated(tabId: number, changeInfo: unknown, tab: unknown): Promise<void>;
} {
  const background = fs.readFileSync(path.resolve(__dirname, "../../extension/background.js"), "utf8");
  const listeners: Array<(message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean> = [];
  const tabUpdatedListeners: Array<(tabId: number, changeInfo: unknown, tab: unknown) => void> = [];
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => "controller-id" },
    fetch: vi.fn(async () => ({ status: 204, ok: true, text: async () => "" })),
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
        : undefined
    },
    globalThis: {}
  });
  context.globalThis = context;
  vm.runInContext(background, context);
  const api = context.__BasedBlinkBrowserControllerBackgroundTest as {
    performControllerCommand(payload: unknown): Promise<unknown>;
  };
  return {
    ...api,
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
