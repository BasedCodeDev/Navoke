import {
  launchPersistentProfile,
  saveScreenshot,
  startTrace,
  stopTrace,
  timeoutMinutes
} from "../automation/browserHarness";
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
import { copyFileToDir, fileSize, inferMimeType, safeBaseName, writeJson } from "../utils/files";
import { sleep } from "../utils/sleep";

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
  extension: {
    browser: {
      protocolVersion: typeof BLINK_EXTENSION_PROTOCOL_VERSION;
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
      focusTarget(
        target: ExtensionBrowserTarget,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ): Promise<unknown>;
      stageFiles(filePaths: string[]): ExtensionCommandFilePayload[];
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
      inferMimeType
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
    extension: {
      browser: {
        protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
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
        focusTarget: (target, options) =>
          extensionBridge.focusTarget({
            target,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal
          }),
        stageFiles: (filePaths) => extensionBridge.stageFiles(filePaths),
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
