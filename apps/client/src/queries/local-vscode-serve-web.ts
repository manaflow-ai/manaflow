import { waitForConnectedSocket } from "@/contexts/socket/socket-boot";
import { normalizeWorkspaceOrigin } from "@/lib/toProxyWorkspaceUrl";
import { queryOptions, useQuery } from "@tanstack/react-query";

export type LocalVSCodeServeWebInfo = {
  baseUrl: string | null;
  port: number | null;
};

const LOCAL_VSCODE_SERVE_WEB_QUERY_KEY = ["local-vscode-serve-web-origin"];

export function localVSCodeServeWebQueryOptions() {
  return queryOptions({
    queryKey: LOCAL_VSCODE_SERVE_WEB_QUERY_KEY,
    queryFn: async (): Promise<LocalVSCodeServeWebInfo> => {
      const socket = await waitForConnectedSocket();
      return await new Promise<LocalVSCodeServeWebInfo>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({ baseUrl: null, port: null });
        }, 5_000);

        try {
          socket.emit(
            "get-local-vscode-serve-web-origin",
            (response: { baseUrl: string | null; port: number | null } | undefined) => {
              if (settled) {
                return;
              }
              settled = true;
              clearTimeout(timer);
              const normalized: LocalVSCodeServeWebInfo = {
                baseUrl: normalizeWorkspaceOrigin(response?.baseUrl ?? null),
                port:
                  typeof response?.port === "number" &&
                  Number.isFinite(response.port)
                    ? response.port
                    : null,
              };
              resolve(normalized);
            }
          );
        } catch (error) {
          clearTimeout(timer);
          if (settled) {
            return;
          }
          settled = true;
          reject(
            error instanceof Error
              ? error
              : new Error(String(error ?? "Unknown socket error"))
          );
        }
      });
    },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useLocalVSCodeServeWebQuery() {
  return useQuery(localVSCodeServeWebQueryOptions());
}
