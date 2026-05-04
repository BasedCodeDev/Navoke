import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchPersistentProfile } from "../../src/main/automation/browserHarness";
import { ExtensionBridge } from "../../src/main/extension/extensionBridge";
import { WorkflowLab } from "../../src/main/lab/workflowLab";
import { createRuntimePaths } from "../../src/main/runtime/paths";

vi.mock("../../src/main/automation/browserHarness", () => ({
  launchPersistentProfile: vi.fn()
}));

const launchPersistentProfileMock = vi.mocked(launchPersistentProfile);

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lab-profile-test-"));
  launchPersistentProfileMock.mockReset();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("WorkflowLab Playwright profile owner", () => {
  it("uses the Workflow Lab profile owner and lab profile by default", async () => {
    const paths = createRuntimePaths(path.join(tempDir, "app-data"));
    const { context, page } = createMockBrowserContext("about:blank", "Blank");
    launchPersistentProfileMock.mockResolvedValue(context);

    const lab = new WorkflowLab(paths, new ExtensionBridge());
    const session = await lab.createSession({ mode: "playwright" });

    expect(launchPersistentProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paths,
        workflowId: "workflow-lab",
        profileName: "lab"
      })
    );
    expect(page.goto).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      mode: "playwright",
      targetUrl: "about:blank",
      profileWorkflowId: "workflow-lab",
      profileName: "lab",
      title: "Blank",
      url: "about:blank"
    });
  });

  it("can launch Playwright Lab with a plugin-owned default profile", async () => {
    const paths = createRuntimePaths(path.join(tempDir, "app-data"));
    const targetUrl = "https://example.test/";
    const { context, page } = createMockBrowserContext("about:blank", "Plugin");
    launchPersistentProfileMock.mockResolvedValue(context);

    const lab = new WorkflowLab(paths, new ExtensionBridge());
    const session = await lab.createSession({
      mode: "playwright",
      targetUrl,
      profileWorkflowId: "example-plugin",
      profileName: "default"
    });

    expect(launchPersistentProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paths,
        workflowId: "example-plugin",
        profileName: "default"
      })
    );
    expect(page.goto).toHaveBeenCalledWith(
      targetUrl,
      expect.objectContaining({
        waitUntil: "domcontentloaded",
        timeout: 45_000
      })
    );
    expect(session).toMatchObject({
      mode: "playwright",
      targetUrl,
      profileWorkflowId: "example-plugin",
      profileName: "default",
      title: "Plugin",
      url: targetUrl
    });
  });

  it("rejects invalid Playwright profile owners", async () => {
    const paths = createRuntimePaths(path.join(tempDir, "app-data"));
    const lab = new WorkflowLab(paths, new ExtensionBridge());

    await expect(lab.createSession({ mode: "playwright", profileWorkflowId: "../other" })).rejects.toThrow(
      "Workflow Lab profile owner can contain only letters, numbers, dot, underscore, and dash."
    );
    expect(launchPersistentProfileMock).not.toHaveBeenCalled();
  });
});

function createMockBrowserContext(initialUrl: string, title: string): { context: BrowserContext; page: Page & { goto: ReturnType<typeof vi.fn> } } {
  let currentUrl = initialUrl;
  const page = {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => title)
  } as unknown as Page & { goto: ReturnType<typeof vi.fn> };
  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  } as unknown as BrowserContext;
  return { context, page };
}
