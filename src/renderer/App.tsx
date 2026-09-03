import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  Info,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Minus,
  Package,
  Palette,
  Pencil,
  PauseCircle,
  Play,
  Plus,
  RefreshCcw,
  Save,
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
  deleteWorkflowLibraryEntry,
  focusExtensionClient,
  getConfig,
  getRun,
  getSystemInfo,
  installPlugin,
  inspectLabSession,
  listLabSessions,
  listPlugins,
  listRuns,
  listWorkflows,
  listWorkflowLibraryEntries,
  openExtensionTab,
  openProject,
  pauseRun,
  renameProject,
  renameRun,
  renameWorkflowLibraryEntry,
  resumeRun,
  runInputFileUrl,
  runLabAction,
  saveRunToWorkflowLibrary,
  subscribeRuntimeEvents,
  uninstallPlugin,
  validateFilePaths,
  waitForLabCondition,
  type ArtifactRecord,
  type FileValidationResult,
  type InstalledPluginRecord,
  type LabWaitCondition,
  type RunArtifactSummary,
  type RunListRecord,
  type RunRecord,
  type RuntimeEvent,
  type SystemInfo,
  type WorkflowLabProfileWorkflowId,
  type WorkflowLabInspectionResult,
  type WorkflowLibraryEntry,
  type WorkflowPresentationItem,
  type WorkflowRunPresentation,
  type WorkflowSummary
} from "@/lib/api";
import { cn, formatDate, isMotionActiveStatus, statusTone } from "@/lib/utils";
import { savedLibrarySourceRunIds } from "@/lib/workflowLibrary";
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
import { buildDuplicateRunConfiguration, collectRunInputFilePaths } from "@/lib/duplicateRunConfiguration";
import {
  buildWorkflowInputFromValues,
  createInitialWorkflowValues,
  normalizeWorkflowValues,
  stringifyJsonFieldValue,
  type WorkflowFormValues
} from "@/lib/workflowForm";
import { isRecoverableFailedExtensionRun, resolveExtensionFocusTarget } from "@/lib/extensionTabFocus";
import { resolveExtensionTabSelection } from "@/lib/extensionTabRouting";
import { activeCliAgentRuns, isCliRun, runOriginCommand, runOriginLabel } from "@/lib/runOrigin";
import { runArtifactCountChips } from "@/lib/runArtifactSummary";
import { runPromptInputSummary, type RunPromptInputSummaryItem } from "@/lib/runInputSummary";
import { isPreviewableModelArtifact } from "@/lib/modelPreview";
import { ArtifactPreview } from "@/components/ArtifactPreview";
import { ModelViewer } from "@/components/ModelViewer";
import { RunArtifactThumbnail } from "@/components/RunArtifactThumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

function getInitialThemeId(): ThemeId {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return resolveThemeId(storedTheme);
}

function getInitialFontId(): FontId {
  return resolveFontId(window.localStorage.getItem(FONT_STORAGE_KEY));
}

type WorkflowUiCapability = NonNullable<WorkflowSummary["manifest"]["uiCapabilities"]>[number];

function workflowHasCapability(workflow: WorkflowSummary | undefined, capability: WorkflowUiCapability): boolean {
  return Boolean(workflow?.manifest.uiCapabilities?.includes(capability));
}

const NEW_EXTENSION_TAB_VALUE = "__new_extension_tab__";
const EXTENSION_TAB_ROUTING_PARAM = "navoke-tab";
const APP_ICON_SRC = "./assets/app-icon.png";

type ExtensionTabInput =
  | { mode: "existing"; clientId: string; url?: string; title?: string }
  | { mode: "new"; routingToken: string; url?: string; title?: string; openMode?: "window" | "tab" };

function createRoutingToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildNewExtensionTabUrl(targetUrl: string | undefined, routingToken: string): string {
  const url = new URL(targetUrl?.trim() || "about:blank");
  url.hash = `${EXTENSION_TAB_ROUTING_PARAM}=${encodeURIComponent(routingToken)}`;
  return url.toString();
}

function buildExtensionTabInput(
  selection: string,
  clients: SystemInfo["extension"]["connectedClients"] = [],
  targetUrl?: string,
  openMode: "window" | "tab" = "window"
): ExtensionTabInput {
  if (selection && selection !== NEW_EXTENSION_TAB_VALUE) {
    const client = clients.find((candidate) => candidate.id === selection);
    return {
      mode: "existing",
      clientId: selection,
      ...(client?.url ? { url: client.url } : {}),
      ...(client?.title ? { title: client.title } : {})
    };
  }
  const routingToken = createRoutingToken();
  return { mode: "new", routingToken, url: buildNewExtensionTabUrl(targetUrl, routingToken), openMode };
}

function extensionTabOptionLabel(client: SystemInfo["extension"]["connectedClients"][number]): string {
  const label = client.title || client.url || "Browser tab";
  return `${label} (${client.status || "ready"})`;
}

type RunWorkflowAvailability =
  | { status: "available"; message: string; workflow: WorkflowSummary }
  | { status: "legacy"; message: string; workflow: WorkflowSummary }
  | { status: "missing"; message: string; workflow: null }
  | { status: "version-mismatch"; message: string; workflow: WorkflowSummary };

type DeleteRunCandidate = Pick<RunRecord, "id" | "name" | "runDir" | "runNumber">;

function resolveRunWorkflowAvailability(run: RunRecord, workflows: WorkflowSummary[]): RunWorkflowAvailability {
  const exact = workflows.find(
    (workflow) =>
      workflow.manifest.id === run.workflowId &&
      (!run.pluginId ||
        (workflow.plugin.id === run.pluginId &&
          workflow.plugin.version === run.pluginVersion &&
          workflow.plugin.apiVersion === (run.pluginApiVersion ?? workflow.plugin.apiVersion)))
  );
  if (exact) {
    return run.pluginId
      ? { status: "available", message: `${exact.plugin.name} ${exact.plugin.version}`, workflow: exact }
      : { status: "legacy", message: "Run has no plugin snapshot; matching by workflow id.", workflow: exact };
  }

  const workflowIdMatch = workflows.find((workflow) => workflow.manifest.id === run.workflowId);
  if (workflowIdMatch && run.pluginId && run.pluginVersion) {
    return {
      status: "version-mismatch",
      message: `This run needs ${run.pluginId}@${run.pluginVersion}, but ${workflowIdMatch.plugin.id}@${workflowIdMatch.plugin.version} is installed.`,
      workflow: workflowIdMatch
    };
  }

  const required = run.pluginId && run.pluginVersion ? `${run.pluginId}@${run.pluginVersion}` : run.workflowId;
  return {
    status: "missing",
    message: `The workflow plugin for this run is not installed: ${required}.`,
    workflow: null
  };
}

function canUseRunWorkflow(availability: RunWorkflowAvailability | null): boolean {
  return !availability || availability.status === "available" || availability.status === "legacy";
}

