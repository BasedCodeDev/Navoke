import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  Info,
  MousePointerClick,
  Palette,
  PauseCircle,
  Play,
  RefreshCcw,
  Square,
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
  focusExtensionClient,
  getConfig,
  getRun,
  getSystemInfo,
  inspectLabSession,
  listLabSessions,
  listRuns,
  listWorkflows,
  openProject,
  pauseRun,
  renameProject,
  resumeRun,
  runInputFileUrl,
  runLabAction,
  subscribeRuntimeEvents,
  validateFilePaths,
  waitForLabCondition,
  type ArtifactRecord,
  type FileValidationResult,
  type LabWaitCondition,
  type RunRecord,
  type RuntimeEvent,
  type SystemInfo,
  type WorkflowLabInspectionResult
} from "@/lib/api";
import { cn, formatDate, statusTone } from "@/lib/utils";
import {
  THEME_STORAGE_KEY,
  appThemes,
  applyThemeToRoot,
  getThemeById,
  resolveThemeId,
  toneClassNames,
  toneTextClassNames,
  type ThemeDefinition,
  type ThemeId
} from "@/lib/themes";
import {
  FONT_STORAGE_KEY,
  appFonts,
  applyFontToRoot,
  getFontById,
  resolveFontId,
  type FontDefinition,
  type FontId
} from "@/lib/fonts";
import {
  buildChatGptArtifactPairing,
  fileName,
  getChatGptRunInput,
  type ChatGptRunInputModel
} from "@/lib/chatGptArtifactPairing";
import { buildDuplicateRunConfiguration, collectRunInputFilePaths } from "@/lib/duplicateRunConfiguration";
import { isRecoverableFailedChatGptRun, resolveChatGptFocusTarget } from "@/lib/chatGptTabFocus";
import { ArtifactPreview } from "@/components/ArtifactPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

function getInitialThemeId(): ThemeId {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return resolveThemeId(storedTheme, prefersDark);
}

function getInitialFontId(): FontId {
  return resolveFontId(window.localStorage.getItem(FONT_STORAGE_KEY));
}

function usesMasterPrompt(workflowId: string): boolean {
  return ["chatgpt.extension-image-transform"].includes(workflowId);
}

function usesBrowserProfile(workflowId: string): boolean {
  return ["hunyuan.image-to-model"].includes(workflowId);
}

const NEW_CHATGPT_TAB_VALUE = "__new_chatgpt_tab__";
const CHATGPT_NEW_TAB_URL = "https://chatgpt.com/";
const CHATGPT_TAB_ROUTING_PARAM = "based-blink-tab";
const APP_ICON_SRC = "/assets/app-icon.png";

type ChatGptTabInput =
  | { mode: "existing"; clientId: string; url?: string; title?: string }
  | { mode: "new"; routingToken: string; url?: string; title?: string };

function createRoutingToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildNewChatGptTabUrl(routingToken: string): string {
  const url = new URL(CHATGPT_NEW_TAB_URL);
  url.hash = `${CHATGPT_TAB_ROUTING_PARAM}=${encodeURIComponent(routingToken)}`;
  return url.toString();
}

function buildChatGptTabInput(
  selection: string,
  clients: SystemInfo["extension"]["connectedClients"] = []
): ChatGptTabInput {
  if (selection && selection !== NEW_CHATGPT_TAB_VALUE) {
    const client = clients.find((candidate) => candidate.id === selection);
    return {
      mode: "existing",
      clientId: selection,
      ...(client?.url ? { url: client.url } : {}),
      ...(client?.title ? { title: client.title } : {})
    };
  }
  const routingToken = createRoutingToken();
  return { mode: "new", routingToken, url: buildNewChatGptTabUrl(routingToken) };
}

function chatGptTabOptionLabel(client: SystemInfo["extension"]["connectedClients"][number]): string {
  const label = client.title || "ChatGPT tab";
  return `${label} (${client.status || "ready"})`;
}

