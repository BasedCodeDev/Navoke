const BLINK_EXTENSION_PROTOCOL_VERSION = 3;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const API_BASE_URL = "http://127.0.0.1:39201";
const CONTROLLER_ID_STORAGE_KEY = "basedBlinkBrowserControllerId";

let controllerIdPromise = null;

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
    throw new Error(body?.error || body?.message || `BLINK API request failed with ${response.status}`);
  }
  return body;
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
  return apiFetch("/api/extension/controller/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      controllerId,
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: EXTENSION_VERSION,
      capabilities: ["open-tab", "open-window", "focus-tab"]
    })
  });
}

async function pollControllerCommands() {
  const controllerId = await getControllerId();
  const command = await apiFetch(`/api/extension/controller/commands/next?controllerId=${encodeURIComponent(controllerId)}`);
  if (!command) return null;
  try {
    const result = await performControllerCommand(command);
    await apiFetch(`/api/extension/controller/commands/${encodeURIComponent(command.id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ result })
    });
    return result;
  } catch (error) {
    await apiFetch(`/api/extension/controller/commands/${encodeURIComponent(command.id)}/fail`, {
      method: "POST",
      body: JSON.stringify({ message: error instanceof Error ? error.message : String(error) })
    });
    throw error;
  }
}

async function performControllerCommand(payload) {
  if (!payload || payload.protocolVersion !== BLINK_EXTENSION_PROTOCOL_VERSION || payload.kind !== "controller-command") {
    throw new Error("Unsupported BLINK controller command payload.");
  }
  const command = payload.command;
  if (!command || (command.kind !== "open-tab" && command.kind !== "open-window" && command.kind !== "focus-tab")) {
    throw new Error(`Unsupported BLINK controller command kind: ${command?.kind || "unknown"}`);
  }
  if (command.kind === "focus-tab") {
    if (typeof command.tabId !== "number") throw new Error("BLINK focus-tab command requires tabId.");
    const tab = await chrome.tabs.update(command.tabId, { active: true });
    const windowId = typeof command.windowId === "number" ? command.windowId : tab.windowId;
    if (typeof windowId === "number") await chrome.windows.update(windowId, { focused: command.focused !== false });
    return {
      ok: true,
      action: "focus-tab",
      tabId: command.tabId,
      windowId: windowId ?? null,
      url: tab.url || "",
      title: tab.title || ""
    };
  }
  if (command.kind === "open-window") {
    const win = await chrome.windows.create({ url: command.url, focused: command.focused !== false });
    const tab = Array.isArray(win.tabs) ? win.tabs[0] : null;
    return {
      ok: true,
      action: "open-window",
      tabId: tab?.id ?? null,
      windowId: win.id ?? tab?.windowId ?? null,
      url: tab?.url || command.url,
      title: tab?.title || ""
    };
  }
  const tab = await chrome.tabs.create({ url: command.url, active: command.active !== false });
  return {
    ok: true,
    action: "open-tab",
    tabId: tab.id ?? null,
    windowId: tab.windowId ?? null,
    url: tab.url || command.url,
    title: tab.title || ""
  };
}

async function tickController() {
  try {
    await controllerHeartbeat();
    await pollControllerCommands();
  } catch {
    // The Electron app may not be running or may not have controller work. Keep polling quietly.
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
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled?.addListener(() => void tickController());
chrome.runtime.onStartup?.addListener(() => void tickController());

void tickController();
setInterval(tickController, 2500);

globalThis.__BasedBlinkBrowserControllerBackgroundTest = {
  performControllerCommand,
  controllerHeartbeat,
  pollControllerCommands
};
