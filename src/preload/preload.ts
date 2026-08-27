import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("navoke", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  openProject: (path?: string) => ipcRenderer.invoke("project:open", path),
  renameProject: (projectPath: string, name: string) => ipcRenderer.invoke("project:rename", { projectPath, name }),
  selectFiles: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
    ipcRenderer.invoke("dialog:select-files", options),
  openPath: (path: string) => ipcRenderer.invoke("shell:open-path", path),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    getState: () => ipcRenderer.invoke("window:get-state"),
    close: () => ipcRenderer.invoke("window:close")
  }
});
