const DEFAULT_API_BASE = "http://127.0.0.1:39201";

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
      status.textContent = `Connected. Clients: ${body.connectedClients.length}; pending: ${body.pending}; running: ${body.running}.`;
    } catch (error) {
      status.textContent = `Not connected: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
}

void init();
