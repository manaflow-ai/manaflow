import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
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
  XCircle,
} from "lucide-react";
import { useMemo, useState, type ElementType } from "react";

type TaskRunDoc = Doc<"taskRuns">;
type RunStatus = TaskRunDoc["status"];

const EMPTY_CHILDREN: TaskRunDoc[] = [];

const STATUS_CONFIG: Record<
  RunStatus,
  { icon: ElementType; badge: string; iconClass: string; label: string; spin?: boolean }
> = {
  pending: {
    icon: Clock,
    badge:
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-300",
    iconClass: "text-neutral-500",
    label: "Pending",
  },
  running: {
    icon: Loader2,
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    iconClass: "text-blue-500",
    label: "Running",
    spin: true,
  },
  completed: {
    icon: CheckCircle2,
    badge:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    iconClass: "text-green-500",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    iconClass: "text-red-500",
    label: "Failed",
  },
  skipped: {
    icon: Pause,
    badge:
      "bg-neutral-100 text-neutral-700 dark:bg-neutral-900/30 dark:text-neutral-300",
    iconClass: "text-neutral-400",
    label: "Skipped",
  },
};

function resolveRunLabel(run: Pick<TaskRunDoc, "agentName" | "summary">): string {
  const fromAgent = run.agentName?.trim();
  if (fromAgent) return fromAgent;

  const fromSummary = run.summary?.trim();
  if (fromSummary) return fromSummary;

  return "Task run";
}

function StatusBadge({ status }: { status: RunStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        config.badge,
      )}
      aria-label={config.label}
      title={config.label}
    >
      <Icon
        className={cn("size-3", config.iconClass, config.spin && "animate-spin")}
        aria-hidden
      />
      <span className="leading-none">{config.label}</span>
    </span>
  );
}

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface RunTreeNodeProps {
  teamSlugOrId: string;
  run: TaskRunDoc;
  depth: number;
  defaultExpandedDepth: number;
  ancestors: Array<Id<"taskRuns">>;
}

function RunTreeNode({
  teamSlugOrId,
  run,
  depth,
  defaultExpandedDepth,
  ancestors,
}: RunTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < defaultExpandedDepth);

  const childrenQuery = useQuery(api.taskRuns.listChildRuns, {
    teamSlugOrId,
    parentRunId: run._id,
  });

  const isLoading = childrenQuery === undefined;
  const children = childrenQuery ?? EMPTY_CHILDREN;

  const nextAncestors = useMemo(
    () => [...ancestors, run._id],
    [ancestors, run._id],
  );

  const { sortedChildren, circularChildIds } = useMemo(() => {
    const circular = new Set<Id<"taskRuns">>();
    const filtered: TaskRunDoc[] = [];

    for (const child of children) {
      if (nextAncestors.includes(child._id)) {
        circular.add(child._id);
        continue;
      }
      filtered.push(child);
    }

    filtered.sort((a, b) => a.createdAt - b.createdAt);

    return {
      sortedChildren: filtered,
      circularChildIds: circular,
    };
  }, [children, nextAncestors]);

  const hasChildren = sortedChildren.length > 0 || circularChildIds.size > 0;
  const indentPx = depth * 14;

  return (
    <div className="space-y-1">
      <div
        className="flex min-w-0 items-center gap-2 rounded-md border border-neutral-200 bg-white/80 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-950/40"
        style={{ marginLeft: indentPx }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-900"
            aria-label={isExpanded ? "Collapse children" : "Expand children"}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((prev) => !prev)}
          >
            {isExpanded ? (
              <ChevronDown className="size-4 text-neutral-500" aria-hidden />
            ) : (
              <ChevronRight className="size-4 text-neutral-500" aria-hidden />
            )}
          </button>
        ) : (
          <div className="size-6" aria-hidden />
        )}

        <StatusBadge status={run.status} />

        <Link
          to="/$teamSlugOrId/task/$taskId"
          params={{ teamSlugOrId, taskId: run.taskId }}
          search={{ runId: run._id }}
          className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-neutral-800 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white"
        >
          <span className="truncate">{resolveRunLabel(run)}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </Link>

        <span className="ml-auto shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
          {formatTime(run.createdAt)}
        </span>
      </div>

      {isLoading && isExpanded ? (
        <div style={{ marginLeft: indentPx + 14 }}>
          <Skeleton className="h-9 w-full" />
        </div>
      ) : null}

      {hasChildren && isExpanded ? (
        <div
          className="border-l border-neutral-200 pl-3 dark:border-neutral-800"
          style={{ marginLeft: indentPx + 14 }}
        >
          {sortedChildren.map((child) => (
            <RunTreeNode
              key={child._id}
              teamSlugOrId={teamSlugOrId}
              run={child}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
              ancestors={nextAncestors}
            />
          ))}
          {circularChildIds.size > 0 ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Circular parent-child relationship detected; some nodes were hidden
              to prevent an infinite loop.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface TeamStatusDashboardProps {
  teamSlugOrId: string;
  rootRunId: Id<"taskRuns">;
  title?: string;
  className?: string;
  defaultExpandedDepth?: number;
}

export function TeamStatusDashboard({
  teamSlugOrId,
  rootRunId,
  title = "Team Status",
  className,
  defaultExpandedDepth = 1,
}: TeamStatusDashboardProps) {
  const rootRun = useQuery(api.taskRuns.get, { teamSlugOrId, id: rootRunId });

  if (rootRun === undefined) {
    return (
      <Card
        className={cn(
          "border-neutral-200/80 bg-white/95 shadow-sm dark:border-neutral-800/70 dark:bg-neutral-900/60",
          className,
        )}
      >
        <CardHeader className="px-4 py-3">
          <Skeleton className="h-4 w-44" />
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4 pt-0">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-5/6" />
        </CardContent>
      </Card>
    );
  }

  if (rootRun === null) {
    return (
      <Card
        className={cn(
          "border-neutral-200/80 bg-white/95 shadow-sm dark:border-neutral-800/70 dark:bg-neutral-900/60",
          className,
        )}
      >
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Task run not found.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "border-neutral-200/80 bg-white/95 shadow-sm dark:border-neutral-800/70 dark:bg-neutral-900/60",
        className,
      )}
    >
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 pt-0">
        <RunTreeNode
          teamSlugOrId={teamSlugOrId}
          run={rootRun}
          depth={0}
          defaultExpandedDepth={defaultExpandedDepth}
          ancestors={[]}
        />
      </CardContent>
    </Card>
  );
}
