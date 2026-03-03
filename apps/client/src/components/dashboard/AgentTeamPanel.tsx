import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Pause,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState, type ElementType } from "react";

interface AgentTeamPanelProps {
  teamSlugOrId: string;
  parentRunId: Id<"taskRuns">;
}

type ChildRun = NonNullable<typeof api.taskRuns.listChildRuns._returnType>[number];
type RunStatus = ChildRun["status"];

const STATUS_CONFIG: Record<
  RunStatus,
  {
    icon: ElementType;
    color: string;
    badge: string;
    label: string;
    spin?: boolean;
  }
> = {
  pending: {
    icon: Clock,
    color: "text-neutral-500",
    badge:
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-300",
    label: "Pending",
  },
  running: {
    icon: Loader2,
    color: "text-blue-500",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    label: "Running",
    spin: true,
  },
  completed: {
    icon: CheckCircle2,
    color: "text-green-500",
    badge:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    color: "text-red-500",
    badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    label: "Failed",
  },
  skipped: {
    icon: Pause,
    color: "text-neutral-400",
    badge:
      "bg-neutral-100 text-neutral-700 dark:bg-neutral-900/30 dark:text-neutral-300",
    label: "Skipped",
  },
};

function resolveAgentName(
  run: Pick<ChildRun, "agentName" | "summary">,
): string {
  const fromRun = run.agentName?.trim();
  if (fromRun && fromRun.length > 0) {
    return fromRun;
  }

  const fromSummary = run.summary?.trim();
  if (fromSummary && fromSummary.length > 0) {
    return fromSummary;
  }

  return "unknown agent";
}

function getPullRequestLinks(
  child: ChildRun,
): Array<{ url: string; label: string }> {
  const links = new Map<string, { url: string; label: string }>();

  for (const pr of child.pullRequests ?? []) {
    const url = pr.url?.trim();
    if (!url || url === "pending") {
      continue;
    }

    const repo = pr.repoFullName?.trim();
    const label = repo
      ? pr.number
        ? `${repo} #${pr.number}`
        : repo
      : "Pull request";
    links.set(url, { url, label });
  }

  const fallbackUrl = child.pullRequestUrl?.trim();
  if (fallbackUrl && fallbackUrl !== "pending" && !links.has(fallbackUrl)) {
    links.set(fallbackUrl, { url: fallbackUrl, label: "Pull request" });
  }

  return Array.from(links.values());
}

function StatusBadge({ status, count }: { status: RunStatus; count?: number }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        config.badge,
      )}
    >
      <Icon
        className={cn("size-3", config.color, config.spin && "animate-spin")}
      />
      <span>
        {count === undefined ? config.label : `${count} ${config.label}`}
      </span>
    </span>
  );
}

export function AgentTeamPanel({
  teamSlugOrId,
  parentRunId,
}: AgentTeamPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const status = useQuery(api.taskRuns.getChildRunsStatus, {
    teamSlugOrId,
    parentRunId,
  });
  const children = useQuery(api.taskRuns.listChildRuns, {
    teamSlugOrId,
    parentRunId,
  });

  const isLoading = status === undefined || children === undefined;
  // null means parent run not found or unauthorized
  const isNotFound = status === null || children === null;

  const sortedChildren = useMemo(
    () =>
      children ? [...children].sort((a, b) => a.createdAt - b.createdAt) : [],
    [children],
  );

  const counts = {
    pending: status?.statusCounts.pending ?? 0,
    running: status?.statusCounts.running ?? 0,
    completed: status?.statusCounts.completed ?? 0,
    failed: status?.statusCounts.failed ?? 0,
    skipped: status?.statusCounts.skipped ?? 0,
  };

  const total = status?.total ?? sortedChildren.length;
  const terminalCount = counts.completed + counts.failed + counts.skipped;
  const progressPercent =
    total > 0
      ? Math.max(0, Math.min(100, Math.round((terminalCount / total) * 100)))
      : 0;

  const collectedPullRequests = useMemo(() => {
    const links = new Map<string, { url: string; label: string }>();

    for (const child of sortedChildren) {
      for (const link of getPullRequestLinks(child)) {
        if (!links.has(link.url)) {
          links.set(link.url, link);
        }
      }
    }

    return Array.from(links.values());
  }, [sortedChildren]);

  // Parent run not found or unauthorized - hide panel entirely
  if (isNotFound) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className="border-neutral-200/80 bg-white/95 shadow-sm dark:border-neutral-800/70 dark:bg-neutral-900/60">
        <CardHeader className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-4" />
          </div>
          <Skeleton className="mt-3 h-1.5 w-full" />
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!children || children.length === 0) {
    return (
      <Card className="border-neutral-200/80 bg-white/95 shadow-sm dark:border-neutral-800/70 dark:bg-neutral-900/60">
        <CardHeader className="px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <Users className="size-4 text-neutral-500" />
            Agent Team
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No child runs yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const showProgress = total > 0 && !status?.allComplete;
  const progressColorClass = status?.allComplete
    ? status.anyFailed
      ? "bg-amber-500"
      : "bg-green-500"
    : "bg-blue-500";

  return (
    <Card className="border-neutral-200/80 bg-white/95 shadow-sm dark:border-neutral-800/70 dark:bg-neutral-900/60">
      <CardHeader className="px-4 py-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
        >
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              <Users className="size-4 text-neutral-500" />
              Agent Team ({terminalCount}/{total} finished)
            </CardTitle>
          </div>
          {isExpanded ? (
            <ChevronDown className="size-4 shrink-0 text-neutral-500" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-neutral-500" />
          )}
        </button>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status="completed" count={counts.completed} />
          <StatusBadge status="failed" count={counts.failed} />
          <StatusBadge status="running" count={counts.running} />
          <StatusBadge status="pending" count={counts.pending} />
          {counts.skipped > 0 ? (
            <StatusBadge status="skipped" count={counts.skipped} />
          ) : null}
        </div>

        {showProgress ? (
          <div className="mt-2.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
              <span>Team progress</span>
              <span>
                {progressPercent}% ({terminalCount}/{total})
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  progressColorClass,
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </CardHeader>

      {isExpanded ? (
        <CardContent className="space-y-2 px-4 pb-4 pt-0">
          {sortedChildren.map((child) => {
            const prLinks = getPullRequestLinks(child);

            return (
              <div
                key={child._id}
                className="rounded-md border border-neutral-200 bg-white/80 p-2.5 dark:border-neutral-800 dark:bg-neutral-950/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={child.status} />
                  <Link
                    to="/$teamSlugOrId/task/$taskId"
                    params={{ teamSlugOrId, taskId: child.taskId }}
                    search={{ runId: child._id }}
                    className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-neutral-800 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white"
                  >
                    <span className="truncate">{resolveAgentName(child)}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </Link>
                  <span className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-400">
                    {new Date(child.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {prLinks.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {prLinks.map((pr) => (
                      <a
                        key={pr.url}
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {pr.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {collectedPullRequests.length > 0 ? (
            <div className="border-t border-neutral-200 pt-2 dark:border-neutral-800">
              <p className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                Collected PRs ({collectedPullRequests.length})
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {collectedPullRequests.map((pr) => (
                  <a
                    key={pr.url}
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/45"
                  >
                    <span className="truncate max-w-48">{pr.label}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
