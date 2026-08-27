import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from "electron";
import { ApiServer } from "./api/server";
import { SqliteStore } from "./db/sqliteStore";
import { extensionBridge } from "./extension/extensionBridge";
import { WorkflowLab } from "./lab/workflowLab";
import { PluginManager } from "./plugins/pluginManager";
import { AppSettingsStore, projectDisplayName, renameProject as writeProjectName } from "./projectSettings";
import { RuntimeEventBus } from "./runtime/eventBus";
import { LocalWorkflowRunner } from "./runtime/localWorkflowRunner";
import { attachManualWaitNotifications } from "./runtime/manualWaitNotifications";
import { createRuntimePaths } from "./runtime/paths";
import { removeRuntimePointer, writeRuntimePointer } from "./runtime/runtimePointer";
import type { RunRecord, RuntimePaths, WorkflowRegistry } from "./runtime/types";
import { createWorkflowRegistry } from "./workflows";

interface RuntimeState {
  apiServer: ApiServer;
  eventBus: RuntimeEventBus;
  paths: RuntimePaths;
  manualWaitNotifications: () => void;
  runner: LocalWorkflowRunner;
  store: SqliteStore;
  workflowLab: WorkflowLab;
}

interface AppConfig {
  apiBaseUrl: string;
  dataDir: string;
  projectDir: string | null;
  projectName: string | null;
  recentProjects: Array<{ name: string; path: string; exists: boolean }>;
  projectDialogCancelled?: boolean;
  platform: NodeJS.Platform;
  pluginRootDir: string | null;
}

let mainWindow: BrowserWindow | null = null;
let runtime: RuntimeState | null = null;
let settingsStore: AppSettingsStore | null = null;
let pluginManager: PluginManager | null = null;
let workflows: WorkflowRegistry = new Map();
let startupCanCreateWindow = false;
let pendingWindowFocus = false;
const APP_ICON_PNG_RELATIVE_PATH = path.join("assets", "app-icon.png");
const APP_ICON_ICO_RELATIVE_PATH = path.join("assets", "app-icon.ico");
const WINDOWS_APP_USER_MODEL_ID = "dev.basedcode.navoke";
const TEST_USER_DATA_DIR_ENV = "NAVOKE_USER_DATA_DIR";
const LEGACY_TEST_USER_DATA_DIR_ENV = "BASED_BLINK_USER_DATA_DIR";

app.setName("Navoke");
if (process.platform === "win32") {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
}

const singleInstanceUserDataDir = applyUserDataDirOverride();
const gotSingleInstanceLock = app.requestSingleInstanceLock({
  userDataDir: singleInstanceUserDataDir
});

async function bootstrap(): Promise<void> {
  const appIconPath = resolveAppIconPath();
  if (process.platform === "darwin" && appIconPath && app.dock) {
    app.dock.setIcon(appIconPath);
  }
  Menu.setApplicationMenu(null);
  const userDataDir = app.getPath("userData");
  settingsStore = new AppSettingsStore(userDataDir);
  pluginManager = new PluginManager(userDataDir);
  await pluginManager.reload();
  replaceWorkflowRegistry(createWorkflowRegistry(pluginManager));
  registerIpc();

  const lastProjectDir = settingsStore.lastProjectDir;
  if (lastProjectDir && fs.existsSync(lastProjectDir)) {
    try {
      await openProject(lastProjectDir);
    } catch (error) {
      dialog.showErrorBox("Could not reopen project", error instanceof Error ? error.message : String(error));
    }
  }

  startupCanCreateWindow = true;
  if (pendingWindowFocus || !mainWindow) {
    pendingWindowFocus = false;
    focusExistingWindow();
  }
}

function applyUserDataDirOverride(): string {
  const override = process.env[TEST_USER_DATA_DIR_ENV]?.trim() || process.env[LEGACY_TEST_USER_DATA_DIR_ENV]?.trim();
  if (!override) return app.getPath("userData");
  const userDataDir = path.resolve(override);
  fs.mkdirSync(userDataDir, { recursive: true });
  app.setPath("userData", userDataDir);
  return userDataDir;
}

function getConfig(): AppConfig {
  return {
    apiBaseUrl: runtime?.apiServer.baseUrl ?? "",
    dataDir: runtime?.paths.dataDir ?? "",
    projectDir: runtime?.paths.projectDir ?? null,
    projectName: runtime?.paths.projectDir ? projectDisplayName(runtime.paths.projectDir) : null,
    recentProjects: getRecentProjects(),
    platform: process.platform,
    pluginRootDir: pluginManager?.rootDir ?? null
  };
}

function getRecentProjects(): Array<{ name: string; path: string; exists: boolean }> {
  return (settingsStore?.recentProjectDirs ?? []).map((projectDir) => {
    const exists = fs.existsSync(projectDir);
    return {
      name: exists ? projectDisplayName(projectDir) : path.basename(projectDir) || projectDir,
      path: projectDir,
      exists
    };
  });
}

