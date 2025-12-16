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

function isTerminalTabIdList(value: unknown): value is TerminalTabId[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

interface CreateTerminalTabHttpResponse {
  id: string;
  ws_url: string;
}

function isCreateTerminalTabHttpResponse(
  value: unknown
): value is CreateTerminalTabHttpResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const id = Reflect.get(value, "id");
  const wsUrl = Reflect.get(value, "ws_url");
  return typeof id === "string" && typeof wsUrl === "string";
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
      const url = buildTerminalUrl(resolvedBaseUrl, "/api/tabs");
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to load terminals (${response.status})`);
      }
      const payload: unknown = await response.json();
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
  const url = buildTerminalUrl(resolvedBaseUrl, "/api/tabs");
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
  if (!isCreateTerminalTabHttpResponse(payload)) {
    throw new Error("Unexpected response while creating terminal.");
  }
  return {
    id: payload.id,
    wsUrl: payload.ws_url,
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
    `/api/tabs/${encodeURIComponent(tabId)}`
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
