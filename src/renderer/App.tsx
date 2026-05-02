import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  Download,
  FlaskConical,
  FolderOpen,
  Info,
  Moon,
  MousePointerClick,
  PauseCircle,
  Play,
  RefreshCcw,
  Square,
  Sun,
  Trash2,
  X,
  Upload
} from "lucide-react";
import {
  artifactDownloadUrl,
  artifactUrl,
  cancelRun,
  closeLabSession,
  createLabSession,
  createRun,
  deleteRun,
  getConfig,
  getRun,
  getSystemInfo,
  inspectLabSession,
  listLabSessions,
  listRuns,
  listWorkflows,
  resumeRun,
  runInputFileUrl,
  runLabAction,
  subscribeRuntimeEvents,
  waitForLabCondition,
  type ArtifactRecord,
  type LabWaitCondition,
  type RunRecord,
  type RuntimeEvent,
  type SystemInfo,
  type WorkflowLabInspectionResult
} from "@/lib/api";
import { cn, formatDate, statusTone } from "@/lib/utils";
import {
  buildChatGptArtifactPairing,
  fileName,
  getChatGptRunInput,
  type ChatGptRunInputModel
} from "@/lib/chatGptArtifactPairing";
import { ArtifactPreview } from "@/components/ArtifactPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "workflowAutomationTheme";
const neutralBadgeTone =
  "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
const infoBadgeTone =
  "border-cyan-200 bg-cyan-100 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-200";
const labBadgeTone =
  "border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200";
const dangerNoticeTone =
  "border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-200";
const infoNoticeTone =
  "border-cyan-200 bg-cyan-50 text-cyan-950 dark:border-cyan-800/70 dark:bg-cyan-950/45 dark:text-cyan-100";

