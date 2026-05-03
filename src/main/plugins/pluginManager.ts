import fs from "node:fs";
import path from "node:path";
import type { WorkflowDefinition, WorkflowRegistration } from "../runtime/types";
import { createWorkflowSdk, type WorkflowSdk } from "../workflowSdk";
import {
  PLUGIN_MANIFEST_FILE,
  WORKFLOW_PLUGIN_API_VERSION,
  type InstalledPluginRecord,
  type PluginInstallResult,
  type PluginManifest,
  pluginManifestSchema
} from "./types";

interface LoadedPluginVersion {
  record: InstalledPluginRecord;
  workflows: WorkflowRegistration[];
}

type WorkflowFactory = (sdk: WorkflowSdk) => WorkflowDefinition[] | Promise<WorkflowDefinition[]>;

export class PluginManager {
  private readonly pluginRoot: string;
  private installedPlugins: InstalledPluginRecord[] = [];
  private workflowRegistrations: WorkflowRegistration[] = [];

  constructor(userDataDir: string) {
    this.pluginRoot = path.join(userDataDir, "plugins", "workflows");
  }

  get rootDir(): string {
    return this.pluginRoot;
  }

  listPlugins(): InstalledPluginRecord[] {
    return this.installedPlugins;
  }

  listWorkflowRegistrations(): WorkflowRegistration[] {
    return this.workflowRegistrations;
  }

  async reload(): Promise<void> {
    fs.mkdirSync(this.pluginRoot, { recursive: true });
    const sdk = createWorkflowSdk();
    const loaded: LoadedPluginVersion[] = [];
    for (const manifestPath of this.findPluginManifestPaths()) {
      loaded.push(await this.loadPluginVersion(manifestPath, sdk));
    }

    const deduplicated = failDuplicateWorkflowIds(loaded);
    this.installedPlugins = deduplicated
      .map((plugin) => plugin.record)
      .sort((a, b) => `${a.pluginId}@${a.version}`.localeCompare(`${b.pluginId}@${b.version}`));
    this.workflowRegistrations = deduplicated.flatMap((plugin) => plugin.workflows);
  }

  async installFromPath(sourcePath: string): Promise<PluginInstallResult> {
    const sourceDir = path.resolve(sourcePath);
    const manifest = readPluginManifest(path.join(sourceDir, PLUGIN_MANIFEST_FILE));
    const targetDir = this.resolvePluginVersionDir(manifest.id, manifest.version);
    if (fs.existsSync(targetDir)) {
      throw new Error(`Plugin ${manifest.id}@${manifest.version} is already installed.`);
    }

    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    await this.reload();
    const plugin = this.installedPlugins.find((record) => record.pluginId === manifest.id && record.version === manifest.version);
    if (!plugin) throw new Error(`Installed plugin ${manifest.id}@${manifest.version} could not be loaded.`);
    return { plugin };
  }

  async uninstall(pluginId: string, version?: string): Promise<void> {
    const id = pluginId.trim();
    if (!id) throw new Error("Plugin id is required.");

    if (version?.trim()) {
      const targetDir = this.resolvePluginVersionDir(id, version.trim());
      assertPathInside(this.pluginRoot, targetDir);
      if (!fs.existsSync(targetDir)) throw new Error(`Plugin ${id}@${version.trim()} is not installed.`);
      fs.rmSync(targetDir, { recursive: true, force: true });
      await this.reload();
      return;
    }

    const pluginDir = path.resolve(this.pluginRoot, id);
    assertPathInside(this.pluginRoot, pluginDir);
    if (!fs.existsSync(pluginDir)) throw new Error(`Plugin ${id} is not installed.`);
    fs.rmSync(pluginDir, { recursive: true, force: true });
    await this.reload();
  }

  private resolvePluginVersionDir(pluginId: string, version: string): string {
    const resolved = path.resolve(this.pluginRoot, pluginId, version);
    assertPathInside(this.pluginRoot, resolved);
    return resolved;
  }

