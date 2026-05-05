import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import type { ExtensionBridge } from "../extension/extensionBridge";
import type { SqliteStore } from "../db/sqliteStore";
import type { PluginManager } from "../plugins/pluginManager";
import type { LocalWorkflowRunner } from "../runtime/localWorkflowRunner";
import type { RuntimeEventBus } from "../runtime/eventBus";
import type { PublicWorkflow, RuntimePaths, WorkflowLibraryEntry, WorkflowRegistration, WorkflowRegistry } from "../runtime/types";
import type { WorkflowLab, WorkflowLabAction } from "../lab/workflowLab";
import type { LabWaitCondition } from "../lab/waitConditions";
import { inferMimeType } from "../utils/files";
import {
  createWorkflowLibraryEntryFromRun,
  deleteWorkflowLibraryEntry,
  mergeLibraryInput
} from "../runtime/workflowLibrary";

interface ApiServerOptions {
  store: SqliteStore;
  runner: LocalWorkflowRunner;
  eventBus: RuntimeEventBus;
  workflows: WorkflowRegistry;
  plugins: PluginManager;
  reloadWorkflows(): Promise<void>;
  paths: RuntimePaths;
  extensionBridge: ExtensionBridge;
  workflowLab: WorkflowLab;
}

export class ApiServer {
  private server: Server | null = null;
  private portValue = 0;

  constructor(private readonly options: ApiServerOptions) {}

