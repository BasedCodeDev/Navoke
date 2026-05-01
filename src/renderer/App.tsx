import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FolderOpen,
  PauseCircle,
  Play,
  RefreshCcw,
  Square,
  Upload
} from "lucide-react";
import {
  cancelRun,
  createRun,
  getConfig,
  getRun,
  getSystemInfo,
  listRuns,
  listWorkflows,
  resumeRun,
  subscribeRuntimeEvents,
  type RunRecord
} from "@/lib/api";
import { cn, formatDate, statusTone } from "@/lib/utils";
import { ArtifactPreview } from "@/components/ArtifactPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

function parseJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Selector config must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function usesMasterPrompt(workflowId: string): boolean {
  return ["chatgpt.extension-image-transform"].includes(workflowId);
}

function usesSelectorConfig(workflowId: string): boolean {
  return ["hunyuan.image-to-model", "chatgpt.extension-image-transform"].includes(workflowId);
}

function usesBrowserProfile(workflowId: string): boolean {
  return ["hunyuan.image-to-model"].includes(workflowId);
}

export default function App(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("chatgpt.extension-image-transform");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [masterPrompt, setMasterPrompt] = useState("");
  const [modelName, setModelName] = useState("Demo model");
  const [profileName, setProfileName] = useState("default");
  const [pauseForManualLogin, setPauseForManualLogin] = useState(true);
  const [selectorsJson, setSelectorsJson] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const workflowsQuery = useQuery({ queryKey: ["workflows"], queryFn: listWorkflows });
  const runsQuery = useQuery({ queryKey: ["runs"], queryFn: listRuns, refetchInterval: 2_000 });
  const systemQuery = useQuery({ queryKey: ["system"], queryFn: getSystemInfo, refetchInterval: 5_000 });
  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const selectedRunQuery = useQuery({
    queryKey: ["run", selectedRunId],
    queryFn: () => getRun(selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: selectedRunId ? 2_000 : false
  });

  useEffect(() => {
    void subscribeRuntimeEvents(() => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["system"] });
      if (selectedRunId) void queryClient.invalidateQueries({ queryKey: ["run", selectedRunId] });
    });
  }, [queryClient, selectedRunId]);

  const workflows = workflowsQuery.data ?? [];
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.manifest.id === selectedWorkflowId)?.manifest,
    [workflows, selectedWorkflowId]
  );

  const createRunMutation = useMutation({
    mutationFn: async () => {
      setFormError(null);
      const selectors = parseJsonObject(selectorsJson);
      const workflowInput =
        selectedWorkflowId === "hunyuan.image-to-model"
          ? { images: selectedFiles, prompt, profileName, pauseForManualLogin, selectors }
          : selectedWorkflowId === "chatgpt.extension-image-transform"
              ? { images: selectedFiles, masterPrompt, selectors }
              : { images: selectedFiles, prompt, modelName, delayMs: 1_200 };

      return createRun({ workflowId: selectedWorkflowId, name, input: workflowInput });
    },
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run", run.id] });
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : String(error))
  });

  const activeRun = selectedRunQuery.data?.run;
  const selectedRunIds = new Set([selectedRunId]);

  async function chooseImages(): Promise<void> {
    const files = await window.workflowAutomation.selectFiles({
      title: "Choose workflow input images",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (files.length > 0) setSelectedFiles(files);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">Browser Workflow Automation</h1>
            <p className="text-sm text-muted-foreground">Local durable browser workflows for images, models, and chained artifacts.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border bg-slate-100 text-slate-700">
              Queue: {systemQuery.data?.runner.queued ?? 0} · Running: {systemQuery.data?.runner.running ?? 0}
            </Badge>
            <Badge className="border bg-cyan-100 text-cyan-800">
              Extension: {systemQuery.data?.extension.connectedClients.length ?? 0}
            </Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-[360px_1fr_420px] gap-5 px-6 py-5">
        <section className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>New Run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Workflow</Label>
                <select
                  value={selectedWorkflowId}
                  onChange={(event) => setSelectedWorkflowId(event.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {workflows.map((workflow) => (
                    <option key={workflow.manifest.id} value={workflow.manifest.id}>
                      {workflow.manifest.title}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{selectedWorkflow?.description}</p>
              </div>

              <div className="space-y-2">
                <Label>Run name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
              </div>

              <div className="space-y-2">
                <Label>Images</Label>
                <Button type="button" variant="outline" className="w-full justify-start" onClick={chooseImages}>
                  <Upload className="h-4 w-4" />
                  Choose images
                </Button>
                <div className="max-h-24 space-y-1 overflow-auto text-xs text-muted-foreground">
                  {selectedFiles.length === 0 ? "No files selected" : selectedFiles.map((file) => <div key={file} className="truncate">{file}</div>)}
                </div>
              </div>

              {!usesMasterPrompt(selectedWorkflowId) ? (
                <>
                  <div className="space-y-2">
                    <Label>Prompt</Label>
                    <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Optional model prompt" />
                  </div>
                  <div className="space-y-2">
                    <Label>Model name</Label>
                    <Input value={modelName} onChange={(event) => setModelName(event.target.value)} />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label>Master prompt</Label>
                  <Textarea value={masterPrompt} onChange={(event) => setMasterPrompt(event.target.value)} placeholder="Stable image transformation prompt" />
                </div>
              )}

              {usesBrowserProfile(selectedWorkflowId) ? (
                <>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                    <div className="space-y-2">
                      <Label>Browser profile</Label>
                      <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                    </div>
                    <label className="flex h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pauseForManualLogin}
                        onChange={(event) => setPauseForManualLogin(event.target.checked)}
                      />
                      Login pause
                    </label>
                  </div>
                </>
              ) : null}

              {usesSelectorConfig(selectedWorkflowId) ? (
                <div className="space-y-2">
                  <Label>Selector config JSON</Label>
                  <Textarea
                    className="font-mono text-xs"
                    value={selectorsJson}
                    onChange={(event) => setSelectorsJson(event.target.value)}
                    placeholder='{"fileInput":"input[type=file]","composer":"#prompt-textarea","submitButton":"button[data-testid=send-button]"}'
                  />
                </div>
              ) : null}

              {formError ? (
                <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {formError}
                </div>
              ) : null}

              <Button className="w-full" onClick={() => createRunMutation.mutate()} disabled={createRunMutation.isPending}>
                <Play className="h-4 w-4" />
                Start run
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Local Runtime</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="truncate">Data: {configQuery.data?.dataDir}</div>
              <div className="truncate">API: {configQuery.data?.apiBaseUrl}</div>
              <div>
                Extension clients: {systemQuery.data?.extension.connectedClients.length ?? 0}; pending:{" "}
                {systemQuery.data?.extension.pending ?? 0}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Runs</h2>
            <Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries()}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          <div className="space-y-3">
            {(runsQuery.data ?? []).map((run) => (
              <RunRow key={run.id} run={run} selected={selectedRunIds.has(run.id)} onSelect={() => setSelectedRunId(run.id)} />
            ))}
            {runsQuery.data?.length === 0 ? <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">No runs yet.</div> : null}
          </div>
        </section>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Run Detail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!activeRun ? <div className="text-sm text-muted-foreground">Select a run to inspect events and artifacts.</div> : null}
              {activeRun ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{activeRun.name}</div>
                        <div className="text-xs text-muted-foreground">{activeRun.workflowId}</div>
                      </div>
                      <Badge className={cn("border", statusTone(activeRun.status))}>{activeRun.status}</Badge>
                    </div>
                    <Progress value={activeRun.progress} />
                    <div className="text-sm text-muted-foreground">{activeRun.currentStep ?? "No step yet"}</div>
                  </div>
                  <div className="flex gap-2">
                    {activeRun.status === "waiting_manual" ? (
                      <Button size="sm" onClick={() => void resumeRun(activeRun.id).then(() => queryClient.invalidateQueries())}>
                        <PauseCircle className="h-4 w-4" />
                        Resume
                      </Button>
                    ) : null}
                    {["queued", "running", "waiting_manual"].includes(activeRun.status) ? (
                      <Button variant="destructive" size="sm" onClick={() => void cancelRun(activeRun.id).then(() => queryClient.invalidateQueries())}>
                        <Square className="h-4 w-4" />
                        Cancel
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => window.workflowAutomation.openPath(configQuery.data?.dataDir ?? "")}>
                      <FolderOpen className="h-4 w-4" />
                      Data folder
                    </Button>
                  </div>
                  {activeRun.error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{activeRun.error}</div> : null}
                </>
              ) : null}
            </CardContent>
          </Card>

          {selectedRunQuery.data?.artifacts.map((artifact) => <ArtifactPreview key={artifact.id} artifact={artifact} />)}

          {selectedRunQuery.data ? (
            <Card>
              <CardHeader>
                <CardTitle>Events</CardTitle>
              </CardHeader>
              <CardContent className="max-h-96 space-y-3 overflow-auto">
                {selectedRunQuery.data.events.map((event) => (
                  <div key={event.id} className="border-l-2 border-border pl-3 text-sm">
                    <div className="flex items-center gap-2">
                      {event.type === "run.completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Bot className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-medium">{event.message}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDate(event.createdAt)} · {event.type}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function RunRow({ run, selected, onSelect }: { run: RunRecord; selected: boolean; onSelect: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border bg-card p-4 text-left shadow-sm transition hover:border-primary",
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="truncate font-medium">{run.name}</div>
          <div className="text-xs text-muted-foreground">{run.workflowId} · {formatDate(run.createdAt)}</div>
          <div className="truncate text-sm text-muted-foreground">{run.currentStep ?? "Queued"}</div>
        </div>
        <Badge className={cn("border", statusTone(run.status))}>{run.status}</Badge>
      </div>
      <Progress value={run.progress} className="mt-3" />
    </button>
  );
}
