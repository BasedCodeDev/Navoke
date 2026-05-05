const BLINK_EXTENSION_PROTOCOL_VERSION = 6;
const API_BASE_URL = "http://127.0.0.1:39201";

async function refresh() {
  const status = document.getElementById("status");
  try {
    const controllerPulse = await chrome.runtime
      .sendMessage({ type: "controller-heartbeat" })
      .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
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
    const controllerHeartbeatError =
      controllerPulse?.ok === false
        ? controllerPulse.error || controllerPulse.controllerHeartbeat?.error || "controller heartbeat failed"
        : controllerPulse?.controllerHeartbeat?.ok === false
          ? controllerPulse.controllerHeartbeat.error || "controller heartbeat failed"
          : "";
    const controller = Array.isArray(body.connectedControllers) ? body.connectedControllers.find((candidate) => candidate.compatible) : null;
    const controllerProblem = compatibleControllers <= 0;
    const commandDiagnostics = body.controllerCommandDiagnostics || {};
    const backgroundCommand = controller?.diagnostics?.lastControllerCommand || controllerPulse?.backgroundDiagnostics?.lastControllerCommand || null;
    const details = [];
    if (controller?.id) details.push(`controller ${controller.id}`);
    if (controllerProblem) details.push("open this popup in the intended Chrome profile; do not open routed URLs with chrome.exe");
    if (controllerHeartbeatError) details.push(`controller heartbeat: ${controllerHeartbeatError}`);
    if (commandDiagnostics.lastPollResult) details.push(`last controller poll ${commandDiagnostics.lastPollResult}`);
    if (backgroundCommand?.status) details.push(`background command ${backgroundCommand.status}`);
    status.className = `status ${
      incompatible > 0 || requiredProtocolVersion !== BLINK_EXTENSION_PROTOCOL_VERSION || controllerProblem || controllerHeartbeatError ? "warn" : "ok"
    }`;
    status.textContent = `${compatible} compatible tab(s), ${incompatible} incompatible tab(s), ${compatibleControllers} browser controller(s); ${protocolMessage}${
      details.length > 0 ? `; ${details.join("; ")}` : ""
    }.`;
  } catch (error) {
    status.className = "status warn";
    status.textContent = `BLINK app is not reachable at ${API_BASE_URL}. Start the app and refresh this tab.`;
  }
}

void refresh();
setInterval(refresh, 2000);

globalThis.__BasedBlinkBrowserControllerPopupTest = { refresh };
