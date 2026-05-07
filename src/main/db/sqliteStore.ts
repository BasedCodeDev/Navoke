import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { fileSize } from "../utils/files";
import { normalizeRunOrigin } from "../runtime/runOrigin";
import type {
  ArtifactRecord,
  ArtifactKind,
  RunArtifactSummary,
  RunListRecord,
  RunOrigin,
  RunRecord,
  RunStatus,
  RuntimeEvent,
  WorkflowLibraryEntry
} from "../runtime/types";

function nowIso(): string {
  return new Date().toISOString();
}

const RUN_NUMBER_COUNTER_KEY = "runNumberCounter";
const RUN_ARTIFACT_PREVIEW_LIMIT = 4;
const VISUAL_ARTIFACT_KIND_PRIORITY: Partial<Record<ArtifactKind, number>> = {
  image: 0,
  model: 1,
  screenshot: 2
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return null;
  return JSON.parse(value);
}

function rowToRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowVersion: row.workflow_version ? String(row.workflow_version) : null,
    pluginId: row.plugin_id ? String(row.plugin_id) : null,
    pluginVersion: row.plugin_version ? String(row.plugin_version) : null,
    pluginApiVersion: row.plugin_api_version ? String(row.plugin_api_version) : null,
    pluginSource: row.plugin_source ? (String(row.plugin_source) as RunRecord["pluginSource"]) : null,
    origin: normalizeRunOrigin(parseJson(row.origin_json)),
    runNumber: row.run_number === null || row.run_number === undefined ? null : Number(row.run_number),
    name: String(row.name),
    runDir: row.run_dir ? String(row.run_dir) : null,
    status: String(row.status) as RunStatus,
    currentStep: row.current_step ? String(row.current_step) : null,
    progress: Number(row.progress ?? 0),
    input: parseJson(row.input_json),
    output: parseJson(row.output_json),
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToEvent(row: Record<string, unknown>): RuntimeEvent {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    type: String(row.type),
    message: String(row.message),
    data: parseJson(row.data_json),
    createdAt: String(row.created_at)
  };
}

function rowToArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    kind: String(row.kind) as ArtifactKind,
    name: String(row.name),
    path: String(row.path),
    mimeType: row.mime_type ? String(row.mime_type) : null,
    size: Number(row.size ?? 0),
    metadata: parseJson(row.metadata_json),
    createdAt: String(row.created_at)
  };
}

function buildRunArtifactSummary(artifacts: ArtifactRecord[]): RunArtifactSummary {
  const counts: Partial<Record<ArtifactKind, number>> = {};
  for (const artifact of artifacts) {
    counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1;
  }

  const visualArtifacts = artifacts
    .filter((artifact) => VISUAL_ARTIFACT_KIND_PRIORITY[artifact.kind] !== undefined)
    .sort((left, right) => {
      const kindPriority = VISUAL_ARTIFACT_KIND_PRIORITY[left.kind]! - VISUAL_ARTIFACT_KIND_PRIORITY[right.kind]!;
      if (kindPriority !== 0) return kindPriority;
      return left.createdAt.localeCompare(right.createdAt);
    });
  const previews = visualArtifacts.slice(0, RUN_ARTIFACT_PREVIEW_LIMIT).map((artifact) => ({
    id: artifact.id,
    runId: artifact.runId,
    kind: artifact.kind,
    name: artifact.name,
    mimeType: artifact.mimeType,
    size: artifact.size,
    metadata: artifact.metadata,
    createdAt: artifact.createdAt
  }));

  return {
    previews,
    visualTotal: visualArtifacts.length,
    hiddenVisualCount: Math.max(0, visualArtifacts.length - previews.length),
    counts,
    total: artifacts.length
  };
}