async function openProject(projectDir: string): Promise<AppConfig> {
  await closeRuntime();

  const paths = createRuntimePaths(projectDir);
  const eventBus = new RuntimeEventBus();
  const store = await SqliteStore.open(paths.dbPath);
  const runner = new LocalWorkflowRunner(workflows, store, paths, eventBus);
  const manualWaitNotifications = attachManualWaitNotifications(eventBus, store, {
    notify: showManualWaitNotification
  });
  const workflowLab = new WorkflowLab(paths, extensionBridge);
  const apiServer = new ApiServer({
    store,
    runner,
    eventBus,
    workflows,
    plugins: getPluginManager(),
    reloadWorkflows,
    paths,
    extensionBridge,
    workflowLab
  });
  await apiServer.start();
  writeRuntimePointer(paths, apiServer.baseUrl);

  runtime = { apiServer, eventBus, paths, manualWaitNotifications, runner, store, workflowLab };
  settingsStore?.setLastProjectDir(paths.projectDir);
  return getConfig();
}

async function reloadWorkflows(): Promise<void> {
  const plugins = getPluginManager();
  await plugins.reload();
  replaceWorkflowRegistry(createWorkflowRegistry(plugins));
}

function replaceWorkflowRegistry(next: WorkflowRegistry): void {
  workflows.clear();
  for (const [workflowId, registration] of next) {
    workflows.set(workflowId, registration);
  }
}

function getPluginManager(): PluginManager {
  if (!pluginManager) throw new Error("Plugin manager is not initialized.");
  return pluginManager;
}

async function closeRuntime(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (!current) return;

  let shutdownError: unknown;
  try {
    await current.runner.shutdown();
  } catch (error) {
    shutdownError = error;
  }
  current.manualWaitNotifications();
  await current.apiServer.stop();
  removeRuntimePointer(current.paths);
  current.store.close();
  if (shutdownError) throw shutdownError;
}

async function chooseProjectDirectory(title: string): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title,
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
}

function registerIpc(): void {
  ipcMain.handle("app:get-config", () => getConfig());

  ipcMain.handle("window:minimize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    window?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!window) return { isMaximized: false };
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return { isMaximized: window.isMaximized() };
  });

  ipcMain.handle("window:get-state", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    return { isMaximized: Boolean(window?.isMaximized()) };
  });

  ipcMain.handle("window:close", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    window?.close();
  });

  ipcMain.handle("project:open", async (_event, targetPath?: string) => {
    const projectDir = targetPath?.trim() || (await chooseProjectDirectory("Open Navoke project folder"));
    if (!projectDir) return { ...getConfig(), projectDialogCancelled: true };
    return openProject(projectDir);
  });

  ipcMain.handle("project:rename", async (_event, input?: { projectPath?: string; name?: string }) => {
    const projectDir = input?.projectPath?.trim();
    if (!projectDir) throw new Error("Project path is required.");
    writeProjectName(projectDir, input?.name ?? "");
    return getConfig();
  });

  ipcMain.handle("dialog:select-files", async (_event, options?: { title?: string; filters?: Electron.FileFilter[] }) => {
    const dialogOptions: Electron.OpenDialogOptions = {
      title: options?.title ?? "Choose files",
      properties: ["openFile", "multiSelections"],
      filters: options?.filters ?? [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
        { name: "All files", extensions: ["*"] }
      ]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("shell:open-path", async (_event, targetPath: string) => {
    return shell.openPath(targetPath);
  });

  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });
}

function resolveAppIconPath(): string | undefined {
  const relativePath = process.platform === "win32" ? APP_ICON_ICO_RELATIVE_PATH : APP_ICON_PNG_RELATIVE_PATH;
  return resolveAssetPath(relativePath) ?? resolveAssetPath(APP_ICON_PNG_RELATIVE_PATH);
}

function resolveAssetPath(relativePath: string): string | undefined {
  const candidates = [
    path.join(__dirname, "../renderer", relativePath),
    path.join(process.cwd(), "public", relativePath)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const appIconPath = resolveAppIconPath();
  const window = new BrowserWindow({
    title: "Navoke",
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow = window;

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    if (process.env.OPEN_DEVTOOLS === "1") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
}

function showManualWaitNotification(run: RunRecord): void {
  if (!Notification.isSupported()) return;
  const runLabel = run.runNumber === null ? run.name : `Run #${run.runNumber}: ${run.name}`;
  const notification = new Notification({
    title: "Navoke needs manual action",
    body: `${runLabel}\n${run.currentStep ?? "Manual action required."}`,
    ...(resolveAppIconPath() ? { icon: resolveAppIconPath() } : {})
  });
  notification.on("click", () => {
    focusExistingWindow();
  });
  notification.show();
}

function focusExistingWindow(): void {
  if (!app.isReady()) {
    void app.whenReady().then(() => focusExistingWindow());
    return;
  }

  if (!startupCanCreateWindow && (!mainWindow || mainWindow.isDestroyed())) {
    pendingWindowFocus = true;
    return;
  }

  const window = createWindow();
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function handleStartupFailure(error: unknown): void {
  dialog.showErrorBox("Startup failed", error instanceof Error ? error.stack ?? error.message : String(error));
  app.quit();
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusExistingWindow();
  });

  app.whenReady().then(() => {
    bootstrap().catch(handleStartupFailure);
  });

  app.on("activate", () => {
    focusExistingWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void closeRuntime();
});