  async start(preferredPort = 39201): Promise<number> {
    const app = express();
    app.use(cors({ origin: true }));
    app.use(express.json({ limit: "100mb" }));

    app.get("/api/health", (_req, res) => {
      res.json({ ok: true });
    });

    app.get("/api/system", (_req, res) => {
      res.json({
        paths: this.options.paths,
        runner: this.options.runner.stats(),
        plugins: {
          rootDir: this.options.plugins.rootDir,
          installed: this.options.plugins.listPlugins().length
        },
        extension: this.options.extensionBridge.status()
      });
    });

    app.get("/api/plugins", (_req, res) => {
      res.json({ rootDir: this.options.plugins.rootDir, plugins: this.options.plugins.listPlugins() });
    });

    app.post("/api/plugins/install", (req, res, next) => {
      void this.options.plugins
        .installFromPath(String(req.body?.path ?? ""))
        .then(async (result) => {
          await this.options.reloadWorkflows();
          res.status(201).json(result);
        })
        .catch(next);
    });

    app.delete("/api/plugins/:id", (req, res, next) => {
      void this.options.plugins
        .uninstall(req.params.id, typeof req.query.version === "string" ? req.query.version : undefined)
        .then(async () => {
          await this.options.reloadWorkflows();
          res.json({ id: req.params.id, deleted: true });
        })
        .catch(next);
    });

    app.get("/api/lab/sessions", (_req, res) => {
      res.json(this.options.workflowLab.listSessions());
    });

    app.post("/api/lab/sessions", (req, res, next) => {
      void this.options.workflowLab
        .createSession({
          mode: req.body?.mode,
          targetUrl: req.body?.targetUrl,
          profileWorkflowId: req.body?.profileWorkflowId,
          profileName: req.body?.profileName,
          clientId: req.body?.clientId
        })
        .then((session) => res.status(201).json(session))
        .catch(next);
    });

    app.get("/api/lab/sessions/:id", (req, res, next) => {
      try {
        res.json(this.options.workflowLab.getSession(req.params.id));
      } catch (error) {
        next(error);
      }
    });

    app.delete("/api/lab/sessions/:id", (req, res, next) => {
      void this.options.workflowLab.closeSession(req.params.id).then((session) => res.json(session)).catch(next);
    });

    app.get("/api/lab/sessions/:id/files/:fileId", (req, res, next) => {
      try {
        const file = this.options.workflowLab.getStagedFile(req.params.id, req.params.fileId);
        res.type(file.mimeType);
        res.sendFile(file.path);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/lab/sessions/:id/inspect", (req, res, next) => {
      void this.options.workflowLab.inspect(req.params.id).then((result) => res.json(result)).catch(next);
    });

    app.post("/api/lab/sessions/:id/actions", (req, res, next) => {
      void this.options.workflowLab
        .runAction(req.params.id, req.body?.action as WorkflowLabAction)
        .then((result) => res.json(result))
        .catch(next);
    });

    app.post("/api/lab/sessions/:id/wait", (req, res, next) => {
      void this.options.workflowLab
        .waitFor(req.params.id, req.body?.condition as LabWaitCondition)
        .then((result) => res.json(result))
        .catch(next);
    });

    app.get("/api/workflows", (_req, res) => {
      res.json([...this.options.workflows.values()].map(publicWorkflow));
    });

    app.post("/api/files/validate", (req, res) => {
      const paths = Array.isArray(req.body?.paths)
        ? req.body.paths.filter((item: unknown): item is string => typeof item === "string")
        : [];
      res.json({ files: paths.map(validateLocalFilePath) });
    });

    app.get("/api/library", (_req, res) => {
      res.json(this.options.store.listWorkflowLibraryEntries());
    });

    app.get("/api/library/:id", (req, res) => {
      const entry = this.options.store.getWorkflowLibraryEntry(req.params.id);
      if (!entry) {
        res.status(404).json({ error: "Workflow library entry not found" });
        return;
      }
      res.json(entry);
    });

    app.post("/api/library/from-run", (req, res, next) => {
      try {
        const entry = createWorkflowLibraryEntryFromRun({
          store: this.options.store,
          paths: this.options.paths,
          workflows: this.options.workflows,
          runId: String(req.body?.runId ?? ""),
          name: typeof req.body?.name === "string" ? req.body.name : undefined
        });
        res.status(201).json(entry);
      } catch (error) {
        next(error);
      }
    });

    app.patch("/api/library/:id", (req, res, next) => {
      try {
        const name = String(req.body?.name ?? "").trim();
        if (!name) throw new Error("Library entry name is required.");
        res.json(this.options.store.updateWorkflowLibraryEntry(req.params.id, { name }));
      } catch (error) {
        next(error);
      }
    });

    app.delete("/api/library/:id", (req, res, next) => {
      try {
        deleteWorkflowLibraryEntry({ store: this.options.store, paths: this.options.paths, entryId: req.params.id });
        res.json({ id: req.params.id, deleted: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/library/:id/runs", (req, res, next) => {
      try {
        const entry = this.options.store.getWorkflowLibraryEntry(req.params.id);
        if (!entry) {
          res.status(404).json({ error: "Workflow library entry not found" });
          return;
        }
        assertWorkflowLibraryEntryIsRunnable(entry, this.options.workflows);
        const workflowInput = mergeLibraryInput(entry.input, req.body?.inputOverrides);
        const run = this.options.runner.enqueue({
          workflowId: entry.workflowId,
          name: typeof req.body?.name === "string" ? req.body.name : entry.name,
          workflowInput,
          origin: req.body?.origin
        });
        res.status(201).json(run);
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/runs", (_req, res) => {
      res.json(this.options.store.listRuns());
    });

    app.post("/api/runs", (req, res, next) => {
      try {
        const run = this.options.runner.enqueue({
          workflowId: String(req.body.workflowId ?? ""),
          name: req.body.name,
          workflowInput: req.body.input ?? {},
          origin: req.body.origin
        });
        res.status(201).json(run);
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/runs/:id", (req, res) => {
      const run = this.options.store.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      res.json({
        run,
        events: this.options.store.listEvents(req.params.id),
        artifacts: this.options.store.listArtifacts(req.params.id)
      });
    });

    app.patch("/api/runs/:id", (req, res, next) => {
      try {
        res.json(this.options.runner.renameRun(req.params.id, String(req.body?.name ?? "")));
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/runs/:id/input-files/:field/:index", (req, res, next) => {
      try {
        const run = this.options.store.getRun(req.params.id);
        if (!run) {
          res.status(404).json({ error: "Run not found" });
          return;
        }
        const filePath = getRunInputFilePath(run.input, req.params.field, Number(req.params.index));
        if (!filePath || !fs.existsSync(filePath)) {
          res.status(404).json({ error: "Run input file not found" });
          return;
        }
        res.sendFile(filePath);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/runs/:id/cancel", (req, res, next) => {
      try {
        res.json(this.options.runner.cancel(req.params.id));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/runs/:id/pause", (req, res, next) => {
      try {
        res.json(this.options.runner.pause(req.params.id));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/runs/:id/resume", (req, res, next) => {
      try {
        res.json(this.options.runner.resume(req.params.id));
      } catch (error) {
        next(error);
      }
    });

    app.delete("/api/runs/:id", async (req, res, next) => {
      try {
        await this.options.runner.deleteRun(req.params.id);
        res.json({ id: req.params.id, deleted: true });
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/artifacts/:id/file", (req, res) => {
      const artifact = this.options.store.getArtifact(req.params.id);
      if (!artifact || !fs.existsSync(artifact.path)) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      if (artifact.mimeType) {
        res.type(artifact.mimeType);
      }
      res.sendFile(artifact.path);
    });

    app.get("/api/artifacts/:id/download", (req, res) => {
      const artifact = this.options.store.getArtifact(req.params.id);
      if (!artifact || !fs.existsSync(artifact.path)) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      res.download(artifact.path, artifact.name);
    });

    app.get("/api/artifacts/:id/assets/*", (req, res, next) => {
      try {
        const artifact = this.options.store.getArtifact(req.params.id);
        if (!artifact || !fs.existsSync(artifact.path)) {
          res.status(404).json({ error: "Artifact not found" });
          return;
        }
        const requestedAssetPath = (req.params as Record<string, string | undefined>)[0] ?? "";
        const assetPath = resolveArtifactAssetPath(artifact.path, requestedAssetPath);
        if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
          res.status(404).json({ error: "Artifact asset not found" });
          return;
        }
        res.type(inferMimeType(assetPath) ?? "application/octet-stream");
        res.sendFile(assetPath);
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/events", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

      const unsubscribe = this.options.eventBus.subscribe((event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      req.on("close", unsubscribe);
    });

    app.post("/api/extension/heartbeat", (req, res, next) => {
      try {
        res.json(this.options.extensionBridge.heartbeat(req.body ?? {}));
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/extension/status", (_req, res) => {
      res.json(this.options.extensionBridge.status());
    });

    app.post("/api/extension/controller/heartbeat", (req, res, next) => {
      try {
        res.json(this.options.extensionBridge.controllerHeartbeat(req.body ?? {}));
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/tabs/open", (req, res, next) => {
      void this.options.extensionBridge
        .openWindowWithController({
          url: String(req.body?.url ?? ""),
          focused: req.body?.active !== false
        })
        .then((result) => res.json({ ok: true, result }))
        .catch(next);
    });

    app.post("/api/extension/clients/:clientId/focus", (req, res, next) => {
      void this.options.extensionBridge
        .focusClient(req.params.clientId)
        .then((result) => res.json({ ok: true, result }))
        .catch(next);
    });

    app.get("/api/extension/focus/commands/next", (req, res, next) => {
      try {
        const clientId = String(req.query.clientId ?? "");
        const command = this.options.extensionBridge.nextFocusCommand(clientId);
        if (!command) {
          res.status(204).send();
          return;
        }
        res.json(command);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/focus/commands/:id/complete", (req, res, next) => {
      try {
        this.options.extensionBridge.completeFocusCommand(req.params.id, req.body?.result);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/focus/commands/:id/fail", (req, res, next) => {
      try {
        this.options.extensionBridge.failFocusCommand(
          req.params.id,
          String(req.body?.message ?? "Extension focus command failed")
        );
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/extension/controller/commands/next", (req, res, next) => {
      try {
        const controllerId = String(req.query.controllerId ?? "");
        const command = this.options.extensionBridge.nextControllerCommand(controllerId);
        if (!command) {
          res.status(204).send();
          return;
        }
        res.json(command);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/controller/commands/:id/complete", (req, res, next) => {
      try {
        this.options.extensionBridge.completeControllerCommand(req.params.id, req.body?.result);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/controller/commands/:id/fail", (req, res, next) => {
      try {
        this.options.extensionBridge.failControllerCommand(
          req.params.id,
          String(req.body?.message ?? "Extension controller command failed")
        );
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/extension/files/:fileId", (req, res, next) => {
      try {
        const filePath = this.options.extensionBridge.getStagedFilePath(req.params.fileId);
        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: "Extension staged file not found" });
          return;
        }
        res.sendFile(filePath);
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/extension/commands/next", (req, res, next) => {
      try {
        const clientId = String(req.query.clientId ?? "");
        const command = this.options.extensionBridge.nextCommand(clientId);
        if (!command) {
          res.status(204).send();
          return;
        }
        res.json(command);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/commands/:id/complete", (req, res, next) => {
      try {
        this.options.extensionBridge.completeCommand(req.params.id, req.body?.result);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/commands/:id/fail", (req, res, next) => {
      try {
        this.options.extensionBridge.failCommand(
          req.params.id,
          String(req.body?.message ?? "Extension browser command failed")
        );
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/extension/lab/commands/next", (req, res, next) => {
      try {
        const clientId = String(req.query.clientId ?? "");
        const command = this.options.extensionBridge.nextLabCommand(clientId);
        if (!command) {
          res.status(204).send();
          return;
        }
        res.json(command);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/lab/commands/:id/complete", (req, res, next) => {
      try {
        this.options.extensionBridge.completeLabCommand(req.params.id, req.body?.result);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/lab/commands/:id/fail", (req, res, next) => {
      try {
        this.options.extensionBridge.failLabCommand(
          req.params.id,
          String(req.body?.message ?? "Extension Workflow Lab command failed")
        );
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    });

    this.server = http.createServer(app);
    await this.listen(preferredPort);
    this.portValue = (this.server.address() as AddressInfo).port;
    return this.portValue;
  }

  get port(): number {
    return this.portValue;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.portValue}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
  }

  private async listen(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && port !== 0) {
          server.off("error", onError);
          void this.listen(0).then(resolve, reject);
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  }
}

function getRunInputFilePath(input: unknown, field: string, index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  if (
    ![
      "images",
      "referenceImages",
      "subjectImages",
      "sourceImages",
      "frontImage",
      "backImage",
      "leftImage",
      "rightImage",
      "topImage",
      "bottomImage",
      "left45Image",
      "right45Image"
    ].includes(field)
  ) {
    return undefined;
  }
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[field];
  if (typeof value === "string") return index === 0 ? value : undefined;
  if (!Array.isArray(value)) return undefined;
  const filePath = value[index];
  return typeof filePath === "string" ? filePath : undefined;
}

export function resolveArtifactAssetPath(artifactPath: string, requestedRelativePath: string): string {
  if (!requestedRelativePath || requestedRelativePath.includes("\0")) {
    throw new Error("Artifact asset path is required.");
  }
  const assetRoot = path.dirname(path.resolve(artifactPath));
  const candidate = path.resolve(assetRoot, requestedRelativePath.replace(/\\/g, "/"));
  if (!isSameOrChildPath(assetRoot, candidate)) {
    throw new Error("Artifact asset path is outside the artifact directory.");
  }
  return candidate;
}

function isSameOrChildPath(parent: string, candidate: string): boolean {
  const parentKey = pathComparisonKey(parent);
  const candidateKey = pathComparisonKey(candidate);
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}${path.sep}`);
}

function pathComparisonKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validateLocalFilePath(filePath: string): {
  path: string;
  exists: boolean;
  isFile: boolean;
  size: number | null;
  error?: string;
} {
  try {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      exists: true,
      isFile: stat.isFile(),
      size: stat.isFile() ? stat.size : null
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { path: filePath, exists: false, isFile: false, size: null };
    }
    return {
      path: filePath,
      exists: false,
      isFile: false,
      size: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function publicWorkflow(registration: WorkflowRegistration): PublicWorkflow {
  return {
    manifest: registration.definition.manifest,
    plugin: registration.plugin,
    availability: { status: "available" }
  };
}

function assertWorkflowLibraryEntryIsRunnable(entry: WorkflowLibraryEntry, workflows: WorkflowRegistry): void {
  const registration = workflows.get(entry.workflowId);
  if (!registration) throw new Error(`The workflow plugin for this library entry is not installed: ${entry.workflowId}.`);
  if (!entry.pluginId || !entry.pluginVersion) return;

  const plugin = registration.plugin;
  if (plugin.id === entry.pluginId && plugin.version === entry.pluginVersion && plugin.apiVersion === (entry.pluginApiVersion ?? plugin.apiVersion)) {
    return;
  }

  throw new Error(
    `This library entry needs ${entry.pluginId}@${entry.pluginVersion}, but ${plugin.id}@${plugin.version} is installed.`
  );
}
