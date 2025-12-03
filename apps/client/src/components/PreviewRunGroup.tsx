import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

import { TaskTree } from "@/components/TaskTree";
import { Button } from "@/components/ui/button";
import type { PreviewTaskGroup } from "@/lib/preview-task-groups";

type Props = {
  group: PreviewTaskGroup;
  teamSlugOrId: string;
  expandTaskIds?: string[] | null;
  variant?: "page" | "sidebar";
};

export function PreviewRunGroup({
  group,
  teamSlugOrId,
  expandTaskIds,
  variant = "page",
}: Props) {
  const [showHistory, setShowHistory] = useState(false);
  const isSidebar = variant === "sidebar";
  const hasHistory = group.previous.length > 0;
  const primaryExpanded =
    expandTaskIds?.includes(group.latest._id) ?? false;
  const historyId = useMemo(
    () => `preview-history-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    [group.key]
  );

  const statusLabel = group.latest.isCompleted
    ? "Latest capture"
    : "Running";
  const statusDot = group.latest.isCompleted
    ? "bg-emerald-400"
    : "bg-amber-400 animate-pulse";

  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200/70 bg-white/70 shadow-sm transition-colors dark:border-neutral-800/70 dark:bg-neutral-900/60",
        isSidebar &&
          "border-neutral-200/40 bg-transparent shadow-none dark:border-neutral-800/50"
      )}
    >
      <div
        className={clsx(
          "flex items-center justify-between gap-3 px-4 pt-3 pb-2",
          isSidebar && "px-2 pt-2 pb-1"
        )}
      >
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
            Preview {group.prNumber ? `PR #${group.prNumber}` : "run"}
          </p>
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {group.repoFullName ?? group.label}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-medium text-neutral-700 ring-1 ring-neutral-200/60 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700/60">
          <span
            className={clsx("h-2 w-2 rounded-full", statusDot)}
            aria-hidden
          />
          {statusLabel}
        </span>
      </div>

      <div className={clsx("px-1 pb-2", isSidebar && "px-1 pb-1")}>
        <div
          className={clsx(
            "rounded-lg border border-neutral-200/80 bg-gradient-to-br from-white via-white to-neutral-50 dark:border-neutral-800/60 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950",
            isSidebar &&
              "bg-white/50 dark:bg-neutral-950/40 dark:border-neutral-800/40"
          )}
        >
          <TaskTree
            task={group.latest}
            defaultExpanded={primaryExpanded}
            teamSlugOrId={teamSlugOrId}
          />
        </div>
      </div>

      {hasHistory ? (
        <div className={clsx("px-3 pb-3", isSidebar && "px-2 pb-2")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-neutral-700 hover:bg-neutral-100/80 dark:text-neutral-200 dark:hover:bg-neutral-800/70"
            onClick={() => setShowHistory((value) => !value)}
            aria-expanded={showHistory}
            aria-controls={historyId}
          >
            <ChevronDown
              className={clsx(
                "h-4 w-4 transition-transform",
                showHistory && "rotate-180"
              )}
            />
            {showHistory
              ? "Hide previous runs"
              : `Show ${group.previous.length} previous run${
                  group.previous.length > 1 ? "s" : ""
                }`}
          </Button>
          {showHistory ? (
            <div id={historyId} className="mt-2 space-y-1">
              {group.previous.map((task) => (
                <div
                  key={task._id}
                  className="rounded-lg border border-dashed border-neutral-200/70 bg-white/60 px-1 pb-1 pt-1.5 dark:border-neutral-800/60 dark:bg-neutral-950/30"
                >
                  <TaskTree
                    task={task}
                    defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                    teamSlugOrId={teamSlugOrId}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
