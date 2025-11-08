import { Suspense } from "react";
import { MonitorUp } from "lucide-react";
import type { Id } from "@cmux/convex/dataModel";
import { TaskRunTerminalsPane } from "@/routes/_layout.$teamSlugOrId.task.$taskId.run.$runId.terminals";

export interface TaskRunTerminalPaneProps {
  teamSlugOrId: string;
  taskRunId: Id<"taskRuns"> | null;
}

export function TaskRunTerminalPane({
  teamSlugOrId,
  taskRunId,
}: TaskRunTerminalPaneProps) {
  const renderPlaceholder = (message: string) => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
      <MonitorUp className="size-4 animate-pulse" aria-hidden />
      <span>{message}</span>
    </div>
  );

  if (!taskRunId) {
    return renderPlaceholder("Select a run to connect a terminal session.");
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <Suspense fallback={renderPlaceholder("Loading terminal…")}>
        <TaskRunTerminalsPane
          teamSlugOrId={teamSlugOrId}
          taskRunId={taskRunId}
          variant="panel"
        />
      </Suspense>
    </div>
  );
}
