import type { ArtifactRecord, RunArtifactSummary } from "@/lib/api";

const NON_VISUAL_ARTIFACT_KINDS: Array<ArtifactRecord["kind"]> = ["download", "json", "trace", "log"];

export interface RunArtifactCountChip {
  kind: ArtifactRecord["kind"] | "other";
  count: number;
  label: string;
}

export function runArtifactCountChips(summary: RunArtifactSummary): RunArtifactCountChip[] {
  const chips: RunArtifactCountChip[] = [];
  let representedCount = 0;

  for (const kind of NON_VISUAL_ARTIFACT_KINDS) {
    const count = summary.counts[kind] ?? 0;
    if (count <= 0) continue;
    representedCount += count;
    chips.push({ kind, count, label: `${kind} ${count}` });
  }

  const otherCount = Math.max(0, summary.total - summary.visualTotal - representedCount);
  if (otherCount > 0) {
    chips.push({ kind: "other", count: otherCount, label: `other ${otherCount}` });
  }

  return chips;
}
