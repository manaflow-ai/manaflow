import { PreviewItem } from "./PreviewItem";
import {
  formatPreviewTimestamp,
  previewStatusDotClass,
  type PreviewRunGroup,
  type PreviewRunWithExtras,
} from "@/lib/previewRuns";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { ChevronRight, ExternalLink, History } from "lucide-react";
import { useMemo, useState } from "react";

type PreviewRunGroupProps = {
  group: PreviewRunGroup;
  teamSlugOrId: string;
};

export function PreviewRunGroupCard({ group, teamSlugOrId }: PreviewRunGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const historyCount = group.previous.length;
  const latest = group.latest;

  const latestTimestampLabel = useMemo(
    () =>
      formatPreviewTimestamp(
        latest.completedAt ?? latest.startedAt ?? latest.createdAt
      ),
    [latest.completedAt, latest.startedAt, latest.createdAt]
  );

  const statusClass = previewStatusDotClass(latest.status);

  return (
    <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/60 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {historyCount > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className={clsx(
                "inline-flex h-6 w-6 items-center justify-center rounded-md",
                "text-neutral-500 hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-200",
                "bg-neutral-100/80 hover:bg-neutral-200/70 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/70",
                "transition-colors"
              )}
              aria-label={
                expanded
                  ? "Hide older preview runs for this PR"
                  : "Show older preview runs for this PR"
              }
            >
              <ChevronRight
                className={clsx(
                  "h-3 w-3 transition-transform",
                  expanded && "rotate-90"
                )}
              />
            </button>
          ) : (
            <div className="w-6" aria-hidden="true" />
          )}
          <span
            className={clsx("h-2.5 w-2.5 rounded-full", statusClass)}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {latest.repoFullName} • PR #{latest.prNumber}
            </div>
            {latest.headRef ? (
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                {latest.headRef}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">
          {latestTimestampLabel && (
            <span className="whitespace-nowrap">{latestTimestampLabel}</span>
          )}
          <a
            href={latest.prUrl}
            target="_blank"
            rel="noreferrer"
            className={clsx(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1",
              "border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-300",
              "dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-100"
            )}
          >
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
            PR
          </a>
        </div>
      </div>

      <div className="border-t border-neutral-200 dark:border-neutral-800">
        <PreviewItem previewRun={latest} teamSlugOrId={teamSlugOrId} />
      </div>

      {historyCount > 0 ? (
        <div className="border-t border-neutral-200 dark:border-neutral-800 px-3 py-2">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-2 text-xs font-semibold text-neutral-700 hover:text-neutral-900 dark:text-neutral-200 dark:hover:text-neutral-50 transition-colors"
          >
            <History className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {expanded
                ? "Hide older runs"
                : `Show ${historyCount} older run${historyCount === 1 ? "" : "s"}`}
            </span>
            <ChevronRight
              className={clsx(
                "h-3 w-3 transition-transform text-neutral-500 dark:text-neutral-400",
                expanded && "rotate-90"
              )}
              aria-hidden="true"
            />
          </button>

          {expanded ? (
            <div className="mt-2 space-y-1.5">
              {group.previous.map((run) => (
                <PreviewHistoryRow
                  key={run._id}
                  run={run}
                  teamSlugOrId={teamSlugOrId}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PreviewHistoryRow({
  run,
  teamSlugOrId,
}: {
  run: PreviewRunWithExtras;
  teamSlugOrId: string;
}) {
  const timestampLabel = formatPreviewTimestamp(
    run.completedAt ?? run.startedAt ?? run.createdAt
  );
  const statusClass = previewStatusDotClass(run.status);
  const taskId = run.taskId;
  const runId = run.taskRunId;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200/80 dark:border-neutral-800/80 bg-neutral-50/80 dark:bg-neutral-800/40 px-2.5 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={clsx("h-2 w-2 rounded-full", statusClass)}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100 truncate">
            {timestampLabel ?? "Previous run"}
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
            {run.headRef || run.headSha || `PR #${run.prNumber}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {taskId && runId ? (
          <Link
            to="/$teamSlugOrId/task/$taskId"
            params={{
              teamSlugOrId,
              taskId,
            }}
            search={{ runId }}
            className={clsx(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
              "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
              "dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            )}
          >
            View run
          </Link>
        ) : null}
        <a
          href={run.prUrl}
          target="_blank"
          rel="noreferrer"
          className={clsx(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
            "border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-300",
            "dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-100"
          )}
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          PR
        </a>
      </div>
    </div>
  );
}
