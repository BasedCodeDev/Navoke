const NAVOKE_EXTENSION_PROTOCOL_VERSION = 6;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const API_BASE_URL = "http://127.0.0.1:39201";
const CONTROLLER_ID_STORAGE_KEY = "navokeBrowserControllerId";

let controllerIdPromise = null;
let lastControllerHeartbeat = {
  ok: false,
  checkedAt: "",
  error: "Controller heartbeat has not run yet.",
  capabilities: ["open-tab", "open-window", "focus-tab", "close-tab"]
};
let lastControllerCommandError = "";
let lastControllerCommand = {
  checkedAt: "",
  status: "not-run"
};
let controllerTickInFlight = null;
let lastDownloadEvent = {
  checkedAt: "",
  status: "not-run"
};

function apiUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Navoke API request failed with ${response.status}`);
  }
  return body;
}

async function apiFetchForContent(path, options = {}) {
  if (typeof path !== "string" || !path.startsWith("/api/extension/")) {
    return { type: "api-fetch-error", ok: false, status: 400, error: "Unsupported Navoke extension API relay path." };
  }
  try {
    const response = await fetch(apiUrl(path), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...(options.body !== undefined ? { body: String(options.body) } : {})
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    return {
      type: "api-fetch-result",
      ok: response.ok,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      type: "api-fetch-error",
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function apiFetchBinaryForContent(path) {
  if (!isSupportedContentFileRelayPath(path)) {
    return { type: "api-fetch-binary-error", ok: false, status: 400, error: "Unsupported Navoke binary relay path." };
  }
  try {
    const response = await fetch(apiUrl(path));
    if (!response.ok) {
      return { type: "api-fetch-binary-error", ok: false, status: response.status, error: `Navoke file request failed with ${response.status}` };
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const buffer = await response.arrayBuffer();
    return {
      type: "api-fetch-binary-result",
      ok: true,
      status: response.status,
      mimeType: contentType,
      base64: arrayBufferToBase64(buffer)
    };
  } catch (error) {
    return {
      type: "api-fetch-binary-error",
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function isSupportedContentFileRelayPath(path) {
  return (
    typeof path === "string" &&
    (path.startsWith("/api/extension/files/") || /^\/api\/lab\/sessions\/[^/]+\/files\/[^/]+/.test(path))
  );
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function getControllerId() {
  if (!controllerIdPromise) {
    controllerIdPromise = chrome.storage.local.get(CONTROLLER_ID_STORAGE_KEY).then(async (stored) => {
      const existing = typeof stored?.[CONTROLLER_ID_STORAGE_KEY] === "string" ? stored[CONTROLLER_ID_STORAGE_KEY] : "";
      if (existing) return existing;
      const next = crypto.randomUUID();
      await chrome.storage.local.set({ [CONTROLLER_ID_STORAGE_KEY]: next });
      return next;
    });
  }
  return controllerIdPromise;
}

async function controllerHeartbeat() {
  const controllerId = await getControllerId();
  const checkedAt = new Date().toISOString();
  const payload = {
    controllerId,
    protocolVersion: NAVOKE_EXTENSION_PROTOCOL_VERSION,
    extensionVersion: EXTENSION_VERSION,
    capabilities: ["open-tab", "open-window", "focus-tab", "close-tab"],
    diagnostics: controllerDiagnostics()
  };
  try {
    const result = await apiFetch("/api/extension/controller/heartbeat", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    lastControllerHeartbeat = {
      ok: result?.ok === true,
      checkedAt,
      controllerId,
      requiredProtocolVersion: result?.requiredProtocolVersion ?? NAVOKE_EXTENSION_PROTOCOL_VERSION,
      compatible: result?.compatible === true,
      capabilities: payload.capabilities
    };
    return { ...result, diagnostics: lastControllerHeartbeat };
  } catch (error) {
    lastControllerHeartbeat = {
      ok: false,
      checkedAt,
      controllerId,
      error: error instanceof Error ? error.message : String(error),
      capabilities: payload.capabilities
    };
    throw error;
  }
}

async function pollControllerCommands() {
  const controllerId = await getControllerId();
  const checkedAt = new Date().toISOString();
  const command = await apiFetch(`/api/extension/controller/commands/next?controllerId=${encodeURIComponent(controllerId)}`);
  if (!command) {
    lastControllerCommand = {
      checkedAt,
      controllerId,
      status: "none"
    };
    return null;
  }
  lastControllerCommand = {
    checkedAt,
    controllerId,
    status: "running",
    commandId: command.id,
    commandKind: command?.command?.kind || "unknown"
  };
  try {
    const result = await performControllerCommand(command);
    await apiFetch(`/api/extension/controller/commands/${encodeURIComponent(command.id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ result })
    });
    lastControllerCommand = {
      checkedAt: new Date().toISOString(),
      controllerId,
      status: "completed",
      commandId: command.id,
      commandKind: command?.command?.kind || "unknown",
      result: summarizeControllerCommandResult(result)
    };
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await apiFetch(`/api/extension/controller/commands/${encodeURIComponent(command.id)}/fail`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
    lastControllerCommand = {
      checkedAt: new Date().toISOString(),
      controllerId,
      status: "failed",
      commandId: command.id,
      commandKind: command?.command?.kind || "unknown",
      error: message
    };
    throw error;
  }
}

