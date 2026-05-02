import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  FlaskConical,
  FolderOpen,
  Info,
  MousePointerClick,
  PauseCircle,
  Play,
  RefreshCcw,
  Square,
  Trash2,
  X,
  Upload
} from "lucide-react";
import {
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
  runLabAction,
  subscribeRuntimeEvents,
  waitForLabCondition,
  type LabWaitCondition,
  type RunRecord,
  type SystemInfo,
  type WorkflowLabInspectionResult
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
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("chatgpt.extension-image-transform");
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
  const [selectorsJson, setSelectorsJson] = useState("");
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
      const chatGptTab = selectedWorkflowId === "chatgpt.extension-image-transform" ? buildChatGptTabInput(chatGptTabSelection) : null;
      if (chatGptTab?.mode === "new") {
        await window.workflowAutomation.openExternal(buildNewChatGptTabUrl(chatGptTab.routingToken));
      }
      const workflowInput =
        selectedWorkflowId === "hunyuan.image-to-model"
          ? { images: selectedFiles, prompt, profileName, pauseForManualLogin, selectors }
          : selectedWorkflowId === "chatgpt.extension-image-transform"
              ? { referenceImages: referenceFiles, subjectImages: subjectFiles, masterPrompt, subjectInstruction, chatGptTab, selectors }
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

  const activeRun = selectedRunQuery.data?.run;
  const selectedRunIds = new Set([selectedRunId]);
  const extensionClients = systemQuery.data?.extension.connectedClients ?? [];
  const compatibleExtensionClients = useMemo(() => extensionClients.filter((client) => client.compatible), [extensionClients]);
  const requiredExtensionProtocol = systemQuery.data?.extension.requiredProtocolVersion ?? 3;
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
                  <ImagePicker
                    label="Subject images"
                    chooseLabel="Choose subjects"
                    files={subjectFiles}
                    emptyText="No subject files selected"
                    onChoose={() => void chooseImages(setSubjectFiles, "Choose subject images")}
                    onClear={() => setSubjectFiles([])}
                  />
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
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Master prompt</Label>
                    <Textarea
                      value={masterPrompt}
                      onChange={(event) => setMasterPrompt(event.target.value)}
                      placeholder='Initial instruction. Example: "After the first response, respond with images only. When ready, respond READY."'
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Per-subject instruction</Label>
                    <Textarea
                      value={subjectInstruction}
                      onChange={(event) => setSubjectInstruction(event.target.value)}
                      placeholder="Optional. Leave blank to send each subject image without text."
                    />
                  </div>
                </>
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
                    placeholder='{"fileInput":"input[type=file]","composer":"#prompt-textarea","submitButton":"button[data-testid=send-button]","stopButton":"button[data-testid=stop-button]"}'
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
          <WorkflowLabPanel extensionClients={extensionClients} />

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
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void deleteRunMutation.mutate(activeRun.id)}
                      disabled={deleteRunMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
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
  const [actionKind, setActionKind] = useState<"click" | "fill" | "submit">("click");
  const [fillValue, setFillValue] = useState("");
  const [waitKind, setWaitKind] = useState<"element" | "text" | "image-count" | "stop-button" | "network-idle">("element");
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
    return { kind: "click" as const, selector: trimmedSelector };
  }

  function buildWaitCondition(): LabWaitCondition {
    const trimmedSelector = selector.trim();
    if (waitKind === "network-idle") return { kind: "network-idle", timeoutMs: 15_000 };
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Workflow Lab</CardTitle>
          <Badge className="border bg-violet-100 text-violet-800">{sessions.length} session{sessions.length === 1 ? "" : "s"}</Badge>
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
                  selectedSession?.id === session.id ? "border-primary bg-cyan-50 text-cyan-950" : "border-border bg-background"
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
                  onChange={(event) => setActionKind(event.target.value as "click" | "fill" | "submit")}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="click">Click</option>
                  <option value="fill">Fill</option>
                  <option value="submit">Submit</option>
                </select>
              </div>
            </div>
            {actionKind === "fill" ? (
              <div className="mt-3 space-y-2">
                <Label>Fill value</Label>
                <Textarea value={fillValue} onChange={(event) => setFillValue(event.target.value)} />
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
              ) : waitKind !== "network-idle" ? (
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
          <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {labError}
          </div>
        ) : null}
        {waitMessage ? <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-950">{waitMessage}</div> : null}

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
    <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-950">
      <div className="flex gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <div className="font-medium">ChatGPT tab routing</div>
          <p className="text-xs leading-5 text-cyan-900">
            Choose the exact compatible ChatGPT tab for this run, or open a new token-routed tab. Other ChatGPT tabs keep
            polling but will not receive the task.
          </p>
          {incompatibleClients.length > 0 ? (
            <p className="text-xs font-medium leading-5 text-red-700">
              {incompatibleClients.length} tab{incompatibleClients.length === 1 ? "" : "s"} need the unpacked extension reloaded and
              ChatGPT refreshed before they can run protocol {requiredProtocolVersion} workflows.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Label htmlFor="chatgpt-tab-target" className="text-xs font-medium text-cyan-950">
          Target tab
        </Label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            id="chatgpt-tab-target"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 min-w-0 rounded-md border border-cyan-200 bg-white px-3 text-xs text-cyan-950"
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
        <p className="text-xs leading-5 text-cyan-900">
          New tabs open ChatGPT externally and are matched when the extension reports the run token.
        </p>
      </div>

      <div className="mt-3 rounded-md border border-cyan-200 bg-white/70 p-2">
        <div className="mb-2 text-xs font-medium text-cyan-950">Reporting ChatGPT tabs</div>
        {clients.length === 0 ? (
          <div className="text-xs text-cyan-900">No ChatGPT extension tab has checked in yet.</div>
        ) : (
          <div className="max-h-28 space-y-2 overflow-auto">
            {clients.map((client) => (
              <div key={client.id} className="space-y-1 rounded border border-cyan-100 bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-xs font-medium text-cyan-950">{client.title || "ChatGPT tab"}</div>
                  <Badge
                    className={cn(
                      "shrink-0 border",
                      !client.compatible
                        ? "bg-red-100 text-red-800"
                        : client.status === "busy"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                    )}
                  >
                    {client.compatible ? client.status : "reload required"}
                  </Badge>
                </div>
                <div className="truncate text-xs text-cyan-800">{client.url || "No URL reported"}</div>
                <div className="text-xs text-cyan-700">
                  Extension v{client.extensionVersion || "unknown"} | protocol {client.protocolVersion ?? "unknown"} / required{" "}
                  {requiredProtocolVersion}
                </div>
                {!client.compatible ? (
                  <div className="text-xs text-red-700">
                    {client.incompatibilityReason ?? "Reload the unpacked extension and refresh this ChatGPT tab."}
                  </div>
                ) : null}
                <div className="text-xs text-cyan-700">Last seen {formatDate(client.lastSeenAt)}</div>
              </div>
            ))}
          </div>
        )}
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