  private findPluginManifestPaths(): string[] {
    if (!fs.existsSync(this.pluginRoot)) return [];
    const manifestPaths: string[] = [];
    for (const pluginDirName of safeReadDirNames(this.pluginRoot)) {
      const pluginDir = path.join(this.pluginRoot, pluginDirName);
      for (const versionDirName of safeReadDirNames(pluginDir)) {
        const manifestPath = path.join(pluginDir, versionDirName, PLUGIN_MANIFEST_FILE);
        if (fs.existsSync(manifestPath)) manifestPaths.push(manifestPath);
      }
    }
    return manifestPaths.sort();
  }

  private async loadPluginVersion(manifestPath: string, sdk: WorkflowSdk): Promise<LoadedPluginVersion> {
    const loadedAt = new Date().toISOString();
    let manifest: PluginManifest;
    try {
      manifest = readPluginManifest(manifestPath);
    } catch (error) {
      const fallback = failedRecordFromPath(manifestPath, loadedAt, error);
      return { record: fallback, workflows: [] };
    }

    const installPath = path.dirname(manifestPath);
    const entrypointPath = path.resolve(installPath, manifest.entrypoint);
    const baseRecord: InstalledPluginRecord = {
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      pluginApiVersion: manifest.pluginApiVersion,
      installPath,
      manifestPath,
      entrypointPath,
      workflows: manifest.workflows,
      capabilities: manifest.capabilities,
      status: manifest.pluginApiVersion === WORKFLOW_PLUGIN_API_VERSION ? "loaded" : "incompatible",
      loadedAt,
      error:
        manifest.pluginApiVersion === WORKFLOW_PLUGIN_API_VERSION
          ? null
          : `Plugin API ${manifest.pluginApiVersion} is not compatible with app plugin API ${WORKFLOW_PLUGIN_API_VERSION}.`
    };

    if (baseRecord.status === "incompatible") {
      return { record: baseRecord, workflows: [] };
    }

    try {
      assertPathInside(installPath, entrypointPath);
      if (!fs.existsSync(entrypointPath)) throw new Error(`Entrypoint not found: ${entrypointPath}`);
      const workflows = await loadWorkflowDefinitions(entrypointPath, sdk);
      validatePluginWorkflows(manifest, workflows);
      return {
        record: { ...baseRecord, status: "loaded", error: null },
        workflows: workflows.map((definition) => ({
          definition,
          plugin: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            source: "user",
            apiVersion: manifest.pluginApiVersion,
            installPath,
            capabilities: manifest.capabilities
          }
        }))
      };
    } catch (error) {
      return {
        record: { ...baseRecord, status: "failed", error: error instanceof Error ? error.message : String(error) },
        workflows: []
      };
    }
  }
}

function readPluginManifest(manifestPath: string): PluginManifest {
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  return pluginManifestSchema.parse(raw);
}

async function loadWorkflowDefinitions(entrypointPath: string, sdk: WorkflowSdk): Promise<WorkflowDefinition[]> {
  const resolvedEntrypoint = require.resolve(entrypointPath);
  delete require.cache[resolvedEntrypoint];
  const loaded = require(resolvedEntrypoint) as unknown;
  const exported = isRecord(loaded) && "default" in loaded && loaded.default ? loaded.default : loaded;
  const candidate = await resolveWorkflowExport(exported, sdk);
  if (Array.isArray(candidate)) return candidate;
  if (isWorkflowDefinition(candidate)) return [candidate];
  throw new Error("Plugin entrypoint must export a workflow, workflows array, or createWorkflows(sdk) factory.");
}

