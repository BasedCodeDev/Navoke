import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import cors from "cors";
import express from "express";
import type { ExtensionBridge } from "../extension/extensionBridge";
import type { SqliteStore } from "../db/sqliteStore";
import type { LocalWorkflowRunner } from "../runtime/localWorkflowRunner";
import type { RuntimeEventBus } from "../runtime/eventBus";
import type { RuntimePaths, WorkflowDefinition } from "../runtime/types";
import type { WorkflowLab, WorkflowLabAction } from "../lab/workflowLab";
import type { LabWaitCondition } from "../lab/waitConditions";

interface ApiServerOptions {
  store: SqliteStore;
  runner: LocalWorkflowRunner;
  eventBus: RuntimeEventBus;
  workflows: Map<string, WorkflowDefinition>;
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
        extension: this.options.extensionBridge.status()
      });
    });

    app.get("/api/lab/sessions", (_req, res) => {
      res.json(this.options.workflowLab.listSessions());
    });

    app.post("/api/lab/sessions", (req, res, next) => {
      void this.options.workflowLab
        .createSession({
          mode: req.body?.mode,
          targetUrl: req.body?.targetUrl,
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
      res.json([...this.options.workflows.values()].map((workflow) => ({ manifest: workflow.manifest })));
    });

    app.get("/api/runs", (_req, res) => {
      res.json(this.options.store.listRuns());
    });

    app.post("/api/runs", (req, res, next) => {
      try {
        const run = this.options.runner.enqueue({
          workflowId: String(req.body.workflowId ?? ""),
          name: req.body.name,
          workflowInput: req.body.input ?? {}
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

    app.get("/api/extension/tasks/next", (req, res, next) => {
      try {
        const clientId = String(req.query.clientId ?? "");
        const task = this.options.extensionBridge.nextTask(clientId);
        if (!task) {
          res.status(204).send();
          return;
        }
        res.json(task);
      } catch (error) {
        next(error);
      }
    });

    app.get("/api/extension/tasks/:id/images/:group/:index", (req, res, next) => {
      try {
        const group = req.params.group === "reference" ? "reference" : "subject";
        const filePath = this.options.extensionBridge.getTaskImagePath(req.params.id, group, Number(req.params.index));
        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: "Task image not found" });
          return;
        }
        res.sendFile(filePath);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/tasks/:id/events", (req, res, next) => {
      try {
        this.options.extensionBridge.addTaskEvent(
          req.params.id,
          String(req.body?.type ?? "extension.event"),
          String(req.body?.message ?? ""),
          req.body?.data
        );
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/tasks/:id/outputs", (req, res, next) => {
      try {
        this.options.extensionBridge.addTaskOutput(req.params.id, req.body);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/tasks/:id/complete", (req, res, next) => {
      try {
        this.options.extensionBridge.completeTask(req.params.id, {
          outputs: Array.isArray(req.body?.outputs) ? req.body.outputs : [],
          metadata: req.body?.metadata
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/extension/tasks/:id/fail", (req, res, next) => {
      try {
        this.options.extensionBridge.failTask(
          req.params.id,
          String(req.body?.message ?? "Extension task failed"),
          req.body?.data
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
  if (!["images", "referenceImages", "subjectImages"].includes(field)) return undefined;
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[field];
  if (!Array.isArray(value)) return undefined;
  const filePath = value[index];
  return typeof filePath === "string" ? filePath : undefined;
}
