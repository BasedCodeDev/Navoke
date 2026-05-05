import type { RuntimeEventBus } from "./eventBus";
import type { RunRecord } from "./types";

export interface ManualWaitRunStore {
  getRun(runId: string): RunRecord | null;
}

export interface ManualWaitNotifier {
  notify(run: RunRecord): void;
}

export function attachManualWaitNotifications(
  eventBus: RuntimeEventBus,
  store: ManualWaitRunStore,
  notifier: ManualWaitNotifier
): () => void {
  const notifiedKeys = new Map<string, string>();
  return eventBus.subscribe((envelope) => {
    if (envelope.kind !== "run-updated") return;
    const run = store.getRun(envelope.runId);
    if (!run || run.status !== "waiting_manual") {
      notifiedKeys.delete(envelope.runId);
      return;
    }

    const key = manualWaitNotificationKey(run);
    if (notifiedKeys.get(run.id) === key) return;
    notifiedKeys.set(run.id, key);
    notifier.notify(run);
  });
}

function manualWaitNotificationKey(run: RunRecord): string {
  return `${run.status}:${run.currentStep ?? ""}`;
}
