import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery as useConvexQuery, useMutation } from "convex/react";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import z from "zod";
import { TaskRunTerminalSession } from "@/components/task-run-terminal-session";
import { toMorphXtermBaseUrl } from "@/lib/toProxyWorkspaceUrl";
import {
  createTerminalTab,
  terminalTabsQueryKey,
  terminalTabsQueryOptions,
  type TerminalTabId,
} from "@/queries/terminals";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { isElectron } from "@/lib/electron";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
  previewId: z.string(),
});

const CLOUD_TMUX_BOOTSTRAP_SCRIPT = `set -euo pipefail
SESSION="cmux"
WORKSPACE_ROOT="/root/workspace"
ensure_session() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    return
  fi

  tmux new-session -d -s "$SESSION" -c "$WORKSPACE_ROOT" -n "main"
  tmux rename-window -t "$SESSION:1" "main" >/dev/null 2>&1 || true
  tmux new-window -t "$SESSION:" -n "maintenance" -c "$WORKSPACE_ROOT"
  tmux new-window -t "$SESSION:" -n "dev" -c "$WORKSPACE_ROOT"
}
ensure_session

tmux select-window -t "$SESSION:main" >/dev/null 2>&1 || true
exec tmux attach -t "$SESSION"`;

const STANDARD_ATTACH_SCRIPT = `set -euo pipefail
tmux select-window -t cmux:0 >/dev/null 2>&1 || true
exec tmux attach -t cmux`;

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/preview/$previewId"
)({
  component: PreviewPage,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => {
      return {
        taskId: params.taskId,
        runId: params.runId,
        previewId: params.previewId,
      };
    },
  },
  loader: async (opts) => {
    const { params, context } = opts;
    const { teamSlugOrId, runId } = params;
    const { queryClient } = context;

    convexQueryClient.convexClient.prewarmQuery({
      query: api.taskRuns.get,
      args: { teamSlugOrId, id: runId },
    });

    // Create terminal in background without blocking
    void (async () => {
      const taskRun = await queryClient.ensureQueryData(
        convexQuery(api.taskRuns.get, {
          teamSlugOrId,
          id: runId,
        })
      );

      const vscodeInfo = taskRun?.vscode;
      const rawMorphUrl = vscodeInfo?.url ?? vscodeInfo?.workspaceUrl ?? null;
      const isMorphProvider = vscodeInfo?.provider === "morph";

      if (!isMorphProvider || !rawMorphUrl) {
        return;
      }

      const baseUrl = toMorphXtermBaseUrl(rawMorphUrl);
      const tabsQueryKey = terminalTabsQueryKey(baseUrl, runId);

      const tabs = await queryClient.ensureQueryData(
        terminalTabsQueryOptions({
          baseUrl,
          contextKey: runId,
        })
      );

      if (tabs.length > 0) {
        return;
      }

      const request = taskRun?.isCloudWorkspace
        ? {
            cmd: "bash",
            args: ["-lc", CLOUD_TMUX_BOOTSTRAP_SCRIPT],
          }
        : {
            cmd: "bash",
            args: ["-lc", STANDARD_ATTACH_SCRIPT],
          };

      try {
        const created = await createTerminalTab({
          baseUrl,
          request,
        });

        queryClient.setQueryData<TerminalTabId[]>(tabsQueryKey, (current) => {
          if (!current || current.length === 0) {
            return [created.id];
          }
          if (current.includes(created.id)) {
            return current;
          }
          return [...current, created.id];
        });
      } catch (error) {
        console.error("Failed to auto-create terminal", error);
      }
    })();
  },
});

