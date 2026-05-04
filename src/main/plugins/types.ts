import { z } from "zod";
import type { WorkflowPluginCapability } from "../runtime/types";

export const WORKFLOW_PLUGIN_API_VERSION = "1";
export const PLUGIN_MANIFEST_FILE = "plugin.json";

const pluginIdSchema = z.string().min(1).regex(/^[a-zA-Z0-9][\w.-]*$/, "Use letters, numbers, dots, dashes, or underscores.");
const pluginVersionSchema = z.string().min(1).regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/, "Use a stable package version.");
const relativeEntrypointSchema = z.string().min(1).refine((value) => !value.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(value), {
  message: "Entrypoint must be a relative path."
});

export const workflowPluginCapabilitySchema = z.enum(["filesystem.artifacts", "browser", "extension.browser"]);

export const pluginManifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().min(1),
  version: pluginVersionSchema,
  pluginApiVersion: z.string().min(1),
  entrypoint: relativeEntrypointSchema,
  workflows: z.array(pluginIdSchema).min(1),
  capabilities: z.array(workflowPluginCapabilitySchema).default([])
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export interface InstalledPluginRecord {
  pluginId: string;
  name: string;
  version: string;
  pluginApiVersion: string;
  installPath: string;
  manifestPath: string;
  entrypointPath: string;
  workflows: string[];
  capabilities: WorkflowPluginCapability[];
  status: "loaded" | "failed" | "incompatible";
  loadedAt: string;
  error: string | null;
}

export interface PluginInstallResult {
  plugin: InstalledPluginRecord;
}