export default function App(): JSX.Element {
  const queryClient = useQueryClient();
  const [themeId, setThemeId] = useState<ThemeId>(getInitialThemeId);
  const [fontId, setFontId] = useState<FontId>(getInitialFontId);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
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
  const [actionError, setActionError] = useState<{ title: string; message: string } | null>(null);
  const [newRunFocusError, setNewRunFocusError] = useState<string | null>(null);
  const [showProjectLanding, setShowProjectLanding] = useState(false);
  const [duplicateSourceRun, setDuplicateSourceRun] = useState<RunRecord | null>(null);
  const [duplicateValidation, setDuplicateValidation] = useState<DuplicateRunValidationState>({ status: "idle", files: [] });
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const hasProject = Boolean(configQuery.data?.apiBaseUrl && configQuery.data.projectDir);
  const apiBaseUrl = configQuery.data?.apiBaseUrl ?? "";
  const workflowsQuery = useQuery({ queryKey: ["workflows", apiBaseUrl], queryFn: listWorkflows, enabled: hasProject });
  const runsQuery = useQuery({
    queryKey: ["runs", apiBaseUrl],
    queryFn: listRuns,
    enabled: hasProject,
    refetchInterval: hasProject ? 2_000 : false
  });
  const systemQuery = useQuery({
    queryKey: ["system", apiBaseUrl],
    queryFn: getSystemInfo,
    enabled: hasProject,
    refetchInterval: hasProject ? 5_000 : false
  });
  const selectedRunQuery = useQuery({
    queryKey: ["run", apiBaseUrl, selectedRunId],
    queryFn: () => getRun(selectedRunId!),
    enabled: Boolean(selectedRunId && hasProject),
    refetchInterval: selectedRunId && hasProject ? 2_000 : false
  });

  const selectedTheme = useMemo(() => getThemeById(themeId), [themeId]);
  const selectedFont = useMemo(() => getFontById(fontId), [fontId]);

  useEffect(() => {
    applyThemeToRoot(selectedTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  }, [selectedTheme, themeId]);

  useEffect(() => {
    applyFontToRoot(selectedFont);
    window.localStorage.setItem(FONT_STORAGE_KEY, fontId);
  }, [selectedFont, fontId]);

  useEffect(() => {
    if (configQuery.data && !hasProject) {
      setShowProjectLanding(true);
    }
  }, [configQuery.data, hasProject]);

  useEffect(() => {
    if (!hasProject) return;
    let unsubscribe: (() => void) | undefined;
    void subscribeRuntimeEvents(() => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["system"] });
      if (selectedRunId) void queryClient.invalidateQueries({ queryKey: ["run"] });
    }).then((cleanup) => {
      unsubscribe = cleanup;
    });
    return () => {
      unsubscribe?.();
    };
  }, [apiBaseUrl, hasProject, queryClient, selectedRunId]);

  const workflows = workflowsQuery.data ?? [];
  const createRunMutation = useMutation({
    mutationFn: async () => {
      setFormError(null);
      setActionError(null);
      let activeConfig = configQuery.data;
      if (!activeConfig?.apiBaseUrl || !activeConfig.projectDir) {
        setShowProjectLanding(true);
        throw new Error("Open a project before starting a run.");
      }
      const chatGptTab =
        selectedWorkflowId === "chatgpt.extension-image-transform"
          ? buildChatGptTabInput(chatGptTabSelection, compatibleExtensionClients)
          : null;
      if (chatGptTab?.mode === "new") {
        await window.basedBlink.openExternal(chatGptTab.url ?? buildNewChatGptTabUrl(chatGptTab.routingToken));
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
      void queryClient.invalidateQueries({ queryKey: ["run"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not start run",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  const deleteRunMutation = useMutation({
    mutationFn: deleteRun,
    onSuccess: (_result, deletedRunId) => {
      if (selectedRunId === deletedRunId) {
        setSelectedRunId(null);
      }
      queryClient.removeQueries({ queryKey: ["run"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["system"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not delete run",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  const focusNewRunTabMutation = useMutation({
    mutationFn: focusExtensionClient,
    onSuccess: () => setNewRunFocusError(null),
    onError: (error) => setNewRunFocusError(error instanceof Error ? error.message : String(error))
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
  const requiredExtensionProtocol = systemQuery.data?.extension.requiredProtocolVersion ?? 7;
  const isChatGptExtensionWorkflow = selectedWorkflowId === "chatgpt.extension-image-transform";
  const duplicateFilePaths = useMemo(() => collectRunInputFilePaths(duplicateSourceRun?.input), [duplicateSourceRun?.input]);

  useEffect(() => {
    if (!isChatGptExtensionWorkflow) return;
    setChatGptTabSelection((current) => {
      if (current === NEW_CHATGPT_TAB_VALUE) return current;
      if (current && compatibleExtensionClients.some((client) => client.id === current)) return current;
      return compatibleExtensionClients[0]?.id ?? NEW_CHATGPT_TAB_VALUE;
    });
  }, [compatibleExtensionClients, isChatGptExtensionWorkflow]);

  async function chooseImages(setFiles: (files: string[]) => void, title: string): Promise<void> {
    const files = await window.basedBlink.selectFiles({
      title,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (files.length > 0) setFiles(files);
  }

  async function openProjectAndRefresh(projectPath?: string): Promise<BasedBlinkConfig> {
    const previousProjectDir = configQuery.data?.projectDir ?? null;
    const config = await openProject(projectPath);
    queryClient.setQueryData(["config"], config);
    if (config.projectDir !== previousProjectDir) {
      setSelectedRunId(null);
      queryClient.removeQueries({ queryKey: ["run"] });
    }
    void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
    void queryClient.invalidateQueries({ queryKey: ["system"] });
    if (config.projectDir && !config.projectDialogCancelled) {
      setShowProjectLanding(false);
      setFormError(null);
    }
    return config;
  }

  async function renameProjectAndRefresh(projectPath: string, nextName: string): Promise<void> {
    const config = await renameProject(projectPath, nextName);
    queryClient.setQueryData(["config"], config);
    setFormError(null);
  }

  async function duplicateRunConfiguration(run: RunRecord): Promise<void> {
    if (workflows.length > 0 && !workflows.some((workflow) => workflow.manifest.id === run.workflowId)) {
      throw new Error(`The workflow for this run is not available: ${run.workflowId}`);
    }

    const duplicate = buildDuplicateRunConfiguration(run, {
      compatibleClients: compatibleExtensionClients,
      newChatGptTabValue: NEW_CHATGPT_TAB_VALUE
    });

    setSelectedWorkflowId(duplicate.workflowId);
    setName(duplicate.name);
    setSelectedFiles(duplicate.selectedFiles);
    setReferenceFiles(duplicate.referenceFiles);
    setSubjectFiles(duplicate.subjectFiles);
    setPrompt(duplicate.prompt);
    setMasterPrompt(duplicate.masterPrompt);
    setSubjectInstruction(duplicate.subjectInstruction);
    setModelName(duplicate.modelName);
    setProfileName(duplicate.profileName);
    setPauseForManualLogin(duplicate.pauseForManualLogin);
    setChatGptTabSelection(duplicate.chatGptTabSelection);
    setFormError(null);
    setNewRunFocusError(null);
    setWorkspaceView("runs");
    setSelectedRunId(null);
  }

  async function confirmDuplicateRunConfiguration(): Promise<void> {
    if (!duplicateSourceRun || !canDuplicateRun(duplicateValidation)) return;
    setDuplicateError(null);
    setIsDuplicating(true);
    try {
      await duplicateRunConfiguration(duplicateSourceRun);
      setDuplicateSourceRun(null);
    } catch (error) {
      setDuplicateError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDuplicating(false);
    }
  }

  function openDuplicateRunDialog(run: RunRecord): void {
    const filePaths = collectRunInputFilePaths(run.input);
    setDuplicateError(null);
    setDuplicateSourceRun(run);
    setDuplicateValidation(filePaths.length === 0 ? { status: "ready", files: [] } : { status: "checking", files: [] });

    if (filePaths.length === 0) return;

    void validateFilePaths(filePaths)
      .then((result) => setDuplicateValidation({ status: "ready", files: result.files }))
      .catch((error) =>
        setDuplicateValidation({
          status: "error",
          files: [],
          message: error instanceof Error ? error.message : String(error)
        })
      );
  }

  const showLanding = showProjectLanding || !hasProject;
  const currentProjectDir = configQuery.data?.projectDir ?? "";
  const projectName = configQuery.data?.projectName ?? "Based BLINK";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground transition-colors">
      <header className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={APP_ICON_SRC}
              alt=""
              className="h-10 w-10 shrink-0 rounded-md border border-border bg-background object-cover"
              draggable={false}
            />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">{showLanding ? "Based BLINK" : projectName}</h1>
              <p className="truncate text-sm text-muted-foreground">
                {showLanding ? "Choose a Based BLINK project folder to continue." : configQuery.data?.projectDir}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!showLanding ? (
              <>
                <Badge className={cn("border", toneClassNames.neutral)}>
                  Queue: {systemQuery.data?.runner.queued ?? 0} · Running: {systemQuery.data?.runner.running ?? 0}
                </Badge>
                <Badge className={cn("border", toneClassNames.info)}>
                  Extension: {systemQuery.data?.extension.connectedClients.length ?? 0}
                </Badge>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowProjectLanding(true)}>
                  <FolderOpen className="h-4 w-4" />
                  Open Project
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void window.basedBlink.openPath(currentProjectDir)}
                  disabled={!currentProjectDir}
                >
                  <ExternalLink className="h-4 w-4" />
                  Show in File Manager
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Choose theme and font"
              title={`${selectedTheme.name} / ${selectedFont.name}`}
              onClick={() => setThemePickerOpen(true)}
            >
              <Palette className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {showLanding ? (
        <ProjectLanding
          config={configQuery.data}
          isLoading={configQuery.isLoading}
          error={formError}
          onOpenProject={() => void openProjectAndRefresh().catch((error) => setFormError(error instanceof Error ? error.message : String(error)))}
          onSelectProject={(projectPath) =>
            void openProjectAndRefresh(projectPath).catch((error) => setFormError(error instanceof Error ? error.message : String(error)))
          }
          onRenameProject={(projectPath, nextName) =>
            renameProjectAndRefresh(projectPath, nextName).catch((error) => setFormError(error instanceof Error ? error.message : String(error)))
          }
        />
      ) : (
      <div className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 grid-cols-[minmax(320px,360px)_minmax(0,1fr)] gap-4 overflow-hidden px-5 py-4">
        <section className="min-h-0">
          <Card>
            <CardHeader className="p-3 pb-1.5">
              <CardTitle>New Run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 pt-0">
              <div className="space-y-1.5">
                <Label>Workflow</Label>
                <select
                  value={selectedWorkflowId}
                  onChange={(event) => setSelectedWorkflowId(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {workflows.map((workflow) => (
                    <option key={workflow.manifest.id} value={workflow.manifest.id}>
                      {workflow.manifest.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Run name</Label>
                <Input className="h-9" value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
              </div>

              {isChatGptExtensionWorkflow ? (
                <ChatGptTabRoutingPanel
                  clients={extensionClients}
                  requiredProtocolVersion={requiredExtensionProtocol}
                  value={chatGptTabSelection || NEW_CHATGPT_TAB_VALUE}
                  onChange={(value) => {
                    setNewRunFocusError(null);
                    setChatGptTabSelection(value);
                  }}
                  onRefresh={() => void queryClient.invalidateQueries({ queryKey: ["system"] })}
                  onFocusSelected={(clientId) => {
                    setNewRunFocusError(null);
                    focusNewRunTabMutation.mutate(clientId);
                  }}
                  isFocusingSelected={focusNewRunTabMutation.isPending}
                  focusError={newRunFocusError}
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
                  <div className="space-y-1.5">
                    <Label>Master prompt</Label>
                    <Textarea
                      className="min-h-12 py-1.5"
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
                  <div className="space-y-1.5">
                    <Label>Per-subject instruction</Label>
                    <Textarea
                      className="min-h-12 py-1.5"
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
                  <div className="space-y-1.5">
                    <Label>Prompt</Label>
                    <Textarea className="min-h-12 py-1.5" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Optional model prompt" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Model name</Label>
                    <Input className="h-9" value={modelName} onChange={(event) => setModelName(event.target.value)} />
                  </div>
                </>
              ) : null}

              {usesBrowserProfile(selectedWorkflowId) ? (
                <>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                    <div className="space-y-1.5">
                      <Label>Browser profile</Label>
                      <Input className="h-9" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                    </div>
                    <label className="flex h-9 items-center gap-2 text-sm">
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
              {!hasProject ? (
                <div className={cn("flex gap-2 rounded-md border p-3 text-sm", toneClassNames.info)}>
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  Choose a project folder to create runs. Starting a run will prompt for one.
                </div>
              ) : null}

              {formError ? (
                <div className={cn("flex gap-2 rounded-md border p-3 text-sm", toneClassNames.danger)}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {formError}
                </div>
              ) : null}

              <Button className="h-9 w-full" onClick={() => createRunMutation.mutate()} disabled={createRunMutation.isPending}>
                <Play className="h-4 w-4" />
                {hasProject ? "Start run" : "Choose project and start"}
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="flex min-h-0 flex-col gap-4">
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
            <div className="flex items-center gap-2">
              {workspaceView === "runs" ? (
                <Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries()} disabled={!hasProject}>
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </Button>
              ) : null}
            </div>
          </div>

          <div className={workspaceView === "lab" ? "min-h-0 flex-1 overflow-hidden" : "hidden"}>
            <WorkflowLabPanel extensionClients={extensionClients} hasProject={hasProject} apiBaseUrl={apiBaseUrl} />
          </div>

          <div className={workspaceView === "runs" ? "flex min-h-0 flex-1 flex-col gap-4" : "hidden"}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Runs</h2>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {!hasProject ? (
                  <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
                    Open a project folder to view and create runs.
                  </div>
                ) : null}
                {(runsQuery.data ?? []).map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    selected={selectedRunIds.has(run.id)}
                    onSelect={() => setSelectedRunId(run.id)}
                    onDuplicate={() => openDuplicateRunDialog(run)}
                  />
                ))}
                {hasProject && runsQuery.data?.length === 0 ? (
                  <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">No runs yet.</div>
                ) : null}
              </div>
          </div>
        </section>

      </div>
      )}

      <LocalRuntimeFooter config={configQuery.data} system={systemQuery.data} />

      {!showLanding && selectedRunId ? (
        <RunDetailModal
          runId={selectedRunId}
          run={activeRun}
          artifacts={selectedRunQuery.data?.artifacts ?? []}
          events={selectedRunQuery.data?.events ?? []}
          extensionClients={extensionClients}
          hasDetails={Boolean(selectedRunQuery.data)}
          isLoading={selectedRunQuery.isLoading}
          detailError={selectedRunDetailError}
          isDeleting={deleteRunMutation.isPending}
          onClose={() => setSelectedRunId(null)}
          onPause={(runId) => void pauseRun(runId).then(() => queryClient.invalidateQueries())}
          onResume={(runId) => void resumeRun(runId).then(() => queryClient.invalidateQueries())}
          onCancel={(runId) => void cancelRun(runId).then(() => queryClient.invalidateQueries())}
          onOpenDataFolder={() => window.basedBlink.openPath(activeRun?.runDir ?? "")}
          onFocusClient={(clientId) => focusExtensionClient(clientId)}
          onDelete={(runId) => void deleteRunMutation.mutate(runId)}
        />
      ) : null}
      {duplicateSourceRun ? (
        <DuplicateRunConfirmDialog
          runName={duplicateSourceRun.name}
          fileCount={duplicateFilePaths.length}
          validation={duplicateValidation}
          error={duplicateError}
          isDuplicating={isDuplicating}
          onCancel={() => setDuplicateSourceRun(null)}
          onConfirm={() => void confirmDuplicateRunConfiguration()}
        />
      ) : null}
      {actionError ? (
        <ActionErrorDialog title={actionError.title} message={actionError.message} onClose={() => setActionError(null)} />
      ) : null}
      {themePickerOpen ? (
        <ThemePickerModal
          themes={appThemes}
          selectedTheme={selectedTheme}
          fonts={appFonts}
          selectedFont={selectedFont}
          onSelect={(nextThemeId) => setThemeId(nextThemeId)}
          onSelectFont={(nextFontId) => setFontId(nextFontId)}
          onClose={() => setThemePickerOpen(false)}
        />
      ) : null}
    </main>
  );
}

function LocalRuntimeFooter({ config, system }: { config?: BasedBlinkConfig; system?: SystemInfo }): JSX.Element {
  return (
    <footer className="shrink-0 overflow-hidden border-t border-border bg-card/90 px-5 py-1 text-[10px] leading-4 text-muted-foreground">
      <div className="mx-auto flex max-w-[1500px] min-w-0 items-center gap-3 overflow-hidden">
        <span className="shrink-0 font-medium text-foreground">Local Runtime</span>
        <span className="min-w-0 flex-[1.2_1_0] truncate">Project: {config?.projectDir ?? "No project selected"}</span>
        <span className="min-w-0 flex-1 truncate">Data: {config?.dataDir || "Choose a project to create .blink data"}</span>
        <span className="shrink-0 truncate">API: {config?.apiBaseUrl || "Not running"}</span>
        <span className="shrink-0">
          Extension: {system?.extension.connectedClients.length ?? 0}; pending: {system?.extension.pending ?? 0}
        </span>
      </div>
    </footer>
  );
}

function ThemePickerModal({
  themes,
  selectedTheme,
  fonts,
  selectedFont,
  onSelect,
  onSelectFont,
  onClose
}: {
  themes: ThemeDefinition[];
  selectedTheme: ThemeDefinition;
  fonts: FontDefinition[];
  selectedFont: FontDefinition;
  onSelect(themeId: ThemeId): void;
  onSelectFont(fontId: FontId): void;
  onClose(): void;
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
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/45 px-4 py-6" onMouseDown={onClose}>
      <div className="mx-auto flex min-h-full max-w-5xl items-start justify-center">
        <div
          className="w-full overflow-hidden rounded-lg border border-border bg-background shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="theme-picker-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id="theme-picker-title" className="text-lg font-semibold">
                Appearance
              </h2>
              <div className="truncate text-sm text-muted-foreground">
                Selected: {selectedTheme.name} / {selectedFont.name}
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close theme picker" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="max-h-[calc(100vh-9rem)] space-y-6 overflow-y-auto p-5">
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Font</h3>
                </div>
                <Badge className={cn("border", toneClassNames.neutral)}>{selectedFont.name}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fonts.map((font) => {
                  const selected = font.id === selectedFont.id;
                  return (
                    <button
                      type="button"
                      key={font.id}
                      onClick={() => onSelectFont(font.id)}
                      className={cn(
                        "rounded-md border bg-card p-4 text-left text-card-foreground transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        selected ? "border-primary ring-1 ring-primary" : "border-border"
                      )}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{font.name}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">{font.description}</div>
                        </div>
                        {selected ? <CheckCircle2 className={cn("h-4 w-4 shrink-0", toneTextClassNames.success)} /> : null}
                      </div>
                      <div
                        className="truncate rounded border border-border bg-background px-3 py-2 text-sm"
                        style={{ fontFamily: font.family }}
                      >
                        {font.preview}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Theme</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {themes.map((theme) => {
                  const selected = theme.id === selectedTheme.id;
                  return (
                    <button
                      type="button"
                      key={theme.id}
                      onClick={() => {
                        onSelect(theme.id);
                        onClose();
                      }}
                      className={cn(
                        "rounded-md border bg-card p-4 text-left text-card-foreground transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        selected ? "border-primary ring-1 ring-primary" : "border-border"
                      )}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{theme.name}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">{theme.description}</div>
                        </div>
                        {selected ? <CheckCircle2 className={cn("h-4 w-4 shrink-0", toneTextClassNames.success)} /> : null}
                      </div>
                      <div className="flex gap-1.5">
                        {theme.swatches.map((swatch) => (
                          <span
                            key={`${theme.id}-${swatch}`}
                            className="h-7 flex-1 rounded border border-border"
                            style={{ backgroundColor: swatch }}
                            aria-hidden="true"
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectLanding({
  config,
  isLoading,
  error,
  onOpenProject,
  onSelectProject,
  onRenameProject
}: {
  config?: BasedBlinkConfig;
  isLoading: boolean;
  error: string | null;
  onOpenProject(): void;
  onSelectProject(projectPath: string): void;
  onRenameProject(projectPath: string, nextName: string): Promise<void>;
}): JSX.Element {
  const recentProjects = config?.recentProjects ?? [];
  const activeProjectDir = config?.projectDir ?? null;
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  function startRename(project: BasedBlinkConfig["recentProjects"][number]): void {
    setEditingPath(project.path);
    setEditingName(project.name);
  }

  async function submitRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editingPath) return;
    setRenamingPath(editingPath);
    try {
      await onRenameProject(editingPath, editingName);
      setEditingPath(null);
    } finally {
      setRenamingPath(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden px-6 py-8">
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 text-center">
        <div className="space-y-4">
          <img
            src={APP_ICON_SRC}
            alt=""
            className="mx-auto h-24 w-24 rounded-lg border border-border bg-background object-cover"
            draggable={false}
          />
          <h2 className="text-3xl font-semibold">{config?.projectName ?? "Based BLINK"}</h2>
          <p className="text-sm text-muted-foreground">
            {activeProjectDir ? `Current project: ${activeProjectDir}` : "Open a project folder to load its runs and local workflow data."}
          </p>
        </div>
        <Button type="button" className="h-14 px-8 text-base" onClick={onOpenProject} disabled={isLoading}>
          <FolderOpen className="h-5 w-5" />
          Open New Project
        </Button>
        {error ? (
          <div className={cn("flex max-w-xl gap-2 rounded-md border p-3 text-sm", toneClassNames.danger)}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}
      </section>

      <section className="min-h-0 space-y-3 overflow-y-auto pb-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Recent Projects</h3>
          <Badge className={cn("border", toneClassNames.neutral)}>{recentProjects.length}</Badge>
        </div>
        {recentProjects.length > 0 ? (
          <div className="grid gap-2">
            {recentProjects.map((project) => {
              const isEditing = editingPath === project.path;
              return (
                <div
                  key={project.path}
                  className={cn(
                    "rounded-md border border-border bg-card px-4 py-3 transition",
                    activeProjectDir === project.path && "border-primary ring-1 ring-primary",
                    !project.exists && "opacity-60"
                  )}
                >
                  {isEditing ? (
                    <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={(event) => void submitRename(event)}>
                      <Input
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        autoFocus
                        aria-label="Project name"
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={renamingPath === project.path}>
                          Save
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingPath(null)}>
                          Cancel
                        </Button>
                      </div>
                      <div className="truncate text-xs text-muted-foreground sm:col-span-2">{project.path}</div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => onSelectProject(project.path)}
                        disabled={!project.exists}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                      >
                        <span className="block truncate text-sm font-medium">{project.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{project.path}</span>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => startRename(project)} disabled={!project.exists}>
                          Rename
                        </Button>
                        <Badge className={cn("border", project.exists ? toneClassNames.info : toneClassNames.danger)}>
                          {project.exists ? "Open" : "Missing"}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No projects have been opened yet.
          </div>
        )}
      </section>
    </div>
  );
}

type DuplicateRunValidationState =
  | { status: "idle" | "checking"; files: FileValidationResult["files"] }
  | { status: "ready"; files: FileValidationResult["files"] }
  | { status: "error"; files: FileValidationResult["files"]; message: string };

function RunDetailModal({
  runId,
  run,
  artifacts,
  events,
  extensionClients,
  hasDetails,
  isLoading,
  detailError,
  isDeleting,
  onClose,
  onPause,
  onResume,
  onCancel,
  onOpenDataFolder,
  onFocusClient,
  onDelete
}: {
  runId: string;
  run?: RunRecord;
  artifacts: ArtifactRecord[];
  events: RuntimeEvent[];
  extensionClients: SystemInfo["extension"]["connectedClients"];
  hasDetails: boolean;
  isLoading: boolean;
  detailError: string | null;
  isDeleting: boolean;
  onClose(): void;
  onPause(runId: string): void;
  onResume(runId: string): void;
  onCancel(runId: string): void;
  onOpenDataFolder(): void | Promise<unknown>;
  onFocusClient(clientId: string): Promise<unknown>;
  onDelete(runId: string): void;
}): JSX.Element {
  const [focusError, setFocusError] = useState<string | null>(null);
  const [isFocusing, setIsFocusing] = useState(false);
  const chatGptFocusTarget = useMemo(
    () => resolveChatGptFocusTarget(run, extensionClients),
    [extensionClients, run]
  );
  const canResumeRun = run?.status === "waiting_manual" || isRecoverableFailedChatGptRun(run);

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

  useEffect(() => {
    setFocusError(null);
  }, [runId, chatGptFocusTarget?.clientId, chatGptFocusTarget?.url]);

  async function focusChatGptTab(): Promise<void> {
    if (!chatGptFocusTarget || chatGptFocusTarget.action === "disabled") return;
    setFocusError(null);
    setIsFocusing(true);
    try {
      if (chatGptFocusTarget.action === "focus" && chatGptFocusTarget.clientId) {
        await onFocusClient(chatGptFocusTarget.clientId);
        return;
      }
      if (chatGptFocusTarget.action === "open" && chatGptFocusTarget.url) {
        await window.basedBlink.openExternal(chatGptFocusTarget.url);
      }
    } catch (error) {
      setFocusError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsFocusing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/45 px-4 py-6" onMouseDown={onClose}>
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
              <div className={cn("rounded-md border p-4 text-sm", toneClassNames.danger)}>
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

                  {run.error ? <div className={cn("rounded-md border p-3 text-sm", toneClassNames.danger)}>{run.error}</div> : null}
                </>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Run metadata is unavailable. Delete remains available for this selected run id.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {run?.workflowId === "chatgpt.extension-image-transform" && run.status === "running" ? (
                  <Button size="sm" variant="outline" onClick={() => onPause(run.id)}>
                    <PauseCircle className="h-4 w-4" />
                    Pause
                  </Button>
                ) : null}
                {run?.status === "pausing" ? (
                  <Button size="sm" variant="outline" disabled title="Pause is being applied.">
                    <PauseCircle className="h-4 w-4" />
                    Pause pending
                  </Button>
                ) : null}
                {run && canResumeRun ? (
                  <Button
                    size="sm"
                    onClick={() => onResume(run.id)}
                    title={
                      run.status === "failed"
                        ? "Resume will inspect the current ChatGPT page before resubmitting unfinished work."
                        : undefined
                    }
                  >
                    <PauseCircle className="h-4 w-4" />
                    Resume
                  </Button>
                ) : null}
                {run && ["queued", "running", "pausing", "waiting_manual"].includes(run.status) ? (
                  <Button variant="destructive" size="sm" onClick={() => onCancel(run.id)}>
                    <Square className="h-4 w-4" />
                    Cancel
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => void onOpenDataFolder()} disabled={!run?.runDir}>
                  <FolderOpen className="h-4 w-4" />
                  Data folder
                </Button>
                {chatGptFocusTarget ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void focusChatGptTab()}
                    disabled={chatGptFocusTarget.action === "disabled" || isFocusing}
                    title={
                      chatGptFocusTarget.disabledReason ??
                      (chatGptFocusTarget.action === "open"
                        ? "Open the tracked ChatGPT page so the extension can reconnect."
                        : `Go to ${chatGptFocusTarget.client?.title || "the selected ChatGPT tab"}`)
                    }
                  >
                    <ExternalLink className="h-4 w-4" />
                    {chatGptFocusTarget.buttonLabel}
                  </Button>
                ) : null}
                <Button variant="destructive" size="sm" onClick={() => onDelete(runId)} disabled={isDeleting}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
              {focusError ? (
                <div className={cn("rounded-md border p-3 text-sm", toneClassNames.danger)}>
                  {focusError}
                </div>
              ) : null}
            </section>

            {hasDetails ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Artifacts</h3>
                  {artifacts.length === 0 ? (
                    <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No artifacts yet.</div>
                  ) : run?.workflowId === "chatgpt.extension-image-transform" && getChatGptRunInput(run.input) ? (
                    <ChatGptArtifactPairs
                      run={run}
                      artifacts={artifacts}
                      input={getChatGptRunInput(run.input)!}
                      onOpenDataFolder={onOpenDataFolder}
                    />
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
                            <CheckCircle2 className={cn("h-4 w-4", toneTextClassNames.success)} />
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

function DuplicateRunConfirmDialog({
  runName,
  fileCount,
  validation,
  error,
  isDuplicating,
  onCancel,
  onConfirm
}: {
  runName: string;
  fileCount: number;
  validation: DuplicateRunValidationState;
  error: string | null;
  isDuplicating: boolean;
  onCancel(): void;
  onConfirm(): void;
}): JSX.Element {
  const invalidFiles = invalidDuplicateFiles(validation);
  const canDuplicate = canDuplicateRun(validation);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-4" onMouseDown={onCancel}>
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-run-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h3 id="duplicate-run-title" className="text-base font-semibold">
            Duplicate Run Configuration
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Copy the workflow settings from {runName} into the New Run form. This will not start the run.
          </p>
        </div>

        <div className="space-y-3 p-5 text-sm">
          {validation.status === "checking" ? (
            <div className={cn("flex gap-2 rounded-md border p-3", toneClassNames.info)}>
              <RefreshCcw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              Checking {fileCount} attached file path{fileCount === 1 ? "" : "s"}...
            </div>
          ) : null}

          {validation.status === "ready" && invalidFiles.length === 0 ? (
            <div className={cn("rounded-md border p-3", toneClassNames.success)}>
              {fileCount === 0
                ? "This run has no attached input files to validate."
                : `All ${fileCount} attached input file path${fileCount === 1 ? "" : "s"} are available.`}
            </div>
          ) : null}

          {validation.status === "ready" && invalidFiles.length > 0 ? (
            <div className={cn("space-y-2 rounded-md border p-3", toneClassNames.danger)}>
              <div className="font-medium">
                {invalidFiles.length} attached file path{invalidFiles.length === 1 ? "" : "s"} cannot be reused.
              </div>
              <div className="max-h-36 space-y-1 overflow-auto text-xs">
                {invalidFiles.slice(0, 8).map((file) => (
                  <div key={file.path} className="space-y-0.5" title={file.path}>
                    <div className="truncate">{file.path}</div>
                    <div className="text-muted-foreground">
                      {file.error ?? (file.exists ? "Path is not a file." : "File is missing.")}
                    </div>
                  </div>
                ))}
                {invalidFiles.length > 8 ? <div>{invalidFiles.length - 8} more...</div> : null}
              </div>
            </div>
          ) : null}

          {validation.status === "error" ? (
            <div className={cn("rounded-md border p-3", toneClassNames.danger)}>
              Could not validate attached file paths: {validation.message}
            </div>
          ) : null}

          {error ? <div className={cn("rounded-md border p-3", toneClassNames.danger)}>{error}</div> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isDuplicating}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onConfirm} disabled={!canDuplicate || isDuplicating}>
            <Copy className="h-4 w-4" />
            {isDuplicating ? "Duplicating..." : "Duplicate configuration"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ActionErrorDialog({
  title,
  message,
  onClose
}: {
  title: string;
  message: string;
  onClose(): void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 px-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="action-error-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", toneTextClassNames.danger)} />
          <div className="min-w-0">
            <h3 id="action-error-title" className="text-base font-semibold">
              {title}
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4">
          <Button type="button" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function invalidDuplicateFiles(validation: DuplicateRunValidationState): FileValidationResult["files"] {
  return validation.files.filter((file) => !file.exists || !file.isFile);
}

function canDuplicateRun(validation: DuplicateRunValidationState): boolean {
  return validation.status === "ready" && invalidDuplicateFiles(validation).length === 0;
}

function ChatGptArtifactPairs({
  run,
  artifacts,
  input,
  onOpenDataFolder
}: {
  run: RunRecord;
  artifacts: ArtifactRecord[];
  input: ChatGptRunInputModel;
  onOpenDataFolder(): void | Promise<unknown>;
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
              <Badge className={cn("border", toneClassNames.neutral)}>
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
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => void onOpenDataFolder()} disabled={!run.runDir}>
              <FolderOpen className="h-4 w-4" />
              Data folder
            </Button>
          </div>
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
  extensionClients,
  hasProject,
  apiBaseUrl
}: {
  extensionClients: SystemInfo["extension"]["connectedClients"];
  hasProject: boolean;
  apiBaseUrl: string;
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
  const sessionsQuery = useQuery({
    queryKey: ["labSessions", apiBaseUrl],
    queryFn: listLabSessions,
    enabled: hasProject,
    refetchInterval: hasProject ? 5_000 : false
  });
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
    const files = await window.basedBlink.selectFiles({
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
          <Badge className={cn("border", toneClassNames.lab)}>{sessions.length} session{sessions.length === 1 ? "" : "s"}</Badge>
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
              disabled={!hasProject || createSessionMutation.isPending || (mode === "extension" && !clientId)}
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
                    ? "border-primary bg-[hsl(var(--tone-info-bg))] text-[hsl(var(--tone-info-fg))]"
                    : "border-border bg-background"
                )}
              >
                <div className="font-medium">{session.title || session.mode}</div>
                <div className="max-w-56 truncate text-muted-foreground">{session.url || session.targetUrl}</div>
              </button>
            ))}
          </div>
        ) : null}

        {!hasProject ? (
          <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
            Open a project folder to use Workflow Lab.
          </div>
        ) : selectedSession ? (
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
          <div className={cn("flex gap-2 rounded-md border p-3 text-sm", toneClassNames.danger)}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {labError}
          </div>
        ) : null}
        {waitMessage ? <div className={cn("rounded-md border p-3 text-sm", toneClassNames.info)}>{waitMessage}</div> : null}

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
  onRefresh,
  onFocusSelected,
  isFocusingSelected = false,
  focusError = null
}: {
  clients: SystemInfo["extension"]["connectedClients"];
  requiredProtocolVersion: number;
  value: string;
  onChange(value: string): void;
  onRefresh(): void;
  onFocusSelected?(clientId: string): void;
  isFocusingSelected?: boolean;
  focusError?: string | null;
}): JSX.Element {
  const compatibleClients = clients.filter((client) => client.compatible);
  const incompatibleClients = clients.filter((client) => !client.compatible);
  const selectedCompatibleClient = compatibleClients.find((client) => client.id === value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label htmlFor="chatgpt-tab-target">ChatGPT tab routing</Label>
          <div className="group relative">
            <button
              type="button"
              aria-label="ChatGPT tab routing details"
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground outline-none ring-offset-2 transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            <div className="invisible absolute left-0 top-6 z-30 w-80 max-w-[calc(100vw-3rem)] rounded-md border border-border bg-card p-3 text-xs text-foreground opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              <div className="space-y-3">
                <p className="leading-5 text-muted-foreground">
                  Choose an open compatible ChatGPT tab for this run, or open a new token-routed tab. Other ChatGPT tabs keep
                  polling but will not receive the task.
                </p>
                <p className="leading-5 text-muted-foreground">
                  New tabs open ChatGPT externally and are matched when the extension reports the run token.
                </p>
                {incompatibleClients.length > 0 ? (
                  <p className={cn("font-medium leading-5", toneTextClassNames.danger)}>
                    {incompatibleClients.length} tab{incompatibleClients.length === 1 ? "" : "s"} need the unpacked extension
                    reloaded and ChatGPT refreshed before they can run protocol {requiredProtocolVersion} workflows.
                  </p>
                ) : null}
                <div>
                  <div className="mb-2 font-medium">Reporting ChatGPT tabs</div>
                  {clients.length === 0 ? (
                    <div className="rounded border border-border bg-muted p-2 text-muted-foreground">
                      No ChatGPT extension tab has checked in yet.
                    </div>
                  ) : (
                    <div className="max-h-40 space-y-2 overflow-auto">
                      {clients.map((client) => (
                        <div
                          key={client.id}
                          className="space-y-1 rounded border border-border bg-background p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate font-medium">
                              {client.title || "ChatGPT tab"}
                            </div>
                            <Badge
                              className={cn(
                                "shrink-0 border",
                                !client.compatible
                                  ? toneClassNames.danger
                                  : client.status === "busy"
                                    ? toneClassNames.warning
                                    : toneClassNames.success
                              )}
                            >
                              {client.compatible ? client.status : "reload required"}
                            </Badge>
                          </div>
                          <div className="truncate text-muted-foreground">{client.url || "No URL reported"}</div>
                          <div className="text-muted-foreground">
                            Extension v{client.extensionVersion || "unknown"} | protocol {client.protocolVersion ?? "unknown"} /
                            required {requiredProtocolVersion}
                          </div>
                          {!client.compatible ? (
                            <div className={toneTextClassNames.danger}>
                              {client.incompatibilityReason ?? "Reload the unpacked extension and refresh this ChatGPT tab."}
                            </div>
                          ) : null}
                          <div className="text-muted-foreground">Last seen {formatDate(client.lastSeenAt)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        {compatibleClients.length > 0 ? <Badge className={cn("border", toneClassNames.neutral)}>{compatibleClients.length} ready</Badge> : null}
      </div>

      <div className={cn("grid gap-2", selectedCompatibleClient ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]")}>
        <select
          id="chatgpt-tab-target"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm"
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
        {selectedCompatibleClient ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onFocusSelected?.(selectedCompatibleClient.id)}
            disabled={!onFocusSelected || isFocusingSelected}
            title={`Go to ${selectedCompatibleClient.title || "the selected ChatGPT tab"}`}
          >
            <ExternalLink className="h-4 w-4" />
            Go to tab
          </Button>
        ) : null}
      </div>
      {focusError ? (
        <div className={cn("rounded-md border p-2 text-xs", toneClassNames.danger)}>
          {focusError}
        </div>
      ) : null}
    </div>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
  onDuplicate
}: {
  run: RunRecord;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
}): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary",
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="min-w-0 space-y-1">
            <div className="truncate font-medium">{run.name}</div>
          <div className="text-xs text-muted-foreground">{run.workflowId} · {formatDate(run.createdAt)}</div>
            <div className="truncate text-sm text-muted-foreground">{run.currentStep ?? "Queued"}</div>
          </div>
          <Progress value={run.progress} className="mt-3" />
        </button>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge className={cn("border", statusTone(run.status))}>{run.status}</Badge>
          <Button type="button" variant="outline" size="sm" onClick={onDuplicate} title="Duplicate Run Configuration">
            <Copy className="h-4 w-4" />
            Duplicate config
          </Button>
        </div>
      </div>
    </div>
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
  const statusText = files.length === 0 ? emptyText : files.length === 1 ? files[0] : `${files.length} selected`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{statusText}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={onChoose}>
          <Upload className="h-4 w-4" />
          {chooseLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClear} disabled={files.length === 0}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function FileList({ files, emptyText }: { files: string[]; emptyText?: string }): JSX.Element {
  const visibleFiles = files.slice(0, 2);
  const remainingCount = files.length - visibleFiles.length;

  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {files.length > 0 ? (
        <>
          {visibleFiles.map((file) => (
            <div key={file} className="truncate">
              {file}
            </div>
          ))}
          {remainingCount > 0 ? <div>{remainingCount} more selected</div> : null}
        </>
      ) : (
        emptyText
      )}
    </div>
  );
}