function libraryEntryToRunRecord(entry: WorkflowLibraryEntry, name = entry.name): RunRecord {
  return {
    id: entry.sourceRunId ?? entry.id,
    workflowId: entry.workflowId,
    workflowVersion: entry.workflowVersion ?? null,
    pluginId: entry.pluginId ?? null,
    pluginVersion: entry.pluginVersion ?? null,
    pluginApiVersion: entry.pluginApiVersion ?? null,
    pluginSource: entry.pluginSource ?? null,
    origin: { source: "ui" },
    runNumber: null,
    name,
    runDir: null,
    status: "completed",
    currentStep: null,
    progress: 100,
    input: entry.input,
    output: null,
    error: null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

export default function App(): JSX.Element {
  const queryClient = useQueryClient();
  const [themeId, setThemeId] = useState<ThemeId>(getInitialThemeId);
  const [fontId, setFontId] = useState<FontId>(getInitialFontId);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [workspaceView, setWorkspaceView] = useState<"runs" | "lab" | "plugins">("runs");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [workflowValues, setWorkflowValues] = useState<WorkflowFormValues>({});
  const [extensionTabSelection, setExtensionTabSelection] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ title: string; message: string } | null>(null);
  const [newRunFocusError, setNewRunFocusError] = useState<string | null>(null);
  const [showProjectLanding, setShowProjectLanding] = useState(false);
  const [newRunModalMode, setNewRunModalMode] = useState<"fresh" | "resubmit" | "library" | null>(null);
  const [resubmitSourceRun, setResubmitSourceRun] = useState<RunRecord | null>(null);
  const [librarySourceEntry, setLibrarySourceEntry] = useState<WorkflowLibraryEntry | null>(null);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [libraryToast, setLibraryToast] = useState<{ id: number; message: string } | null>(null);
  const [deleteRunCandidate, setDeleteRunCandidate] = useState<DeleteRunCandidate | null>(null);
  const [resubmitValidation, setResubmitValidation] = useState<ReusedInputValidationState>({ status: "idle", files: [] });
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const hasProject = Boolean(configQuery.data?.apiBaseUrl && configQuery.data.projectDir);
  const apiBaseUrl = configQuery.data?.apiBaseUrl ?? "";
  const workflowsQuery = useQuery({ queryKey: ["workflows", apiBaseUrl], queryFn: listWorkflows, enabled: hasProject });
  const pluginsQuery = useQuery({ queryKey: ["plugins", apiBaseUrl], queryFn: listPlugins, enabled: hasProject });
  const runsQuery = useQuery({
    queryKey: ["runs", apiBaseUrl],
    queryFn: listRuns,
    enabled: hasProject,
    refetchInterval: hasProject ? 2_000 : false
  });
  const libraryQuery = useQuery({
    queryKey: ["library", apiBaseUrl],
    queryFn: listWorkflowLibraryEntries,
    enabled: hasProject
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

  useEffect(() => {
    if (!libraryToast) return;
    const timeout = window.setTimeout(() => setLibraryToast(null), 2_400);
    return () => window.clearTimeout(timeout);
  }, [libraryToast]);

  const workflows = workflowsQuery.data ?? [];
  const plugins = pluginsQuery.data?.plugins ?? [];
  const selectedWorkflow = workflows.find((workflow) => workflow.manifest.id === selectedWorkflowId);
  const isExtensionWorkflow = workflowHasCapability(selectedWorkflow, "extension.tabRouting");

  useEffect(() => {
    if (workflows.length === 0) {
      setSelectedWorkflowId("");
      return;
    }
    if (!selectedWorkflowId || !workflows.some((workflow) => workflow.manifest.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].manifest.id);
    }
  }, [selectedWorkflowId, workflows]);

  useEffect(() => {
    setWorkflowValues((current) => normalizeWorkflowValues(selectedWorkflow, current));
  }, [selectedWorkflow]);
  const createRunMutation = useMutation({
    mutationFn: async () => {
      setFormError(null);
      setActionError(null);
      let activeConfig = configQuery.data;
      if (!activeConfig?.apiBaseUrl || !activeConfig.projectDir) {
        setShowProjectLanding(true);
        throw new Error("Open a project before starting a run.");
      }
      if (!selectedWorkflow) {
        throw new Error("Install a workflow plugin before starting a run.");
      }
      const extensionTab =
        workflowHasCapability(selectedWorkflow, "extension.tabRouting")
          ? buildExtensionTabInput(extensionTabSelection, compatibleExtensionClients, selectedWorkflow.manifest.targetUrl)
          : null;
      const workflowInput = buildWorkflowInputFromValues(selectedWorkflow, workflowValues);
      if (extensionTab) workflowInput.extensionTab = extensionTab;

      return createRun({ workflowId: selectedWorkflowId, name, input: workflowInput });
    },
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      setNewRunModalMode(null);
      setResubmitSourceRun(null);
      setLibrarySourceEntry(null);
      setResubmitValidation({ status: "idle", files: [] });
      setResubmitError(null);
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
      setDeleteRunCandidate(null);
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

  const renameRunMutation = useMutation({
    mutationFn: ({ runId, nextName }: { runId: string; nextName: string }) => renameRun(runId, nextName),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not rename run",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  function requestDeleteRun(run: DeleteRunCandidate): void {
    setActionError(null);
    setDeleteRunCandidate(run);
  }

  const saveRunToLibraryMutation = useMutation({
    mutationFn: (runId: string) => saveRunToWorkflowLibrary({ runId }),
    onSuccess: (entry) => {
      setLibraryToast({ id: Date.now(), message: `Saved "${entry.name}" to Library.` });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not save run to library",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  const renameLibraryEntryMutation = useMutation({
    mutationFn: ({ entryId, nextName }: { entryId: string; nextName: string }) => renameWorkflowLibraryEntry(entryId, nextName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not rename library entry",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  const deleteLibraryEntryMutation = useMutation({
    mutationFn: deleteWorkflowLibraryEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not delete library entry",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  const focusNewRunTabMutation = useMutation({
    mutationFn: focusExtensionClient,
    onSuccess: () => setNewRunFocusError(null),
    onError: (error) => setNewRunFocusError(error instanceof Error ? error.message : String(error))
  });

  const installPluginMutation = useMutation({
    mutationFn: installPlugin,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plugins"] });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["system"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not install plugin",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  const uninstallPluginMutation = useMutation({
    mutationFn: ({ pluginId, version }: { pluginId: string; version?: string }) => uninstallPlugin(pluginId, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plugins"] });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["system"] });
    },
    onError: (error) =>
      setActionError({
        title: "Could not uninstall plugin",
        message: error instanceof Error ? error.message : String(error)
      })
  });

  const selectedRunSummary = (runsQuery.data ?? []).find((run) => run.id === selectedRunId);
  const activeRun = selectedRunQuery.data?.run ?? selectedRunSummary;
  const selectedRunDetailError = selectedRunQuery.error
    ? selectedRunQuery.error instanceof Error
      ? selectedRunQuery.error.message
      : String(selectedRunQuery.error)
    : null;
  const selectedRunIds = new Set([selectedRunId]);
  const cliAgentRuns = useMemo(() => activeCliAgentRuns(runsQuery.data ?? []), [runsQuery.data]);
  const savedRunIds = useMemo(() => savedLibrarySourceRunIds(libraryQuery.data ?? []), [libraryQuery.data]);
  const extensionClients = systemQuery.data?.extension.connectedClients ?? [];
  const compatibleExtensionClients = useMemo(() => extensionClients.filter((client) => client.compatible), [extensionClients]);
  const requiredExtensionProtocol = systemQuery.data?.extension.requiredProtocolVersion ?? 7;
  const activeRunWorkflowAvailability = useMemo(
    () => (activeRun ? resolveRunWorkflowAvailability(activeRun, workflows) : null),
    [activeRun, workflows]
  );

  useEffect(() => {
    if (!isExtensionWorkflow) return;
    setExtensionTabSelection((current) => {
      return resolveExtensionTabSelection(
        current,
        compatibleExtensionClients.map((client) => client.id),
        NEW_EXTENSION_TAB_VALUE
      );
    });
  }, [compatibleExtensionClients, isExtensionWorkflow]);

  async function chooseFilesForField(
    fieldName: string,
    title: string,
    maxFiles?: number,
    filters?: Array<{ name: string; extensions: string[] }>
  ): Promise<void> {
    const files = await window.navoke.selectFiles({
      title,
      filters: filters ?? [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (files.length > 0) {
      setWorkflowValues((current) => ({ ...current, [fieldName]: files.slice(0, maxFiles) }));
      markResubmitFileInputsChanged();
    }
  }

  async function openProjectAndRefresh(projectPath?: string): Promise<NavokeConfig> {
    const previousProjectDir = configQuery.data?.projectDir ?? null;
    const config = await openProject(projectPath);
    queryClient.setQueryData(["config"], config);
    if (config.projectDir !== previousProjectDir) {
      setSelectedRunId(null);
      queryClient.removeQueries({ queryKey: ["run"] });
    }
    void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    void queryClient.invalidateQueries({ queryKey: ["plugins"] });
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
    void queryClient.invalidateQueries({ queryKey: ["library"] });
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

  function resetNewRunForm(): void {
    const workflow = workflows[0];
    setSelectedWorkflowId(workflow?.manifest.id ?? "");
    setName("");
    setWorkflowValues(createInitialWorkflowValues(workflow));
    setExtensionTabSelection("");
    setFormError(null);
    setNewRunFocusError(null);
    setResubmitSourceRun(null);
    setLibrarySourceEntry(null);
    setResubmitValidation({ status: "idle", files: [] });
    setResubmitError(null);
  }

  function openFreshNewRunModal(): void {
    resetNewRunForm();
    setWorkspaceView("runs");
    setNewRunModalMode("fresh");
  }

  function markResubmitFileInputsChanged(): void {
    if (newRunModalMode !== "resubmit" && newRunModalMode !== "library") return;
    setResubmitError(null);
    setResubmitValidation({ status: "ready", files: [] });
  }

  function clearWorkflowFiles(fieldName: string): void {
    setWorkflowValues((current) => ({ ...current, [fieldName]: [] }));
    markResubmitFileInputsChanged();
  }

  function applyNewRunConfigurationToForm(
    duplicate: ReturnType<typeof buildDuplicateRunConfiguration>,
    nameOverride = duplicate.name
  ): void {
    setSelectedWorkflowId(duplicate.workflowId);
    setName(nameOverride);
    setWorkflowValues(duplicate.values);
    setExtensionTabSelection(duplicate.extensionTabSelection);
    setFormError(null);
    setNewRunFocusError(null);
    setWorkspaceView("runs");
    setSelectedRunId(null);
  }

  function applyRunConfigurationToForm(run: RunRecord): void {
    const availability = resolveRunWorkflowAvailability(run, workflows);
    if (availability.status === "missing" || availability.status === "version-mismatch") {
      throw new Error(availability.message);
    }

    const duplicate = buildDuplicateRunConfiguration(run, {
      workflow: availability.workflow ?? undefined,
      compatibleClients: compatibleExtensionClients,
      existingRuns: runsQuery.data ?? [],
      newExtensionTabValue: NEW_EXTENSION_TAB_VALUE
    });

    applyNewRunConfigurationToForm(duplicate);
  }

  function applyLibraryEntryConfigurationToForm(entry: WorkflowLibraryEntry): void {
    const runLike = libraryEntryToRunRecord(entry, "");
    const availability = resolveRunWorkflowAvailability(libraryEntryToRunRecord(entry), workflows);
    if (availability.status === "missing" || availability.status === "version-mismatch") {
      throw new Error(availability.message);
    }

    const duplicate = buildDuplicateRunConfiguration(runLike, {
      workflow: availability.workflow ?? undefined,
      compatibleClients: compatibleExtensionClients,
      existingRuns: runsQuery.data ?? [],
      newExtensionTabValue: NEW_EXTENSION_TAB_VALUE
    });

    applyNewRunConfigurationToForm(duplicate, entry.name);
  }

  function closeNewRunModal(): void {
    if (createRunMutation.isPending) return;
    setNewRunModalMode(null);
    setResubmitSourceRun(null);
    setLibrarySourceEntry(null);
    setResubmitValidation({ status: "idle", files: [] });
    setResubmitError(null);
  }

  function openResubmitNewModal(run: RunRecord): void {
    const availability = resolveRunWorkflowAvailability(run, workflows);
    const filePaths = collectRunInputFilePaths(run.input, availability.workflow ?? undefined);
    setResubmitError(null);
    setResubmitSourceRun(run);
    setLibrarySourceEntry(null);
    setResubmitValidation(filePaths.length === 0 ? { status: "ready", files: [] } : { status: "checking", files: [] });
    setNewRunModalMode("resubmit");

    try {
      applyRunConfigurationToForm(run);
    } catch (error) {
      setResubmitError(error instanceof Error ? error.message : String(error));
      setResubmitValidation({ status: "error", files: [], message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (filePaths.length === 0) return;

    void validateFilePaths(filePaths)
      .then((result) => setResubmitValidation({ status: "ready", files: result.files }))
      .catch((error) =>
        setResubmitValidation({
          status: "error",
          files: [],
        message: error instanceof Error ? error.message : String(error)
        })
      );
  }

  function openLibraryEntryModal(entry: WorkflowLibraryEntry): void {
    const availability = resolveRunWorkflowAvailability(libraryEntryToRunRecord(entry), workflows);
    const filePaths = collectRunInputFilePaths(entry.input, availability.workflow ?? undefined);
    setResubmitError(null);
    setResubmitSourceRun(null);
    setLibrarySourceEntry(entry);
    setResubmitValidation(filePaths.length === 0 ? { status: "ready", files: [] } : { status: "checking", files: [] });
    setNewRunModalMode("library");

    try {
      applyLibraryEntryConfigurationToForm(entry);
    } catch (error) {
      setResubmitError(error instanceof Error ? error.message : String(error));
      setResubmitValidation({ status: "error", files: [], message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (filePaths.length === 0) return;

    void validateFilePaths(filePaths)
      .then((result) => setResubmitValidation({ status: "ready", files: result.files }))
      .catch((error) =>
        setResubmitValidation({
          status: "error",
          files: [],
          message: error instanceof Error ? error.message : String(error)
        })
      );
  }

  const showLanding = showProjectLanding || !hasProject;
  const currentProjectDir = configQuery.data?.projectDir ?? "";
  const projectName = configQuery.data?.projectName ?? "Navoke";
  const reusedSourceInput = resubmitSourceRun?.input ?? librarySourceEntry?.input ?? null;
  const reusedWorkflow = resubmitSourceRun
    ? resolveRunWorkflowAvailability(resubmitSourceRun, workflows).workflow ?? undefined
    : librarySourceEntry
      ? resolveRunWorkflowAvailability(libraryEntryToRunRecord(librarySourceEntry), workflows).workflow ?? undefined
      : undefined;
  const reusedFileCount = reusedSourceInput ? collectRunInputFilePaths(reusedSourceInput, reusedWorkflow).length : 0;
  const hasReusedInputValidation = newRunModalMode === "resubmit" || newRunModalMode === "library";
  const canStartNewRun =
    Boolean(selectedWorkflow) &&
    !createRunMutation.isPending &&
    (!hasReusedInputValidation || canUseReusedInputFiles(resubmitValidation));
  const newRunModalTitle =
    newRunModalMode === "resubmit" ? "Resubmit New" : newRunModalMode === "library" ? "Use Library Entry" : "New Run";
  const newRunModalDescription =
    newRunModalMode === "resubmit" && resubmitSourceRun
      ? `Create a new run from ${resubmitSourceRun.name}.`
      : newRunModalMode === "library" && librarySourceEntry
        ? `Create a new run from ${librarySourceEntry.name}.`
      : "Configure and start a new workflow run.";
  const newRunForm = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Workflow</Label>
        <select
          value={selectedWorkflowId}
          onChange={(event) => setSelectedWorkflowId(event.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {workflows.length === 0 ? <option value="">No workflow plugins installed</option> : null}
          {workflows.map((workflow) => (
            <option key={workflow.manifest.id} value={workflow.manifest.id}>
              {workflow.manifest.title} [{workflow.plugin.source}: {workflow.plugin.id}@{workflow.plugin.version}]
            </option>
          ))}
        </select>
      </div>
      {hasProject && workflows.length === 0 ? (
        <div className={cn("flex gap-2 rounded-md border p-3 text-sm", toneClassNames.info)}>
          <Package className="mt-0.5 h-4 w-4 shrink-0" />
          Install a workflow plugin from the Plugins tab before starting a run.
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Run name</Label>
        <Input className="h-9" value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
      </div>

      {isExtensionWorkflow ? (
        <ExtensionTabRoutingPanel
          clients={extensionClients}
          requiredProtocolVersion={requiredExtensionProtocol}
          value={extensionTabSelection || NEW_EXTENSION_TAB_VALUE}
          onChange={(value) => {
            setNewRunFocusError(null);
            setExtensionTabSelection(value);
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

      {selectedWorkflow?.manifest.inputFields.map((field) => (
        <WorkflowInputFieldControl
          key={field.name}
          field={field}
          value={workflowValues[field.name]}
          onChange={(value) => setWorkflowValues((current) => ({ ...current, [field.name]: value }))}
          onChooseFiles={() => void chooseFilesForField(field.name, field.filePickerTitle ?? `Choose ${field.label}`, field.maxFiles, field.fileFilters)}
          onClearFiles={() => clearWorkflowFiles(field.name)}
        />
      ))}

      {!hasProject ? (
        <div className={cn("flex gap-2 rounded-md border p-3 text-sm", toneClassNames.info)}>
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Choose a project folder to create runs. Starting a run will prompt for one.
        </div>
      ) : null}

      {hasReusedInputValidation ? (
        <ReusedInputValidationPanel
          fileCount={reusedFileCount}
          validation={resubmitValidation}
          error={resubmitError}
        />
      ) : null}

      {formError ? (
        <div className={cn("flex gap-2 rounded-md border p-3 text-sm", toneClassNames.danger)}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {formError}
        </div>
      ) : null}

      <Button className="h-9 w-full" onClick={() => createRunMutation.mutate()} disabled={!canStartNewRun}>
        <Play className="h-4 w-4" />
        {createRunMutation.isPending ? "Starting..." : hasProject ? "Start run" : "Choose project and start"}
      </Button>
    </div>
  );

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground transition-colors">
      <header className="app-drag-region shrink-0 border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={APP_ICON_SRC}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full border border-border bg-background object-cover"
              draggable={false}
            />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">{showLanding ? "Navoke" : projectName}</h1>
              <p className="truncate text-sm text-muted-foreground">
                {showLanding ? "Choose a Navoke project folder to continue." : configQuery.data?.projectDir}
              </p>
            </div>
          </div>
          <div className="app-no-drag flex items-center gap-2">
            {!showLanding ? (
              <>
                <Badge
                  className={cn(
                    "gap-1.5 border",
                    (systemQuery.data?.runner.running ?? 0) > 0 ? toneClassNames.info : toneClassNames.neutral
                  )}
                >
                  {(systemQuery.data?.runner.running ?? 0) > 0 ? <span className="queue-running-indicator" aria-hidden="true" /> : null}
                  Queue: {systemQuery.data?.runner.queued ?? 0} | Running: {systemQuery.data?.runner.running ?? 0}
                </Badge>
                <Badge className={cn("border", toneClassNames.info)}>
                  Extension: {systemQuery.data?.extension.connectedClients.length ?? 0}
                </Badge>
                {cliAgentRuns.length > 0 ? (
                  <Badge className={cn("border", toneClassNames.warning)}>CLI agents: {cliAgentRuns.length}</Badge>
                ) : null}
                <Button type="button" variant="outline" size="sm" onClick={() => setShowProjectLanding(true)}>
                  <FolderOpen className="h-4 w-4" />
                  Switch Project
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void window.navoke.openPath(currentProjectDir)}
                  disabled={!currentProjectDir}
                >
                  <ExternalLink className="h-4 w-4" />
                  File Manager
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
            <AppWindowControls />
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
      <div className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 overflow-hidden px-5 py-4">
        <section className="flex min-h-0 w-full flex-col gap-4">
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
                onClick={() => setWorkspaceView("plugins")}
                className={cn(
                  "rounded px-3 py-1.5 text-sm font-medium transition",
                  workspaceView === "plugins" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Plugins
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
            <WorkflowLabPanel
              extensionClients={extensionClients}
              hasProject={hasProject}
              apiBaseUrl={apiBaseUrl}
              workflows={workflows}
              onUseCalibrationPreset={(workflowId, fieldName, value) => {
                resetNewRunForm();
                setSelectedWorkflowId(workflowId);
                setWorkflowValues((current) => ({ ...current, [fieldName]: stringifyJsonFieldValue(value) }));
                setWorkspaceView("runs");
                setNewRunModalMode("fresh");
              }}
            />
          </div>

          <div className={workspaceView === "plugins" ? "min-h-0 flex-1 overflow-hidden" : "hidden"}>
            <PluginPanel
              plugins={plugins}
              workflows={workflows}
              rootDir={pluginsQuery.data?.rootDir ?? configQuery.data?.pluginRootDir ?? ""}
              browserExtensionDir={configQuery.data?.browserExtensionDir ?? ""}
              hasProject={hasProject}
              isLoading={pluginsQuery.isLoading}
              isInstalling={installPluginMutation.isPending}
              uninstallingPlugin={`${uninstallPluginMutation.variables?.pluginId ?? ""}@${uninstallPluginMutation.variables?.version ?? ""}`}
              onInstall={(pluginPath) => installPluginMutation.mutate(pluginPath)}
              onUninstall={(pluginId, version) => uninstallPluginMutation.mutate({ pluginId, version })}
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: ["plugins"] });
                void queryClient.invalidateQueries({ queryKey: ["workflows"] });
              }}
            />
          </div>

          <div className={workspaceView === "runs" ? "flex min-h-0 flex-1 flex-col gap-4" : "hidden"}>
              {cliAgentRuns.length > 0 ? (
                <AgentActivityPanel runs={cliAgentRuns} onSelectRun={(runId) => setSelectedRunId(runId)} />
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Runs</h2>
                <Button type="button" onClick={openFreshNewRunModal} disabled={!hasProject}>
                  <Plus className="h-4 w-4" />
                  New Run
                </Button>
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
                    workflowAvailability={resolveRunWorkflowAvailability(run, workflows)}
                    onSelect={() => setSelectedRunId(run.id)}
                    onResubmit={() => openResubmitNewModal(run)}
                    onSaveToLibrary={() => saveRunToLibraryMutation.mutate(run.id)}
                    isSavedToLibrary={savedRunIds.has(run.id)}
                    isSavingToLibrary={saveRunToLibraryMutation.variables === run.id && saveRunToLibraryMutation.isPending}
                    onDelete={() => requestDeleteRun(run)}
                    isDeleting={deleteRunMutation.variables === run.id && deleteRunMutation.isPending}
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

      {!showLanding && hasProject ? (
        <WorkflowLibraryDrawer
          entries={libraryQuery.data ?? []}
          runs={runsQuery.data ?? []}
          workflows={workflows}
          isLoading={libraryQuery.isLoading}
          isOpen={libraryDrawerOpen}
          deletingEntryId={deleteLibraryEntryMutation.variables ?? null}
          onOpenChange={setLibraryDrawerOpen}
          onUse={openLibraryEntryModal}
          onRename={(entryId, nextName) =>
            renameLibraryEntryMutation.mutateAsync({ entryId, nextName }).then(() => undefined)
          }
          onDelete={(entryId) => deleteLibraryEntryMutation.mutate(entryId)}
        />
      ) : null}

      {libraryToast ? <LibraryToast message={libraryToast.message} /> : null}

      <LocalRuntimeFooter config={configQuery.data} system={systemQuery.data} />

      {!showLanding && newRunModalMode ? (
        <NewRunModal title={newRunModalTitle} description={newRunModalDescription} onClose={closeNewRunModal}>
          {newRunForm}
        </NewRunModal>
      ) : null}
      {!showLanding && selectedRunId ? (
        <RunDetailModal
          runId={selectedRunId}
          run={activeRun}
          artifacts={selectedRunQuery.data?.artifacts ?? []}
          events={selectedRunQuery.data?.events ?? []}
          extensionClients={extensionClients}
          workflowAvailability={activeRunWorkflowAvailability}
          hasDetails={Boolean(selectedRunQuery.data)}
          isLoading={selectedRunQuery.isLoading}
          detailError={selectedRunDetailError}
          isDeleting={deleteRunMutation.isPending}
          isSavedToLibrary={savedRunIds.has(selectedRunId)}
          isSavingToLibrary={saveRunToLibraryMutation.variables === selectedRunId && saveRunToLibraryMutation.isPending}
          onClose={() => setSelectedRunId(null)}
          onPause={(runId) => void pauseRun(runId).then(() => queryClient.invalidateQueries())}
          onResume={(runId) => void resumeRun(runId).then(() => queryClient.invalidateQueries())}
          onCancel={(runId) => void cancelRun(runId).then(() => queryClient.invalidateQueries())}
          onOpenDataFolder={() => window.navoke.openPath(activeRun?.runDir ?? "")}
          onFocusClient={(clientId) => focusExtensionClient(clientId)}
          onRename={(runId, nextName) => renameRunMutation.mutateAsync({ runId, nextName }).then(() => undefined)}
          onSaveToLibrary={(runId) => saveRunToLibraryMutation.mutate(runId)}
          onDelete={(runId) => {
            const candidate = activeRun ?? (runsQuery.data ?? []).find((run) => run.id === runId);
            if (candidate) {
              requestDeleteRun(candidate);
              return;
            }
            setActionError({
              title: "Could not delete run",
              message: "Run metadata is unavailable, so the data folder path cannot be confirmed."
            });
          }}
        />
      ) : null}
      {deleteRunCandidate ? (
        <DeleteRunConfirmDialog
          run={deleteRunCandidate}
          isDeleting={deleteRunMutation.isPending}
          onCancel={() => setDeleteRunCandidate(null)}
          onConfirm={() => deleteRunMutation.mutate(deleteRunCandidate.id)}
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

function AppWindowControls(): JSX.Element | null {
  const controls = window.navoke?.windowControls;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    let active = true;
    void controls
      .getState()
      .then((state) => {
        if (active) setIsMaximized(state.isMaximized);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [controls]);

  if (!controls) return null;

  return (
    <div className="app-no-drag ml-1 flex overflow-hidden rounded-md border border-border bg-background">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-10 rounded-none"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void controls.minimize().catch(() => undefined)}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-10 rounded-none"
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        title={isMaximized ? "Restore" : "Maximize"}
        onClick={() =>
          void controls
            .toggleMaximize()
            .then((state) => setIsMaximized(state.isMaximized))
            .catch(() => undefined)
        }
      >
        {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-10 rounded-none hover:bg-destructive hover:text-destructive-foreground"
        aria-label="Close window"
        title="Close"
        onClick={() => void controls.close().catch(() => undefined)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function LocalRuntimeFooter({ config, system }: { config?: NavokeConfig; system?: SystemInfo }): JSX.Element {
  return (
    <footer className="shrink-0 overflow-hidden border-t border-border bg-card/90 px-5 py-1 text-[10px] leading-4 text-muted-foreground">
      <div className="mx-auto flex max-w-[1500px] min-w-0 items-center gap-3 overflow-hidden">
        <span className="shrink-0 font-medium text-foreground">Local Runtime</span>
        <span className="min-w-0 flex-[1.2_1_0] truncate">Project: {config?.projectDir ?? "No project selected"}</span>
        <span className="min-w-0 flex-1 truncate">Data: {config?.dataDir || "Choose a project to create .navoke data"}</span>
        <span className="shrink-0 truncate">API: {config?.apiBaseUrl || "Not running"}</span>
        <span className="shrink-0 truncate">Plugins: {system?.plugins?.installed ?? 0}</span>
        <span className="shrink-0">
          Extension tabs: {system?.extension.connectedClients.length ?? 0}; compatible: {system?.extension.compatible ?? 0}; controllers:{" "}
          {system?.extension.compatibleControllers ?? 0}
        </span>
      </div>
    </footer>
  );
}

function RunStatusBadge({ status }: { status: RunRecord["status"] }): JSX.Element {
  const motionActive = isMotionActiveStatus(status);
  return (
    <Badge className={cn("gap-1.5 border", statusTone(status))}>
      {motionActive ? (
        <span className={cn("run-activity-dot", status === "running" && "run-activity-dot--strong")} aria-hidden="true" />
      ) : null}
      {status}
    </Badge>
  );
}

function RunNumberBadge({ runNumber }: { runNumber: RunRecord["runNumber"] }): JSX.Element | null {
  if (runNumber === null) return null;
  return (
    <Badge className="border border-border bg-muted/40 font-mono text-[11px] font-medium text-muted-foreground">
      #{runNumber}
    </Badge>
  );
}

function AgentActivityPanel({ runs, onSelectRun }: { runs: RunRecord[]; onSelectRun(runId: string): void }): JSX.Element {
  return (
    <Card className="shrink-0">
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">CLI Agent Activity</CardTitle>
          <Badge className={cn("border", toneClassNames.warning)}>{runs.length} active</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0">
        {runs.map((run) => {
          const command = runOriginCommand(run);
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelectRun(run.id)}
              className="w-full rounded-md border border-border bg-background p-3 text-left transition hover:border-primary"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <RunNumberBadge runNumber={run.runNumber} />
                    <div className="truncate text-sm font-medium">{run.name}</div>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{run.workflowId}</div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">{run.currentStep ?? "Queued"}</div>
                  {command ? <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{command}</div> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge className={cn("border", toneClassNames.neutral)}>{runOriginLabel(run)}</Badge>
                  <RunStatusBadge status={run.status} />
                </div>
              </div>
              <Progress value={run.progress} active={isMotionActiveStatus(run.status)} className="mt-3" />
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PluginPanel({
  plugins,
  workflows,
  rootDir,
  browserExtensionDir,
  hasProject,
  isLoading,
  isInstalling,
  uninstallingPlugin,
  onInstall,
  onUninstall,
  onRefresh
}: {
  plugins: InstalledPluginRecord[];
  workflows: WorkflowSummary[];
  rootDir: string;
  browserExtensionDir: string;
  hasProject: boolean;
  isLoading: boolean;
  isInstalling: boolean;
  uninstallingPlugin: string;
  onInstall(pluginPath: string): void;
  onUninstall(pluginId: string, version: string): void;
  onRefresh(): void;
}): JSX.Element {
  const [pluginPath, setPluginPath] = useState("");
  const builtInWorkflows = workflows.filter((workflow) => workflow.plugin.source === "builtin");
  const installedWorkflowCount = workflows.filter((workflow) => workflow.plugin.source === "user").length;

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Workflow Plugins</CardTitle>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {rootDir || "Open a project to start the local API and manage user plugins."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void window.navoke.openPath(browserExtensionDir)}
              disabled={!browserExtensionDir}
              title="Open the unpacked Navoke browser extension folder"
            >
              <FolderOpen className="h-4 w-4" />
              Browser extension
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={!hasProject}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 pt-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={pluginPath}
            onChange={(event) => setPluginPath(event.target.value)}
            placeholder="Local plugin folder path containing plugin.json"
            disabled={!hasProject || isInstalling}
          />
          <Button
            type="button"
            onClick={() => onInstall(pluginPath.trim())}
            disabled={!hasProject || isInstalling || !pluginPath.trim()}
          >
            <Upload className="h-4 w-4" />
            Install
          </Button>
        </div>

        {!hasProject ? (
          <div className={cn("rounded-md border p-3 text-sm", toneClassNames.info)}>
            Open a project to use the local plugin API. Plugins are installed per user, not per project.
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <PluginStat label="Installed plugins" value={String(plugins.length)} />
          <PluginStat label="Plugin workflows" value={String(installedWorkflowCount)} />
          <PluginStat label="Built-ins" value={String(builtInWorkflows.length)} />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          {isLoading ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading plugins...</div>
          ) : null}

          {plugins.length === 0 && !isLoading ? (
            <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              No user plugins are installed. Built-in workflows remain available.
            </div>
          ) : null}

          {plugins.map((plugin) => {
            const pluginKey = `${plugin.pluginId}@${plugin.version}`;
            const isUninstalling = uninstallingPlugin === pluginKey;
            return (
              <div key={pluginKey} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="truncate text-sm font-medium">
                        {plugin.name} {plugin.version}
                      </div>
                      <Badge
                        className={cn(
                          "border",
                          plugin.status === "loaded"
                            ? toneClassNames.success
                            : plugin.status === "incompatible"
                              ? toneClassNames.warning
                              : toneClassNames.danger
                        )}
                      >
                        {plugin.status}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {plugin.pluginId} | API {plugin.pluginApiVersion}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{plugin.installPath}</div>
                    {plugin.error ? <div className={cn("mt-2 text-xs", toneTextClassNames.danger)}>{plugin.error}</div> : null}
                    {plugin.workflows.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {plugin.workflows.map((workflowId) => (
                          <Badge key={workflowId} className={cn("border", toneClassNames.neutral)}>
                            {workflowId}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => onUninstall(plugin.pluginId, plugin.version)}
                    disabled={isUninstalling}
                    title="Uninstall this user plugin version"
                  >
                    <Trash2 className="h-4 w-4" />
                    Uninstall
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PluginStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
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
    <div className="app-no-drag fixed inset-0 z-50 overflow-hidden bg-slate-950/45 px-4 py-6" onMouseDown={onClose}>
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
  config?: NavokeConfig;
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

  function startRename(project: NavokeConfig["recentProjects"][number]): void {
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
            className="mx-auto h-24 w-24 rounded-full border border-border bg-background object-cover"
            draggable={false}
          />
          <h2 className="text-3xl font-semibold">{config?.projectName ?? "Navoke"}</h2>
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

function RunInputPromptSummary({ items }: { items: RunPromptInputSummaryItem[] }): JSX.Element {
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{items.length === 1 ? "Input prompt" : "Input prompts"}</h3>
        <p className="text-xs text-muted-foreground">Prompt text saved with this run input.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <div key={item.name} className={cn("space-y-2", item.multiline ? "lg:col-span-2" : undefined)}>
            <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
            <div className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

type ReusedInputValidationState =
  | { status: "idle" | "checking"; files: FileValidationResult["files"] }
  | { status: "ready"; files: FileValidationResult["files"] }
  | { status: "error"; files: FileValidationResult["files"]; message: string };

function RunDetailModal({
  runId,
  run,
  artifacts,
  events,
  extensionClients,
  workflowAvailability,
  hasDetails,
  isLoading,
  detailError,
  isDeleting,
  isSavedToLibrary,
  isSavingToLibrary,
  onClose,
  onPause,
  onResume,
  onCancel,
  onOpenDataFolder,
  onFocusClient,
  onRename,
  onSaveToLibrary,
  onDelete
}: {
  runId: string;
  run?: RunRecord;
  artifacts: ArtifactRecord[];
  events: RuntimeEvent[];
  extensionClients: SystemInfo["extension"]["connectedClients"];
  workflowAvailability: RunWorkflowAvailability | null;
  hasDetails: boolean;
  isLoading: boolean;
  detailError: string | null;
  isDeleting: boolean;
  isSavedToLibrary: boolean;
  isSavingToLibrary: boolean;
  onClose(): void;
  onPause(runId: string): void;
  onResume(runId: string): void;
  onCancel(runId: string): void;
  onOpenDataFolder(): void | Promise<unknown>;
  onFocusClient(clientId: string): Promise<unknown>;
  onRename(runId: string, nextName: string): Promise<void>;
  onSaveToLibrary(runId: string): void;
  onDelete(runId: string): void;
}): JSX.Element {
  const [focusError, setFocusError] = useState<string | null>(null);
  const [isFocusing, setIsFocusing] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState(run?.name ?? "");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const extensionFocusTarget = useMemo(
    () => resolveExtensionFocusTarget(run, extensionClients, workflowAvailability?.workflow ?? undefined),
    [extensionClients, run, workflowAvailability?.workflow]
  );
  const workflowUsable = canUseRunWorkflow(workflowAvailability);
  const runWorkflow = workflowAvailability?.workflow ?? undefined;
  const hasExtensionFocus = workflowHasCapability(runWorkflow, "extension.focusTarget");
  const runPresentation = getRunPresentation(run?.output);
  const promptInputItems = useMemo(() => runPromptInputSummary(run?.input, runWorkflow), [run?.input, runWorkflow]);
  const canResumeRun = workflowUsable && (run?.status === "waiting_manual" || isRecoverableFailedExtensionRun(run, runWorkflow));
  const canRenameRun = Boolean(run && !["queued", "running", "pausing", "waiting_manual"].includes(run.status));
  const saveTitle = isSavedToLibrary
    ? "Already saved to library"
    : isSavingToLibrary
      ? "Saving to library..."
      : "Save this run configuration to the library";

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
  }, [runId, extensionFocusTarget?.clientId, extensionFocusTarget?.url]);

  useEffect(() => {
    if (!isEditingName) {
      setEditingName(run?.name ?? "");
      setRenameError(null);
    }
  }, [isEditingName, run?.name, runId]);

  async function submitRunRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!run) return;
    setRenameError(null);
    setIsRenaming(true);
    try {
      await onRename(run.id, editingName);
      setIsEditingName(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRenaming(false);
    }
  }

  async function focusExtensionTab(): Promise<void> {
    if (!extensionFocusTarget || extensionFocusTarget.action === "disabled") return;
    setFocusError(null);
    setIsFocusing(true);
    try {
      if (extensionFocusTarget.action === "focus" && extensionFocusTarget.clientId) {
        await onFocusClient(extensionFocusTarget.clientId);
        return;
      }
      if (extensionFocusTarget.action === "open" && extensionFocusTarget.url) {
        await openExtensionTab(extensionFocusTarget.url);
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
                {run ? `${run.runNumber === null ? "" : `Run #${run.runNumber} | `}${run.name} | ${run.workflowId}` : `Run ${runId}`}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close run detail"
              className="shrink-0"
              onClick={onClose}
            >
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
                        {isEditingName ? (
                          <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={(event) => void submitRunRename(event)}>
                            <Input
                              value={editingName}
                              onChange={(event) => setEditingName(event.target.value)}
                              autoFocus
                              aria-label="Run name"
                              className="h-9 min-w-64"
                            />
                            <Button type="submit" size="sm" disabled={isRenaming}>
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setIsEditingName(false);
                                setRenameError(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </form>
                        ) : (
                          <div className="truncate font-medium">{run.name}</div>
                        )}
                        <div className="text-xs text-muted-foreground">{run.workflowId}</div>
                        {workflowAvailability ? (
                          <div
                            className={cn(
                              "text-xs",
                              workflowAvailability.status === "missing" || workflowAvailability.status === "version-mismatch"
                                ? toneTextClassNames.danger
                                : "text-muted-foreground"
                            )}
                          >
                            {workflowAvailability.message}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <RunNumberBadge runNumber={run.runNumber} />
                        {isCliRun(run) ? <Badge className={cn("border", toneClassNames.neutral)}>{runOriginLabel(run)}</Badge> : null}
                        <RunStatusBadge status={run.status} />
                      </div>
                    </div>
                    <Progress value={run.progress} active={isMotionActiveStatus(run.status)} />
                    <div className="text-sm text-muted-foreground">{run.currentStep ?? "No step yet"}</div>
                    {isCliRun(run) ? (
                      <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">{runOriginLabel(run)}</div>
                        {runOriginCommand(run) ? <div className="mt-1 truncate font-mono">{runOriginCommand(run)}</div> : null}
                        {run.origin.source === "cli" && run.origin.cwd ? <div className="mt-1 truncate">cwd: {run.origin.cwd}</div> : null}
                      </div>
                    ) : null}
                  </div>

                  {run.error ? <div className={cn("rounded-md border p-3 text-sm", toneClassNames.danger)}>{run.error}</div> : null}
                  {workflowAvailability?.status === "missing" || workflowAvailability?.status === "version-mismatch" ? (
                    <div className={cn("rounded-md border p-3 text-sm", toneClassNames.danger)}>
                      {workflowAvailability.message} Install the matching plugin version before duplicating or resuming this run.
                    </div>
                  ) : null}
                  {renameError ? <div className={cn("rounded-md border p-3 text-sm", toneClassNames.danger)}>{renameError}</div> : null}
                </>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Run metadata is unavailable. Delete remains available for this selected run id.
                </div>
              )}

              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {run && hasExtensionFocus && run.status === "running" ? (
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
                          ? "Resume will inspect the current browser page before resubmitting unfinished work."
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingName(run?.name ?? "");
                      setRenameError(null);
                      setIsEditingName(true);
                    }}
                    disabled={!run || !canRenameRun}
                    title={canRenameRun ? "Rename run and data folder" : "Runs can be renamed after they are inactive."}
                  >
                    <Pencil className="h-4 w-4" />
                    Rename
                  </Button>
                  {hasExtensionFocus && extensionFocusTarget ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void focusExtensionTab()}
                      disabled={extensionFocusTarget.action === "disabled" || isFocusing}
                      title={
                        extensionFocusTarget.disabledReason ??
                        (extensionFocusTarget.action === "open"
                          ? "Open the tracked URL through the Navoke browser controller."
                          : `Go to ${extensionFocusTarget.client?.title || "the selected browser tab"}`)
                      }
                    >
                      <ExternalLink className="h-4 w-4" />
                      {extensionFocusTarget.buttonLabel}
                    </Button>
                  ) : null}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => run && onSaveToLibrary(run.id)}
                    disabled={!run || isSavedToLibrary || isSavingToLibrary}
                    title={saveTitle}
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => onDelete(runId)} disabled={isDeleting}>
                    <Trash2 className="h-4 w-4" />
                    Delete run
                  </Button>
                </div>
              </div>
              {focusError ? (
                <div className={cn("rounded-md border p-3 text-sm", toneClassNames.danger)}>
                  {focusError}
                </div>
              ) : null}
            </section>

            {promptInputItems.length > 0 ? <RunInputPromptSummary items={promptInputItems} /> : null}

            {hasDetails ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Artifacts</h3>
                  {artifacts.length === 0 ? (
                    <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No artifacts yet.</div>
                  ) : runPresentation && run ? (
                    <WorkflowPresentationView run={run} artifacts={artifacts} presentation={runPresentation} />
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

function NewRunModal({
  title,
  description,
  children,
  onClose
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose(): void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-4 py-6" onMouseDown={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-run-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 id="new-run-title" className="text-base font-semibold">
              {title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close new run modal">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function WorkflowInputFieldControl({
  field,
  value,
  onChange,
  onChooseFiles,
  onClearFiles
}: {
  field: WorkflowSummary["manifest"]["inputFields"][number];
  value: unknown;
  onChange(value: unknown): void;
  onChooseFiles(): void;
  onClearFiles(): void;
}): JSX.Element {
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.type === "fileList") {
    const files = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string" && value.trim()
        ? [value]
        : [];
    return (
      <ImagePicker
        label={label}
        chooseLabel={field.fileValue === "single" || field.maxFiles === 1 ? "Choose file" : "Choose files"}
        files={files}
        emptyText="No files selected"
        onChoose={onChooseFiles}
        onClear={onClearFiles}
      />
    );
  }
  if (field.type === "textarea" || field.type === "json") {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Textarea
          className={cn("min-h-24 py-1.5", field.type === "json" && "font-mono text-xs")}
          value={typeof value === "string" ? value : stringifyJsonFieldValue(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          spellCheck={field.type === "json" ? false : undefined}
        />
        {field.help ? <div className="text-xs text-muted-foreground">{field.help}</div> : null}
      </div>
    );
  }
  if (field.type === "stringList") {
    return (
      <StringListEditor
        label={label}
        values={Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []}
        placeholder={field.placeholder}
        help={field.help}
        onChange={onChange}
      />
    );
  }
  if (field.type === "select") {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.help ? <div className="text-xs text-muted-foreground">{field.help}</div> : null}
      </div>
    );
  }
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        className="h-9"
        type={field.type === "number" ? "number" : "text"}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(event) => onChange(field.type === "number" ? event.target.value : event.target.value)}
        placeholder={field.placeholder}
      />
      {field.help ? <div className="text-xs text-muted-foreground">{field.help}</div> : null}
    </div>
  );
}

function ReusedInputValidationPanel({
  fileCount,
  validation,
  error
}: {
  fileCount: number;
  validation: ReusedInputValidationState;
  error: string | null;
}): JSX.Element {
  const invalidFiles = invalidReusedInputFiles(validation);

  return (
    <div className="space-y-3 text-sm">
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

function DeleteRunConfirmDialog({
  run,
  isDeleting,
  onCancel,
  onConfirm
}: {
  run: DeleteRunCandidate;
  isDeleting: boolean;
  onCancel(): void;
  onConfirm(): void;
}): JSX.Element {
  const runLabel = `${run.runNumber === null ? "" : `#${run.runNumber} `}${run.name}`;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 px-4" onMouseDown={onCancel}>
      <div
        className="w-full max-w-2xl rounded-lg border border-border bg-background shadow-xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-run-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", toneTextClassNames.danger)} />
          <div className="min-w-0">
            <h3 id="delete-run-title" className="text-base font-semibold">
              Delete run?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This will delete {runLabel} and its run data folder.
            </p>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="text-sm font-medium">Folder to delete</div>
          {run.runDir ? (
            <div className="select-all break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
              {run.runDir}
            </div>
          ) : (
            <div className={cn("rounded-md border p-3 text-sm", toneClassNames.warning)}>
              No run data folder is recorded for this run. Deletion will remove the run record and any legacy artifacts tracked by the app.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={isDeleting}>
            <Trash2 className="h-4 w-4" />
            {isDeleting ? "Deleting..." : "Delete run"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function invalidReusedInputFiles(validation: ReusedInputValidationState): FileValidationResult["files"] {
  return validation.files.filter((file) => !file.exists || !file.isFile);
}

function canUseReusedInputFiles(validation: ReusedInputValidationState): boolean {
  return validation.status === "ready" && invalidReusedInputFiles(validation).length === 0;
}

function WorkflowPresentationView({
  run,
  artifacts,
  presentation
}: {
  run: RunRecord;
  artifacts: ArtifactRecord[];
  presentation: WorkflowRunPresentation;
}): JSX.Element {
  return (
    <div className="space-y-4">
      {presentation.title ? <h4 className="text-sm font-semibold">{presentation.title}</h4> : null}
      {presentation.groups.map((group, groupIndex) => (
        <section key={group.id ?? groupIndex} className="space-y-3 rounded-md border border-border bg-background p-4">
          {group.title ? <h4 className="text-sm font-semibold">{group.title}</h4> : null}
          {group.description ? <p className="text-sm text-muted-foreground">{group.description}</p> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {group.items.map((item, itemIndex) => (
              <PresentationItemView key={itemIndex} run={run} artifacts={artifacts} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PresentationItemView({
  run,
  artifacts,
  item
}: {
  run: RunRecord;
  artifacts: ArtifactRecord[];
  item: WorkflowPresentationItem;
}): JSX.Element {
  if (item.kind === "text") {
    return (
      <div className="space-y-2">
        {item.label ? <div className="text-xs font-medium text-muted-foreground">{item.label}</div> : null}
        <div className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">{item.value}</div>
      </div>
    );
  }
  if (item.kind === "inputFile") {
    return <InputImagePreview runId={run.id} field={item.field} index={item.index ?? 0} filePath={item.path} label={item.label} />;
  }
  if (item.kind === "artifact") {
    const artifact = artifacts.find((candidate) => candidate.id === item.artifactId);
    if (!artifact) {
      return <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">{item.label ?? "Artifact"} is not available.</div>;
    }
    if (item.preview === "model" && isPreviewableModelArtifact(artifact)) {
      return (
        <div className="space-y-2">
          {item.label ? <div className="text-xs font-medium text-muted-foreground">{item.label}</div> : null}
          <ModelViewer artifact={artifact} />
        </div>
      );
    }
    if (item.preview === "image" || artifact.kind === "image") {
      return (
        <div className="space-y-2">
          {item.label ? <div className="text-xs font-medium text-muted-foreground">{item.label}</div> : null}
          <OutputImagePreview artifact={artifact} />
        </div>
      );
    }
    return <ArtifactPreview artifact={artifact} />;
  }
  if (item.kind === "pair") {
    return (
      <article className="space-y-3 rounded-md border border-border p-3 lg:col-span-2">
        {item.label ? <div className="text-sm font-medium">{item.label}</div> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {item.left ? <PresentationItemView run={run} artifacts={artifacts} item={item.left} /> : null}
          {item.right ? <PresentationItemView run={run} artifacts={artifacts} item={item.right} /> : null}
        </div>
      </article>
    );
  }
  return (
    <div className="grid gap-3 lg:col-span-2 lg:grid-cols-2">
      {item.label ? <div className="text-sm font-medium lg:col-span-2">{item.label}</div> : null}
      {item.items.map((child, index) => (
        <PresentationItemView key={index} run={run} artifacts={artifacts} item={child} />
      ))}
    </div>
  );
}

function getRunPresentation(output: unknown): WorkflowRunPresentation | null {
  if (!output || typeof output !== "object") return null;
  const presentation = (output as Record<string, unknown>).presentation;
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) return null;
  const groups = (presentation as Record<string, unknown>).groups;
  if (!Array.isArray(groups)) return null;
  return presentation as WorkflowRunPresentation;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function assignSelectorJson(currentJson: string, path: string[], selector: string): string {
  const config = parseCalibrationJson(currentJson);
  assignNestedValue(config, path, selector);
  return `${JSON.stringify(config, null, 2)}\n`;
}

function parseCalibrationJson(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Calibration JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function assignNestedValue(target: Record<string, unknown>, path: string[], value: string): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

function InputImagePreview({
  runId,
  field,
  index,
  filePath,
  label
}: {
  runId: string;
  field: string;
  index: number;
  filePath: string;
  label?: string;
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
        {label ? <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div> : null}
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
  apiBaseUrl,
  workflows,
  onUseCalibrationPreset
}: {
  extensionClients: SystemInfo["extension"]["connectedClients"];
  hasProject: boolean;
  apiBaseUrl: string;
  workflows: WorkflowSummary[];
  onUseCalibrationPreset(workflowId: string, fieldName: string, value: unknown): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"playwright" | "extension">("extension");
  const [targetUrl, setTargetUrl] = useState("about:blank");
  const [profileWorkflowId, setProfileWorkflowId] = useState<WorkflowLabProfileWorkflowId>("workflow-lab");
  const [profileName, setProfileName] = useState("lab");
  const [clientId, setClientId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<WorkflowLabInspectionResult | null>(null);
  const [selector, setSelector] = useState("");
  const [actionKind, setActionKind] = useState<"click" | "fill" | "submit" | "attach-file">("click");
  const [fillValue, setFillValue] = useState("");
  const [actionFiles, setActionFiles] = useState<string[]>([]);
  const [waitKind, setWaitKind] = useState<"element" | "text" | "image-count" | "url" | "network-idle" | "document-ready">("element");
  const [waitState, setWaitState] = useState("visible");
  const [waitText, setWaitText] = useState("");
  const [waitMinImages, setWaitMinImages] = useState(1);
  const [labError, setLabError] = useState<string | null>(null);
  const [waitMessage, setWaitMessage] = useState<string | null>(null);
  const workflowsWithCalibration = useMemo(
    () => workflows.filter((workflow) => (workflow.manifest.calibrationPresets?.length ?? 0) > 0),
    [workflows]
  );
  const [calibrationWorkflowId, setCalibrationWorkflowId] = useState("");
  const [calibrationPresetId, setCalibrationPresetId] = useState("");
  const [calibrationAssignmentKey, setCalibrationAssignmentKey] = useState("");
  const [calibrationJson, setCalibrationJson] = useState("");
  const calibrationWorkflow = workflowsWithCalibration.find((workflow) => workflow.manifest.id === calibrationWorkflowId) ?? workflowsWithCalibration[0] ?? null;
  const calibrationPreset =
    calibrationWorkflow?.manifest.calibrationPresets?.find((preset) => preset.id === calibrationPresetId) ??
    calibrationWorkflow?.manifest.calibrationPresets?.[0] ??
    null;
  const calibrationAssignment =
    calibrationPreset?.assignments.find((assignment) => assignment.key === calibrationAssignmentKey) ??
    calibrationPreset?.assignments[0] ??
    null;

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

  useEffect(() => {
    if (mode !== "playwright") return;
    if (!profileName.trim()) setProfileName(profileWorkflowId === "workflow-lab" ? "lab" : "default");
  }, [mode, profileName, profileWorkflowId]);

  useEffect(() => {
    if (!calibrationWorkflow) return;
    setCalibrationWorkflowId((current) => (current && workflowsWithCalibration.some((workflow) => workflow.manifest.id === current) ? current : calibrationWorkflow.manifest.id));
  }, [calibrationWorkflow, workflowsWithCalibration]);

  useEffect(() => {
    if (!calibrationPreset) {
      setCalibrationPresetId("");
      setCalibrationAssignmentKey("");
      setCalibrationJson("");
      return;
    }
    setCalibrationPresetId((current) => (current && calibrationWorkflow?.manifest.calibrationPresets?.some((preset) => preset.id === current) ? current : calibrationPreset.id));
    setCalibrationAssignmentKey((current) => (current && calibrationPreset.assignments.some((assignment) => assignment.key === current) ? current : calibrationPreset.assignments[0]?.key ?? ""));
    setCalibrationJson((current) => current || stringifyJsonFieldValue(calibrationPreset.defaultValue ?? {}));
  }, [calibrationPreset, calibrationWorkflow]);

  const createSessionMutation = useMutation({
    mutationFn: () =>
      createLabSession({
        mode,
        targetUrl: targetUrl.trim(),
        profileWorkflowId: mode === "playwright" ? profileWorkflowId : undefined,
        profileName: mode === "playwright" ? profileName : undefined,
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
    if (waitKind === "document-ready") return { kind: "document-ready", timeoutMs: 15_000 };
    if (waitKind === "url") return { kind: "url", value: waitText, match: "contains", timeoutMs: 30_000 };
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
    const files = await window.navoke.selectFiles({
      title: "Choose files for Workflow Lab attach-file probe",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (files.length > 0) setActionFiles(files);
  }

  function assignCurrentSelectorToCalibrationPreset(): void {
    try {
      const trimmedSelector = selector.trim();
      if (!trimmedSelector) throw new Error("Choose a probe selector before assigning it.");
      if (!calibrationAssignment) throw new Error("Choose a calibration target before assigning a selector.");
      setCalibrationJson((current) => assignSelectorJson(current, calibrationAssignment.path, trimmedSelector));
      setLabError(null);
    } catch (error) {
      setLabError(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyCalibrationPreset(): Promise<void> {
    try {
      await navigator.clipboard.writeText(calibrationJson);
      setLabError(null);
    } catch (error) {
      setLabError(error instanceof Error ? error.message : String(error));
    }
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
        <div
          className={cn(
            "grid gap-3",
            mode === "playwright" ? "grid-cols-[150px_1fr_140px_120px_auto]" : "grid-cols-[150px_1fr_120px_auto]"
          )}
        >
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
                    {extensionTabOptionLabel(client)}
                  </option>
                ))}
              </select>
            ) : (
              <Input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://example.com" />
            )}
          </div>
          {mode === "playwright" ? (
            <div className="space-y-2">
              <Label>Profile owner</Label>
              <Input
                value={profileWorkflowId}
                onChange={(event) => setProfileWorkflowId(event.target.value as WorkflowLabProfileWorkflowId)}
                placeholder="workflow-lab"
              />
            </div>
          ) : null}
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
                {session.mode === "playwright" && session.profileName ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {session.profileWorkflowId ?? "workflow-lab"} / {session.profileName}
                  </div>
                ) : null}
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
                <option value="url">URL contains</option>
                <option value="network-idle">Network idle</option>
                <option value="document-ready">Document ready</option>
              </select>
              {waitKind === "image-count" ? (
                <Input
                  className="h-9 w-24"
                  type="number"
                  min={1}
                  value={waitMinImages}
                  onChange={(event) => setWaitMinImages(Number(event.target.value) || 1)}
                />
              ) : waitKind === "text" || waitKind === "url" ? (
                <Input className="h-9 w-60" value={waitText} onChange={(event) => setWaitText(event.target.value)} placeholder={waitKind === "url" ? "URL fragment" : "Text to wait for"} />
              ) : waitKind === "element" ? (
                <select
                  value={waitState}
                  onChange={(event) => setWaitState(event.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {["visible", "hidden", "enabled", "disabled"].map((state) => (
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

        {workflowsWithCalibration.length > 0 ? (
          <div className="rounded-md border border-border bg-background p-3">
            <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1.2fr_auto_auto_auto] lg:items-end">
              <div className="space-y-2">
                <Label>Workflow</Label>
                <select
                  value={calibrationWorkflow?.manifest.id ?? ""}
                  onChange={(event) => {
                    setCalibrationWorkflowId(event.target.value);
                    setCalibrationPresetId("");
                    setCalibrationJson("");
                  }}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {workflowsWithCalibration.map((workflow) => (
                    <option key={workflow.manifest.id} value={workflow.manifest.id}>
                      {workflow.manifest.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Preset</Label>
                <select
                  value={calibrationPreset?.id ?? ""}
                  onChange={(event) => {
                    setCalibrationPresetId(event.target.value);
                    const nextPreset = calibrationWorkflow?.manifest.calibrationPresets?.find((preset) => preset.id === event.target.value);
                    setCalibrationJson(stringifyJsonFieldValue(nextPreset?.defaultValue ?? {}));
                  }}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {(calibrationWorkflow?.manifest.calibrationPresets ?? []).map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Selector target</Label>
                <select
                  value={calibrationAssignment?.key ?? ""}
                  onChange={(event) => setCalibrationAssignmentKey(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {(calibrationPreset?.assignments ?? []).map((assignment) => (
                    <option key={assignment.key} value={assignment.key}>
                      {assignment.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={assignCurrentSelectorToCalibrationPreset}>
                <Plus className="h-4 w-4" />
                Assign
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyCalibrationPreset()}>
                <Copy className="h-4 w-4" />
                Copy JSON
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!calibrationWorkflow || !calibrationPreset}
                onClick={() => {
                  if (!calibrationWorkflow || !calibrationPreset) return;
                  onUseCalibrationPreset(calibrationWorkflow.manifest.id, calibrationPreset.targetField, parseCalibrationJson(calibrationJson));
                }}
              >
                <CheckCircle2 className="h-4 w-4" />
                Use in run
              </Button>
            </div>
            <Textarea
              className="mt-3 min-h-32 font-mono text-xs"
              value={calibrationJson}
              onChange={(event) => setCalibrationJson(event.target.value)}
              spellCheck={false}
            />
          </div>
        ) : null}

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

function ExtensionTabRoutingPanel({
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
          <Label htmlFor="extension-tab-target">browser tab routing</Label>
          <div className="group relative">
            <button
              type="button"
              aria-label="browser tab routing details"
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground outline-none ring-offset-2 transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            <div className="invisible absolute left-0 top-6 z-30 w-80 max-w-[calc(100vw-3rem)] rounded-md border border-border bg-card p-3 text-xs text-foreground opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              <div className="space-y-3">
                <p className="leading-5 text-muted-foreground">
                  Choose an open compatible browser tab for this run, or let the Navoke browser controller open a new token-routed window. Other browser tabs keep
                  polling but will not receive the task.
                </p>
                <p className="leading-5 text-muted-foreground">
                  New windows are opened by the installed extension profile and are matched when the extension reports the run token.
                </p>
                {incompatibleClients.length > 0 ? (
                  <p className={cn("font-medium leading-5", toneTextClassNames.danger)}>
                    {incompatibleClients.length} tab{incompatibleClients.length === 1 ? "" : "s"} need the unpacked extension
                    reloaded and the page refreshed before they can run protocol {requiredProtocolVersion} workflows.
                  </p>
                ) : null}
                <div>
                  <div className="mb-2 font-medium">Reporting browser tabs</div>
                  {clients.length === 0 ? (
                    <div className="rounded border border-border bg-muted p-2 text-muted-foreground">
                      No Navoke extension tab has checked in yet.
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
                              {client.title || "browser tab"}
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
                              {client.incompatibilityReason ?? "Reload the unpacked extension and refresh this browser tab."}
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
          id="extension-tab-target"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value={NEW_EXTENSION_TAB_VALUE}>Open via Navoke browser controller</option>
          {compatibleClients.map((client) => (
            <option key={client.id} value={client.id}>
              {extensionTabOptionLabel(client)}
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
            title={`Go to ${selectedCompatibleClient.title || "the selected browser tab"}`}
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

function WorkflowLibraryDrawer({
  entries,
  runs,
  workflows,
  isLoading,
  isOpen,
  deletingEntryId,
  onOpenChange,
  onUse,
  onRename,
  onDelete
}: {
  entries: WorkflowLibraryEntry[];
  runs: RunRecord[];
  workflows: WorkflowSummary[];
  isLoading: boolean;
  isOpen: boolean;
  deletingEntryId: string | null;
  onOpenChange(isOpen: boolean): void;
  onUse(entry: WorkflowLibraryEntry): void;
  onRename(entryId: string, nextName: string): Promise<void>;
  onDelete(entryId: string): void;
}): JSX.Element {
  const runsById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const entryCards = entries.map((entry) => {
    const sourceRun = entry.sourceRunId ? runsById.get(entry.sourceRunId) : undefined;
    const availability = resolveRunWorkflowAvailability(libraryEntryToRunRecord(entry), workflows);
    return (
      <WorkflowLibraryEntryCard
        key={entry.id}
        entry={entry}
        sourceRun={sourceRun}
        workflowAvailability={availability}
        isDeleting={deletingEntryId === entry.id}
        onUse={() => onUse(entry)}
        onRename={(nextName) => onRename(entry.id, nextName)}
        onDelete={() => onDelete(entry.id)}
      />
    );
  });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 px-5">
      <div className="mx-auto flex max-w-[1500px] justify-end">
        {!isOpen ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-events-auto rounded-b-none border-b-0 bg-card shadow-lg"
            onClick={() => onOpenChange(true)}
            aria-expanded={false}
            aria-controls="workflow-library-drawer"
          >
            <BookOpen className="h-4 w-4" />
            Library
            <Badge className={cn("border", toneClassNames.neutral)}>{entries.length}</Badge>
          </Button>
        ) : null}
      </div>

      {isOpen ? (
        <section
          id="workflow-library-drawer"
          className="pointer-events-auto mx-auto max-w-[1500px] overflow-hidden rounded-t-lg border border-border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Library</h3>
              <Badge className={cn("border", toneClassNames.neutral)}>{entries.length}</Badge>
              {isLoading ? <span className="text-xs text-muted-foreground">Loading...</span> : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label="Close library drawer"
              aria-expanded={true}
              aria-controls="workflow-library-drawer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-[45vh] overflow-y-auto p-3">
            {entries.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Save reusable runs here from the run list.
              </div>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">{entryCards}</div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LibraryToast({ message }: { message: string }): JSX.Element {
  return (
    <div className="fixed bottom-16 right-5 z-[80] max-w-sm rounded-md border border-border bg-card px-3 py-2 text-sm shadow-lg" role="status">
      <div className="flex items-start gap-2">
        <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", toneTextClassNames.success)} />
        <div className="min-w-0 truncate">{message}</div>
      </div>
    </div>
  );
}

function WorkflowLibraryEntryCard({
  entry,
  sourceRun,
  workflowAvailability,
  isDeleting,
  onUse,
  onRename,
  onDelete
}: {
  entry: WorkflowLibraryEntry;
  sourceRun?: RunRecord;
  workflowAvailability: RunWorkflowAvailability;
  isDeleting: boolean;
  onUse(): void;
  onRename(nextName: string): Promise<void>;
  onDelete(): void;
}): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(entry.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const workflowUnavailable = workflowAvailability.status === "missing" || workflowAvailability.status === "version-mismatch";
  const sourceLabel = sourceRun
    ? `Source: ${sourceRun.runNumber === null ? "" : `#${sourceRun.runNumber} `}${sourceRun.name}`
    : entry.sourceRunId
      ? "Source: run deleted"
      : "Source: library";

  useEffect(() => {
    if (!isEditing) {
      setEditingName(entry.name);
      setRenameError(null);
    }
  }, [entry.name, isEditing]);

  async function submitRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setRenameError(null);
    setIsRenaming(true);
    try {
      await onRename(editingName);
      setIsEditing(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRenaming(false);
    }
  }

  function useEntry(): void {
    if (workflowUnavailable || isEditing) return;
    onUse();
  }

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background p-3 transition",
        workflowUnavailable || isEditing ? "" : "cursor-pointer hover:border-primary focus-within:border-primary"
      )}
      role="button"
      tabIndex={workflowUnavailable || isEditing ? -1 : 0}
      aria-disabled={workflowUnavailable}
      title={workflowUnavailable ? workflowAvailability.message : "Use this library entry"}
      onClick={useEntry}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          useEntry();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {isEditing ? (
            <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={(event) => void submitRename(event)}>
              <Input
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                className="h-8 min-w-48"
                autoFocus
              />
              <Button type="submit" size="sm" disabled={isRenaming}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="truncate text-sm font-medium">{entry.name}</div>
          )}
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{entry.workflowId}</div>
          <div className="truncate text-xs text-muted-foreground">{sourceLabel}</div>
          {workflowUnavailable ? (
            <div className={cn("mt-1 truncate text-xs", toneTextClassNames.danger)} title={workflowAvailability.message}>
              {workflowAvailability.message}
            </div>
          ) : entry.pluginId ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {entry.pluginId}@{entry.pluginVersion ?? "unknown"}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              setIsEditing(true);
            }}
            title="Rename library entry"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            disabled={isDeleting}
            title="Delete library entry"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {renameError ? <div className={cn("mt-2 rounded-md border p-2 text-xs", toneClassNames.danger)}>{renameError}</div> : null}
    </div>
  );
}

function RunInfoTooltip({
  run,
  workflowAvailability
}: {
  run: RunListRecord;
  workflowAvailability: RunWorkflowAvailability;
}): JSX.Element {
  const details = [
    { label: "Workflow", value: run.workflowId },
    ...(run.workflowVersion ? [{ label: "Workflow version", value: run.workflowVersion }] : []),
    { label: "Plugin", value: run.pluginId ? `${run.pluginId}@${run.pluginVersion ?? "unknown"}` : "Bundled workflow" },
    ...(run.pluginApiVersion ? [{ label: "Plugin API", value: run.pluginApiVersion }] : []),
    { label: "Created", value: formatDate(run.createdAt) },
    { label: "Updated", value: formatDate(run.updatedAt) },
    { label: "Origin", value: runOriginLabel(run) },
    { label: "Availability", value: workflowAvailability.message }
  ];

  return (
    <div className="group/info relative inline-flex shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={`Details for ${run.name}`}
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground outline-none ring-offset-2 transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <div className="invisible absolute left-0 top-6 z-50 w-80 max-w-[calc(100vw-3rem)] select-text rounded-md border border-border bg-card p-3 text-xs text-foreground opacity-0 shadow-lg transition group-hover/info:visible group-hover/info:opacity-100 group-focus-within/info:visible group-focus-within:opacity-100">
        <div className="mb-2 font-medium">Run details</div>
        <dl className="space-y-1.5">
          {details.map((detail) => (
            <div key={detail.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">{detail.label}</dt>
              <dd className="min-w-0 break-words">{detail.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function RunRow({
  run,
  selected,
  workflowAvailability,
  onSelect,
  onResubmit,
  onSaveToLibrary,
  isSavedToLibrary,
  isSavingToLibrary,
  onDelete,
  isDeleting
}: {
  run: RunListRecord;
  selected: boolean;
  workflowAvailability: RunWorkflowAvailability;
  onSelect: () => void;
  onResubmit: () => void;
  onSaveToLibrary: () => void;
  isSavedToLibrary: boolean;
  isSavingToLibrary: boolean;
  onDelete: () => void;
  isDeleting: boolean;
}): JSX.Element {
  const workflowUnavailable = workflowAvailability.status === "missing" || workflowAvailability.status === "version-mismatch";
  const motionActive = isMotionActiveStatus(run.status);
  const saveTitle = isSavedToLibrary
    ? "Already saved to library"
    : isSavingToLibrary
      ? "Saving to library..."
      : "Save this run configuration to the library";
  const saveAriaLabel = isSavedToLibrary ? `${run.name} is already saved to library` : `Save ${run.name} to library`;
  const primaryArtifact = run.artifactSummary.previews[0] ?? null;
  return (
    <div
      className={cn(
        "h-[7.5rem] overflow-hidden rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary",
        run.status === "running" && "run-row-active",
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      )}
    >
      <div className="flex h-full min-h-0 items-stretch justify-between gap-4">
        {primaryArtifact ? (
          <button
            type="button"
            onClick={onSelect}
            className="flex w-28 shrink-0 self-stretch rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open run ${run.name}`}
          >
            <RunArtifactThumbnail artifact={primaryArtifact} className="h-full max-h-full w-full" />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onSelect}
                  className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RunNumberBadge runNumber={run.runNumber} />
                  <div className="truncate font-medium">{run.name}</div>
                </button>
                <RunInfoTooltip run={run} workflowAvailability={workflowAvailability} />
              </div>
              <button
                type="button"
                onClick={onSelect}
                className="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="truncate text-sm text-muted-foreground">{run.currentStep ?? "Queued"}</div>
              </button>
            </div>
            <button
              type="button"
              onClick={onSelect}
              className="ml-auto min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RunArtifactStrip summary={run.artifactSummary} skipPrimary={Boolean(primaryArtifact)} />
            </button>
          </div>
          <button
            type="button"
            onClick={onSelect}
            className="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Progress value={run.progress} active={motionActive} />
          </button>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between gap-2">
          <div className="flex flex-col items-end gap-2">
            {isCliRun(run) ? <Badge className={cn("border", toneClassNames.neutral)}>{runOriginLabel(run)}</Badge> : null}
            <RunStatusBadge status={run.status} />
            {workflowUnavailable ? <Badge className={cn("border", toneClassNames.danger)}>plugin missing</Badge> : null}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onResubmit}
              disabled={workflowUnavailable}
              title={workflowUnavailable ? workflowAvailability.message : "Resubmit New"}
              aria-label={workflowUnavailable ? workflowAvailability.message : `Resubmit ${run.name} as a new run`}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onSaveToLibrary}
              disabled={isSavedToLibrary || isSavingToLibrary}
              title={saveTitle}
              aria-label={saveAriaLabel}
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onDelete}
              disabled={isDeleting}
              title="Delete run"
              aria-label={`Delete ${run.name}`}
              className="hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunArtifactStrip({ summary, skipPrimary = false }: { summary: RunArtifactSummary; skipPrimary?: boolean }): JSX.Element | null {
  if (summary.total === 0) return null;

  const countChips = runArtifactCountChips(summary);
  const previews = skipPrimary ? summary.previews.slice(1) : summary.previews;

  if (previews.length === 0 && summary.hiddenVisualCount === 0 && countChips.length === 0) return null;

  return (
    <div className="flex h-12 min-w-0 max-w-[24rem] items-center justify-end gap-1.5 overflow-hidden" aria-label="Run artifacts">
      {previews.map((artifact) => (
        <RunArtifactThumbnail key={artifact.id} artifact={artifact} />
      ))}
      {summary.hiddenVisualCount > 0 ? (
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-medium text-muted-foreground"
          title={`${summary.hiddenVisualCount} more visual artifacts`}
        >
          +{summary.hiddenVisualCount}
        </div>
      ) : null}
      {countChips.map(({ kind, count, label }) => (
        <span
          key={kind}
          className="shrink-0 rounded border border-border bg-muted px-2 py-1 text-[10px] font-medium uppercase leading-none text-muted-foreground"
          title={`${count} ${kind} artifact${count === 1 ? "" : "s"}`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function StringListEditor({
  label,
  values,
  placeholder,
  help,
  onChange
}: {
  label: string;
  values: string[];
  placeholder?: string;
  help?: string;
  onChange(values: string[]): void;
}): JSX.Element {
  const updateValue = (index: number, value: string): void => {
    onChange(values.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };
  const removeValue = (index: number): void => {
    onChange(values.filter((_item, itemIndex) => itemIndex !== index));
  };
  const moveValue = (index: number, direction: -1 | 1): void => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= values.length) return;
    const next = [...values];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ""])}>
          <Plus className="h-4 w-4" />
          Add item
        </Button>
      </div>
      {help ? <div className="text-xs text-muted-foreground">{help}</div> : null}
      {values.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No items added.</div>
      ) : (
        <div className="space-y-2">
          {values.map((value, index) => (
            <div key={index} className="rounded-md border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">Item {index + 1}</div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => moveValue(index, -1)}
                    disabled={index === 0}
                    title="Move item up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => moveValue(index, 1)}
                    disabled={index === values.length - 1}
                    title="Move item down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => removeValue(index)} title="Remove item">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Textarea
                className="min-h-16 py-1.5"
                value={value}
                onChange={(event) => updateValue(index, event.target.value)}
                placeholder={placeholder}
              />
            </div>
          ))}
        </div>
      )}
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
  const fieldLabel = label.replace(/\s+\*$/, "");
  const statusText = files.length === 0 ? emptyText : files.length === 1 ? files[0] : `${files.length} selected`;

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label className="shrink-0">{label}</Label>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{statusText}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_2rem] gap-2">
        <Button type="button" variant="outline" size="sm" className="min-w-0 justify-start" onClick={onChoose}>
          <Upload className="h-4 w-4" />
          <span className="truncate">{chooseLabel}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={onClear}
          disabled={files.length === 0}
          aria-label={`Clear ${fieldLabel}`}
          title={`Clear ${fieldLabel}`}
        >
          <X className="h-4 w-4" />
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
