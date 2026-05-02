import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHATGPT_EXTENSION_PROTOCOL_VERSION, ExtensionBridge } from "../../src/main/extension/extensionBridge";
import { WorkflowLab } from "../../src/main/lab/workflowLab";
import { createRuntimePaths } from "../../src/main/runtime/paths";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lab-test-"));
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("WorkflowLab", () => {
  it("stages attach-file actions for extension lab sessions", async () => {
    const paths = createRuntimePaths(path.join(tempDir, "app-data"));
    const bridge = new ExtensionBridge();
    bridge.heartbeat({
      id: "lab-tab",
      url: "https://chatgpt.com/",
      title: "ChatGPT",
      status: "ready",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
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
      kind: "workflow-lab",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
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
