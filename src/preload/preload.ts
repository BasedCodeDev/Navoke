import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("workflowAutomation", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  openProject: (path?: string) => ipcRenderer.invoke("project:open", path),
  selectFiles: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
    ipcRenderer.invoke("dialog:select-files", options),
  openPath: (path: string) => ipcRenderer.invoke("shell:open-path", path),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url)
});
