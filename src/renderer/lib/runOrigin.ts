import type { RunRecord } from "./api";

const ACTIVE_STATUSES = new Set(["queued", "running", "pausing", "waiting_manual"]);

export function isCliRun(run: Pick<RunRecord, "origin"> | undefined): boolean {
  return run?.origin?.source === "cli";
}

export function runOriginLabel(run: Pick<RunRecord, "origin"> | undefined): string {
  if (run?.origin?.source !== "cli") return "UI";
  return run.origin.agentName ? `CLI: ${run.origin.agentName}` : "CLI";
}

export function runOriginCommand(run: Pick<RunRecord, "origin"> | undefined): string | null {
  return run?.origin?.source === "cli" && run.origin.command ? run.origin.command : null;
}

export function activeCliAgentRuns(runs: RunRecord[]): RunRecord[] {
  return runs.filter((run) => isCliRun(run) && ACTIVE_STATUSES.has(run.status));
}
