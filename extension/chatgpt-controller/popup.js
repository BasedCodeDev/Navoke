const DEFAULT_API_BASE = "http://127.0.0.1:39201";
const CHATGPT_EXTENSION_PROTOCOL_VERSION = 6;
const EXTENSION_VERSION = chrome.runtime?.getManifest?.().version || "unknown";

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

async function init() {
  const apiInput = document.getElementById("apiBaseUrl");
  const status = document.getElementById("status");
  const values = await getStorage(["apiBaseUrl"]);
  apiInput.value = values.apiBaseUrl || DEFAULT_API_BASE;

  document.getElementById("save").addEventListener("click", async () => {
    await setStorage({ apiBaseUrl: apiInput.value.replace(/\/+$/, "") });
    status.textContent = "Saved.";
  });

  document.getElementById("check").addEventListener("click", async () => {
    try {
      const base = apiInput.value.replace(/\/+$/, "");
      const response = await fetch(`${base}/api/extension/status`);
      const body = await response.json();
      const requiredProtocolVersion = body.requiredProtocolVersion || CHATGPT_EXTENSION_PROTOCOL_VERSION;
      const incompatibleClients = (body.connectedClients || []).filter((client) => !client.compatible).length;
      const protocolStatus =
        requiredProtocolVersion === CHATGPT_EXTENSION_PROTOCOL_VERSION
          ? "protocol compatible"
          : `protocol mismatch: app requires ${requiredProtocolVersion}, extension has ${CHATGPT_EXTENSION_PROTOCOL_VERSION}`;
      const reloadMessage =
        incompatibleClients > 0 || requiredProtocolVersion !== CHATGPT_EXTENSION_PROTOCOL_VERSION
          ? " Reload the unpacked extension and refresh every open ChatGPT tab."
          : "";
      status.textContent =
        `Connected. Extension v${EXTENSION_VERSION}, ${protocolStatus}. ` +
        `Clients: ${(body.connectedClients || []).length}; incompatible: ${incompatibleClients}; pending: ${body.pending}; running: ${body.running}.` +
        reloadMessage;
    } catch (error) {
      status.textContent = `Not connected: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
}

void init();
