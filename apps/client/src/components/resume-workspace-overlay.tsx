import { useCallback } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import type { Doc } from "@cmux/convex/dataModel";
import {
  useMorphInstancePauseQuery,
  useResumeMorphWorkspace,
} from "@/hooks/useMorphWorkspace";
import { AlertTriangle } from "lucide-react";

interface ResumeWorkspaceOverlayProps {
  taskRun: Doc<"taskRuns">;
  teamSlugOrId: string;
  className?: string;
  onResumed?: () => void;
}

export function ResumeWorkspaceOverlay({
  taskRun,
  teamSlugOrId,
  className,
  onResumed,
}: ResumeWorkspaceOverlayProps) {
  const taskRunId = taskRun._id;

  const pauseStatusQuery = useMorphInstancePauseQuery({
    taskRunId,
    teamSlugOrId,
  });

  const isPaused = pauseStatusQuery.data?.paused === true;
  const isStopped = pauseStatusQuery.data?.stopped === true;

  const resumeWorkspace = useResumeMorphWorkspace({
    taskRunId,
    teamSlugOrId,
    onSuccess: onResumed,
  });

  const handleResume = useCallback(async () => {
    if (!taskRun || !isPaused || isStopped) {
      return;
    }

    await resumeWorkspace.mutateAsync({
      path: { taskRunId },
      body: { teamSlugOrId },
    });
  }, [resumeWorkspace, isPaused, isStopped, taskRun, taskRunId, teamSlugOrId]);

  if (!isPaused) {
    return null;
  }

  // Show different UI for permanently stopped instances
  if (isStopped) {
    return (
      <div
        className={clsx(
          "absolute inset-0 flex items-center justify-center bg-neutral-50/90 backdrop-blur-sm dark:bg-black/80",
          className
        )}
      >
        <div className="rounded-lg border border-neutral-200/80 bg-white/90 p-4 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/80 max-w-sm">
          <div className="flex justify-center mb-2">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
          </div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
            Workspace expired
          </p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            This workspace was automatically cleaned up after being inactive for
            2 weeks. Your code changes are preserved in any commits or pull
            requests you created.
          </p>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-500">
            To continue working, create a new task with the same repository.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "absolute inset-0 flex items-center justify-center bg-neutral-50/90 backdrop-blur-sm dark:bg-black/80",
        className
      )}
    >
      <div className="rounded-lg border border-neutral-200/80 bg-white/90 p-4 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/80">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
          Workspace paused
        </p>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Resume your VM to reconnect VS Code.
        </p>
        <Button
          className="mt-3"
          onClick={handleResume}
          disabled={resumeWorkspace.isPending}
          variant="default"
        >
          {resumeWorkspace.isPending ? "Resuming…" : "Resume VM"}
        </Button>
      </div>
    </div>
  );
}
