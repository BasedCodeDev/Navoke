import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SqliteStore } from "../db/sqliteStore";
import { copyFileToDir } from "../utils/files";
import { getLibraryEntryDir, getLibraryEntryInputDir } from "./paths";
import { productIdsMatch } from "./legacyCompatibility";
import type { RunRecord, RuntimePaths, WorkflowLibraryEntry, WorkflowRegistration, WorkflowRegistry } from "./types";

export function createWorkflowLibraryEntryFromRun(input: {
  store: SqliteStore;
  paths: RuntimePaths;
  workflows: WorkflowRegistry;
  runId: string;
  name?: string;
}): WorkflowLibraryEntry {
  const run = input.store.getRun(input.runId);
  if (!run) throw new Error(`Run not found: ${input.runId}`);
  const existingEntry = input.store.getWorkflowLibraryEntryBySourceRunId(run.id);
  if (existingEntry) {
    throw new Error(`Run is already saved to the library as "${existingEntry.name}".`);
  }

  const id = randomUUID();
  const entryDir = getLibraryEntryDir(input.paths, id);
  try {
    const copiedInput = copyLibraryInputFiles({
      input: run.input,
      targetInputDir: getLibraryEntryInputDir(input.paths, id),
      registration: workflowRegistrationForRun(run, input.workflows)
    });
    const entry = input.store.createWorkflowLibraryEntry({
      id,
      name: input.name?.trim() || run.name || "Library entry",
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion ?? null,
      pluginId: run.pluginId ?? null,
      pluginVersion: run.pluginVersion ?? null,
      pluginApiVersion: run.pluginApiVersion ?? null,
      pluginSource: run.pluginSource ?? null,
      sourceRunId: run.id,
      input: copiedInput
    });
    return entry;
  } catch (error) {
    fs.rmSync(entryDir, { recursive: true, force: true });
    throw error;
  }
}

export function deleteWorkflowLibraryEntry(input: {
  store: SqliteStore;
  paths: RuntimePaths;
  entryId: string;
}): void {
  const entry = input.store.getWorkflowLibraryEntry(input.entryId);
  if (!entry) throw new Error(`Workflow library entry not found: ${input.entryId}`);
  deleteWorkflowLibraryEntryData(input.paths, input.entryId);
  input.store.deleteWorkflowLibraryEntry(input.entryId);
}

export function mergeLibraryInput(input: unknown, overrides: unknown): unknown {
  if (overrides === undefined || overrides === null) return input;
  if (!isRecord(input) || !isRecord(overrides)) return overrides;
  const merged: Record<string, unknown> = { ...input };
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = isRecord(merged[key]) && isRecord(value) ? mergeLibraryInput(merged[key], value) : value;
  }
  return merged;
}

function copyLibraryInputFiles(input: {
  input: unknown;
  targetInputDir: string;
  registration?: WorkflowRegistration;
}): unknown {
  if (!isRecord(input.input)) return input.input;

  const copiedInput: Record<string, unknown> = { ...input.input };
  const fileFields = workflowFileInputFields(input.registration, copiedInput);

  for (const field of fileFields) {
    const value = copiedInput[field];
    if (typeof value === "string") {
      if (!value.trim()) continue;
      copiedInput[field] = copyOneLibraryFile(value, input.targetInputDir, field, 0);
      continue;
    }
    if (!Array.isArray(value)) continue;
    copiedInput[field] = value.map((item, index) =>
      typeof item === "string" ? copyOneLibraryFile(item, input.targetInputDir, field, index) : item
    );
  }

  return copiedInput;
}

function workflowFileInputFields(registration: WorkflowRegistration | undefined, input: Record<string, unknown>): string[] {
  const manifestFields =
    registration?.definition.manifest.inputFields
      .filter((field) => field.type === "fileList")
      .map((field) => field.name) ?? [];
  return [...new Set(manifestFields.filter((field) => field in input))];
}

function copyOneLibraryFile(filePath: string, targetInputDir: string, field: string, index: number): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    throw new Error(
      `Cannot save run to library because input file is missing or inaccessible: ${filePath}. ` +
        (error instanceof Error ? error.message : String(error))
    );
  }
  if (!stat.isFile()) {
    throw new Error(`Cannot save run to library because input path is not a file: ${filePath}`);
  }
  return copyFileToDir(filePath, path.join(targetInputDir, field), `${String(index + 1).padStart(2, "0")}-`);
}

function workflowRegistrationForRun(run: RunRecord, workflows: WorkflowRegistry): WorkflowRegistration | undefined {
  const registration = workflows.get(run.workflowId);
  if (!registration) return undefined;
  if (!run.pluginId || !run.pluginVersion) return registration;
  const plugin = registration.plugin;
  if (
    productIdsMatch(plugin.id, run.pluginId) &&
    plugin.version === run.pluginVersion &&
    plugin.apiVersion === (run.pluginApiVersion ?? plugin.apiVersion)
  ) {
    return registration;
  }
  return undefined;
}

function deleteWorkflowLibraryEntryData(paths: RuntimePaths, entryId: string): void {
  const libraryRoot = path.resolve(paths.libraryDir);
  const entryDir = path.resolve(getLibraryEntryDir(paths, entryId));
  if (entryDir === libraryRoot || !isSameOrChildPath(entryDir, libraryRoot)) {
    throw new Error(`Refusing to delete workflow library path outside project library: ${entryDir}`);
  }
  fs.rmSync(entryDir, { recursive: true, force: true });
}

function isSameOrChildPath(candidate: string, parent: string): boolean {
  const comparisonCandidate = pathComparisonKey(candidate);
  const comparisonParent = pathComparisonKey(parent);
  return comparisonCandidate === comparisonParent || comparisonCandidate.startsWith(`${comparisonParent}${path.sep}`);
}

function pathComparisonKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