async function resolveWorkflowExport(exported: unknown, sdk: WorkflowSdk): Promise<unknown> {
  if (typeof exported === "function") return (exported as WorkflowFactory)(sdk);
  if (isRecord(exported)) {
    if (typeof exported.createWorkflows === "function") return (exported.createWorkflows as WorkflowFactory)(sdk);
    if (Array.isArray(exported.workflows)) return exported.workflows;
    if (isWorkflowDefinition(exported.workflow)) return exported.workflow;
  }
  return exported;
}

function validatePluginWorkflows(manifest: PluginManifest, workflows: WorkflowDefinition[]): void {
  if (workflows.length === 0) throw new Error("Plugin exported no workflows.");
  const exportedIds = new Set<string>();
  for (const workflow of workflows) {
    if (!isWorkflowDefinition(workflow)) throw new Error("Plugin exported an invalid workflow definition.");
    if (exportedIds.has(workflow.manifest.id)) throw new Error(`Duplicate workflow id in plugin: ${workflow.manifest.id}`);
    exportedIds.add(workflow.manifest.id);
    if (!manifest.workflows.includes(workflow.manifest.id)) {
      throw new Error(`Workflow ${workflow.manifest.id} is not declared in plugin.json.`);
    }
  }

  for (const workflowId of manifest.workflows) {
    if (!exportedIds.has(workflowId)) throw new Error(`Declared workflow ${workflowId} was not exported by the plugin.`);
  }
}

function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return Boolean(
    isRecord(value) &&
      isRecord(value.manifest) &&
      typeof value.manifest.id === "string" &&
      typeof value.manifest.version === "string" &&
      isRecord(value.inputSchema) &&
      typeof value.inputSchema.safeParse === "function" &&
      isRecord(value.outputSchema) &&
      typeof value.outputSchema.safeParse === "function" &&
      typeof value.run === "function"
  );
}

function failedRecordFromPath(manifestPath: string, loadedAt: string, error: unknown): InstalledPluginRecord {
  const installPath = path.dirname(manifestPath);
  const version = path.basename(installPath);
  const pluginId = path.basename(path.dirname(installPath));
  return {
    pluginId,
    name: pluginId,
    version,
    pluginApiVersion: "unknown",
    installPath,
    manifestPath,
    entrypointPath: installPath,
    workflows: [],
    capabilities: [],
    status: "failed",
    loadedAt,
    error: error instanceof Error ? error.message : String(error)
  };
}

function failDuplicateWorkflowIds(plugins: LoadedPluginVersion[]): LoadedPluginVersion[] {
  const owners = new Map<string, string[]>();
  for (const plugin of plugins) {
    for (const workflow of plugin.workflows) {
      const key = workflow.definition.manifest.id;
      owners.set(key, [...(owners.get(key) ?? []), `${plugin.record.pluginId}@${plugin.record.version}`]);
    }
  }

  const duplicateIds = [...owners.entries()].filter((entry) => entry[1].length > 1);
  if (duplicateIds.length === 0) return plugins;

  const failingPlugins = new Set(duplicateIds.flatMap((entry) => entry[1]));
  const duplicateSummary = duplicateIds.map(([workflowId, pluginIds]) => `${workflowId} (${pluginIds.join(", ")})`).join("; ");

  return plugins.map((plugin) => {
    const pluginKey = `${plugin.record.pluginId}@${plugin.record.version}`;
    if (!failingPlugins.has(pluginKey)) return plugin;
    return {
      record: {
        ...plugin.record,
        status: "failed",
        error: `Duplicate workflow id across installed plugins: ${duplicateSummary}`
      },
      workflows: []
    };
  });
}

function safeReadDirNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function assertPathInside(parent: string, candidate: string): void {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  const parentKey = pathComparisonKey(resolvedParent);
  const candidateKey = pathComparisonKey(resolvedCandidate);
  if (candidateKey !== parentKey && !candidateKey.startsWith(`${parentKey}${path.sep}`)) {
    throw new Error(`Path is outside the plugin directory: ${resolvedCandidate}`);
  }
}

function pathComparisonKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
