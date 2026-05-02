import type { RunRecord, SystemInfo } from "./api";

export type ExtensionClient = SystemInfo["extension"]["connectedClients"][number];

export interface ChatGptTabTargetInput {
  mode: "any" | "existing" | "new";
  clientId?: string;
  routingToken?: string;
}

export interface ChatGptFocusTarget {
  clientId: string | null;
  client: ExtensionClient | null;
  disabledReason: string | null;
}

export function resolveChatGptFocusTarget(run: RunRecord | undefined, clients: ExtensionClient[]): ChatGptFocusTarget | null {
  if (!run || run.workflowId !== "chatgpt.extension-image-transform") return null;

  const target = readChatGptTabTarget(run.input);
  if (!target) {
    return {
      clientId: null,
      client: null,
      disabledReason: "This run did not record a specific ChatGPT tab target."
    };
  }

  if (target.mode === "existing") {
    const clientId = target.clientId?.trim() ?? "";
    if (!clientId) {
      return {
        clientId: null,
        client: null,
        disabledReason: "This run recorded an invalid ChatGPT tab target."
      };
    }
    return resolveClientById(clientId, clients);
  }

  if (target.mode === "new") {
    const routingToken = target.routingToken?.trim() ?? "";
    if (!routingToken) {
      return {
        clientId: null,
        client: null,
        disabledReason: "This run recorded an invalid new-tab routing token."
      };
    }
    const matchedClient = clients.find((client) => client.routingToken === routingToken);
    if (!matchedClient) {
      return {
        clientId: null,
        client: null,
        disabledReason: "The routed ChatGPT tab is not connected."
      };
    }
    return clientToFocusTarget(matchedClient);
  }

  return {
    clientId: null,
    client: null,
    disabledReason: "This run did not target a specific ChatGPT tab."
  };
}

export function resolveClientById(clientId: string, clients: ExtensionClient[]): ChatGptFocusTarget {
  const client = clients.find((candidate) => candidate.id === clientId) ?? null;
  if (!client) {
    return {
      clientId: null,
      client: null,
      disabledReason: "The selected ChatGPT tab is not connected."
    };
  }
  return clientToFocusTarget(client);
}

export function readChatGptTabTarget(input: unknown): ChatGptTabTargetInput | null {
  if (!input || typeof input !== "object") return null;
  const chatGptTab = (input as Record<string, unknown>).chatGptTab;
  if (!chatGptTab || typeof chatGptTab !== "object") return null;
  const record = chatGptTab as Record<string, unknown>;
  if (record.mode === "existing") {
    return {
      mode: "existing",
      clientId: typeof record.clientId === "string" ? record.clientId : undefined
    };
  }
  if (record.mode === "new") {
    return {
      mode: "new",
      routingToken: typeof record.routingToken === "string" ? record.routingToken : undefined
    };
  }
  if (record.mode === "any") return { mode: "any" };
  return null;
}

function clientToFocusTarget(client: ExtensionClient): ChatGptFocusTarget {
  if (!client.compatible) {
    return {
      clientId: null,
      client,
      disabledReason: client.incompatibilityReason ?? "The selected ChatGPT tab is running an incompatible extension."
    };
  }
  return {
    clientId: client.id,
    client,
    disabledReason: null
  };
}
