import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inferMimeType } from "../utils/files";

export const BLINK_EXTENSION_PROTOCOL_VERSION = 4;
export const BLINK_ROUTING_TOKEN_PARAM = "based-blink-tab";

const CLIENT_TTL_MS = 30_000;
const CONTROLLER_TTL_MS = 30_000;
const COMMAND_LEASE_MS = 60_000;
const FOCUS_COMMAND_LEASE_MS = 15_000;
const CONTROLLER_COMMAND_LEASE_MS = 15_000;
const COMMAND_CLIENT_COOLDOWN_MS = 120_000;
const ROUTED_TAB_CONNECT_TIMEOUT_MS = 45_000;

export type ExtensionCommandStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type ExtensionBrowserTarget =
  | { mode: "any" }
  | { mode: "existing"; clientId: string; url?: string; title?: string; tabId?: number; windowId?: number; controllerId?: string }
  | {
      mode: "new";
      routingToken: string;
      url?: string;
      title?: string;
      openMode?: "window" | "tab";
      clientId?: string;
      tabId?: number;
      windowId?: number;
      controllerId?: string;
    };

export type ExtensionTaskTarget = ExtensionBrowserTarget;

export interface ExtensionClientStatus {
  id: string;
  url: string;
  title: string;
  status: string;
  protocolVersion: number | null;
  extensionVersion: string;
  routingToken?: string;
  controllerId?: string;
  tabId?: number;
  windowId?: number;
  controllerHeartbeatOk?: boolean;
  controllerHeartbeatAt?: string;
  controllerHeartbeatError?: string;
  compatible: boolean;
  incompatibilityReason?: string;
  lastSeenAt: string;
  capabilities: string[];
}

export interface ExtensionControllerStatus {
  id: string;
  status: string;
  protocolVersion: number | null;
  extensionVersion: string;
  compatible: boolean;
  incompatibilityReason?: string;
  lastSeenAt: string;
  capabilities: string[];
}

export interface ExtensionControllerDiagnostics {
  compatibleTabsWithController: number;
  compatibleTabsWithoutController: number;
  latestControllerHeartbeatAt?: string;
  latestControllerHeartbeatOk?: boolean;
  latestControllerHeartbeatError?: string;
  connectedTabDiagnostics: Array<{
    id: string;
    url: string;
    title: string;
    routingToken?: string;
    controllerId?: string;
    tabId?: number;
    windowId?: number;
    controllerHeartbeatOk?: boolean;
    controllerHeartbeatAt?: string;
    controllerHeartbeatError?: string;
  }>;
}

export type ExtensionControllerCommandInput =
  | { kind: "open-tab"; url: string; active?: boolean }
  | { kind: "open-window"; url: string; focused?: boolean }
  | { kind: "focus-tab"; tabId: number; windowId?: number; focused?: boolean };

export interface ExtensionControllerCommandPayload {
  id: string;
  kind: "controller-command";
  protocolVersion: number;
  command: ExtensionControllerCommandInput;
  createdAt: string;
}

export interface ExtensionCommandFilePayload {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export type ExtensionBrowserAction =
  | { kind: "click"; selector: string; text?: string; textMatch?: "contains" | "exact" | "regex"; caseSensitive?: boolean }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "submit"; selector: string }
  | { kind: "select"; selector: string; value?: string; label?: string; index?: number }
  | { kind: "attach-file"; selector: string; files: ExtensionCommandFilePayload[] };

export type ExtensionBrowserExtractQuery =
  | {
      kind: "element-state";
      selector: string;
    }
  | {
      kind: "images";
      selector?: string;
      minWidth?: number;
      minHeight?: number;
      includeBase64?: boolean;
      excludeFingerprints?: string[];
      excludeStableSourceIds?: string[];
      latestFirst?: boolean;
      maxImages?: number;
      fetchTimeoutMs?: number;
    }
  | {
      kind: "text";
      selector?: string;
    };

export type ExtensionCommandInput =
  | { kind: "inspect" }
  | { kind: "action"; action: ExtensionBrowserAction }
  | { kind: "wait"; condition: unknown }
  | { kind: "extract"; query: ExtensionBrowserExtractQuery };

export interface ExtensionCommandPayload {
  id: string;
  kind: "browser-command";
  protocolVersion: number;
  command: ExtensionCommandInput;
  createdAt: string;
}

export interface ExtensionFocusCommandPayload {
  id: string;
  kind: "focus-tab";
  protocolVersion: number;
  createdAt: string;
}