function getInitialThemeMode(): ThemeMode {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function usesMasterPrompt(workflowId: string): boolean {
  return ["chatgpt.extension-image-transform"].includes(workflowId);
}

function usesBrowserProfile(workflowId: string): boolean {
  return ["hunyuan.image-to-model"].includes(workflowId);
}

const NEW_CHATGPT_TAB_VALUE = "__new_chatgpt_tab__";
const CHATGPT_NEW_TAB_URL = "https://chatgpt.com/";
const CHATGPT_TAB_ROUTING_PARAM = "workflow-automation-tab";

type ChatGptTabInput =
  | { mode: "existing"; clientId: string }
  | { mode: "new"; routingToken: string };

function createRoutingToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildNewChatGptTabUrl(routingToken: string): string {
  const url = new URL(CHATGPT_NEW_TAB_URL);
  url.hash = `${CHATGPT_TAB_ROUTING_PARAM}=${encodeURIComponent(routingToken)}`;
  return url.toString();
}

function buildChatGptTabInput(selection: string): ChatGptTabInput {
  if (selection && selection !== NEW_CHATGPT_TAB_VALUE) {
    return { mode: "existing", clientId: selection };
  }
  return { mode: "new", routingToken: createRoutingToken() };
}

function chatGptTabOptionLabel(client: SystemInfo["extension"]["connectedClients"][number]): string {
  const label = client.title || "ChatGPT tab";
  return `${label} (${client.status || "ready"})`;
}

export default function App(): JSX.Element {
  const queryClient = useQueryClient();
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("chatgpt.extension-image-transform");
  const [workspaceView, setWorkspaceView] = useState<"runs" | "lab">("runs");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<string[]>([]);
  const [subjectFiles, setSubjectFiles] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [masterPrompt, setMasterPrompt] = useState("");
  const [subjectInstruction, setSubjectInstruction] = useState("");
  const [modelName, setModelName] = useState("Demo model");
  const [profileName, setProfileName] = useState("default");
  const [pauseForManualLogin, setPauseForManualLogin] = useState(true);
  const [chatGptTabSelection, setChatGptTabSelection] = useState("");
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

  const isDarkMode = themeMode === "dark";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDarkMode);
    root.style.colorScheme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [isDarkMode, themeMode]);

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
      const chatGptTab = selectedWorkflowId === "chatgpt.extension-image-transform" ? buildChatGptTabInput(chatGptTabSelection) : null;
      if (chatGptTab?.mode === "new") {
        await window.workflowAutomation.openExternal(buildNewChatGptTabUrl(chatGptTab.routingToken));
      }
      const workflowInput =
        selectedWorkflowId === "hunyuan.image-to-model"
          ? { images: selectedFiles, prompt, profileName, pauseForManualLogin }
          : selectedWorkflowId === "chatgpt.extension-image-transform"
              ? { referenceImages: referenceFiles, subjectImages: subjectFiles, masterPrompt, subjectInstruction, chatGptTab }
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

  const deleteRunMutation = useMutation({
    mutationFn: deleteRun,
    onSuccess: (_result, deletedRunId) => {
      if (selectedRunId === deletedRunId) {
        setSelectedRunId(null);
      }
      queryClient.removeQueries({ queryKey: ["run", deletedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["system"] });
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : String(error))
  });

  const selectedRunSummary = (runsQuery.data ?? []).find((run) => run.id === selectedRunId);
  const activeRun = selectedRunQuery.data?.run ?? selectedRunSummary;
  const selectedRunDetailError = selectedRunQuery.error
    ? selectedRunQuery.error instanceof Error
      ? selectedRunQuery.error.message
      : String(selectedRunQuery.error)
    : null;
  const selectedRunIds = new Set([selectedRunId]);
  const extensionClients = systemQuery.data?.extension.connectedClients ?? [];
  const compatibleExtensionClients = useMemo(() => extensionClients.filter((client) => client.compatible), [extensionClients]);
  const requiredExtensionProtocol = systemQuery.data?.extension.requiredProtocolVersion ?? 5;
  const isChatGptExtensionWorkflow = selectedWorkflowId === "chatgpt.extension-image-transform";

  useEffect(() => {
    if (!isChatGptExtensionWorkflow) return;
    setChatGptTabSelection((current) => {
      if (current === NEW_CHATGPT_TAB_VALUE) return current;
      if (current && compatibleExtensionClients.some((client) => client.id === current)) return current;
      return compatibleExtensionClients[0]?.id ?? NEW_CHATGPT_TAB_VALUE;
    });
  }, [compatibleExtensionClients, isChatGptExtensionWorkflow]);

  async function chooseImages(setFiles: (files: string[]) => void, title: string): Promise<void> {
    const files = await window.workflowAutomation.selectFiles({
      title,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (files.length > 0) setFiles(files);
  }

  return (
    <main className={cn("min-h-screen bg-background text-foreground transition-colors", isDarkMode && "dark")}>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">Browser Workflow Automation</h1>
            <p className="text-sm text-muted-foreground">Local durable browser workflows for images, models, and chained artifacts.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn("border", neutralBadgeTone)}>
              Queue: {systemQuery.data?.runner.queued ?? 0} · Running: {systemQuery.data?.runner.running ?? 0}
            </Badge>
            <Badge className={cn("border", infoBadgeTone)}>
              Extension: {systemQuery.data?.extension.connectedClients.length ?? 0}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={isDarkMode ? "Use light mode" : "Use dark mode"}
              title={isDarkMode ? "Use light mode" : "Use dark mode"}
              onClick={() => setThemeMode(isDarkMode ? "light" : "dark")}
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-[360px_minmax(0,1fr)] gap-5 px-6 py-5">
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

              {isChatGptExtensionWorkflow ? (
                <ChatGptTabRoutingPanel
                  clients={extensionClients}
                  requiredProtocolVersion={requiredExtensionProtocol}
                  value={chatGptTabSelection || NEW_CHATGPT_TAB_VALUE}
                  onChange={setChatGptTabSelection}
                  onRefresh={() => void queryClient.invalidateQueries({ queryKey: ["system"] })}
                />
              ) : null}

              {isChatGptExtensionWorkflow ? (
                <>
                  <ImagePicker
                    label="Reference images"
                    chooseLabel="Choose references"
                    files={referenceFiles}
                    emptyText="No reference files selected"
                    onChoose={() => void chooseImages(setReferenceFiles, "Choose optional reference images")}
                    onClear={() => setReferenceFiles([])}
                  />
                  <div className="space-y-2">
                    <Label>Master prompt</Label>
                    <Textarea
                      value={masterPrompt}
                      onChange={(event) => setMasterPrompt(event.target.value)}
                      placeholder='Initial instruction. Example: "After the first response, respond with images only. When ready, respond READY."'
                    />
                  </div>
                  <ImagePicker
                    label="Subject images"
                    chooseLabel="Choose subjects"
                    files={subjectFiles}
                    emptyText="No subject files selected"
                    onChoose={() => void chooseImages(setSubjectFiles, "Choose subject images")}
                    onClear={() => setSubjectFiles([])}
                  />
                  <div className="space-y-2">
                    <Label>Per-subject instruction</Label>
                    <Textarea
                      value={subjectInstruction}
                      onChange={(event) => setSubjectInstruction(event.target.value)}
                      placeholder="Optional. Leave blank to send each subject image without text."
                    />
                  </div>
                </>
              ) : (
                <ImagePicker
                  label="Images"
                  chooseLabel="Choose images"
                  files={selectedFiles}
                  emptyText="No files selected"
                  onChoose={() => void chooseImages(setSelectedFiles, "Choose workflow input images")}
                  onClear={() => setSelectedFiles([])}
                />
              )}

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
              ) : null}

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

              {formError ? (
                <div className={cn("flex gap-2 rounded-md border p-3 text-sm", dangerNoticeTone)}>
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
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-md border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setWorkspaceView("runs")}
                className={cn(
                  "rounded px-3 py-1.5 text-sm font-medium transition",
                  workspaceView === "runs" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Runs
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView("lab")}
                className={cn(
                  "rounded px-3 py-1.5 text-sm font-medium transition",
                  workspaceView === "lab" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Workflow Lab
              </button>
            </div>
            {workspaceView === "runs" ? (
              <Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries()}>
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </Button>
            ) : null}
          </div>

          <div className={workspaceView === "lab" ? "" : "hidden"}>
            <WorkflowLabPanel extensionClients={extensionClients} />
          </div>

          <div className={workspaceView === "runs" ? "space-y-5" : "hidden"}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Runs</h2>
              </div>
              <div className="space-y-3">
                {(runsQuery.data ?? []).map((run) => (
                  <RunRow key={run.id} run={run} selected={selectedRunIds.has(run.id)} onSelect={() => setSelectedRunId(run.id)} />
                ))}
                {runsQuery.data?.length === 0 ? (
                  <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">No runs yet.</div>
                ) : null}
              </div>
          </div>
        </section>

      </div>

      {selectedRunId ? (
        <RunDetailModal
          runId={selectedRunId}
          run={activeRun}
          artifacts={selectedRunQuery.data?.artifacts ?? []}
          events={selectedRunQuery.data?.events ?? []}
          hasDetails={Boolean(selectedRunQuery.data)}
          isLoading={selectedRunQuery.isLoading}
          detailError={selectedRunDetailError}
          isDeleting={deleteRunMutation.isPending}
          onClose={() => setSelectedRunId(null)}
          onResume={(runId) => void resumeRun(runId).then(() => queryClient.invalidateQueries())}
          onCancel={(runId) => void cancelRun(runId).then(() => queryClient.invalidateQueries())}
          onOpenDataFolder={() => window.workflowAutomation.openPath(configQuery.data?.dataDir ?? "")}
          onDelete={(runId) => void deleteRunMutation.mutate(runId)}
        />
      ) : null}
    </main>
  );
}

function RunDetailModal({
  runId,
  run,
  artifacts,
  events,
  hasDetails,
  isLoading,
  detailError,
  isDeleting,
  onClose,
  onResume,
  onCancel,
  onOpenDataFolder,
  onDelete
}: {
  runId: string;
  run?: RunRecord;
  artifacts: ArtifactRecord[];
  events: RuntimeEvent[];
  hasDetails: boolean;
  isLoading: boolean;
  detailError: string | null;
  isDeleting: boolean;
  onClose(): void;
  onResume(runId: string): void;
  onCancel(runId: string): void;
  onOpenDataFolder(): void | Promise<unknown>;
  onDelete(runId: string): void;
}): JSX.Element {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 px-4 py-6" onMouseDown={onClose}>
      <div className="mx-auto flex min-h-full max-w-5xl items-start justify-center">
        <div
          className="w-full overflow-hidden rounded-lg border border-border bg-background shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-detail-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id="run-detail-title" className="text-lg font-semibold">
                Run Detail
              </h2>
              <div className="truncate text-sm text-muted-foreground">
                {run ? `${run.name} | ${run.workflowId}` : `Run ${runId}`}
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close run detail" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="max-h-[calc(100vh-9rem)] space-y-5 overflow-y-auto p-5">
            {isLoading ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Loading artifacts and events. Run actions are available now.
              </div>
            ) : null}
            {detailError ? (
              <div className={cn("rounded-md border p-4 text-sm", dangerNoticeTone)}>
                Could not load full run details: {detailError}. You can still delete this run.
              </div>
            ) : null}

            <section className="space-y-4 rounded-md border border-border bg-card p-4">
              {run ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{run.name}</div>
                        <div className="text-xs text-muted-foreground">{run.workflowId}</div>
                      </div>
                      <Badge className={cn("border", statusTone(run.status))}>{run.status}</Badge>
                    </div>
                    <Progress value={run.progress} />
                    <div className="text-sm text-muted-foreground">{run.currentStep ?? "No step yet"}</div>
                  </div>

                  {run.error ? <div className={cn("rounded-md border p-3 text-sm", dangerNoticeTone)}>{run.error}</div> : null}
                </>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Run metadata is unavailable. Delete remains available for this selected run id.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {run?.status === "waiting_manual" ? (
                  <Button size="sm" onClick={() => onResume(run.id)}>
                    <PauseCircle className="h-4 w-4" />
                    Resume
                  </Button>
                ) : null}
                {run && ["queued", "running", "waiting_manual"].includes(run.status) ? (
                  <Button variant="destructive" size="sm" onClick={() => onCancel(run.id)}>
                    <Square className="h-4 w-4" />
                    Cancel
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => void onOpenDataFolder()}>
                  <FolderOpen className="h-4 w-4" />
                  Data folder
                </Button>
                <Button variant="destructive" size="sm" onClick={() => onDelete(runId)} disabled={isDeleting}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </section>

            {hasDetails ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Artifacts</h3>
                  {artifacts.length === 0 ? (
                    <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No artifacts yet.</div>
                  ) : run?.workflowId === "chatgpt.extension-image-transform" && getChatGptRunInput(run.input) ? (
                    <ChatGptArtifactPairs run={run} artifacts={artifacts} input={getChatGptRunInput(run.input)!} />
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {artifacts.map((artifact) => (
                        <ArtifactPreview key={artifact.id} artifact={artifact} />
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-md border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="text-sm font-semibold">Events</h3>
                  </div>
                  <div className="max-h-96 space-y-3 overflow-auto p-4">
                    {events.length === 0 ? <div className="text-sm text-muted-foreground">No events yet.</div> : null}
                    {events.map((event) => (
                      <div key={event.id} className="border-l-2 border-border pl-3 text-sm">
                        <div className="flex items-center gap-2">
                          {event.type === "run.completed" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Bot className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-medium">{event.message}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(event.createdAt)} | {event.type}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatGptArtifactPairs({
  run,
  artifacts,
  input
}: {
  run: RunRecord;
  artifacts: ArtifactRecord[];
  input: ChatGptRunInputModel;
}): JSX.Element {
  const pairing = buildChatGptArtifactPairing(input, artifacts);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-background p-4">
        <h4 className="text-sm font-semibold">GPT setup context</h4>
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Master prompt sent first</div>
            <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">
              {input.masterPrompt || "No master prompt recorded."}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Reference images sent with setup</div>
            {input.referenceImages.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No reference images were sent.</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {input.referenceImages.map((referenceImage, index) => (
                  <InputImagePreview
                    key={`${referenceImage}-${index}`}
                    runId={run.id}
                    field="referenceImages"
                    index={index}
                    filePath={referenceImage}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Subject input and generated result pairs</h4>
        {pairing.pairs.map((pair) => (
          <article key={`${pair.subjectImage}-${pair.index}`} className="rounded-md border border-border bg-background p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Subject {pair.index + 1}</div>
                <div className="text-xs text-muted-foreground">{fileName(pair.subjectImage)}</div>
              </div>
              <Badge className={cn("border", neutralBadgeTone)}>
                {pair.primaryOutput ? "1 result" : "Missing result"}
              </Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground">Input to GPT</div>
                <InputImagePreview runId={run.id} field="subjectImages" index={pair.index} filePath={pair.subjectImage} />
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Prompt paired with this input</div>
                  <div className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">
                    {input.subjectInstruction.trim() || "No per-subject text; this step sent the subject image after the setup prompt."}
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground">GPT result</div>
                {pair.primaryOutput ? (
                  <OutputImagePreview artifact={pair.primaryOutput} />
                ) : (
                  <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
                    No output artifact is paired with this input yet.
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {pairing.otherArtifacts.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Other artifacts</h4>
          <div className="grid gap-3 lg:grid-cols-2">
            {pairing.otherArtifacts.map((artifact) => (
              <ArtifactPreview key={artifact.id} artifact={artifact} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InputImagePreview({
  runId,
  field,
  index,
  filePath
}: {
  runId: string;
  field: "images" | "referenceImages" | "subjectImages";
  index: number;
  filePath: string;
}): JSX.Element {
  const [fileUrl, setFileUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    void runInputFileUrl(runId, field, index).then(setFileUrl);
  }, [field, index, runId]);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 min-w-0">
        <div className="truncate text-xs font-medium">{fileName(filePath)}</div>
        <div className="truncate text-xs text-muted-foreground" title={filePath}>
          {filePath}
        </div>
      </div>
      {!fileUrl ? (
        <div className="flex h-44 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          Loading input preview...
        </div>
      ) : failed ? (
        <div className="flex h-44 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          Input image preview unavailable.
        </div>
      ) : (
        <img
          src={fileUrl}
          alt={fileName(filePath)}
          className="h-44 w-full rounded-md bg-muted object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function OutputImagePreview({ artifact }: { artifact: ArtifactRecord }): JSX.Element {
  const [fileUrl, setFileUrl] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    void artifactUrl(artifact.id).then(setFileUrl);
    void artifactDownloadUrl(artifact.id).then(setDownloadUrl);
  }, [artifact.id]);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{artifact.name}</div>
          <div className="text-xs text-muted-foreground">{Math.round(artifact.size / 1024)} KB</div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={downloadUrl}>
            <Download className="h-4 w-4" />
            Download
          </a>
        </Button>
      </div>
      {fileUrl ? (
        <img src={fileUrl} alt={artifact.name} className="h-64 w-full rounded-md bg-muted object-contain" />
      ) : (
        <div className="flex h-64 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          Loading output preview...
        </div>
      )}
    </div>
  );
}

function WorkflowLabPanel({
  extensionClients
}: {
  extensionClients: SystemInfo["extension"]["connectedClients"];
}): JSX.Element {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"playwright" | "extension">("extension");
  const [targetUrl, setTargetUrl] = useState("https://chatgpt.com/");
  const [profileName, setProfileName] = useState("lab");
  const [clientId, setClientId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<WorkflowLabInspectionResult | null>(null);
  const [selector, setSelector] = useState("");
  const [actionKind, setActionKind] = useState<"click" | "fill" | "submit" | "attach-file">("click");
  const [fillValue, setFillValue] = useState("");
  const [actionFiles, setActionFiles] = useState<string[]>([]);
  const [waitKind, setWaitKind] = useState<"element" | "text" | "image-count" | "stop-button" | "chatgpt-submit-ready" | "network-idle">("element");
  const [waitState, setWaitState] = useState("visible");
  const [waitText, setWaitText] = useState("");
  const [waitMinImages, setWaitMinImages] = useState(1);
  const [labError, setLabError] = useState<string | null>(null);
  const [waitMessage, setWaitMessage] = useState<string | null>(null);

  const compatibleClients = extensionClients.filter((client) => client.compatible);
  const sessionsQuery = useQuery({ queryKey: ["labSessions"], queryFn: listLabSessions, refetchInterval: 5_000 });
  const sessions = sessionsQuery.data ?? [];
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;

  useEffect(() => {
    if (selectedSessionId || !sessions[0]) return;
    setSelectedSessionId(sessions[0].id);
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (clientId && compatibleClients.some((client) => client.id === clientId)) return;
    setClientId(compatibleClients[0]?.id ?? "");
  }, [clientId, compatibleClients]);

  const createSessionMutation = useMutation({
    mutationFn: () =>
      createLabSession({
        mode,
        targetUrl: targetUrl.trim(),
        profileName,
        clientId: mode === "extension" ? clientId : undefined
      }),
    onSuccess: (session) => {
      setLabError(null);
      setSelectedSessionId(session.id);
      setInspection(null);
      void queryClient.invalidateQueries({ queryKey: ["labSessions"] });
    },
    onError: (error) => setLabError(error instanceof Error ? error.message : String(error))
  });

  const inspectMutation = useMutation({
    mutationFn: inspectLabSession,
    onSuccess: (result) => {
      setLabError(null);
      setInspection(result);
      setSelectedSessionId(result.session.id);
      void queryClient.invalidateQueries({ queryKey: ["labSessions"] });
    },
    onError: (error) => setLabError(error instanceof Error ? error.message : String(error))
  });

  const actionMutation = useMutation({
    mutationFn: runLabAction,
    onSuccess: (result) => {
      setLabError(null);
      void queryClient.invalidateQueries({ queryKey: ["labSessions"] });
      void inspectMutation.mutate(result.session.id);
    },
    onError: (error) => setLabError(error instanceof Error ? error.message : String(error))
  });

  const waitMutation = useMutation({
    mutationFn: waitForLabCondition,
    onSuccess: (result) => {
      setLabError(null);
      setWaitMessage(result.reason);
      void queryClient.invalidateQueries({ queryKey: ["labSessions"] });
      if (result.satisfied) void inspectMutation.mutate(result.session.id);
    },
    onError: (error) => setLabError(error instanceof Error ? error.message : String(error))
  });

  const closeMutation = useMutation({
    mutationFn: closeLabSession,
    onSuccess: (session) => {
      setLabError(null);
      if (selectedSessionId === session.id) {
        setSelectedSessionId(null);
        setInspection(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["labSessions"] });
    },
    onError: (error) => setLabError(error instanceof Error ? error.message : String(error))
  });

  function buildAction() {
    const trimmedSelector = selector.trim();
    if (!trimmedSelector) throw new Error("Choose a selector for the action probe.");
    if (actionKind === "fill") return { kind: "fill" as const, selector: trimmedSelector, value: fillValue };
    if (actionKind === "submit") return { kind: "submit" as const, selector: trimmedSelector };
    if (actionKind === "attach-file") {
      if (actionFiles.length === 0) throw new Error("Choose at least one file to attach.");
      return { kind: "attach-file" as const, selector: trimmedSelector, filePaths: actionFiles };
    }
    return { kind: "click" as const, selector: trimmedSelector };
  }

  function buildWaitCondition(): LabWaitCondition {
    const trimmedSelector = selector.trim();
    if (waitKind === "network-idle") return { kind: "network-idle", timeoutMs: 15_000 };
    if (waitKind === "chatgpt-submit-ready") {
      return {
        kind: "chatgpt-submit-ready",
        selectors: trimmedSelector ? { submitButton: trimmedSelector } : undefined,
        timeoutMs: 120_000
      };
    }
    if (waitKind === "text") return { kind: "text", text: waitText, state: waitState === "absent" ? "absent" : "present", timeoutMs: 30_000 };
    if (waitKind === "image-count") {
      return {
        kind: "image-count",
        selector: trimmedSelector || undefined,
        minCount: waitMinImages,
        previousFingerprints: inspection?.inspection.imageFingerprints ?? [],
        timeoutMs: 45_000
      };
    }
    if (waitKind === "stop-button") {
      return {
        kind: "stop-button",
        selector: trimmedSelector || undefined,
        state: waitState === "hidden" ? "hidden" : "visible",
        timeoutMs: 45_000
      };
    }
    if (!trimmedSelector) throw new Error("Choose a selector for the element wait.");
    return {
      kind: "element",
      selector: trimmedSelector,
      state: ["visible", "hidden", "enabled", "disabled"].includes(waitState)
        ? (waitState as "visible" | "hidden" | "enabled" | "disabled")
        : "visible",
      timeoutMs: 30_000
    };
  }

  function runSelectedAction(): void {
    try {
      if (!selectedSession) throw new Error("Start or select a Workflow Lab session first.");
      actionMutation.mutate({ sessionId: selectedSession.id, action: buildAction() });
    } catch (error) {
      setLabError(error instanceof Error ? error.message : String(error));
    }
  }

  function runSelectedWait(): void {
    try {
      if (!selectedSession) throw new Error("Start or select a Workflow Lab session first.");
      setWaitMessage(null);
      waitMutation.mutate({ sessionId: selectedSession.id, condition: buildWaitCondition() });
    } catch (error) {
      setLabError(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseActionFiles(): Promise<void> {
    const files = await window.workflowAutomation.selectFiles({
      title: "Choose files for Workflow Lab attach-file probe",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (files.length > 0) setActionFiles(files);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Workflow Lab</CardTitle>
          <Badge className={cn("border", labBadgeTone)}>{sessions.length} session{sessions.length === 1 ? "" : "s"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[150px_1fr_120px_auto] gap-3">
          <div className="space-y-2">
            <Label>Bridge</Label>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as "playwright" | "extension")}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="extension">Extension tab</option>
              <option value="playwright">Playwright</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>{mode === "extension" ? "Connected tab" : "Target URL"}</Label>
            {mode === "extension" ? (
              <select
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {compatibleClients.length === 0 ? <option value="">No compatible tabs</option> : null}
                {compatibleClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {chatGptTabOptionLabel(client)}
                  </option>
                ))}
              </select>
            ) : (
              <Input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://example.com" />
            )}
          </div>
          <div className="space-y-2">
            <Label>Profile</Label>
            <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} disabled={mode === "extension"} />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={() => createSessionMutation.mutate()}
              disabled={createSessionMutation.isPending || (mode === "extension" && !clientId)}
            >
              <FlaskConical className="h-4 w-4" />
              Start
            </Button>
          </div>
        </div>

        {sessions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sessions.map((session) => (
              <button
                type="button"
                key={session.id}
                onClick={() => setSelectedSessionId(session.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-xs",
                  selectedSession?.id === session.id
                    ? "border-primary bg-cyan-50 text-cyan-950 dark:bg-cyan-950/40 dark:text-cyan-100"
                    : "border-border bg-background"
                )}
              >
                <div className="font-medium">{session.title || session.mode}</div>
                <div className="max-w-56 truncate text-muted-foreground">{session.url || session.targetUrl}</div>
              </button>
            ))}
          </div>
        ) : null}

        {selectedSession ? (
          <div className="rounded-md border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{selectedSession.title || "Workflow Lab session"}</div>
                <div className="truncate text-xs text-muted-foreground">{selectedSession.url || selectedSession.targetUrl}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => inspectMutation.mutate(selectedSession.id)}
                  disabled={inspectMutation.isPending}
                >
                  <Camera className="h-4 w-4" />
                  Inspect
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => closeMutation.mutate(selectedSession.id)}
                  disabled={closeMutation.isPending}
                >
                  <X className="h-4 w-4" />
                  Close
                </Button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_190px] gap-3">
              <div className="space-y-2">
                <Label>Probe selector</Label>
                <Input value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="button[data-testid='send-button']" />
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <select
                  value={actionKind}
                  onChange={(event) => setActionKind(event.target.value as "click" | "fill" | "submit" | "attach-file")}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="click">Click</option>
                  <option value="fill">Fill</option>
                  <option value="submit">Submit</option>
                  <option value="attach-file">Attach file</option>
                </select>
              </div>
            </div>
            {actionKind === "fill" ? (
              <div className="mt-3 space-y-2">
                <Label>Fill value</Label>
                <Textarea value={fillValue} onChange={(event) => setFillValue(event.target.value)} />
              </div>
            ) : null}
            {actionKind === "attach-file" ? (
              <div className="mt-3 space-y-2">
                <Label>Files</Label>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void chooseActionFiles()}>
                    <Upload className="h-4 w-4" />
                    Choose files
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setActionFiles([])} disabled={actionFiles.length === 0}>
                    Clear
                  </Button>
                </div>
                <FileList files={actionFiles} emptyText="No files selected" />
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={runSelectedAction} disabled={actionMutation.isPending}>
                <MousePointerClick className="h-4 w-4" />
                Run probe
              </Button>
              <select
                value={waitKind}
                onChange={(event) => setWaitKind(event.target.value as typeof waitKind)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="element">Element state</option>
                <option value="text">Text state</option>
                <option value="image-count">New images</option>
                <option value="stop-button">Stop button</option>
                <option value="chatgpt-submit-ready">ChatGPT submit ready</option>
                <option value="network-idle">Network idle</option>
              </select>
              {waitKind === "image-count" ? (
                <Input
                  className="h-9 w-24"
                  type="number"
                  min={1}
                  value={waitMinImages}
                  onChange={(event) => setWaitMinImages(Number(event.target.value) || 1)}
                />
              ) : waitKind === "text" ? (
                <Input className="h-9 w-60" value={waitText} onChange={(event) => setWaitText(event.target.value)} placeholder="Text to wait for" />
              ) : waitKind !== "network-idle" && waitKind !== "chatgpt-submit-ready" ? (
                <select
                  value={waitState}
                  onChange={(event) => setWaitState(event.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {(waitKind === "element" ? ["visible", "hidden", "enabled", "disabled"] : ["visible", "hidden"]).map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={runSelectedWait} disabled={waitMutation.isPending}>
                Wait
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">Start a lab session to inspect and probe a page.</div>
        )}

        {labError ? (
          <div className={cn("flex gap-2 rounded-md border p-3 text-sm", dangerNoticeTone)}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {labError}
          </div>
        ) : null}
        {waitMessage ? <div className={cn("rounded-md border p-3 text-sm", infoNoticeTone)}>{waitMessage}</div> : null}

        {inspection ? (
          <div className="grid grid-cols-[280px_1fr] gap-4">
            <div className="space-y-2">
              {inspection.screenshotBase64 ? (
                <img
                  src={`data:${inspection.screenshotMimeType ?? "image/png"};base64,${inspection.screenshotBase64}`}
                  alt="Workflow Lab screenshot"
                  className="max-h-64 w-full rounded-md border border-border object-contain"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  Extension DOM capture
                </div>
              )}
              <div className="rounded-md border border-border p-2 text-xs text-muted-foreground">
                <div>Fingerprint: {inspection.inspection.fingerprint}</div>
                <div>
                  Elements: {inspection.inspection.interactiveElements.length}; images: {inspection.inspection.imageFingerprints.length}
                </div>
                <div className="truncate">Artifact: {inspection.artifacts[0]?.path}</div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="max-h-40 overflow-auto rounded-md border border-border p-3 text-xs leading-5 text-muted-foreground">
                {inspection.inspection.bodyTextSample || "No visible body text captured."}
              </div>
              <div className="max-h-64 space-y-2 overflow-auto">
                {inspection.inspection.interactiveElements.slice(0, 12).map((element) => (
                  <button
                    type="button"
                    key={`${element.index}-${element.label}`}
                    onClick={() => setSelector(element.selectors[0]?.selector ?? "")}
                    className="w-full rounded-md border border-border bg-background p-2 text-left text-xs hover:border-primary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{element.label}</span>
                      <span className="text-muted-foreground">{element.tagName}</span>
                    </div>
                    <div className="mt-1 truncate text-muted-foreground">{element.selectors[0]?.selector ?? "No selector candidate"}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {selectedSession?.actionLog.length ? (
          <div className="max-h-28 space-y-2 overflow-auto border-t border-border pt-3">
            {selectedSession.actionLog.slice(0, 6).map((entry) => (
              <div key={entry.id} className="text-xs">
                <span className="font-medium">{entry.message}</span>
                <span className="text-muted-foreground"> | {formatDate(entry.createdAt)} | {entry.type}</span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChatGptTabRoutingPanel({
  clients,
  requiredProtocolVersion,
  value,
  onChange,
  onRefresh
}: {
  clients: SystemInfo["extension"]["connectedClients"];
  requiredProtocolVersion: number;
  value: string;
  onChange(value: string): void;
  onRefresh(): void;
}): JSX.Element {
  const compatibleClients = clients.filter((client) => client.compatible);
  const incompatibleClients = clients.filter((client) => !client.compatible);

  return (
    <div className={cn("rounded-md border p-3 text-sm", infoNoticeTone)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="font-medium">ChatGPT tab routing</div>
          <div className="group relative">
            <button
              type="button"
              aria-label="ChatGPT tab routing details"
              className="flex h-6 w-6 items-center justify-center rounded-full text-cyan-800 outline-none ring-offset-2 transition hover:bg-cyan-100 focus-visible:ring-2 focus-visible:ring-primary dark:text-cyan-200 dark:hover:bg-cyan-900/70"
            >
              <Info className="h-4 w-4" />
            </button>
            <div className="invisible absolute left-0 top-7 z-30 w-80 max-w-[calc(100vw-3rem)] rounded-md border border-cyan-200 bg-white p-3 text-xs text-cyan-900 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-cyan-800 dark:bg-slate-950 dark:text-cyan-100">
              <div className="space-y-3">
                <p className="leading-5">
                  Choose an open compatible ChatGPT tab for this run, or open a new token-routed tab. Other ChatGPT tabs keep
                  polling but will not receive the task.
                </p>
                <p className="leading-5">
                  New tabs open ChatGPT externally and are matched when the extension reports the run token.
                </p>
                {incompatibleClients.length > 0 ? (
                  <p className="font-medium leading-5 text-red-700 dark:text-red-300">
                    {incompatibleClients.length} tab{incompatibleClients.length === 1 ? "" : "s"} need the unpacked extension
                    reloaded and ChatGPT refreshed before they can run protocol {requiredProtocolVersion} workflows.
                  </p>
                ) : null}
                <div>
                  <div className="mb-2 font-medium text-cyan-950 dark:text-cyan-100">Reporting ChatGPT tabs</div>
                  {clients.length === 0 ? (
                    <div className="rounded border border-cyan-100 bg-cyan-50 p-2 dark:border-cyan-900/70 dark:bg-cyan-950/30">
                      No ChatGPT extension tab has checked in yet.
                    </div>
                  ) : (
                    <div className="max-h-40 space-y-2 overflow-auto">
                      {clients.map((client) => (
                        <div
                          key={client.id}
                          className="space-y-1 rounded border border-cyan-100 bg-cyan-50 p-2 dark:border-cyan-900/70 dark:bg-background"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate font-medium text-cyan-950 dark:text-cyan-100">
                              {client.title || "ChatGPT tab"}
                            </div>
                            <Badge
                              className={cn(
                                "shrink-0 border",
                                !client.compatible
                                  ? "border-red-200 bg-red-100 text-red-800 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-200"
                                  : client.status === "busy"
                                    ? "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-200"
                                    : "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-200"
                              )}
                            >
                              {client.compatible ? client.status : "reload required"}
                            </Badge>
                          </div>
                          <div className="truncate text-cyan-800 dark:text-cyan-300">{client.url || "No URL reported"}</div>
                          <div className="text-cyan-700 dark:text-cyan-300">
                            Extension v{client.extensionVersion || "unknown"} | protocol {client.protocolVersion ?? "unknown"} /
                            required {requiredProtocolVersion}
                          </div>
                          {!client.compatible ? (
                            <div className="text-red-700 dark:text-red-300">
                              {client.incompatibilityReason ?? "Reload the unpacked extension and refresh this ChatGPT tab."}
                            </div>
                          ) : null}
                          <div className="text-cyan-700 dark:text-cyan-300">Last seen {formatDate(client.lastSeenAt)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        {compatibleClients.length > 0 ? <Badge className={cn("border", neutralBadgeTone)}>{compatibleClients.length} ready</Badge> : null}
      </div>

      <Label htmlFor="chatgpt-tab-target" className="sr-only">
        Target tab
      </Label>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <select
          id="chatgpt-tab-target"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 min-w-0 rounded-md border border-cyan-200 bg-white px-3 text-xs text-cyan-950 dark:border-cyan-800 dark:bg-background dark:text-cyan-100"
        >
          <option value={NEW_CHATGPT_TAB_VALUE}>Open a new ChatGPT tab</option>
          {compatibleClients.map((client) => (
            <option key={client.id} value={client.id}>
              {chatGptTabOptionLabel(client)}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
    </div>
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

function ImagePicker({
  label,
  chooseLabel,
  files,
  emptyText,
  onChoose,
  onClear
}: {
  label: string;
  chooseLabel: string;
  files: string[];
  emptyText: string;
  onChoose(): void;
  onClear(): void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button type="button" variant="outline" className="justify-start" onClick={onChoose}>
          <Upload className="h-4 w-4" />
          {chooseLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClear} disabled={files.length === 0}>
          Clear
        </Button>
      </div>
      <FileList files={files} emptyText={emptyText} />
    </div>
  );
}

function FileList({ files, emptyText }: { files: string[]; emptyText: string }): JSX.Element {
  return (
    <div className="max-h-24 space-y-1 overflow-auto text-xs text-muted-foreground">
      {files.length === 0 ? emptyText : files.map((file) => <div key={file} className="truncate">{file}</div>)}
    </div>
  );
}
