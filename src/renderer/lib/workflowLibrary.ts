import type { WorkflowLibraryEntry } from "./api";

export function savedLibrarySourceRunIds(entries: WorkflowLibraryEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.sourceRunId).filter((sourceRunId): sourceRunId is string => Boolean(sourceRunId)));
}
