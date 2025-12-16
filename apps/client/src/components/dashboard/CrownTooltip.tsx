import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isFakeConvexId } from "@/lib/fakeConvexId";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
// Read team slug from path to avoid route type coupling
import { AlertCircle, Crown, Loader2 } from "lucide-react";

interface CrownStatusProps {
  taskId: Id<"tasks">;
  teamSlugOrId: string;
}

export function CrownStatus({ taskId, teamSlugOrId }: CrownStatusProps) {
  // Get task runs
  const taskRuns = useQuery(
    api.taskRuns.getByTask,
    isFakeConvexId(taskId) ? "skip" : { teamSlugOrId, taskId }
  );

  // Get task with error status
  const task = useQuery(
    api.tasks.getById,
    isFakeConvexId(taskId) ? "skip" : { teamSlugOrId, id: taskId }
  );

  // Get crown evaluation
  const crownedRun = useQuery(
    api.crown.getCrownedRun,
    isFakeConvexId(taskId) ? "skip" : { teamSlugOrId, taskId }
  );

  const crownStatus = task?.crownEvaluationStatus ?? null;
  const isCrownEvaluating = task?.crownEvaluationStatus === "in_progress";
  const rawCrownErrorMessage = task?.crownEvaluationError ?? null;
  const crownErrorMessage =
    rawCrownErrorMessage === "pending_evaluation" ||
    rawCrownErrorMessage === "in_progress"
      ? null
      : rawCrownErrorMessage;

  const isLoadingRuns = taskRuns === undefined;
  const isLoadingCrownedRun = crownedRun === undefined;
  const runCount = taskRuns?.length ?? 0;
  const hasMultipleRuns = runCount >= 2;
  const completedRuns = taskRuns?.filter((run) => run.status === "completed") ?? [];
  const allCompleted =
    !!taskRuns &&
    taskRuns.every((run) => run.status === "completed" || run.status === "failed");

  const resolvedCrownedRun = crownedRun ?? null;
  const displayState = (() => {
    if (isCrownEvaluating) {
      return "evaluating" as const;
    }

    if (
      !hasMultipleRuns &&
      crownStatus !== "pending" &&
      crownStatus !== "in_progress" &&
      crownStatus !== "error" &&
      crownStatus !== "succeeded" &&
      !resolvedCrownedRun
    ) {
      return "hidden" as const;
    }

    if (isLoadingRuns || (crownStatus === "succeeded" && isLoadingCrownedRun)) {
      return "loading" as const;
    }

    if (taskRuns && hasMultipleRuns && !allCompleted) {
      return "waiting" as const;
    }

    if (resolvedCrownedRun && (crownStatus === "succeeded" || crownStatus === null)) {
      return "winner" as const;
    }

    if (crownStatus === "pending") {
      return "pending" as const;
    }

    if (crownStatus === "error" || crownErrorMessage) {
      return "error" as const;
    }

    if (crownStatus === "succeeded") {
      return "done" as const;
    }

    return "pending" as const;
  })();

  if (displayState === "hidden") {
    return null;
  }

  if (displayState === "loading") {
    return (
      <div className="mt-2 mb-4">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-200">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Loading crown status...</span>
        </div>
      </div>
    );
  }

  // Resolve agent name (prefer stored run.agentName)
  const resolveAgentName = (run: { agentName?: string | null }) => {
    const fromRun = run.agentName?.trim();
    return fromRun && fromRun.length > 0 ? fromRun : "unknown agent";
  };

  // Determine the status pill content
  let pillContent;
  let pillClassName =
    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium";

  if (displayState === "waiting" && taskRuns) {
    const waitingContent = (
      <>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>
          Waiting for models ({completedRuns.length}/{taskRuns.length})
        </span>
      </>
    );

    pillContent = (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-help">
            {waitingContent}
          </div>
        </TooltipTrigger>
        <TooltipContent
          className="max-w-sm p-3 z-[var(--z-overlay)]"
          side="bottom"
          sideOffset={5}
        >
          <div className="space-y-2">
            <p className="font-medium text-sm">Crown Evaluation System</p>
            <p className="text-xs text-muted-foreground">
              Multiple AI models are working on your task in parallel. Once
              all models complete, Claude will evaluate and select the best
              implementation.
            </p>
            <div className="border-t pt-2 mt-2">
              <p className="text-xs font-medium mb-1">Competing models:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {taskRuns.map((run, idx) => {
                  const agentName = resolveAgentName(run);
                  const status =
                    run.status === "completed"
                      ? "✓"
                      : run.status === "running"
                        ? "⏳"
                        : run.status === "failed"
                          ? "✗"
                          : "•";
                  return (
                    <li key={idx}>
                      {status} {agentName}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );

    pillClassName +=
      " bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  } else if (displayState === "winner" && resolvedCrownedRun) {
    const winnerContent = (
      <>
        <Crown className="w-3 h-3" />
        <span>Winner: {resolveAgentName(resolvedCrownedRun)}</span>
      </>
    );

    // If we have a reason, wrap in tooltip
    if (resolvedCrownedRun.crownReason) {
      pillContent = (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 cursor-help">
              {winnerContent}
            </div>
          </TooltipTrigger>
          <TooltipContent
            className="max-w-sm p-3 z-[var(--z-overlay)]"
            side="bottom"
            sideOffset={5}
          >
            <div className="space-y-2">
              <p className="font-medium text-sm">Evaluation Reason</p>
              <p className="text-xs text-muted-foreground">
                {resolvedCrownedRun.crownReason}
              </p>
              {taskRuns && (
                <p className="text-xs text-muted-foreground border-t pt-2 mt-2">
                  Evaluated against {taskRuns.length} implementations
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      );
    } else {
      pillContent = winnerContent;
    }

    pillClassName +=
      " bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  } else if (displayState === "evaluating") {
    const evaluatingContent = (
      <>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Evaluating...</span>
      </>
    );

    pillContent = (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-help">
            {evaluatingContent}
          </div>
        </TooltipTrigger>
        <TooltipContent
          className="max-w-sm p-3 z-[var(--z-overlay)]"
          side="bottom"
          sideOffset={5}
        >
          <div className="space-y-2">
            <p className="font-medium text-sm">AI Judge in Progress</p>
            <p className="text-xs text-muted-foreground">
              Claude is analyzing the code implementations from all models to
              determine which one best solves your task. The evaluation
              considers code quality, completeness, best practices, and
              correctness.
            </p>
            <div className="border-t pt-2 mt-2">
              <p className="text-xs font-medium mb-1">Completed implementations:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {completedRuns.map((run, idx) => {
                  const agentName = resolveAgentName(run);
                  return <li key={idx}>• {agentName}</li>;
                })}
              </ul>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );

    pillClassName +=
      " bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  } else if (displayState === "error") {
    const errorContent = (
      <div className="flex items-center gap-1.5 cursor-help">
        <AlertCircle className="w-3 h-3" />
        <span>Evaluation failed</span>
      </div>
    );

    if (crownErrorMessage) {
      pillContent = (
        <Tooltip>
          <TooltipTrigger asChild>{errorContent}</TooltipTrigger>
          <TooltipContent
            className="max-w-sm p-3 z-[var(--z-overlay)]"
            side="bottom"
            sideOffset={5}
          >
            <div className="space-y-1">
              <p className="font-medium text-sm">Evaluation Error</p>
              <p className="text-xs text-muted-foreground">
                {crownErrorMessage}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    } else {
      pillContent = errorContent;
    }

    pillClassName +=
      " bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  } else if (displayState === "done") {
    pillContent = (
      <>
        <Crown className="w-3 h-3" />
        <span>Evaluation complete</span>
      </>
    );
    pillClassName +=
      " bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  } else {
    pillContent = (
      <>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Pending evaluation</span>
      </>
    );
    pillClassName +=
      " bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  }

  return (
    <div className="mt-2 mb-4">
      <div className={pillClassName}>{pillContent}</div>
    </div>
  );
}
