import type { RunRecord, SystemInfo } from "./api";

export type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];

export interface ChatGptTabTargetInput {
  mode: "any" | "existing" | "new";
  clientId?: string;
  routingToken?: string;
  url?: string;
  title?: string;
}

export interface ChatGptFocusTarget {
  clientId: string | null;
  client: ExtensionClient | null;
  url: string | null;
  action: "focus" | "open" | "disabled";
  buttonLabel: string;
  disabledReason: string | null;
}

export function resolveChatGptFocusTarget(run: RunRecord | undefined, clients: ExtensionClient[]): ChatGptFocusTarget | null {
  if (!run || run.workflowId !== "chatgpt.extension-image-transform") return null;

  const target = readChatGptTabTarget(run.input);
  const page = readChatGptPage(run.output);
  const trackedUrl = normalizeComparableUrl(page?.url ?? target?.url);
  const routingToken = firstNonEmptyString(target?.routingToken, page?.routingToken);
  const trackedUrlForOpen = trackedUrl ? addRoutingTokenToUrl(trackedUrl, routingToken) : null;
  if (!target && !page) {
    return {
      clientId: null,
      client: null,
      url: null,
      action: "disabled",
      buttonLabel: "Go to ChatGPT tab",
      disabledReason: "This run did not record a specific ChatGPT tab target."
    };
  }

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

  if (recordedClientId) return disabledTarget("The selected ChatGPT tab is not connected.");
  if (routingToken) return disabledTarget("The routed ChatGPT tab is not connected.");
  if (target?.mode === "existing" && !recordedClientId) {
    return disabledTarget("This run recorded an invalid ChatGPT tab target.");
  }
  if (target?.mode === "new" && !routingToken) {
    return disabledTarget("This run recorded an invalid new-tab routing token.");
  }
  return {
    clientId: null,
    client: null,
    url: null,
    action: "disabled",
    buttonLabel: "Go to ChatGPT tab",
    disabledReason: "This run did not target a specific ChatGPT tab."
  };
}

export function resolveClientById(clientId: string, clients: ExtensionClient[]): ChatGptFocusTarget {
  const client = clients.find((candidate) => candidate.id === clientId) ?? null;
  if (!client) {
    return {
      clientId: null,
      client: null,
      url: null,
      action: "disabled",
      buttonLabel: "Go to ChatGPT tab",
      disabledReason: "The selected ChatGPT tab is not connected."
    };
  }
  return clientToFocusTarget(client);
}

export function isRecoverableFailedChatGptRun(run: RunRecord | undefined): boolean {
  if (!run || run.status !== "failed" || run.workflowId !== "chatgpt.extension-image-transform") return false;
  const target = readChatGptTabTarget(run.input);
  const page = readChatGptPage(run.output);
  if (page) return true;
  if (hasChatGptCheckpoint(run.output)) return true;
  return Boolean(target?.url);
}

export function readChatGptTabTarget(input: unknown): ChatGptTabTargetInput | null {
  if (!input || typeof input !== "object") return null;
  const chatGptTab = (input as Record<string, unknown>).chatGptTab;
  if (!chatGptTab || typeof chatGptTab !== "object") return null;
  const record = chatGptTab as Record<string, unknown>;
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

export function readChatGptPage(output: unknown): ChatGptPage | null {
  if (!output || typeof output !== "object") return null;
  const chatGptPage = (output as Record<string, unknown>).chatGptPage;
  if (!chatGptPage || typeof chatGptPage !== "object") return null;
  const record = chatGptPage as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url) return null;
  return {
    url,
    title: typeof record.title === "string" ? record.title : undefined,
    clientId: typeof record.clientId === "string" ? record.clientId : undefined,
    routingToken: typeof record.routingToken === "string" ? record.routingToken : undefined,
    capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : undefined
  };
}

function hasChatGptCheckpoint(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const checkpoint = (output as Record<string, unknown>).checkpoint;
  return Boolean(checkpoint && typeof checkpoint === "object");
}

function clientToFocusTarget(client: ExtensionClient): ChatGptFocusTarget {
  if (!client.compatible) {
    return {
      clientId: null,
      client,
      url: null,
      action: "disabled",
      buttonLabel: "Go to ChatGPT tab",
      disabledReason: client.incompatibilityReason ?? "The selected ChatGPT tab is running an incompatible extension."
    };
  }
  return {
    clientId: client.id,
    client,
    url: client.url || null,
    action: "focus",
    buttonLabel: "Go to ChatGPT tab",
    disabledReason: null
  };
}

interface ChatGptPage {
  url: string;
  title?: string;
  clientId?: string;
  routingToken?: string;
  capturedAt?: string;
}

function urlToOpenTarget(url: string): ChatGptFocusTarget {
  return {
    clientId: null,
    client: null,
    url,
    action: "open",
    buttonLabel: "Open ChatGPT page",
    disabledReason: null
  };
}

function disabledTarget(disabledReason: string): ChatGptFocusTarget {
  return {
    clientId: null,
    client: null,
    url: null,
    action: "disabled",
    buttonLabel: "Go to ChatGPT tab",
    disabledReason
  };
}

function findClientByUrl(
  url: string,
  clients: ExtensionClient[],
  options: { compatible?: boolean } = { compatible: true }
): ExtensionClient | null {
  const normalizedUrl = normalizeComparableUrl(url);
  if (!normalizedUrl) return null;
  return (
    clients.find((client) => {
      if (options.compatible !== undefined && client.compatible !== options.compatible) return false;
      return normalizeComparableUrl(client.url) === normalizedUrl;
    }) ?? null
  );
}

function normalizeComparableUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    removeRoutingToken(url);
    return url.toString();
  } catch {
    return trimmed;
  }
}

function addRoutingTokenToUrl(value: string, routingToken?: string): string {
  const token = routingToken?.trim();
  if (!token) return value;
  try {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    hash.set("based-blink-tab", token);
    url.hash = hash.toString();
    return url.toString();
  } catch {
    return value;
  }
}

function removeRoutingToken(url: URL): void {
  const search = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  let changed = false;
  if (search.has("based-blink-tab")) {
    search.delete("based-blink-tab");
    changed = true;
  }
  if (hash.has("based-blink-tab")) {
    hash.delete("based-blink-tab");
    changed = true;
  }
  if (!changed) return;
  url.search = search.toString();
  url.hash = hash.toString();
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
