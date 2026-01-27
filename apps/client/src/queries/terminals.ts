import { queryOptions } from "@tanstack/react-query";

export type TerminalTabId = string;

export interface CreateTerminalTabRequest {
  cmd?: string;
  args?: string[];
  cols?: number;
  rows?: number;
}

export interface CreateTerminalTabResponse {
  id: string;
  wsUrl: string;
}

const NO_BASE_PLACEHOLDER = "__no-terminal-base__";
const NO_CONTEXT_PLACEHOLDER = "__no-terminal-context__";

export function terminalTabsQueryKey(
  baseUrl: string | null | undefined,
  contextKey?: string | number | null
) {
  return [
    "terminal-tabs",
    contextKey ?? NO_CONTEXT_PLACEHOLDER,
    baseUrl ?? NO_BASE_PLACEHOLDER,
    "list",
  ] as const;
}

function ensureBaseUrl(baseUrl: string | null | undefined): string {
  if (!baseUrl) {
    throw new Error("Terminal backend is not ready yet.");
  }
  return baseUrl;
}

function buildTerminalUrl(baseUrl: string, pathname: string) {
  return new URL(pathname, baseUrl);
}

interface SessionInfo {
  id: string;
  name: string;
  index: number;
  metadata?: { type?: string; location?: string; managed?: boolean };
}

interface SessionsListResponse {
  sessions: SessionInfo[];
}

function getSessionPriority(session: SessionInfo): number {
  const metadata = session.metadata;
  if (metadata?.type === "agent" && metadata.managed) {
    return 0;
  }
  if (session.name === "cmux") {
    return 0;
  }
  if (metadata?.type === "agent") {
    return 1;
  }
  if (session.name === "dev" || metadata?.type === "dev") {
    return 2;
  }
  if (session.name === "maintenance" || metadata?.type === "maintenance") {
    return 3;
  }
  return 4;
}

/**
 * Sort sessions so that the coding agent terminal is always first.
 * This ensures Terminal 1 in the UI is the agent by default.
 */
function sortSessionsWithAgentFirst(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => {
    const priorityDiff = getSessionPriority(a) - getSessionPriority(b);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    if (a.index !== b.index) {
      return a.index - b.index;
    }
    if (a.name !== b.name) {
      return a.name.localeCompare(b.name);
    }
    return a.id.localeCompare(b.id);
  });
}

function sortTerminalIdsWithAgentFirst(
  ids: TerminalTabId[],
  contextKey?: string | number | null
): TerminalTabId[] {
  const preferredId =
    typeof contextKey === "string" && contextKey.length > 0 ? contextKey : null;

  return [...ids].sort((a, b) => {
    if (preferredId) {
      if (a === preferredId) return -1;
      if (b === preferredId) return 1;
    }
    if (a === "cmux") return -1;
    if (b === "cmux") return 1;
    if (a === "dev") return 1;
    if (b === "dev") return -1;
    return 0;
  });
}

function isSessionsListResponse(value: unknown): value is SessionsListResponse {
  if (typeof value !== "object" || value === null) return false;
  const sessions = Reflect.get(value, "sessions");
  return Array.isArray(sessions);
}

function isTerminalTabIdList(value: unknown): value is TerminalTabId[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}


export function terminalTabsQueryOptions({
  baseUrl,
  contextKey,
  enabled = true,
}: {
  baseUrl: string | null | undefined;
  contextKey?: string | number | null;
  enabled?: boolean;
}) {
  const effectiveEnabled = Boolean(enabled && baseUrl);

  return queryOptions<TerminalTabId[]>({
    queryKey: terminalTabsQueryKey(baseUrl, contextKey),
    enabled: effectiveEnabled,
    queryFn: async () => {
      const resolvedBaseUrl = ensureBaseUrl(baseUrl);
      const url = buildTerminalUrl(resolvedBaseUrl, "/sessions");
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to load terminals (${response.status})`);
      }
      const payload: unknown = await response.json();
      // Handle new API format: { sessions: [...] }
      // Sort so that the coding agent terminal is always first (Terminal 1)
      if (isSessionsListResponse(payload)) {
        const sorted = sortSessionsWithAgentFirst(payload.sessions);
        return sorted.map((s) => s.id);
      }
      // Fallback for old API format: [...]
      if (!isTerminalTabIdList(payload)) {
        throw new Error("Unexpected response while loading terminals.");
      }
      return sortTerminalIdsWithAgentFirst(payload, contextKey);
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export async function createTerminalTab({
  baseUrl,
  request,
}: {
  baseUrl: string | null | undefined;
  request?: CreateTerminalTabRequest;
}): Promise<CreateTerminalTabResponse> {
  const resolvedBaseUrl = ensureBaseUrl(baseUrl);
  const url = buildTerminalUrl(resolvedBaseUrl, "/sessions");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request ?? {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to create terminal (${response.status})`);
  }
  const payload: unknown = await response.json();
  // New API returns full session info with id
  const id = typeof payload === "object" && payload !== null ? Reflect.get(payload, "id") : null;
  if (typeof id !== "string") {
    throw new Error("Unexpected response while creating terminal.");
  }
  return {
    id,
    wsUrl: `/sessions/${id}/ws`,
  };
}

export async function deleteTerminalTab({
  baseUrl,
  tabId,
}: {
  baseUrl: string | null | undefined;
  tabId: string;
}): Promise<void> {
  const resolvedBaseUrl = ensureBaseUrl(baseUrl);
  const url = buildTerminalUrl(
    resolvedBaseUrl,
    `/sessions/${encodeURIComponent(tabId)}`
  );
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to delete terminal (${response.status})`);
  }
}
