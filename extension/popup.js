const BLINK_EXTENSION_PROTOCOL_VERSION = 3;
const API_BASE_URL = "http://127.0.0.1:39201";

async function refresh() {
  const status = document.getElementById("status");
  try {
    await chrome.runtime.sendMessage({ type: "controller-heartbeat" }).catch(() => undefined);
    const response = await fetch(`${API_BASE_URL}/api/extension/status`);
    if (!response.ok) throw new Error(`BLINK app returned ${response.status}`);
    const body = await response.json();
    const requiredProtocolVersion = body.requiredProtocolVersion || BLINK_EXTENSION_PROTOCOL_VERSION;
    const protocolMessage =
      requiredProtocolVersion === BLINK_EXTENSION_PROTOCOL_VERSION
        ? "protocol compatible"
        : `protocol mismatch: app requires ${requiredProtocolVersion}, extension has ${BLINK_EXTENSION_PROTOCOL_VERSION}`;
    const compatible = Number(body.compatible || 0);
    const incompatible = Number(body.incompatible || 0);
    const compatibleControllers = Number(body.compatibleControllers || 0);
    status.className = `status ${incompatible > 0 || requiredProtocolVersion !== BLINK_EXTENSION_PROTOCOL_VERSION ? "warn" : "ok"}`;
    status.textContent = `${compatible} compatible tab(s), ${incompatible} incompatible tab(s), ${compatibleControllers} browser controller(s); ${protocolMessage}.`;
  } catch (error) {
    status.className = "status warn";
    status.textContent = `BLINK app is not reachable at ${API_BASE_URL}. Start the app and refresh this tab.`;
  }
}

void refresh();
setInterval(refresh, 2000);