interface ExtensionCommand {
  id: string;
  clientId: string;
  command: ExtensionCommandInput;
  status: ExtensionCommandStatus;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ExtensionFocusCommand {
  id: string;
  clientId: string;
  status: ExtensionCommandStatus;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ExtensionControllerCommand {
  id: string;
  controllerId: string;
  command: ExtensionControllerCommandInput;
  status: ExtensionCommandStatus;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface CommandWaiter {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  abort?: () => void;
}

interface StagedExtensionFile {
  id: string;
  filePath: string;
  name: string;
  mimeType: string;
  createdAt: number;
}

export class ExtensionBridge {
  private readonly commands = new Map<string, ExtensionCommand>();
  private readonly commandWaiters = new Map<string, CommandWaiter>();
  private readonly focusCommands = new Map<string, ExtensionFocusCommand>();
  private readonly focusWaiters = new Map<string, CommandWaiter>();
  private readonly controllerCommands = new Map<string, ExtensionControllerCommand>();
  private readonly controllerWaiters = new Map<string, CommandWaiter>();
  private readonly clients = new Map<string, ExtensionClientStatus>();
  private readonly controllers = new Map<string, ExtensionControllerStatus>();
  private readonly stagedFiles = new Map<string, StagedExtensionFile>();
  private readonly commandUnhealthySince = new Map<string, number>();

  heartbeat(payload: unknown): { ok: true; requiredProtocolVersion: number; compatible: boolean; clientId: string } {
    if (!payload || typeof payload !== "object") throw new Error("Extension heartbeat payload is required.");
    const record = payload as Record<string, unknown>;
    const clientId = firstNonEmptyString(record.clientId, record.id) ?? "browser-tab";
    const protocolVersion = typeof record.protocolVersion === "number" ? record.protocolVersion : null;
    const url = typeof record.url === "string" ? record.url : "";
    const title = typeof record.title === "string" ? record.title : "";
    const extensionVersion = typeof record.extensionVersion === "string" ? record.extensionVersion : "";
    const capabilities = Array.isArray(record.capabilities)
      ? record.capabilities.filter((capability): capability is string => typeof capability === "string")
      : [];
    const controllerId = firstNonEmptyString(record.controllerId) ?? undefined;
    const tabId = optionalNumber(record.tabId);
    const windowId = optionalNumber(record.windowId);
    const controllerHeartbeatOk = optionalBoolean(record.controllerHeartbeatOk);
    const controllerHeartbeatAt = firstNonEmptyString(record.controllerHeartbeatAt) ?? undefined;
    const controllerHeartbeatError = firstNonEmptyString(record.controllerHeartbeatError) ?? undefined;
    const previous = this.clients.get(clientId);
    const routingToken =
      firstNonEmptyString(record.routingToken) ?? routingTokenFromUrl(url) ?? previous?.routingToken ?? undefined;
    const compatible = protocolVersion === BLINK_EXTENSION_PROTOCOL_VERSION;

    const status: ExtensionClientStatus = {
      id: clientId,
      url,
      title,
      status: compatible ? "connected" : "incompatible",
      protocolVersion,
      extensionVersion,
      ...(routingToken ? { routingToken } : {}),
      ...(controllerId ? { controllerId } : previous?.controllerId ? { controllerId: previous.controllerId } : {}),
      ...(tabId !== undefined ? { tabId } : previous?.tabId !== undefined ? { tabId: previous.tabId } : {}),
      ...(windowId !== undefined ? { windowId } : previous?.windowId !== undefined ? { windowId: previous.windowId } : {}),
      ...(controllerHeartbeatOk !== undefined
        ? { controllerHeartbeatOk }
        : previous?.controllerHeartbeatOk !== undefined
          ? { controllerHeartbeatOk: previous.controllerHeartbeatOk }
          : {}),
      ...(controllerHeartbeatAt ? { controllerHeartbeatAt } : previous?.controllerHeartbeatAt ? { controllerHeartbeatAt: previous.controllerHeartbeatAt } : {}),
      ...(controllerHeartbeatError
        ? { controllerHeartbeatError }
        : controllerHeartbeatOk === true
          ? {}
          : previous?.controllerHeartbeatError
            ? { controllerHeartbeatError: previous.controllerHeartbeatError }
            : {}),
      compatible,
      ...(compatible
        ? {}
        : {
            incompatibilityReason: `Reload the unpacked BLINK browser extension and refresh browser tabs. App requires extension protocol ${BLINK_EXTENSION_PROTOCOL_VERSION}.`
          }),
      lastSeenAt: new Date().toISOString(),
      capabilities
    };
    this.clients.set(clientId, status);
    this.prune();
    return { ok: true, requiredProtocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION, compatible, clientId };
  }

  controllerHeartbeat(payload: unknown): {
    ok: true;
    requiredProtocolVersion: number;
    compatible: boolean;
    controllerId: string;
  } {
    if (!payload || typeof payload !== "object") throw new Error("Extension controller heartbeat payload is required.");
    const record = payload as Record<string, unknown>;
    const controllerId = firstNonEmptyString(record.controllerId, record.id) ?? "browser-controller";
    const protocolVersion = typeof record.protocolVersion === "number" ? record.protocolVersion : null;
    const extensionVersion = typeof record.extensionVersion === "string" ? record.extensionVersion : "";
    const capabilities = Array.isArray(record.capabilities)
      ? record.capabilities.filter((capability): capability is string => typeof capability === "string")
      : [];
    const compatible =
      protocolVersion === BLINK_EXTENSION_PROTOCOL_VERSION &&
      capabilities.includes("open-window") &&
      capabilities.includes("focus-tab");
    const status: ExtensionControllerStatus = {
      id: controllerId,
      status: compatible ? "connected" : "incompatible",
      protocolVersion,
      extensionVersion,
      compatible,
      ...(compatible
        ? {}
        : {
            incompatibilityReason: `Reload the unpacked BLINK browser extension. App requires extension protocol ${BLINK_EXTENSION_PROTOCOL_VERSION} with open-window and focus-tab support.`
          }),
      lastSeenAt: new Date().toISOString(),
      capabilities
    };
    this.controllers.set(controllerId, status);
    this.prune();
    return { ok: true, requiredProtocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION, compatible, controllerId };
  }

  status(): {
    requiredProtocolVersion: number;
    connected: number;
    compatible: number;
    incompatible: number;
    connectedClients: ExtensionClientStatus[];
    clients: ExtensionClientStatus[];
    connectedControllers: ExtensionControllerStatus[];
    controllers: ExtensionControllerStatus[];
    compatibleControllers: number;
    incompatibleControllers: number;
    controllerDiagnostics: ExtensionControllerDiagnostics;
  } {
    this.prune();
    const clients = [...this.clients.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    const controllers = [...this.controllers.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    const controllerDiagnostics = buildControllerDiagnostics(clients);
    return {
      requiredProtocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      connected: clients.length,
      compatible: clients.filter((client) => client.compatible).length,
      incompatible: clients.filter((client) => !client.compatible).length,
      connectedClients: clients,
      clients,
      connectedControllers: controllers,
      controllers,
      compatibleControllers: controllers.filter((controller) => controller.compatible).length,
      incompatibleControllers: controllers.filter((controller) => !controller.compatible).length,
      controllerDiagnostics
    };
  }

  findCompatibleClientForTarget(target: ExtensionBrowserTarget): ExtensionClientStatus | undefined {
    this.prune();
    const clients = [...this.clients.values()]
      .filter((client) => client.compatible && this.isCommandHealthy(client.id))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    if (target.mode === "any") return clients[0];

    if (target.mode === "existing") {
      const exact = clients.find((client) => client.id === target.clientId);
      if (exact) return exact;
      if (target.url) {
        const sameUrlClient = clients.find((client) => sameUrl(client.url, target.url));
        if (sameUrlClient) return sameUrlClient;
      }
      return undefined;
    }

    if (target.clientId) {
      const exact = clients.find((client) => client.id === target.clientId);
      if (exact) return exact;
    }
    const byToken = clients.find((client) => client.routingToken === target.routingToken);
    if (byToken) return byToken;
    return undefined;
  }

  findCompatibleController(
    capability?: "open-tab" | "open-window" | "focus-tab",
    preferredControllerId?: string
  ): ExtensionControllerStatus | undefined {
    this.prune();
    const candidates = [...this.controllers.values()].filter(
      (controller) => controller.compatible && (!capability || controller.capabilities.includes(capability))
    );
    if (preferredControllerId) {
      const preferred = candidates.find((controller) => controller.id === preferredControllerId);
      if (preferred) return preferred;
    }
    return candidates.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
  }

  async openTabWithController(input: {
    url: string;
    active?: boolean;
    controllerId?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const url = safeExtensionTabUrl(input.url);
    const controller = this.findCompatibleController("open-tab", input.controllerId);
    if (!controller) {
      throw new Error(this.noCompatibleControllerMessage("open-tab"));
    }
    return this.executeControllerCommand({
      controllerId: controller.id,
      command: { kind: "open-tab", url, active: input.active ?? true },
      timeoutMs: input.timeoutMs,
      signal: input.signal
    });
  }

  async focusBrowserSurfaceWithController(input: {
    tabId: number;
    windowId?: number;
    controllerId?: string;
    focused?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const controller = this.findCompatibleController("focus-tab", input.controllerId);
    if (!controller) {
      throw new Error(this.noCompatibleControllerMessage("focus-tab"));
    }
    return this.executeControllerCommand({
      controllerId: controller.id,
      command: { kind: "focus-tab", tabId: input.tabId, ...(input.windowId !== undefined ? { windowId: input.windowId } : {}), focused: input.focused ?? true },
      timeoutMs: input.timeoutMs,
      signal: input.signal
    });
  }

  async openWindowWithController(input: {
    url: string;
    focused?: boolean;
    controllerId?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const url = safeExtensionTabUrl(input.url);
    const controller = this.findCompatibleController("open-window", input.controllerId);
    if (!controller) {
      throw new Error(this.noCompatibleControllerMessage("open-window"));
    }
    return this.executeControllerCommand({
      controllerId: controller.id,
      command: { kind: "open-window", url, focused: input.focused ?? true },
      timeoutMs: input.timeoutMs,
      signal: input.signal
    });
  }

  async ensureRoutedTab(input: {
    target: ExtensionBrowserTarget;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<ExtensionClientStatus> {
    const existing = this.findCompatibleClientForTarget(input.target);
    if (existing) return existing;

    const url = openableTargetUrl(input.target);
    if (!url) {
      throw new Error("No compatible BLINK browser extension tab is connected for the requested target.");
    }

    let openResult: unknown = null;
    if (input.target.mode === "new" && input.target.openMode !== "tab") {
      openResult = await this.openWindowWithController({
        url,
        focused: true,
        controllerId: input.target.controllerId,
        timeoutMs: Math.min(input.timeoutMs ?? CONTROLLER_COMMAND_LEASE_MS, CONTROLLER_COMMAND_LEASE_MS),
        signal: input.signal
      });
    } else {
      openResult = await this.openTabWithController({
        url,
        active: true,
        controllerId: input.target.mode === "any" ? undefined : input.target.controllerId,
        timeoutMs: Math.min(input.timeoutMs ?? CONTROLLER_COMMAND_LEASE_MS, CONTROLLER_COMMAND_LEASE_MS),
        signal: input.signal
      });
    }

    const timeoutMs = input.timeoutMs ?? ROUTED_TAB_CONNECT_TIMEOUT_MS;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const client = this.findCompatibleClientForTarget(input.target);
      if (client) return client;
      await wait(750, input.signal);
    }

    const visibleClients = [...this.clients.values()]
      .filter((client) => client.compatible)
      .slice(0, 5)
      .map((client) => ({
        url: client.url,
        title: client.title,
        routingToken: client.routingToken,
        controllerId: client.controllerId,
        tabId: client.tabId,
        windowId: client.windowId,
        controllerHeartbeatOk: client.controllerHeartbeatOk,
        controllerHeartbeatError: client.controllerHeartbeatError
      }));
    throw new Error(
      `Opened a routed BLINK browser window, but no compatible page client connected. openResult=${JSON.stringify(
        openResult
      )}; knownClients=${JSON.stringify(
        visibleClients
      )}. Do not open chrome.exe or paste this routed URL into another Chrome profile. The routed window must be opened by the BLINK extension controller in the intended browser profile. Reload the unpacked extension, confirm site access is enabled for the opened page, open the BLINK extension popup in that profile, and refresh the opened page.`
    );
  }

  stageFiles(filePaths: string[]): ExtensionCommandFilePayload[] {
    return filePaths.map((filePath) => {
      if (!fs.existsSync(filePath)) throw new Error(`Extension file not found: ${filePath}`);
      const id = randomUUID();
      const staged: StagedExtensionFile = {
        id,
        filePath,
        name: path.basename(filePath),
        mimeType: inferMimeType(filePath) ?? "application/octet-stream",
        createdAt: Date.now()
      };
      this.stagedFiles.set(id, staged);
      return {
        id,
        name: staged.name,
        mimeType: staged.mimeType,
        url: `/api/extension/files/${encodeURIComponent(id)}`
      };
    });
  }

  getStagedFilePath(fileId: string): string {
    const staged = this.stagedFiles.get(fileId);
    if (!staged) throw new Error(`Extension staged file not found: ${fileId}`);
    return staged.filePath;
  }

  async executeCommandForTarget(input: {
    target: ExtensionBrowserTarget;
    command: ExtensionCommandInput;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const client = this.findCompatibleClientForTarget(input.target);
    if (!client) throw new Error("No compatible BLINK browser extension tab is connected for the requested target.");
    return this.executeCommand({ clientId: client.id, command: input.command, timeoutMs: input.timeoutMs, signal: input.signal });
  }

  async executeCommand(input: {
    clientId: string;
    command: ExtensionCommandInput;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const client = this.clients.get(input.clientId);
    if (!client?.compatible) {
      throw new Error("Selected browser extension tab is not connected or is running an incompatible extension.");
    }
    const now = new Date().toISOString();
    const command: ExtensionCommand = {
      id: randomUUID(),
      clientId: input.clientId,
      command: input.command,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.commands.set(command.id, command);
    return this.waitForCommand(this.commands, this.commandWaiters, command.id, input.timeoutMs ?? COMMAND_LEASE_MS, input.signal);
  }

  nextCommand(clientId: string): ExtensionCommandPayload | null {
    const normalizedClientId = clientId.trim();
    this.requireCompatibleClient(normalizedClientId);
    this.expireCommands(this.commands, this.commandWaiters, COMMAND_LEASE_MS);

    const command = [...this.commands.values()].find(
      (candidate) => candidate.clientId === normalizedClientId && candidate.status === "pending"
    );
    if (!command) return null;
    command.status = "running";
    command.updatedAt = new Date().toISOString();
    return {
      id: command.id,
      kind: "browser-command",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      command: command.command,
      createdAt: command.createdAt
    };
  }

  completeCommand(commandId: string, result: unknown): void {
    this.resolveCommand(this.commands, this.commandWaiters, commandId, "completed", result);
  }

  failCommand(commandId: string, message: string): void {
    this.rejectCommand(this.commands, this.commandWaiters, commandId, message);
  }

  executeControllerCommand(input: {
    controllerId: string;
    command: ExtensionControllerCommandInput;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    this.requireCompatibleController(input.controllerId);
    const now = new Date().toISOString();
    const command: ExtensionControllerCommand = {
      id: randomUUID(),
      controllerId: input.controllerId,
      command: {
        ...input.command,
        ...(input.command.kind === "open-tab" || input.command.kind === "open-window"
          ? { url: safeExtensionTabUrl(input.command.url) }
          : {})
      },
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.controllerCommands.set(command.id, command);
    return this.waitForCommand(
      this.controllerCommands,
      this.controllerWaiters,
      command.id,
      input.timeoutMs ?? CONTROLLER_COMMAND_LEASE_MS,
      input.signal
    );
  }

  nextControllerCommand(controllerId: string): ExtensionControllerCommandPayload | null {
    const normalizedControllerId = controllerId.trim();
    this.requireCompatibleController(normalizedControllerId);
    this.expireCommands(this.controllerCommands, this.controllerWaiters, CONTROLLER_COMMAND_LEASE_MS);
    const command = [...this.controllerCommands.values()].find(
      (candidate) => candidate.controllerId === normalizedControllerId && candidate.status === "pending"
    );
    if (!command) return null;
    command.status = "running";
    command.updatedAt = new Date().toISOString();
    return {
      id: command.id,
      kind: "controller-command",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      command: command.command,
      createdAt: command.createdAt
    };
  }

  completeControllerCommand(commandId: string, result: unknown): void {
    this.resolveCommand(this.controllerCommands, this.controllerWaiters, commandId, "completed", result);
  }

  failControllerCommand(commandId: string, message: string): void {
    this.rejectCommand(this.controllerCommands, this.controllerWaiters, commandId, message);
  }

  executeLabCommand(input: { clientId: string; command: ExtensionCommandInput; timeoutMs?: number }): Promise<unknown> {
    return this.executeCommand(input);
  }

  nextLabCommand(clientId: string): ExtensionCommandPayload | null {
    return this.nextCommand(clientId);
  }

  completeLabCommand(commandId: string, result: unknown): void {
    this.completeCommand(commandId, result);
  }

  failLabCommand(commandId: string, message: string): void {
    this.failCommand(commandId, message);
  }

  async focusClient(clientId: string): Promise<unknown> {
    const client = this.requireCompatibleClient(clientId);
    if (client.tabId !== undefined) {
      try {
        return await this.focusBrowserSurfaceWithController({
          tabId: client.tabId,
          windowId: client.windowId,
          controllerId: client.controllerId,
          focused: true
        });
      } catch {
        // Fall back to the content-script focus path for existing clients if the controller cannot focus by tab id.
      }
    }
    const now = new Date().toISOString();
    const command: ExtensionFocusCommand = {
      id: randomUUID(),
      clientId,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.focusCommands.set(command.id, command);
    return this.waitForCommand(this.focusCommands, this.focusWaiters, command.id, FOCUS_COMMAND_LEASE_MS);
  }

  async focusTarget(input: { target: ExtensionBrowserTarget; timeoutMs?: number; signal?: AbortSignal }): Promise<unknown> {
    const client = this.findCompatibleClientForTarget(input.target);
    if (!client) throw new Error("No compatible BLINK browser extension tab is connected for the requested target.");
    if (client.tabId !== undefined) {
      try {
        return await this.focusBrowserSurfaceWithController({
          tabId: client.tabId,
          windowId: client.windowId,
          controllerId: client.controllerId,
          focused: true,
          timeoutMs: input.timeoutMs,
          signal: input.signal
        });
      } catch {
        // Fall back to the client command below; the caller should treat focus failures as diagnostic only.
      }
    }
    return this.focusClient(client.id);
  }

  nextFocusCommand(clientId: string): ExtensionFocusCommandPayload | null {
    const normalizedClientId = clientId.trim();
    this.requireCompatibleClient(normalizedClientId);
    this.expireCommands(this.focusCommands, this.focusWaiters, FOCUS_COMMAND_LEASE_MS);
    const command = [...this.focusCommands.values()].find(
      (candidate) => candidate.clientId === normalizedClientId && candidate.status === "pending"
    );
    if (!command) return null;
    command.status = "running";
    command.updatedAt = new Date().toISOString();
    return {
      id: command.id,
      kind: "focus-tab",
      protocolVersion: BLINK_EXTENSION_PROTOCOL_VERSION,
      createdAt: command.createdAt
    };
  }

  completeFocusCommand(commandId: string, result: unknown): void {
    this.resolveCommand(this.focusCommands, this.focusWaiters, commandId, "completed", result);
  }

  failFocusCommand(commandId: string, message: string): void {
    this.rejectCommand(this.focusCommands, this.focusWaiters, commandId, message);
  }

  private waitForCommand<T extends { id: string; clientId?: string; status: ExtensionCommandStatus; result?: unknown; error?: string }>(
    commands: Map<string, T>,
    waiters: Map<string, CommandWaiter>,
    commandId: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const existing = commands.get(commandId);
    if (!existing) throw new Error(`Extension command not found: ${commandId}`);
    if (existing.status === "completed") return Promise.resolve(existing.result);
    if (existing.status === "failed") return Promise.reject(new Error(existing.error ?? "Extension command failed"));

    return new Promise((resolve, reject) => {
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        if (signal && abort) signal.removeEventListener("abort", abort);
        waiters.delete(commandId);
        fn();
      };
      const timer = setTimeout(() => {
        const command = commands.get(commandId);
        if (command && command.status !== "completed" && command.status !== "failed") {
          command.status = "failed";
          command.error = `Timed out waiting for browser extension command ${commandId}.`;
          if (command.clientId) this.markCommandUnhealthy(command.clientId);
        }
        finish(() => reject(new Error(`Timed out waiting for browser extension command ${commandId}.`)));
      }, timeoutMs);
      const abort = signal
        ? () => {
            const command = commands.get(commandId);
            if (command && command.status !== "completed" && command.status !== "failed") {
              command.status = "cancelled";
              command.error = "Operation cancelled.";
            }
            finish(() => reject(new Error("Operation cancelled")));
          }
        : undefined;
      if (signal) signal.addEventListener("abort", abort!, { once: true });
      waiters.set(commandId, { resolve, reject, timer, ...(abort ? { abort } : {}) });
    });
  }

  private resolveCommand<T extends { id: string; status: ExtensionCommandStatus; result?: unknown; updatedAt: string }>(
    commands: Map<string, T>,
    waiters: Map<string, CommandWaiter>,
    commandId: string,
    status: "completed",
    result: unknown
  ): void {
    const command = commands.get(commandId);
    if (!command) throw new Error(`Extension command not found: ${commandId}`);
    if (command.status === "failed" || command.status === "cancelled") return;
    command.status = status;
    command.result = result;
    command.updatedAt = new Date().toISOString();
    if ("clientId" in command && typeof command.clientId === "string") this.markCommandHealthy(command.clientId);
    const waiter = waiters.get(commandId);
    if (waiter) {
      clearTimeout(waiter.timer);
      if (waiter.abort) waiter.abort = undefined;
      waiters.delete(commandId);
      waiter.resolve(result);
    }
  }

  private rejectCommand<T extends { id: string; status: ExtensionCommandStatus; error?: string; updatedAt: string }>(
    commands: Map<string, T>,
    waiters: Map<string, CommandWaiter>,
    commandId: string,
    message: string
  ): void {
    const command = commands.get(commandId);
    if (!command) throw new Error(`Extension command not found: ${commandId}`);
    if (command.status === "failed" || command.status === "cancelled") return;
    command.status = "failed";
    command.error = message;
    command.updatedAt = new Date().toISOString();
    const waiter = waiters.get(commandId);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiters.delete(commandId);
      waiter.reject(new Error(message));
    }
  }

  private expireCommands<T extends { id: string; status: ExtensionCommandStatus; createdAt: string; error?: string }>(
    commands: Map<string, T>,
    waiters: Map<string, CommandWaiter>,
    timeoutMs: number
  ): void {
    const now = Date.now();
    for (const command of commands.values()) {
      if (command.status !== "pending") continue;
      if (now - Date.parse(command.createdAt) <= timeoutMs) continue;
      command.status = "failed";
      command.error = `Timed out waiting for browser extension command ${command.id} to be picked up.`;
      if ("clientId" in command && typeof command.clientId === "string") this.markCommandUnhealthy(command.clientId);
      const waiter = waiters.get(command.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(command.id);
        waiter.reject(new Error(command.error));
      }
    }
  }

  private requireCompatibleClient(clientId: string): ExtensionClientStatus {
    this.prune();
    const client = this.clients.get(clientId);
    if (!client) throw new Error("Browser extension client has not checked in. Reload the unpacked extension and refresh the tab.");
    if (!client.compatible) {
      throw new Error(
        client.incompatibilityReason ??
          `Reload the unpacked BLINK browser extension and refresh browser tabs. App requires extension protocol ${BLINK_EXTENSION_PROTOCOL_VERSION}.`
      );
    }
    return client;
  }

  private requireCompatibleController(controllerId: string): ExtensionControllerStatus {
    this.prune();
    const controller = this.controllers.get(controllerId);
    if (!controller) {
      throw new Error("BLINK browser controller has not checked in. Reload the unpacked extension and open any page in that browser profile.");
    }
    if (!controller.compatible) {
      throw new Error(
        controller.incompatibilityReason ??
          `Reload the unpacked BLINK browser extension. App requires extension protocol ${BLINK_EXTENSION_PROTOCOL_VERSION}.`
      );
    }
    return controller;
  }

  private prune(): void {
    const cutoff = Date.now() - CLIENT_TTL_MS;
    for (const [clientId, client] of this.clients.entries()) {
      if (Date.parse(client.lastSeenAt) < cutoff) this.clients.delete(clientId);
    }
    const controllerCutoff = Date.now() - CONTROLLER_TTL_MS;
    for (const [controllerId, controller] of this.controllers.entries()) {
      if (Date.parse(controller.lastSeenAt) < controllerCutoff) this.controllers.delete(controllerId);
    }
    const unhealthyCutoff = Date.now() - COMMAND_CLIENT_COOLDOWN_MS;
    for (const [clientId, unhealthySince] of this.commandUnhealthySince.entries()) {
      if (unhealthySince < unhealthyCutoff || !this.clients.has(clientId)) this.commandUnhealthySince.delete(clientId);
    }
    const fileCutoff = Date.now() - 60 * 60_000;
    for (const [fileId, file] of this.stagedFiles.entries()) {
      if (file.createdAt < fileCutoff) this.stagedFiles.delete(fileId);
    }
  }

  private isCommandHealthy(clientId: string): boolean {
    const unhealthySince = this.commandUnhealthySince.get(clientId);
    if (!unhealthySince) return true;
    if (Date.now() - unhealthySince > COMMAND_CLIENT_COOLDOWN_MS) {
      this.commandUnhealthySince.delete(clientId);
      return true;
    }
    return false;
  }

  private markCommandUnhealthy(clientId: string): void {
    this.commandUnhealthySince.set(clientId, Date.now());
  }

  private markCommandHealthy(clientId: string): void {
    this.commandUnhealthySince.delete(clientId);
  }

  private noCompatibleControllerMessage(capability: "open-tab" | "open-window" | "focus-tab"): string {
    const status = this.status();
    const connectedTabs = status.connectedClients.map((client) => ({
      id: client.id,
      url: client.url,
      title: client.title,
      routingToken: client.routingToken,
      controllerId: client.controllerId,
      tabId: client.tabId,
      windowId: client.windowId,
      controllerHeartbeatOk: client.controllerHeartbeatOk,
      controllerHeartbeatError: client.controllerHeartbeatError
    }));
    const controllers = status.connectedControllers.map((controller) => ({
      id: controller.id,
      compatible: controller.compatible,
      capabilities: controller.capabilities,
      incompatibilityReason: controller.incompatibilityReason
    }));
    return (
      `No compatible BLINK browser controller with ${capability} support is connected. ` +
      "Do not open chrome.exe or paste routed workflow URLs into another Chrome profile; that bypasses the BLINK extension controller and can open the wrong profile. " +
      "Open the BLINK extension popup in the intended Chrome profile, confirm it reports at least 1 browser controller, then resume the run. " +
      `connectedTabs=${JSON.stringify(connectedTabs)}; connectedControllers=${JSON.stringify(controllers)}; ` +
      `controllerDiagnostics=${JSON.stringify(status.controllerDiagnostics)}`
    );
  }
}

export const extensionBridge = new ExtensionBridge();

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function buildControllerDiagnostics(clients: ExtensionClientStatus[]): ExtensionControllerDiagnostics {
  const compatibleClients = clients.filter((client) => client.compatible);
  const heartbeatClients = compatibleClients.filter(
    (client) => client.controllerHeartbeatAt || client.controllerHeartbeatError || client.controllerHeartbeatOk !== undefined
  );
  const latestHeartbeat = heartbeatClients.sort((a, b) =>
    String(b.controllerHeartbeatAt ?? b.lastSeenAt).localeCompare(String(a.controllerHeartbeatAt ?? a.lastSeenAt))
  )[0];
  return {
    compatibleTabsWithController: compatibleClients.filter((client) => Boolean(client.controllerId)).length,
    compatibleTabsWithoutController: compatibleClients.filter((client) => !client.controllerId).length,
    ...(latestHeartbeat?.controllerHeartbeatAt ? { latestControllerHeartbeatAt: latestHeartbeat.controllerHeartbeatAt } : {}),
    ...(latestHeartbeat?.controllerHeartbeatOk !== undefined ? { latestControllerHeartbeatOk: latestHeartbeat.controllerHeartbeatOk } : {}),
    ...(latestHeartbeat?.controllerHeartbeatError ? { latestControllerHeartbeatError: latestHeartbeat.controllerHeartbeatError } : {}),
    connectedTabDiagnostics: compatibleClients.map((client) => ({
      id: client.id,
      url: client.url,
      title: client.title,
      ...(client.routingToken ? { routingToken: client.routingToken } : {}),
      ...(client.controllerId ? { controllerId: client.controllerId } : {}),
      ...(client.tabId !== undefined ? { tabId: client.tabId } : {}),
      ...(client.windowId !== undefined ? { windowId: client.windowId } : {}),
      ...(client.controllerHeartbeatOk !== undefined ? { controllerHeartbeatOk: client.controllerHeartbeatOk } : {}),
      ...(client.controllerHeartbeatAt ? { controllerHeartbeatAt: client.controllerHeartbeatAt } : {}),
      ...(client.controllerHeartbeatError ? { controllerHeartbeatError: client.controllerHeartbeatError } : {})
    }))
  };
}

function routingTokenFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const searchToken = url.searchParams.get(BLINK_ROUTING_TOKEN_PARAM)?.trim();
    if (searchToken) return searchToken;
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    return hash.get(BLINK_ROUTING_TOKEN_PARAM)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function openableTargetUrl(target: ExtensionBrowserTarget): string | undefined {
  if (target.mode === "any") return undefined;
  const rawUrl = target.url?.trim();
  if (!rawUrl) return undefined;
  const url = new URL(safeExtensionTabUrl(rawUrl));
  if (target.mode === "new" && target.routingToken) {
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    if (!hash.get(BLINK_ROUTING_TOKEN_PARAM)) {
      hash.set(BLINK_ROUTING_TOKEN_PARAM, target.routingToken);
      url.hash = hash.toString();
    }
  }
  return url.toString();
}

function safeExtensionTabUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Extension tab URL is required.");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Extension tab URL must use http or https: ${value}`);
  }
  return url.toString();
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("Operation cancelled"));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error("Operation cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function normalizeComparableUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    removeRoutingToken(url);
    return url.toString();
  } catch {
    return trimmed;
  }
}

function sameUrl(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function removeRoutingToken(url: URL): void {
  const search = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  if (search.has(BLINK_ROUTING_TOKEN_PARAM)) {
    search.delete(BLINK_ROUTING_TOKEN_PARAM);
    url.search = search.toString();
  }
  if (hash.has(BLINK_ROUTING_TOKEN_PARAM)) {
    hash.delete(BLINK_ROUTING_TOKEN_PARAM);
    url.hash = hash.toString();
  }
}
