import type { RunRecord, SystemInfo, WorkflowSummary } from "./api";

export type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];

export interface ExtensionTabTargetInput {
  mode: "any" | "existing" | "new";
  clientId?: string;
  routingToken?: string;
  url?: string;
  title?: string;
}

export interface ExtensionFocusTarget {
  clientId: string | null;
  client: ExtensionClient | null;
  url: string | null;
  action: "focus" | "open" | "disabled";
  buttonLabel: string;
  disabledReason: string | null;
}

export function resolveExtensionFocusTarget(
  run: RunRecord | undefined,
  clients: ExtensionClient[],
  workflow?: WorkflowSummary
): ExtensionFocusTarget | null {
  if (!run || !workflow?.manifest.uiCapabilities?.includes("extension.focusTarget")) return null;

  const target = readExtensionTabTarget(run.input);
  const page = readExtensionPage(run.output);
  const trackedUrl = normalizeComparableUrl(page?.url ?? target?.url);
  const routingToken = firstNonEmptyString(target?.routingToken, page?.routingToken);
  const trackedUrlForOpen = trackedUrl ? addRoutingTokenToUrl(trackedUrl, routingToken) : null;
  if (!target && !page) return disabledTarget("This run did not record a specific browser tab target.");

  const recordedClientId = firstNonEmptyString(target?.mode === "existing" ? target.clientId : undefined, page?.clientId);
  if (recordedClientId) {
    const matchedClient = clients.find((client) => client.id === recordedClientId) ?? null;
    if (matchedClient) return clientToFocusTarget(matchedClient);
  }
  if (routingToken) {
    const matchedClient = clients.find((client) => client.routingToken === routingToken);
    if (matchedClient) return clientToFocusTarget(matchedClient);
  }
  if (trackedUrl) {
    const matchedClient = findClientByUrl(trackedUrl, clients);
    if (matchedClient) return clientToFocusTarget(matchedClient);
    const incompatibleClient = findClientByUrl(trackedUrl, clients, { compatible: false });
    if (incompatibleClient) return clientToFocusTarget(incompatibleClient);
    return urlToOpenTarget(trackedUrlForOpen ?? trackedUrl);
  }

  if (recordedClientId) return disabledTarget("The selected browser tab is not connected.");
  if (routingToken) return disabledTarget("The routed browser tab is not connected.");
  return disabledTarget("This run did not target a specific browser tab.");
}

export function isRecoverableFailedExtensionRun(run: RunRecord | undefined, workflow?: WorkflowSummary): boolean {
  if (!run || run.status !== "failed" || !workflow?.manifest.uiCapabilities?.includes("extension.focusTarget")) return false;
  const target = readExtensionTabTarget(run.input);
  const page = readExtensionPage(run.output);
  if (page) return true;
  if (hasCheckpoint(run.output)) return true;
  return Boolean(target?.url);
}

export function readExtensionTabTarget(input: unknown): ExtensionTabTargetInput | null {
  if (!input || typeof input !== "object") return null;
  const extensionTab = (input as Record<string, unknown>).extensionTab;
  if (!extensionTab || typeof extensionTab !== "object") return null;
  const record = extensionTab as Record<string, unknown>;
  if (record.mode === "existing") {
    return {
      mode: "existing",
      clientId: typeof record.clientId === "string" ? record.clientId : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      title: typeof record.title === "string" ? record.title : undefined
    };
  }
  if (record.mode === "new") {
    return {
      mode: "new",
      routingToken: typeof record.routingToken === "string" ? record.routingToken : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      title: typeof record.title === "string" ? record.title : undefined
    };
  }
  if (record.mode === "any") return { mode: "any" };
  return null;
}

function readExtensionPage(output: unknown): { url: string; title?: string; clientId?: string; routingToken?: string } | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const page = record.browserPage as unknown;
  if (!page || typeof page !== "object") return null;
  const pageRecord = page as Record<string, unknown>;
  const url = typeof pageRecord.url === "string" ? pageRecord.url.trim() : "";
  if (!url) return null;
  return {
    url,
    title: typeof pageRecord.title === "string" ? pageRecord.title : undefined,
    clientId: typeof pageRecord.clientId === "string" ? pageRecord.clientId : undefined,
    routingToken: typeof pageRecord.routingToken === "string" ? pageRecord.routingToken : undefined
  };
}

function hasCheckpoint(output: unknown): boolean {
  return Boolean(output && typeof output === "object" && (output as Record<string, unknown>).checkpoint);
}

function clientToFocusTarget(client: ExtensionClient): ExtensionFocusTarget {
  if (!client.compatible) {
    return {
      clientId: null,
      client,
      url: client.url || null,
      action: "disabled",
      buttonLabel: "Go to browser tab",
      disabledReason: client.incompatibilityReason ?? "The selected browser tab is running an incompatible extension."
    };
  }
  return {
    clientId: client.id,
    client,
    url: client.url || null,
    action: "focus",
    buttonLabel: "Go to browser tab",
    disabledReason: null
  };
}

function urlToOpenTarget(url: string): ExtensionFocusTarget {
  return {
    clientId: null,
    client: null,
    url,
    action: "open",
    buttonLabel: "Open via BLINK controller",
    disabledReason: null
  };
}

function disabledTarget(reason: string): ExtensionFocusTarget {
  return {
    clientId: null,
    client: null,
    url: null,
    action: "disabled",
    buttonLabel: "Go to browser tab",
    disabledReason: reason
  };
}

function findClientByUrl(url: string, clients: ExtensionClient[], options: { compatible?: boolean } = {}): ExtensionClient | null {
  return (
    clients.find((client) => {
      if (options.compatible !== undefined && client.compatible !== options.compatible) return false;
      return normalizeComparableUrl(client.url) === normalizeComparableUrl(url);
    }) ?? null
  );
}

function normalizeComparableUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    removeRoutingToken(url);
    return url.toString();
  } catch {
    return value;
  }
}

function addRoutingTokenToUrl(value: string, routingToken: string | undefined): string {
  if (!routingToken) return value;
  try {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    hash.set("based-blink-tab", routingToken);
    url.hash = hash.toString();
    return url.toString();
  } catch {
    return value;
  }
}

function removeRoutingToken(url: URL): void {
  const search = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  if (search.has("based-blink-tab")) {
    search.delete("based-blink-tab");
    url.search = search.toString();
  }
  if (hash.has("based-blink-tab")) {
    hash.delete("based-blink-tab");
    url.hash = hash.toString();
  }
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
