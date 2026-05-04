import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchPersistentProfile } from "../../src/main/automation/browserHarness";
import { BLINK_EXTENSION_PROTOCOL_VERSION, ExtensionBridge } from "../../src/main/extension/extensionBridge";
import { WorkflowLab } from "../../src/main/lab/workflowLab";
import { createRuntimePaths } from "../../src/main/runtime/paths";

vi.mock("../../src/main/automation/browserHarness", () => ({
  launchPersistentProfile: vi.fn()
}));

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lab-test-"));
  vi.mocked(launchPersistentProfile).mockReset();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("WorkflowLab", () => {
  it("uses the default Workflow Lab owner profile for Playwright sessions", async () => {
    vi.mocked(launchPersistentProfile).mockResolvedValue(createMockContext() as any);
    const paths = createRuntimePaths(path.join(tempDir, "app-data"));
    const lab = new WorkflowLab(paths, new ExtensionBridge());

    const session = await lab.createSession({ mode: "playwright", targetUrl: "https://example.test/" });

    expect(launchPersistentProfile).toHaveBeenCalledWith({
      paths,
      workflowId: "workflow-lab",
      profileName: "lab"
    });
    expect(session).toMatchObject({
      mode: "playwright",
      profileWorkflowId: "workflow-lab",
      profileName: "lab",
      targetUrl: "https://example.test/"
    });
  });

  it("can share a custom owner profile for Playwright calibration", async () => {
    vi.mocked(launchPersistentProfile).mockResolvedValue(createMockContext() as any);
    const paths = createRuntimePaths(path.join(tempDir, "app-data"));
    const lab = new WorkflowLab(paths, new ExtensionBridge());

    const session = await lab.createSession({
      mode: "playwright",
      targetUrl: "https://example.test/",
      profileWorkflowId: "custom-plugin"
    });

    expect(launchPersistentProfile).toHaveBeenCalledWith({
      paths,
      workflowId: "custom-plugin",
      profileName: "default"
    });
    expect(session).toMatchObject({
      mode: "playwright",
      profileWorkflowId: "custom-plugin",
      profileName: "default"
    });
  });

  it("stages attach-file actions for extension lab sessions", async () => {
    const paths = createRuntimePaths(path.join(tempDir, "app-data"));
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      id: "lab-tab",
      url: "https://BLINK.com/",
      title: "BLINK",
      status: "ready",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: "0.5.0"
    });
    const lab = new WorkflowLab(paths, bridge);
    const session = await lab.createSession({ mode: "extension", clientId: "lab-tab" });
    const imagePath = path.join(tempDir, "subject.png");
    fs.writeFileSync(imagePath, Buffer.from("not-a-real-png"));

    const run = lab.runAction(session.id, {
      kind: "attach-file",
      selector: "input[type='file']",
      filePaths: [imagePath]
    });
    const command = bridge.nextLabCommand("lab-tab");

    expect(command).toMatchObject({
      kind: "browser-command",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      command: {
        kind: "action",
        action: {
          kind: "attach-file",
          selector: "input[type='file']"
        }
      }
    });

    const action = command!.command.kind === "action" ? (command!.command.action as { files: Array<{ id: string; url: string }> }) : null;
    expect(action?.files).toHaveLength(1);
    const stagedPayload = action!.files[0]!;
    expect(stagedPayload.url).toContain(`/api/lab/sessions/${session.id}/files/`);
    const stagedFile = lab.getStagedFile(session.id, stagedPayload.id);
    expect(stagedFile).toMatchObject({
      path: imagePath,
      name: "subject.png",
      mimeType: "image/png"
    });

    bridge.completeLabCommand(command!.id, { ok: true, attachedCount: 1 });
    await expect(run).resolves.toMatchObject({
      entry: {
        type: "action.completed"
      }
    });
  });
});

function createMockContext() {
  const page = {
    goto: vi.fn(async () => undefined),
    url: vi.fn(() => "https://example.test/"),
    title: vi.fn(async () => "Example")
  };
  return {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page)
  };
}
