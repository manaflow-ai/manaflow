import { api } from "@cmux/convex/api";
import { useQuery as useConvexQuery } from "convex/react";
import {
  ExternalLink,
  X,
  Check,
  Circle,
  Clock,
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useMemo } from "react";

type WorkflowRunsProps = {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  headSha?: string;
};

type CombinedRun = ReturnType<typeof useCombinedWorkflowData>["allRuns"][number];

function useCombinedWorkflowData({
  teamSlugOrId,
  repoFullName,
  prNumber,
  headSha,
}: WorkflowRunsProps) {
  const workflowRuns = useConvexQuery(api.github_workflows.getWorkflowRunsForPr, {
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
    limit: 50,
  });

  const checkRuns = useConvexQuery(api.github_check_runs.getCheckRunsForPr, {
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
    limit: 50,
  });

  const deployments = useConvexQuery(api.github_deployments.getDeploymentsForPr, {
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
    limit: 50,
  });

  const commitStatuses = useConvexQuery(
    api.github_commit_statuses.getCommitStatusesForPr,
    {
      teamSlugOrId,
      repoFullName,
      prNumber,
      headSha,
      limit: 50,
    },
  );

  const isLoading =
    workflowRuns === undefined ||
    checkRuns === undefined ||
    deployments === undefined ||
    commitStatuses === undefined;

  const allRuns = useMemo(
    () => [
      ...(workflowRuns || []).map((run) => ({
        ...run,
        type: "workflow",
        name: run.workflowName,
        timestamp: run.runStartedAt,
        url: run.htmlUrl,
      })),
      ...(checkRuns || []).map((run) => {
        const url =
          run.htmlUrl ||
          `https://github.com/${repoFullName}/pull/${prNumber}/checks?check_run_id=${run.checkRunId}`;
        return { ...run, type: "check", timestamp: run.startedAt, url };
      }),
      ...(deployments || [])
        .filter((dep) => dep.environment !== "Preview")
        .map((dep) => ({
          ...dep,
          type: "deployment",
          name: dep.description || dep.environment || "Deployment",
          timestamp: dep.createdAt,
          status:
            dep.state === "pending" ||
            dep.state === "queued" ||
            dep.state === "in_progress"
              ? "in_progress"
              : "completed",
          conclusion:
            dep.state === "success"
              ? "success"
              : dep.state === "failure" || dep.state === "error"
                ? "failure"
                : undefined,
          url: dep.targetUrl,
        })),
      ...(commitStatuses || []).map((status) => ({
        ...status,
        type: "status",
        name: status.context,
        timestamp: status.updatedAt,
        status: status.state === "pending" ? "in_progress" : "completed",
        conclusion:
          status.state === "success"
            ? "success"
            : status.state === "failure" || status.state === "error"
              ? "failure"
              : undefined,
        url: status.targetUrl,
      })),
    ],
    [workflowRuns, checkRuns, deployments, commitStatuses, repoFullName, prNumber],
  );

  return { allRuns, isLoading };
}

function WorkflowRunsBadge({
  allRuns,
  isLoading,
}: {
  allRuns: CombinedRun[];
  isLoading: boolean;
}) {
  if (isLoading || allRuns.length === 0) {
    return null;
  }

  const hasAnyRunning = allRuns.some(
    (run) =>
      run.status === "in_progress" ||
      run.status === "queued" ||
      run.status === "waiting" ||
      run.status === "pending",
  );
  const hasAnyFailure = allRuns.some(
    (run) =>
      run.conclusion === "failure" ||
      run.conclusion === "timed_out" ||
      run.conclusion === "action_required",
  );
  const allPassed =
    allRuns.length > 0 &&
    allRuns.every(
      (run) =>
        run.conclusion === "success" ||
        run.conclusion === "neutral" ||
        run.conclusion === "skipped",
    );

  const { icon, colorClass, statusText } = hasAnyRunning
    ? {
        icon: <Clock className="w-[10px] h-[10px] animate-pulse" />,
        colorClass: "text-yellow-600 dark:text-yellow-400",
        statusText: "Running",
      }
    : hasAnyFailure
      ? {
          icon: <X className="w-[10px] h-[10px]" />,
          colorClass: "text-red-600 dark:text-red-400",
          statusText: "Failed",
        }
      : allPassed
        ? {
            icon: <Check className="w-[10px] h-[10px]" />,
            colorClass: "text-green-600 dark:text-green-400",
            statusText: "Passed",
          }
        : {
            icon: <Circle className="w-[10px] h-[10px]" />,
            colorClass: "text-neutral-500 dark:text-neutral-400",
            statusText: "Checks",
          };

  return (
    <div className={`flex items-center gap-1 ml-2 shrink-0 ${colorClass}`}>
      {icon}
      <span className="text-[9px] font-medium select-none">{statusText}</span>
    </div>
  );
}

