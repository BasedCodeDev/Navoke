import {
  launchPersistentProfile,
  saveScreenshot,
  startTrace,
  stopTrace,
  timeoutMinutes
} from "../automation/browserHarness";
import {
  CHATGPT_EXTENSION_PROTOCOL_VERSION,
  extensionBridge,
  type ChatGptSubjectTaskMode,
  type ChatGptExtensionTaskInput,
  type ChatGptExtensionTaskTarget,
  type ExtensionClientStatus,
  type ExtensionTaskEvent,
  type ExtensionTaskOutput,
  type ExtensionTaskPayload,
  type ExtensionTaskResult
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
  ChatGptExtensionTaskInput,
  ChatGptExtensionTaskTarget,
  ChatGptSubjectTaskMode,
  ExtensionClientStatus,
  ExtensionTaskEvent,
  ExtensionTaskOutput,
  ExtensionTaskPayload,
  ExtensionTaskResult
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
    chatgpt: {
      protocolVersion: typeof CHATGPT_EXTENSION_PROTOCOL_VERSION;
      createConversationTask(input: ChatGptExtensionTaskInput): ExtensionTaskPayload;
      waitForTask(taskId: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<ExtensionTaskResult>;
      subscribeTask(taskId: string, listener: (event: ExtensionTaskEvent) => void): () => void;
      subscribeTaskOutput(taskId: string, listener: (output: ExtensionTaskOutput) => void): () => void;
      requestTaskPause(taskId: string): void;
      cancelTask(taskId: string): void;
      findCompatibleClientForTarget(target: ChatGptExtensionTaskTarget): ExtensionClientStatus | undefined;
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
      chatgpt: {
        protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
        createConversationTask: (input) => extensionBridge.createChatGptConversationTask(input),
        waitForTask: (taskId, options) => extensionBridge.waitForTask(taskId, options),
        subscribeTask: (taskId, listener) => extensionBridge.subscribeTask(taskId, listener),
        subscribeTaskOutput: (taskId, listener) => extensionBridge.subscribeTaskOutput(taskId, listener),
        requestTaskPause: (taskId) => extensionBridge.requestTaskPause(taskId),
        cancelTask: (taskId) => extensionBridge.cancelTask(taskId),
        findCompatibleClientForTarget: (target) => extensionBridge.findCompatibleClientForTarget(target)
      }
    },
    errors: {
      WorkflowConfigurationError
    },
    sleep
  };
}
