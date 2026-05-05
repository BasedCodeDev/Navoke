import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("generic browser extension popup", () => {
  it("warns when compatible tabs exist but no browser controller is connected", async () => {
    const harness = loadPopupHarness({
      statusBody: {
        requiredProtocolVersion: 4,
        compatible: 1,
        incompatible: 0,
        compatibleControllers: 0,
        connectedControllers: []
      },
      controllerPulse: { ok: true, controllerHeartbeat: { ok: true, controllerId: "controller-1" } }
    });

    await harness.refresh();

    expect(harness.status.className).toBe("status warn");
    expect(harness.status.textContent).toContain("1 compatible tab(s)");
    expect(harness.status.textContent).toContain("0 browser controller(s)");
    expect(harness.status.textContent).toContain("do not open routed URLs with chrome.exe");
  });

  it("surfaces popup-triggered controller heartbeat failures", async () => {
    const harness = loadPopupHarness({
      statusBody: {
        requiredProtocolVersion: 4,
        compatible: 1,
        incompatible: 0,
        compatibleControllers: 0,
        connectedControllers: []
      },
      controllerPulse: { ok: false, controllerHeartbeat: { ok: false, error: "controller failed" } }
    });

    await harness.refresh();

    expect(harness.status.className).toBe("status warn");
    expect(harness.status.textContent).toContain("controller heartbeat: controller failed");
  });

  it("shows the connected browser controller id when available", async () => {
    const harness = loadPopupHarness({
      statusBody: {
        requiredProtocolVersion: 4,
        compatible: 1,
        incompatible: 0,
        compatibleControllers: 1,
        connectedControllers: [{ id: "controller-1", compatible: true }]
      },
      controllerPulse: { ok: true, controllerHeartbeat: { ok: true, controllerId: "controller-1" } }
    });

    await harness.refresh();

    expect(harness.status.className).toBe("status ok");
    expect(harness.status.textContent).toContain("controller controller-1");
  });
});

function loadPopupHarness(input: { statusBody: unknown; controllerPulse: unknown }): {
  refresh(): Promise<void>;
  status: { className: string; textContent: string };
} {
  const popup = fs.readFileSync(path.resolve(__dirname, "../../extension/popup.js"), "utf8");
  const status = { className: "", textContent: "" };
  const context = vm.createContext({
    chrome: {
      runtime: {
        sendMessage: vi.fn(async () => input.controllerPulse)
      }
    },
    document: {
      getElementById: (id: string) => {
        expect(id).toBe("status");
        return status;
      }
    },
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => input.statusBody
    })),
    setInterval: vi.fn(),
    console,
    globalThis: {}
  });
  context.globalThis = context;
  vm.runInContext(popup, context);
  const api = context.__BasedBlinkBrowserControllerPopupTest as { refresh(): Promise<void> };
  return { refresh: api.refresh, status };
}