export function WorkflowRunsSection({
  allRuns,
  isLoading,
  isExpanded,
  onToggle,
}: {
  allRuns: CombinedRun[];
  isLoading: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const sortedRuns = useMemo(
    () =>
      allRuns.slice().sort((a, b) => {
        const getStatusPriority = (run: typeof a) => {
          if (
            run.conclusion === "failure" ||
            run.conclusion === "timed_out" ||
            run.conclusion === "action_required"
          )
            return 0;
          if (
            run.status === "in_progress" ||
            run.status === "queued" ||
            run.status === "waiting" ||
            run.status === "pending"
          )
            return 1;
          if (
            run.conclusion === "success" ||
            run.conclusion === "neutral" ||
            run.conclusion === "skipped"
          )
            return 2;
          if (run.conclusion === "cancelled") return 3;
          return 4;
        };

        const priorityA = getStatusPriority(a);
        const priorityB = getStatusPriority(b);

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return (b.timestamp ?? 0) - (a.timestamp ?? 0);
      }),
    [allRuns],
  );

  const runningRuns = sortedRuns.filter(
    (run) =>
      run.status === "in_progress" ||
      run.status === "queued" ||
      run.status === "waiting" ||
      run.status === "pending",
  );
  const hasAnyRunning = runningRuns.length > 0;
  const failedRuns = sortedRuns.filter(
    (run) =>
      run.conclusion === "failure" ||
      run.conclusion === "timed_out" ||
      run.conclusion === "action_required",
  );
  const hasAnyFailure = failedRuns.length > 0;
  const passedRuns = sortedRuns.filter(
    (run) =>
      run.conclusion === "success" ||
      run.conclusion === "neutral" ||
      run.conclusion === "skipped",
  );
  const allPassed = sortedRuns.length > 0 && passedRuns.length === sortedRuns.length;

  if (isLoading) {
    return (
      <div>
        <div className="w-full flex items-center pl-3 pr-2.5 py-1.5 border-y border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
          <div className="flex items-center" style={{ width: "20px" }}>
            <div className="w-3.5 h-3.5 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse" />
          </div>
          <div className="flex items-center" style={{ width: "20px" }}>
            <div className="w-3 h-3 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse" />
          </div>
          <div className="h-3 w-24 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (allRuns.length === 0) {
    return null;
  }

  const { summaryIcon, summaryText, summaryColorClass } = hasAnyRunning
    ? {
        summaryIcon: <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />,
        summaryText: (() => {
          const parts: string[] = [];
          if (passedRuns.length > 0) {
            parts.push(`${passedRuns.length} passed`);
          }
          if (failedRuns.length > 0) {
            parts.push(`${failedRuns.length} failed`);
          }
          parts.push(`${runningRuns.length} running`);
          return parts.join(", ");
        })(),
        summaryColorClass: "text-yellow-600 dark:text-yellow-500",
      }
    : hasAnyFailure
      ? {
          summaryIcon: <X className="w-3 h-3" strokeWidth={2} />,
          summaryText: `${failedRuns.length} ${failedRuns.length === 1 ? "check" : "checks"} failed`,
          summaryColorClass: "text-red-600 dark:text-red-500",
        }
      : allPassed
        ? {
            summaryIcon: <Check className="w-3 h-3" strokeWidth={2} />,
            summaryText: "All checks passed",
            summaryColorClass: "text-green-600 dark:text-green-500",
          }
        : {
            summaryIcon: <Circle className="w-3 h-3" strokeWidth={2} />,
            summaryText: `${sortedRuns.length} ${sortedRuns.length === 1 ? "check" : "checks"}`,
            summaryColorClass: "text-neutral-500 dark:text-neutral-400",
          };

  const getStatusIcon = (status?: string, conclusion?: string) => {
    if (conclusion === "success") {
      return (
        <Check
          className="w-3 h-3 text-green-600 dark:text-green-400"
          strokeWidth={2}
        />
      );
    }
    if (conclusion === "failure") {
      return (
        <X className="w-3 h-3 text-red-600 dark:text-red-400" strokeWidth={2} />
      );
    }
    if (conclusion === "cancelled") {
      return (
        <Circle
          className="w-3 h-3 text-neutral-500 dark:text-neutral-400"
          strokeWidth={2}
        />
      );
    }
    if (status === "in_progress" || status === "queued") {
      return (
        <Loader2
          className="w-3 h-3 text-yellow-600 dark:text-yellow-500 animate-spin"
          strokeWidth={2}
        />
      );
    }
    return (
      <AlertCircle
        className="w-3 h-3 text-neutral-500 dark:text-neutral-400"
        strokeWidth={2}
      />
    );
  };

  const formatTimeAgo = (timestamp?: number) => {
    if (!timestamp) return "";
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const getStatusDescription = (run: (typeof allRuns)[0]) => {
    const parts: string[] = [];

    if (run.conclusion === "success") {
      if (run.type === "workflow" && "runDuration" in run && run.runDuration) {
        const mins = Math.floor(run.runDuration / 60);
        const secs = run.runDuration % 60;
        parts.push(`Successful in ${mins}m ${secs}s`);
      } else {
        parts.push("Successful");
      }
    } else if (run.conclusion === "failure") {
      parts.push("Failed");
    } else if (run.conclusion === "cancelled") {
      parts.push("Cancelled");
    } else if (run.conclusion === "skipped") {
      parts.push("Skipped");
    } else if (run.conclusion === "timed_out") {
      parts.push("Timed out");
    } else if (run.conclusion === "action_required") {
      parts.push("Action required");
    } else if (run.conclusion === "neutral") {
      parts.push("Neutral");
    } else if (run.status === "in_progress") {
      parts.push("In progress");
    } else if (run.status === "queued") {
      parts.push("Queued");
    } else if (run.status === "waiting") {
      parts.push("Waiting");
    } else if (run.status === "pending") {
      parts.push("Pending");
    }

    const timeAgo = formatTimeAgo(run.timestamp);
    if (timeAgo) {
      parts.push(timeAgo);
    }

    return parts.join(" — ");
  };

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center pl-3 pr-2.5 py-1.5 border-y border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors group"
      >
        <div className="flex items-center" style={{ width: "20px" }}>
          <div className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-600 dark:group-hover:text-neutral-400">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </div>
        </div>
        <div className="flex items-center" style={{ width: "20px" }}>
          <div className={`${summaryColorClass}`}>{summaryIcon}</div>
        </div>
        <span className={`text-[11px] font-semibold ${summaryColorClass}`}>
          {summaryText}
        </span>
      </button>
      {isExpanded && (
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border-b border-neutral-200 dark:border-neutral-800">
          {sortedRuns.map((run) => {
            const appLabel =
              run.type === "check" && "appSlug" in run && run.appSlug
                ? `[${run.appSlug}]`
                : run.type === "check" && "appName" in run && run.appName
                  ? `[${run.appName}]`
                  : run.type === "deployment"
                    ? "[deployment]"
                    : run.type === "status"
                      ? "[status]"
                      : null;

            return (
              <a
                key={`${run.type}-${run._id}`}
                href={run.url || "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 pl-8 pr-3 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors group"
              >
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <div className="shrink-0">
                    {getStatusIcon(run.status, run.conclusion)}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <div className="text-[11px] text-neutral-900 dark:text-neutral-100 font-normal truncate">
                      {run.name}
                    </div>
                    {appLabel && (
                      <span className="text-[10px] text-neutral-500 dark:text-neutral-500 shrink-0">
                        {appLabel}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-600 dark:text-neutral-400 shrink-0">
                    {getStatusDescription(run)}
                  </div>
                </div>
                {run.url && (
                  <div className="p-1 shrink-0">
                    <ExternalLink className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-400" />
                  </div>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { useCombinedWorkflowData, WorkflowRunsBadge };
export type { CombinedRun };
