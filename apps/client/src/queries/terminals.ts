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

export interface TerminalHealthStatus {
  ok: boolean;
  status: string | null;
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
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = pathname.startsWith("/")
    ? pathname.slice(1)
    : pathname;
  return new URL(normalizedPath, normalizedBase);
}

interface SessionsListResponse {
  sessions: Array<{ id: string; name: string; index: number }>;
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

export function terminalHealthQueryOptions({
  baseUrl,
  enabled = true,
}: {
  baseUrl: string | null | undefined;
  enabled?: boolean;
}) {
  const effectiveEnabled = Boolean(enabled && baseUrl);

  return queryOptions<TerminalHealthStatus>({
    queryKey: ["terminal-health", baseUrl ?? NO_BASE_PLACEHOLDER],
    enabled: effectiveEnabled,
    queryFn: async () => {
      const resolvedBaseUrl = ensureBaseUrl(baseUrl);
      const url = buildTerminalUrl(resolvedBaseUrl, "/health");
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Terminal health check failed (${response.status})`);
      }
      let status: string | null = null;
      try {
        const payload: unknown = await response.json();
        const statusValue =
          typeof payload === "object" && payload !== null
            ? Reflect.get(payload, "status")
            : null;
        if (typeof statusValue === "string") {
          status = statusValue;
        }
      } catch (error) {
        console.error("Failed to parse terminal health response", error);
      }

      return {
        ok: response.ok && (status ? status === "ok" : true),
        status,
      };
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
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
      if (isSessionsListResponse(payload)) {
        return payload.sessions.map((s) => s.id);
      }
      // Fallback for old API format: [...]
      if (!isTerminalTabIdList(payload)) {
        throw new Error("Unexpected response while loading terminals.");
      }
      return payload;
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
