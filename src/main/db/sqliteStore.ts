import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { fileSize } from "../utils/files";
import type { ArtifactRecord, ArtifactKind, RunRecord, RunStatus, RuntimeEvent } from "../runtime/types";

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return null;
  return JSON.parse(value);
}

function rowToRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    name: String(row.name),
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
    name: string;
    status: RunStatus;
    input: unknown;
  }): RunRecord {
    const createdAt = nowIso();
    this.db.run(
      `insert into runs (
        id, workflow_id, name, status, current_step, progress, input_json, output_json, error, created_at, updated_at
      ) values (?, ?, ?, ?, null, 0, ?, null, null, ?, ?)`,
      [input.id, input.workflowId, input.name, input.status, JSON.stringify(input.input), createdAt, createdAt]
    );
    this.persist();
    const run = this.getRun(input.id);
    if (!run) throw new Error("Failed to create run");
    return run;
  }

  listRuns(): RunRecord[] {
    return this.all<Record<string, unknown>>("select * from runs order by created_at desc").map(rowToRun);
  }

  getRun(id: string): RunRecord | null {
    const row = this.get<Record<string, unknown>>("select * from runs where id = ?", [id]);
    return row ? rowToRun(row) : null;
  }

  updateRun(
    id: string,
    patch: Partial<Pick<RunRecord, "status" | "currentStep" | "progress" | "output" | "error">>
  ): RunRecord {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [nowIso()];
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

  private recoverInterruptedRuns(): void {
    this.db.run(
      "update runs set status = 'failed', error = 'App exited before this run finished.', updated_at = ? where status in ('running', 'waiting_manual')",
      [nowIso()]
    );
  }

  private migrate(): void {
    this.db.run(`
      create table if not exists runs (
        id text primary key,
        workflow_id text not null,
        name text not null,
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

      create index if not exists idx_runs_status on runs(status);
      create index if not exists idx_events_run_id on events(run_id);
      create index if not exists idx_artifacts_run_id on artifacts(run_id);
    `);
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
