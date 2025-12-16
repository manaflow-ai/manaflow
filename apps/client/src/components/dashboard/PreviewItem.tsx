import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useArchiveTask } from "@/hooks/useArchiveTask";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { useClipboard } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import {
  Archive,
  Check,
  Copy,
  ExternalLink,
  GitPullRequest,
} from "lucide-react";
import { memo, useCallback } from "react";

type PreviewRunWithConfig = Doc<"previewRuns"> & {
  configRepoFullName?: string;
  taskId?: Id<"tasks">;
};

interface PreviewItemProps {
  previewRun: PreviewRunWithConfig;
  teamSlugOrId: string;
}

export const PreviewItem = memo(function PreviewItem({
  previewRun,
  teamSlugOrId,
}: PreviewItemProps) {
  const clipboard = useClipboard({ timeout: 2000 });
  const { archive } = useArchiveTask(teamSlugOrId);

  // Determine if this is a "completed" status (filled green circle) or "in progress" (empty circle)
  // "completed" and "skipped" show as green (done), "failed" shows as red
  const isCompleted = previewRun.status === "completed" || previewRun.status === "skipped";
  const isFailed = previewRun.status === "failed";

  // Generate a display title from PR info
  const displayTitle = `PR #${previewRun.prNumber}`;
  const repoName = previewRun.repoFullName.split("/")[1] || previewRun.repoFullName;

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      clipboard.copy(previewRun.prUrl);
    },
    [clipboard, previewRun.prUrl]
  );

  const handleOpenPR = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.open(previewRun.prUrl, "_blank", "noopener,noreferrer");
    },
    [previewRun.prUrl]
  );

  const handleArchive = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (previewRun.taskId) {
        archive(previewRun.taskId);
      }
    },
    [archive, previewRun.taskId]
  );

  // Format the timestamp
  const formatTime = (timestamp: number | undefined) => {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    const today = new Date();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    return isToday
      ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const timestamp = previewRun.completedAt || previewRun.startedAt || previewRun.createdAt;

  const rowContent = (
    <>
      <div className="flex items-center justify-center pl-1 -mr-2 relative">
        {/* Placeholder for future selection checkbox */}
      </div>
      <div className="flex items-center justify-center">
        <div
          className={clsx(
            "rounded-full flex-shrink-0",
            isCompleted
              ? "w-[8px] h-[8px] border border-transparent bg-green-500"
              : isFailed
                ? "w-[8px] h-[8px] border border-transparent bg-red-500"
                : "w-[9.5px] h-[9.5px] border border-neutral-400 dark:border-neutral-500 bg-transparent"
          )}
        />
      </div>
      <div className="min-w-0 flex items-center gap-2">
        <GitPullRequest className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
        <span className="text-[13px] font-medium truncate min-w-0 pr-1">
          {displayTitle}
        </span>
        {previewRun.headRef && (
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">
            {previewRun.headRef}
          </span>
        )}
      </div>
      <div className="text-[11px] text-neutral-400 dark:text-neutral-500 min-w-0 text-right flex items-center justify-end gap-2">
        <span className="truncate">{repoName}</span>
      </div>
      <div className="text-[11px] text-neutral-400 dark:text-neutral-500 flex-shrink-0 tabular-nums text-right">
        {formatTime(timestamp)}
      </div>
    </>
  );

  const rowClassName = clsx(
    "relative grid w-full items-center py-2 pr-3 cursor-default select-none group",
    "grid-cols-[24px_36px_1fr_minmax(120px,auto)_58px]",
    "bg-white dark:bg-neutral-900/50 group-hover:bg-neutral-50/90 dark:group-hover:bg-neutral-600/60"
  );

  return (
    <div className="relative group w-full">
      {previewRun.taskId ? (
        <Link
          to="/$teamSlugOrId/task/$taskId"
          params={{
            teamSlugOrId,
            taskId: previewRun.taskId,
          }}
          search={{ runId: previewRun.taskRunId }}
          className={rowClassName}
        >
          {rowContent}
        </Link>
      ) : (
        <div className={rowClassName}>
          {rowContent}
        </div>
      )}
      <div className="right-2 top-0 bottom-0 absolute py-2 group">
        <div className="flex gap-1">
          {/* Copy PR URL button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopy}
                className={clsx(
                  "p-1 rounded",
                  "bg-neutral-100 dark:bg-neutral-700",
                  "text-neutral-600 dark:text-neutral-400",
                  "hover:bg-neutral-200 dark:hover:bg-neutral-600",
                  "group-hover:opacity-100 opacity-0"
                )}
                title="Copy PR URL"
              >
                {clipboard.copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {clipboard.copied ? "Copied!" : "Copy PR URL"}
            </TooltipContent>
          </Tooltip>

          {/* Open PR button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleOpenPR}
                className={clsx(
                  "p-1 rounded",
                  "bg-neutral-100 dark:bg-neutral-700",
                  "text-neutral-600 dark:text-neutral-400",
                  "hover:bg-neutral-200 dark:hover:bg-neutral-600",
                  "group-hover:opacity-100 opacity-0"
                )}
                title="Open PR"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Open PR</TooltipContent>
          </Tooltip>

          {/* Archive button - only show if there's a linked task */}
          {previewRun.taskId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleArchive}
                  className={clsx(
                    "p-1 rounded",
                    "bg-neutral-100 dark:bg-neutral-700",
                    "text-neutral-600 dark:text-neutral-400",
                    "hover:bg-neutral-200 dark:hover:bg-neutral-600",
                    "group-hover:opacity-100 opacity-0"
                  )}
                  title="Archive"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Archive</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
});