function rowToWorkflowLibraryEntry(row: Record<string, unknown>): WorkflowLibraryEntry {
  return {
    id: String(row.id),
    name: String(row.name),
    workflowId: String(row.workflow_id),
    workflowVersion: row.workflow_version ? String(row.workflow_version) : null,
    pluginId: row.plugin_id ? String(row.plugin_id) : null,
    pluginVersion: row.plugin_version ? String(row.plugin_version) : null,
    pluginApiVersion: row.plugin_api_version ? String(row.plugin_api_version) : null,
    pluginSource: row.plugin_source ? (String(row.plugin_source) as WorkflowLibraryEntry["pluginSource"]) : null,
    sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    input: parseJson(row.input_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class SqliteStore {
  private constructor(
    private readonly dbPath: string,
    private readonly db: SqlJsDatabase
  ) {}

  static async open(dbPath: string): Promise<SqliteStore> {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm") as string;
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
    const store = new SqliteStore(dbPath, db);
    store.migrate();
    store.recoverInterruptedRuns();
    store.persist();
    return store;
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  createRun(input: {
    id: string;
    workflowId: string;
    workflowVersion?: string | null;
    pluginId?: string | null;
    pluginVersion?: string | null;
    pluginApiVersion?: string | null;
    pluginSource?: RunRecord["pluginSource"];
    origin?: RunOrigin;
    runNumber?: number | null;
    name: string;
    runDir?: string | null;
    status: RunStatus;
    input: unknown;
  }): RunRecord {
    const createdAt = nowIso();
    const runNumber = Number.isInteger(input.runNumber) && Number(input.runNumber) > 0 ? Number(input.runNumber) : this.nextRunNumber();
    this.db.run(
      `insert into runs (
        id, workflow_id, workflow_version, plugin_id, plugin_version, plugin_api_version, plugin_source,
        origin_json, run_number, name, run_dir, status, current_step, progress, input_json, output_json, error, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 0, ?, null, null, ?, ?)`,
      [
        input.id,
        input.workflowId,
        input.workflowVersion ?? null,
        input.pluginId ?? null,
        input.pluginVersion ?? null,
        input.pluginApiVersion ?? null,
        input.pluginSource ?? null,
        JSON.stringify(normalizeRunOrigin(input.origin)),
        runNumber,
        input.name,
        input.runDir ?? null,
        input.status,
        JSON.stringify(input.input),
        createdAt,
        createdAt
      ]
    );
    this.setRunNumberCounterAtLeast(runNumber);
    this.persist();
    const run = this.getRun(input.id);
    if (!run) throw new Error("Failed to create run");
    return run;
  }

  listRuns(): RunRecord[] {
    return this.all<Record<string, unknown>>("select * from runs order by run_number desc, created_at desc").map(rowToRun);
  }

  listRunsWithArtifactSummaries(): RunListRecord[] {
    const runs = this.listRuns();
    const artifactsByRunId = new Map<string, ArtifactRecord[]>();
    for (const artifact of this.all<Record<string, unknown>>("select * from artifacts order by created_at asc").map(rowToArtifact)) {
      const artifacts = artifactsByRunId.get(artifact.runId) ?? [];
      artifacts.push(artifact);
      artifactsByRunId.set(artifact.runId, artifacts);
    }
    return runs.map((run) => ({
      ...run,
      artifactSummary: buildRunArtifactSummary(artifactsByRunId.get(run.id) ?? [])
    }));
  }

  nextRunNumber(): number {
    const nextRunNumber = Math.max(this.maxRunNumber(), this.metadataNumber(RUN_NUMBER_COUNTER_KEY)) + 1;
    this.setMetadataNumber(RUN_NUMBER_COUNTER_KEY, nextRunNumber);
    this.persist();
    return nextRunNumber;
  }

  getRun(id: string): RunRecord | null {
    const row = this.get<Record<string, unknown>>("select * from runs where id = ?", [id]);
    return row ? rowToRun(row) : null;
  }

  deleteRunCascade(id: string): void {
    if (!this.getRun(id)) throw new Error(`Run not found: ${id}`);
    this.db.run("delete from artifacts where run_id = ?", [id]);
    this.db.run("delete from events where run_id = ?", [id]);
    this.db.run("delete from runs where id = ?", [id]);
    this.persist();
  }

  createWorkflowLibraryEntry(input: {
    id: string;
    name: string;
    workflowId: string;
    workflowVersion?: string | null;
    pluginId?: string | null;
    pluginVersion?: string | null;
    pluginApiVersion?: string | null;
    pluginSource?: WorkflowLibraryEntry["pluginSource"];
    sourceRunId?: string | null;
    input: unknown;
  }): WorkflowLibraryEntry {
    const createdAt = nowIso();
    this.db.run(
      `insert into workflow_library_entries (
        id, name, workflow_id, workflow_version, plugin_id, plugin_version, plugin_api_version, plugin_source,
        source_run_id, input_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.name,
        input.workflowId,
        input.workflowVersion ?? null,
        input.pluginId ?? null,
        input.pluginVersion ?? null,
        input.pluginApiVersion ?? null,
        input.pluginSource ?? null,
        input.sourceRunId ?? null,
        JSON.stringify(input.input),
        createdAt,
        createdAt
      ]
    );
    this.persist();
    const entry = this.getWorkflowLibraryEntry(input.id);
    if (!entry) throw new Error("Failed to create workflow library entry");
    return entry;
  }

  listWorkflowLibraryEntries(): WorkflowLibraryEntry[] {
    return this.all<Record<string, unknown>>("select * from workflow_library_entries order by updated_at desc, created_at desc").map(
      rowToWorkflowLibraryEntry
    );
  }

  getWorkflowLibraryEntry(id: string): WorkflowLibraryEntry | null {
    const row = this.get<Record<string, unknown>>("select * from workflow_library_entries where id = ?", [id]);
    return row ? rowToWorkflowLibraryEntry(row) : null;
  }

  getWorkflowLibraryEntryBySourceRunId(sourceRunId: string): WorkflowLibraryEntry | null {
    const row = this.get<Record<string, unknown>>(
      "select * from workflow_library_entries where source_run_id = ? order by created_at asc, id asc",
      [sourceRunId]
    );
    return row ? rowToWorkflowLibraryEntry(row) : null;
  }

  updateWorkflowLibraryEntry(
    id: string,
    patch: Partial<Pick<WorkflowLibraryEntry, "name" | "input">>
  ): WorkflowLibraryEntry {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [nowIso()];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.input !== undefined) {
      sets.push("input_json = ?");
      params.push(JSON.stringify(patch.input));
    }
    params.push(id);
    this.db.run(`update workflow_library_entries set ${sets.join(", ")} where id = ?`, params as any);
    this.persist();
    const entry = this.getWorkflowLibraryEntry(id);
    if (!entry) throw new Error(`Workflow library entry not found after update: ${id}`);
    return entry;
  }

  deleteWorkflowLibraryEntry(id: string): void {
    if (!this.getWorkflowLibraryEntry(id)) throw new Error(`Workflow library entry not found: ${id}`);
    this.db.run("delete from workflow_library_entries where id = ?", [id]);
    this.persist();
  }

  updateRun(
    id: string,
    patch: Partial<Pick<RunRecord, "name" | "runDir" | "status" | "currentStep" | "progress" | "input" | "output" | "error">>
  ): RunRecord {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [nowIso()];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.runDir !== undefined) {
      sets.push("run_dir = ?");
      params.push(patch.runDir);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (patch.currentStep !== undefined) {
      sets.push("current_step = ?");
      params.push(patch.currentStep);
    }
    if (patch.progress !== undefined) {
      sets.push("progress = ?");
      params.push(Math.max(0, Math.min(100, patch.progress)));
    }
    if (patch.input !== undefined) {
      sets.push("input_json = ?");
      params.push(JSON.stringify(patch.input));
    }
    if (patch.output !== undefined) {
      sets.push("output_json = ?");
      params.push(JSON.stringify(patch.output));
    }
    if (patch.error !== undefined) {
      sets.push("error = ?");
      params.push(patch.error);
    }
    params.push(id);
    this.db.run(`update runs set ${sets.join(", ")} where id = ?`, params as any);
    this.persist();
    const run = this.getRun(id);
    if (!run) throw new Error(`Run not found after update: ${id}`);
    return run;
  }

  addEvent(input: { runId: string; type: string; message: string; data?: unknown }): RuntimeEvent {
    const createdAt = nowIso();
    this.db.run(
      "insert into events (run_id, type, message, data_json, created_at) values (?, ?, ?, ?, ?)",
      [input.runId, input.type, input.message, JSON.stringify(input.data ?? null), createdAt]
    );
    const idRow = this.get<Record<string, unknown>>("select last_insert_rowid() as id");
    const row = idRow ? this.get<Record<string, unknown>>("select * from events where id = ?", [Number(idRow.id)]) : null;
    this.persist();
    if (!row) throw new Error("Failed to insert event");
    return rowToEvent(row);
  }

  listEvents(runId: string): RuntimeEvent[] {
    return this.all<Record<string, unknown>>("select * from events where run_id = ? order by id asc", [runId]).map(
      rowToEvent
    );
  }

  addArtifact(input: {
    id: string;
    runId: string;
    kind: ArtifactKind;
    name: string;
    path: string;
    mimeType?: string | null;
    metadata?: unknown;
  }): ArtifactRecord {
    const createdAt = nowIso();
    this.db.run(
      `insert into artifacts (
        id, run_id, kind, name, path, mime_type, size, metadata_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.runId,
        input.kind,
        input.name,
        input.path,
        input.mimeType ?? null,
        fileSize(input.path),
        JSON.stringify(input.metadata ?? null),
        createdAt
      ]
    );
    this.persist();
    const artifact = this.getArtifact(input.id);
    if (!artifact) throw new Error("Failed to insert artifact");
    return artifact;
  }

  getArtifact(id: string): ArtifactRecord | null {
    const row = this.get<Record<string, unknown>>("select * from artifacts where id = ?", [id]);
    return row ? rowToArtifact(row) : null;
  }

  listArtifacts(runId: string): ArtifactRecord[] {
    return this.all<Record<string, unknown>>("select * from artifacts where run_id = ? order by created_at asc", [
      runId
    ]).map(rowToArtifact);
  }

  updateArtifact(
    id: string,
    patch: Partial<Pick<ArtifactRecord, "path" | "metadata">>
  ): ArtifactRecord {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.path !== undefined) {
      sets.push("path = ?", "size = ?");
      params.push(patch.path, fileSize(patch.path));
    }
    if (patch.metadata !== undefined) {
      sets.push("metadata_json = ?");
      params.push(JSON.stringify(patch.metadata));
    }
    if (sets.length === 0) {
      const artifact = this.getArtifact(id);
      if (!artifact) throw new Error(`Artifact not found: ${id}`);
      return artifact;
    }
    params.push(id);
    this.db.run(`update artifacts set ${sets.join(", ")} where id = ?`, params as any);
    this.persist();
    const artifact = this.getArtifact(id);
    if (!artifact) throw new Error(`Artifact not found after update: ${id}`);
    return artifact;
  }

  private recoverInterruptedRuns(): void {
    this.db.run(
      "update runs set status = 'failed', error = 'App exited before this run finished.', updated_at = ? where status in ('running', 'pausing', 'waiting_manual')",
      [nowIso()]
    );
  }

  private migrate(): void {
    this.db.run(`
      create table if not exists runs (
        id text primary key,
        workflow_id text not null,
        workflow_version text,
        plugin_id text,
        plugin_version text,
        plugin_api_version text,
        plugin_source text,
        origin_json text,
        run_number integer,
        name text not null,
        run_dir text,
        status text not null,
        current_step text,
        progress integer not null default 0,
        input_json text not null,
        output_json text,
        error text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists events (
        id integer primary key autoincrement,
        run_id text not null,
        type text not null,
        message text not null,
        data_json text,
        created_at text not null,
        foreign key (run_id) references runs(id)
      );

      create table if not exists artifacts (
        id text primary key,
        run_id text not null,
        kind text not null,
        name text not null,
        path text not null,
        mime_type text,
        size integer not null default 0,
        metadata_json text,
        created_at text not null,
        foreign key (run_id) references runs(id)
      );

      create table if not exists workflow_library_entries (
        id text primary key,
        name text not null,
        workflow_id text not null,
        workflow_version text,
        plugin_id text,
        plugin_version text,
        plugin_api_version text,
        plugin_source text,
        source_run_id text,
        input_json text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists metadata (
        key text primary key,
        value text not null
      );

      create index if not exists idx_runs_status on runs(status);
      create index if not exists idx_events_run_id on events(run_id);
      create index if not exists idx_artifacts_run_id on artifacts(run_id);
      create index if not exists idx_workflow_library_workflow_id on workflow_library_entries(workflow_id);
      create index if not exists idx_workflow_library_source_run_id on workflow_library_entries(source_run_id);
    `);
    this.addColumnIfMissing("runs", "run_dir text");
    this.addColumnIfMissing("runs", "workflow_version text");
    this.addColumnIfMissing("runs", "plugin_id text");
    this.addColumnIfMissing("runs", "plugin_version text");
    this.addColumnIfMissing("runs", "plugin_api_version text");
    this.addColumnIfMissing("runs", "plugin_source text");
    this.addColumnIfMissing("runs", "origin_json text");
    this.addColumnIfMissing("runs", "run_number integer");
    this.backfillRunNumbers();
    this.setRunNumberCounterAtLeast(this.maxRunNumber());
  }

  private backfillRunNumbers(): void {
    let nextRunNumber = Math.max(this.maxRunNumber(), this.metadataNumber(RUN_NUMBER_COUNTER_KEY)) + 1;
    const missingRuns = this.all<Record<string, unknown>>(
      "select id from runs where run_number is null order by created_at asc, id asc"
    );
    for (const run of missingRuns) {
      this.db.run("update runs set run_number = ? where id = ?", [nextRunNumber, String(run.id)]);
      nextRunNumber += 1;
    }
  }

  private maxRunNumber(): number {
    const row = this.get<Record<string, unknown>>("select max(run_number) as max_run_number from runs");
    const maxRunNumber = Number(row?.max_run_number ?? 0);
    return Number.isFinite(maxRunNumber) ? maxRunNumber : 0;
  }

  private metadataNumber(key: string): number {
    const row = this.get<Record<string, unknown>>("select value from metadata where key = ?", [key]);
    const value = Number(row?.value ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  private setRunNumberCounterAtLeast(value: number): void {
    if (!Number.isFinite(value) || value <= this.metadataNumber(RUN_NUMBER_COUNTER_KEY)) return;
    this.setMetadataNumber(RUN_NUMBER_COUNTER_KEY, value);
  }

  private setMetadataNumber(key: string, value: number): void {
    this.db.run("insert or replace into metadata (key, value) values (?, ?)", [key, String(Math.trunc(value))]);
  }

  private addColumnIfMissing(table: string, columnDefinition: string): void {
    try {
      this.db.run(`alter table ${table} add column ${columnDefinition}`);
    } catch {
      // Existing databases already have this column.
    }
  }

  private all<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as any);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private get<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }

  private persist(): void {
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }
}
