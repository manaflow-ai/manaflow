import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery as useConvexQuery } from "convex/react";
import { useMemo } from "react";
import z from "zod";
import {
  TerminalSessionsPanel,
  type TerminalBackendStatus,
} from "@/components/TerminalSessionsPanel";
import { toMorphXtermBaseUrl } from "@/lib/toProxyWorkspaceUrl";
import {
  createTerminalTab,
  terminalTabsQueryKey,
  terminalTabsQueryOptions,
  type TerminalTabId,
} from "@/queries/terminals";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminals"
)({
  component: TaskRunTerminals,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
  loader: async (opts) => {
    const { params, context } = opts;
    const { teamSlugOrId, runId } = params;
    const { queryClient } = context;

    convexQueryClient.convexClient.prewarmQuery({
      query: api.taskRuns.get,
      args: { teamSlugOrId, id: runId },
    });

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

      try {
        const created = await createTerminalTab({
          baseUrl,
          request: {},
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

function TaskRunTerminals() {
  const { runId: taskRunId, teamSlugOrId } = Route.useParams();
  const taskRun = useConvexQuery(api.taskRuns.get, {
    teamSlugOrId,
    id: taskRunId,
  });

  const vscodeInfo = taskRun?.vscode;
  const rawMorphUrl = vscodeInfo?.url ?? vscodeInfo?.workspaceUrl ?? null;
  const isMorphProvider = vscodeInfo?.provider === "morph";

  const xtermBaseUrl = useMemo(() => {
    if (!rawMorphUrl) {
      return null;
    }
    return toMorphXtermBaseUrl(rawMorphUrl);
  }, [rawMorphUrl]);

  const terminalStatus: TerminalBackendStatus = !isMorphProvider
    ? "unsupported"
    : xtermBaseUrl
      ? "available"
      : "pending";

  const pendingMessage = isMorphProvider
    ? "Waiting for Cloud workspace to expose the terminal backend..."
    : undefined;

  return (
    <div className="flex flex-col grow bg-neutral-50 dark:bg-black">
      <div className="flex flex-col grow min-h-0 border-l border-neutral-200 dark:border-neutral-800">
        <TerminalSessionsPanel
          baseUrl={xtermBaseUrl}
          contextKey={taskRunId}
          status={terminalStatus}
          pendingMessage={pendingMessage}
          unsupportedMessage="Terminals are only available for Cloud-based runs."
          className="flex-1"
        />
      </div>
    </div>
  );
}
