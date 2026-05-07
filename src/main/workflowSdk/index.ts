import {
  launchPersistentProfile,
  saveScreenshot,
  startTrace,
  stopTrace,
  timeoutMinutes
} from "../automation/browserHarness";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  BLINK_EXTENSION_PROTOCOL_VERSION,
  extensionBridge,
  type ExtensionBrowserAction,
  type ExtensionBrowserExtractQuery,
  type ExtensionBrowserTarget,
  type ExtensionClientStatus,
  type ExtensionCommandFilePayload,
  type ExtensionCommandInput
} from "../extension/extensionBridge";
import { z } from "zod";
import { WorkflowConfigurationError } from "../runtime/errors";
import {
  ensureRunDataDirs,
  getRunArtifactDir,
  getRunInputDir,
  getRunOutputArtifactDir
} from "../runtime/paths";
import { copyFileToDir, extractZip, fileSize, inferMimeType, safeBaseName, writeJson } from "../utils/files";
import { sleep } from "../utils/sleep";

const workflowSdkRequire = createRequire(__filename);

export type {
  ArtifactKind,
  ArtifactRecord,
  PublicWorkflow,
  RunRecord,
  RunStatus,
  RuntimeEvent,
  RuntimePaths,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowInputField,
  WorkflowManifest,
  WorkflowPluginCapability,
  WorkflowPluginMetadata,
  WorkflowRegistration,
  WorkflowRegistry
} from "../runtime/types";

export type { InstalledPluginRecord, PluginManifest, PluginInstallResult } from "../plugins/types";

export type {
  ExtensionBrowserAction,
  ExtensionBrowserExtractQuery,
  ExtensionBrowserTarget,
  ExtensionClientStatus,
  ExtensionCommandFilePayload,
  ExtensionCommandInput
} from "../extension/extensionBridge";

export interface WorkflowSdk {
  schema: {
    z: typeof z;
  };
  files: {
    safeBaseName: typeof safeBaseName;
    fileSize: typeof fileSize;
    copyFileToDir: typeof copyFileToDir;
    writeJson: typeof writeJson;
    inferMimeType: typeof inferMimeType;
    extractZip: typeof extractZip;
  };
  artifacts: {
    ensureRunDataDirs: typeof ensureRunDataDirs;
    getRunArtifactDir: typeof getRunArtifactDir;
    getRunInputDir: typeof getRunInputDir;
    getRunOutputArtifactDir: typeof getRunOutputArtifactDir;
  };
  browser: {
    launchPersistentProfile: typeof launchPersistentProfile;
    saveScreenshot: typeof saveScreenshot;
    startTrace: typeof startTrace;
    stopTrace: typeof stopTrace;
    timeoutMinutes: typeof timeoutMinutes;
  };
  packages: {
    resolvePackageRoot(packageName: string): string;
  };
  extension: {
    browser: {
      protocolVersion: typeof BLINK_EXTENSION_PROTOCOL_VERSION;
      status?(): ReturnType<typeof extensionBridge.status>;
      findCompatibleClientForTarget(target: ExtensionBrowserTarget): ExtensionClientStatus | undefined;
      ensureRoutedTab(
        target: ExtensionBrowserTarget,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): Promise<ExtensionClientStatus>;
      openTab(
        url: string,
        options?: { active?: boolean; signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      openWindow(
        url: string,
        options?: { focused?: boolean; signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      closeTab(
        tabId: number,
        options?: { controllerId?: string; signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      focusTarget(
        target: ExtensionBrowserTarget,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      stageFiles(filePaths: string[]): ExtensionCommandFilePayload[];
      startDownloadWatch(): ReturnType<typeof extensionBridge.startDownloadWatch>;
      waitForDownload(
        watchId: string,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): ReturnType<typeof extensionBridge.waitForDownload>;
      executeCommand(
        target: ExtensionBrowserTarget,
        command: ExtensionCommandInput,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      inspect(target: ExtensionBrowserTarget, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
      action(
        target: ExtensionBrowserTarget,
        action: ExtensionBrowserAction,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      wait(
        target: ExtensionBrowserTarget,
        condition: unknown,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      extract(
        target: ExtensionBrowserTarget,
        query: ExtensionBrowserExtractQuery,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
    };
  };
  errors: {
    WorkflowConfigurationError: typeof WorkflowConfigurationError;
  };
  sleep: typeof sleep;
}

export function createWorkflowSdk(): WorkflowSdk {
  return {
    schema: {
      z
    },
    files: {
      safeBaseName,
      fileSize,
      copyFileToDir,
      writeJson,
      inferMimeType,
      extractZip
    },
    artifacts: {
      ensureRunDataDirs,
      getRunArtifactDir,
      getRunInputDir,
      getRunOutputArtifactDir
    },
    browser: {
      launchPersistentProfile,
      saveScreenshot,
      startTrace,
      stopTrace,
      timeoutMinutes
    },
    packages: {
      resolvePackageRoot
    },
    extension: {
      browser: {
        protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
        status: () => extensionBridge.status(),
        findCompatibleClientForTarget: (target) => extensionBridge.findCompatibleClientForTarget(target),
        ensureRoutedTab: (target, options) =>
          extensionBridge.ensureRoutedTab({
            target,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        openTab: (url, options) =>
          extensionBridge.openTabWithController({
            url,
            active: options?.active,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        openWindow: (url, options) =>
          extensionBridge.openWindowWithController({
            url,
            focused: options?.focused,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        closeTab: (tabId, options) =>
          extensionBridge.closeTabWithController({
            tabId,
            controllerId: options?.controllerId,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        focusTarget: (target, options) =>
          extensionBridge.focusTarget({
            target,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        stageFiles: (filePaths) => extensionBridge.stageFiles(filePaths),
        startDownloadWatch: () => extensionBridge.startDownloadWatch(),
        waitForDownload: (watchId, options) =>
          extensionBridge.waitForDownload({
            watchId,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        executeCommand: (target, command, options) =>
          extensionBridge.executeCommandForTarget({
            target,
            command,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        inspect: (target, options) =>
          extensionBridge.executeCommandForTarget({
            target,
            command: { kind: "inspect" },
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        action: (target, action, options) =>
          extensionBridge.executeCommandForTarget({
            target,
            command: { kind: "action", action },
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        wait: (target, condition, options) =>
          extensionBridge.executeCommandForTarget({
            target,
            command: { kind: "wait", condition },
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        extract: (target, query, options) =>
          extensionBridge.executeCommandForTarget({
            target,
            command: { kind: "extract", query },
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          })
      }
    },
    errors: {
      WorkflowConfigurationError
    },
    sleep
  };
}

function resolvePackageRoot(packageName: string): string {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(packageName)) {
    throw new Error(`Invalid package name: ${packageName}`);
  }

  const entrypoint = workflowSdkRequire.resolve(packageName);
  let current = path.dirname(entrypoint);
  for (;;) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.dirname(entrypoint);
    current = parent;
  }
}