function summarizeControllerCommandResult(result) {
  if (!result || typeof result !== "object") return result ?? null;
  return {
    ok: result.ok === true,
    action: result.action || "",
    tabId: typeof result.tabId === "number" ? result.tabId : result.tabId ?? null,
    windowId: typeof result.windowId === "number" ? result.windowId : result.windowId ?? null,
    url: result.url || "",
    title: result.title || "",
    injection: result.injection || null
  };
}

function controllerDiagnostics() {
  return {
    serviceWorkerCheckedAt: new Date().toISOString(),
    lastControllerCommand,
    lastControllerCommandError,
    lastDownloadEvent
  };
}

async function performControllerCommand(payload) {
  if (!payload || payload.protocolVersion !== NAVOKE_EXTENSION_PROTOCOL_VERSION || payload.kind !== "controller-command") {
    throw new Error("Unsupported Navoke controller command payload.");
  }
  const command = payload.command;
  if (!command || (command.kind !== "open-tab" && command.kind !== "open-window" && command.kind !== "focus-tab" && command.kind !== "close-tab")) {
    throw new Error(`Unsupported Navoke controller command kind: ${command?.kind || "unknown"}`);
  }
  if (command.kind === "close-tab") {
    if (typeof command.tabId !== "number") throw new Error("Navoke close-tab command requires tabId.");
    try {
      await chrome.tabs.remove(command.tabId);
      return {
        ok: true,
        action: "close-tab",
        tabId: command.tabId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no tab with id|cannot find|not found/i.test(message)) {
        return {
          ok: true,
          action: "close-tab",
          tabId: command.tabId,
          alreadyClosed: true
        };
      }
      throw error;
    }
  }
  if (command.kind === "focus-tab") {
    if (typeof command.tabId !== "number") throw new Error("Navoke focus-tab command requires tabId.");
    const tab = await chrome.tabs.update(command.tabId, { active: true });
    const windowId = typeof command.windowId === "number" ? command.windowId : tab.windowId;
    if (typeof windowId === "number") await chrome.windows.update(windowId, { focused: command.focused !== false });
    const injection = await injectContentScriptIntoTab(command.tabId);
    return {
      ok: true,
      action: "focus-tab",
      tabId: command.tabId,
      windowId: windowId ?? null,
      url: tab.url || "",
      title: tab.title || "",
      injection
    };
  }
  if (command.kind === "open-window") {
    const win = await chrome.windows.create({ url: command.url, focused: command.focused !== false });
    const tab = Array.isArray(win.tabs) ? win.tabs[0] : null;
    const injection = await injectContentScriptIntoTab(tab?.id);
    return {
      ok: true,
      action: "open-window",
      tabId: tab?.id ?? null,
      windowId: win.id ?? tab?.windowId ?? null,
      url: tab?.url || command.url,
      title: tab?.title || "",
      injection
    };
  }
  const tab = await chrome.tabs.create({ url: command.url, active: command.active !== false });
  const injection = await injectContentScriptIntoTab(tab.id);
  return {
    ok: true,
    action: "open-tab",
    tabId: tab.id ?? null,
    windowId: tab.windowId ?? null,
    url: tab.url || command.url,
    title: tab.title || "",
    injection
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInjectableTab(tabId) {
  if (typeof tabId !== "number" || typeof chrome.tabs.get !== "function") return null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab?.url || tab?.pendingUrl || "";
      if ((url.startsWith("http://") || url.startsWith("https://")) && tab?.status !== "loading") return tab;
    } catch {
      // The tab may not be queryable immediately after creation.
    }
    await wait(250);
  }
  return null;
}

async function injectContentScriptIntoTab(tabId) {
  if (typeof tabId !== "number") return { injected: false, reason: "missing-tab-id" };
  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return { injected: false, reason: "scripting-unavailable" };
  }
  try {
    await waitForInjectableTab(tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return { injected: true };
  } catch (error) {
    return {
      injected: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

if (chrome.tabs?.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo?.status !== "complete") return;
    const url = tab?.url || tab?.pendingUrl || "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) return;
    void injectContentScriptIntoTab(tabId);
  });
}

async function tickController() {
  if (controllerTickInFlight) return controllerTickInFlight;
  controllerTickInFlight = tickControllerOnce().finally(() => {
    controllerTickInFlight = null;
  });
  return controllerTickInFlight;
}

