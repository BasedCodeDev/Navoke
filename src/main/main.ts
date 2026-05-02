import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ApiServer } from "./api/server";
import { SqliteStore } from "./db/sqliteStore";
import { extensionBridge } from "./extension/extensionBridge";
import { RuntimeEventBus } from "./runtime/eventBus";
import { LocalWorkflowRunner } from "./runtime/localWorkflowRunner";
import { createRuntimePaths } from "./runtime/paths";
import { WorkflowLab } from "./lab/workflowLab";
import { createWorkflowRegistry } from "./workflows";

let mainWindow: BrowserWindow | null = null;
let apiServer: ApiServer | null = null;
let store: SqliteStore | null = null;
let apiBaseUrl = "";

async function bootstrap(): Promise<void> {
  app.setName("Browser Workflow Automation");
  const paths = createRuntimePaths(app.getPath("userData"));
  const eventBus = new RuntimeEventBus();
  const workflows = createWorkflowRegistry();
  store = await SqliteStore.open(paths.dbPath);

  const runner = new LocalWorkflowRunner(workflows, store, paths, eventBus);
  const workflowLab = new WorkflowLab(paths, extensionBridge);
  apiServer = new ApiServer({ store, runner, eventBus, workflows, paths, extensionBridge, workflowLab });
  await apiServer.start();
  apiBaseUrl = apiServer.baseUrl;

  registerIpc(paths.dataDir);
  createWindow();
}

function registerIpc(dataDir: string): void {
  ipcMain.handle("app:get-config", () => ({
    apiBaseUrl,
    dataDir,
    platform: process.platform
  }));

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    if (process.env.OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  bootstrap().catch((error) => {
    dialog.showErrorBox("Startup failed", error instanceof Error ? error.stack ?? error.message : String(error));
    app.quit();
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  store?.close();
  void apiServer?.stop();
});