function PreviewPage() {
  const { taskId, teamSlugOrId, runId, previewId } = Route.useParams();

  const taskRuns = useConvexQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });
  
  const updatePreviewUrl = useMutation(api.taskRuns.updateCustomPreviewUrl).withOptimisticUpdate(
    (localStore, args) => {
      // Update all queries that might have this task run
      const taskRunsQuery = localStore.getQuery(api.taskRuns.getByTask, {
        teamSlugOrId: args.teamSlugOrId,
        taskId,
      });
      
      if (taskRunsQuery) {
        localStore.setQuery(
          api.taskRuns.getByTask,
          { teamSlugOrId: args.teamSlugOrId, taskId },
          taskRunsQuery.map((r) =>
            r._id === args.runId
              ? {
                  ...r,
                  customPreviews: (r.customPreviews || []).map((preview, i) =>
                    i === args.index ? { ...preview, url: args.url } : preview
                  ),
                }
              : r
          )
        );
      }
    }
  );

  // Get the specific run
  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);
  
  // Check if this is a custom preview (not a port)
  const isCustomPreview = useMemo(() => {
    const index = Number.parseInt(previewId, 10);
    return !Number.isNaN(index) && selectedRun?.customPreviews && index < selectedRun.customPreviews.length;
  }, [previewId, selectedRun]);
  
  const handleUserNavigate = useCallback((url: string) => {
    const index = Number.parseInt(previewId, 10);
    if (!Number.isNaN(index) && isCustomPreview) {
      void updatePreviewUrl({
        teamSlugOrId,
        runId,
        index,
        url,
      }).catch((error) => {
        console.error("Failed to update preview URL", error);
      });
    }
  }, [previewId, isCustomPreview, updatePreviewUrl, teamSlugOrId, runId]);

  // Find the service URL - check if previewId is a port or custom preview
  const { previewUrl, displayUrl } = useMemo(() => {
    if (!selectedRun) {
      return { previewUrl: null, displayUrl: null };
    }

    // Try parsing as index for custom preview
    const index = Number.parseInt(previewId, 10);
    if (!Number.isNaN(index) && selectedRun.customPreviews) {
      const customPreview = selectedRun.customPreviews[index];
      if (customPreview) {
        return {
          previewUrl: customPreview.url,
          displayUrl: customPreview.url,
        };
      }
      // Index exists but preview not yet synced (optimistic)
      if (index === selectedRun.customPreviews.length) {
        return {
          previewUrl: "about:blank",
          displayUrl: "about:blank",
        };
      }
    }

    // Fall back to port-based preview
    if (!selectedRun.networking) {
      return { previewUrl: null, displayUrl: null };
    }
    const portNum = Number.parseInt(previewId, 10);
    if (Number.isNaN(portNum)) {
      return { previewUrl: null, displayUrl: null };
    }
    const service = selectedRun.networking.find(
      (s) => s.port === portNum && s.status === "running"
    );
    if (!service?.url) {
      return { previewUrl: null, displayUrl: null };
    }

    const electronDisplayUrl = `http://localhost:${service.port}`;

    return {
      previewUrl: service.url,
      displayUrl: isElectron ? electronDisplayUrl : service.url,
    };
  }, [selectedRun, previewId]);

  const persistKey = useMemo(() => {
    return getTaskRunPreviewPersistKey(runId, previewId);
  }, [runId, previewId]);

  // Terminal setup
  const vscodeInfo = selectedRun?.vscode;
  const rawMorphUrl = vscodeInfo?.url ?? vscodeInfo?.workspaceUrl ?? null;
  const isMorphProvider = vscodeInfo?.provider === "morph";
  const baseUrl = useMemo(() => {
    if (!isMorphProvider || !rawMorphUrl) return null;
    return toMorphXtermBaseUrl(rawMorphUrl);
  }, [isMorphProvider, rawMorphUrl]);

  const terminalTabsQuery = useQuery(
    terminalTabsQueryOptions({
      baseUrl,
      contextKey: runId,
      enabled: Boolean(baseUrl),
    })
  );

  const activeTerminalId = terminalTabsQuery.data?.[0] ?? null;

  // Terminal state - default open if preview URL is not available
  const [isTerminalVisible, setIsTerminalVisible] = useState(() => !previewUrl);

  // Update terminal visibility when preview URL changes
  useEffect(() => {
    if (!previewUrl) {
      setIsTerminalVisible(true);
    }
  }, [previewUrl]);

  const [terminalWidth, setTerminalWidth] = useState(400);
  const isResizingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleTerminal = () => {
    setIsTerminalVisible((prev) => !prev);
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      const minWidth = 300;
      const maxWidth = rect.width - 400;
      setTerminalWidth(Math.max(minWidth, Math.min(newWidth, maxWidth)));
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const paneBorderRadius = 6;

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col bg-white dark:bg-neutral-950"
    >
      {previewUrl ? (
        <>
          <ElectronPreviewBrowser
            persistKey={persistKey}
            src={displayUrl}
            requestUrl={previewUrl ?? undefined}
            borderRadius={paneBorderRadius}
            terminalVisible={isTerminalVisible}
            onToggleTerminal={toggleTerminal}
            onUserNavigate={handleUserNavigate}
            renderBelowAddressBar={() =>
              isTerminalVisible &&
              baseUrl &&
              activeTerminalId &&
              !terminalTabsQuery.isLoading ? (
                <div
                  className="border-l border-neutral-200 dark:border-neutral-800 flex bg-white dark:bg-neutral-950 flex-shrink-0 relative"
                  style={{ width: `${terminalWidth}px` }}
                >
                  {/* Resize handle */}
                  <div
                    className="w-1 h-full absolute left-0 top-0 bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 cursor-ew-resize z-10"
                    onMouseDown={handleResizeStart}
                  />
                  <div className="flex-1 min-h-0 pl-1">
                    <TaskRunTerminalSession
                      baseUrl={baseUrl}
                      terminalId={activeTerminalId}
                      isActive={true}
                    />
                  </div>
                </div>
              ) : null
            }
          />
        </>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
              {selectedRun
                ? `Preview ${previewId} is not available for this run`
                : "Loading..."}
            </p>
            {selectedRun?.networking && selectedRun.networking.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                  Available ports:
                </p>
                <div className="flex justify-center gap-2">
                  {selectedRun.networking
                    .filter((s) => s.status === "running")
                    .map((service) => (
                      <span
                        key={service.port}
                        className="rounded px-2 py-1 text-xs bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
                      >
                        {service.port}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