async function tickControllerOnce() {
  let heartbeatResult = null;
  try {
    heartbeatResult = await controllerHeartbeat();
  } catch {
    return {
      ok: false,
      controllerHeartbeat: lastControllerHeartbeat,
      backgroundDiagnostics: controllerDiagnostics(),
      commandError: lastControllerCommandError || ""
    };
  }

  try {
    const commandResult = await pollControllerCommands();
    lastControllerCommandError = "";
    return {
      ok: true,
      controllerHeartbeat: lastControllerHeartbeat,
      heartbeatResult,
      backgroundDiagnostics: controllerDiagnostics(),
      commandResult: commandResult ?? null
    };
  } catch (error) {
    lastControllerCommandError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      controllerHeartbeat: lastControllerHeartbeat,
      heartbeatResult,
      backgroundDiagnostics: controllerDiagnostics(),
      commandError: lastControllerCommandError
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "current-tab-info") {
    getControllerId()
      .then((controllerId) =>
        sendResponse({
          ok: true,
          controllerId,
          tabId: sender.tab?.id ?? null,
          windowId: sender.tab?.windowId ?? null
        })
      )
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "focus-current-tab") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (typeof tabId !== "number" || typeof windowId !== "number") {
      sendResponse({ ok: false, error: "Could not identify the sender tab to focus." });
      return false;
    }

    Promise.all([chrome.tabs.update(tabId, { active: true }), chrome.windows.update(windowId, { focused: true })])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });

    return true;
  }

  if (message?.type === "controller-heartbeat") {
    tickController()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "api-fetch") {
    apiFetchForContent(message.path, message.options || {})
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          type: "api-fetch-error",
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message?.type === "api-fetch-binary") {
    apiFetchBinaryForContent(message.path)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          type: "api-fetch-binary-error",
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  return false;
});

async function postDownloadEvent(event) {
  lastDownloadEvent = {
    checkedAt: new Date().toISOString(),
    status: event.state || event.type || "unknown",
    downloadId: event.downloadId ?? null,
    filename: event.filename || ""
  };
  try {
    await apiFetch("/api/extension/downloads/event", {
      method: "POST",
      body: JSON.stringify(event)
    });
  } catch (error) {
    lastDownloadEvent = {
      ...lastDownloadEvent,
      status: "post-failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function downloadItemById(downloadId) {
  if (!chrome.downloads || typeof chrome.downloads.search !== "function") return null;
  const items = await chrome.downloads.search({ id: downloadId });
  return Array.isArray(items) ? items[0] || null : null;
}

function downloadEventFromItem(type, item) {
  return {
    type,
    downloadId: item?.id ?? null,
    url: item?.url || "",
    finalUrl: item?.finalUrl || "",
    filename: item?.filename || "",
    mime: item?.mime || "",
    state: item?.state || "",
    danger: item?.danger || "",
    error: item?.error || "",
    totalBytes: item?.totalBytes ?? null,
    fileSize: item?.fileSize ?? null,
    exists: item?.exists ?? null,
    startTime: item?.startTime || "",
    endTime: item?.endTime || "",
    receivedAt: new Date().toISOString()
  };
}

chrome.downloads?.onCreated?.addListener?.((item) => {
  void postDownloadEvent(downloadEventFromItem("created", item));
});

chrome.downloads?.onChanged?.addListener?.((delta) => {
  if (!delta?.id) return;
  const currentState = delta.state?.current || "";
  const completed = currentState === "complete" || currentState === "interrupted";
  if (!completed && !delta.filename?.current) return;
  void downloadItemById(delta.id)
    .then((item) => postDownloadEvent(downloadEventFromItem(currentState || "changed", item || { id: delta.id, state: currentState })))
    .catch((error) =>
      postDownloadEvent({
        type: currentState || "changed",
        downloadId: delta.id,
        state: currentState,
        error: error instanceof Error ? error.message : String(error),
        receivedAt: new Date().toISOString()
      })
    );
});

chrome.runtime.onInstalled?.addListener(() => void tickController());
chrome.runtime.onStartup?.addListener(() => void tickController());
chrome.alarms?.create?.("navoke-controller-poll", { periodInMinutes: 1 });
chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm?.name === "navoke-controller-poll") void tickController();
});

void tickController();
setInterval(tickController, 2500);

globalThis.__NavokeBrowserControllerBackgroundTest = {
  performControllerCommand,
  controllerHeartbeat,
  apiFetchForContent,
  apiFetchBinaryForContent,
  pollControllerCommands,
  tickController,
  postDownloadEvent,
  lastControllerHeartbeat: () => lastControllerHeartbeat,
  lastControllerCommand: () => lastControllerCommand,
  lastDownloadEvent: () => lastDownloadEvent
};
