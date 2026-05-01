import { EventEmitter } from "node:events";
import type { RuntimeEvent } from "./types";

export type RuntimeEventEnvelope =
  | { kind: "event"; event: RuntimeEvent }
  | { kind: "run-updated"; runId: string }
  | { kind: "artifact-added"; runId: string; artifactId: string }
  | { kind: "system"; message: string; data?: unknown };

export class RuntimeEventBus extends EventEmitter {
  publish(envelope: RuntimeEventEnvelope): void {
    this.emit("message", envelope);
  }

  subscribe(listener: (envelope: RuntimeEventEnvelope) => void): () => void {
    this.on("message", listener);
    return () => this.off("message", listener);
  }
}
