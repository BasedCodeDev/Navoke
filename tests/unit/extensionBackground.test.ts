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
      protocolVersion: 1,
      command: { kind: "open-tab", url: "https://example.test/#based-blink-tab=route-1", active: true }
    });

    expect(createdTabs).toEqual([{ url: "https://example.test/#based-blink-tab=route-1", active: true }]);
    expect(result).toMatchObject({ ok: true, action: "open-tab", tabId: 42, windowId: 7 });
  });
});

function loadBackgroundHarness(options: { tabsCreate(input: unknown): Promise<unknown> }): {
  performControllerCommand(payload: unknown): Promise<unknown>;
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
        update: vi.fn()
      },
      windows: {
        update: vi.fn()
      }
    },
    globalThis: {}
  });
  context.globalThis = context;
  vm.runInContext(background, context);
  return context.__BasedBlinkBrowserControllerBackgroundTest as {
    performControllerCommand(payload: unknown): Promise<unknown>;
  };
}
