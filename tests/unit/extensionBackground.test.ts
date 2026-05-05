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
      protocolVersion: 3,
      command: { kind: "open-tab", url: "https://example.test/#based-blink-tab=route-1", active: true }
    });

    expect(createdTabs).toEqual([{ url: "https://example.test/#based-blink-tab=route-1", active: true }]);
    expect(result).toMatchObject({ ok: true, action: "open-tab", tabId: 42, windowId: 7 });
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
      protocolVersion: 3,
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
      protocolVersion: 3,
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
  tabsUpdate?: (tabId: number, input: unknown) => Promise<unknown>;
  windowsCreate?: (input: unknown) => Promise<unknown>;
  windowsUpdate?: (windowId: number, input: unknown) => Promise<unknown>;
}): {
  performControllerCommand(payload: unknown): Promise<unknown>;
  sendRuntimeMessage(message: unknown, sender?: unknown): Promise<unknown>;
} {
  const background = fs.readFileSync(path.resolve(__dirname, "../../extension/background.js"), "utf8");
  const listeners: Array<(message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean> = [];
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => "controller-id" },
    fetch: vi.fn(async () => ({ status: 204, ok: true, text: async () => "" })),
    setInterval: vi.fn(),
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
        update: options.tabsUpdate ?? vi.fn()
      },
      windows: {
        create: options.windowsCreate ?? vi.fn(),
        update: options.windowsUpdate ?? vi.fn()
      }
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
    }
  };
}
