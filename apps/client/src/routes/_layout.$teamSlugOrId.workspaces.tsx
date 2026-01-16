import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { FloatingPane } from "@/components/floating-pane";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { isFakeConvexId } from "@/lib/fakeConvexId";
import { api } from "@cmux/convex/api";
import { type Id } from "@cmux/convex/dataModel";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "convex/react";
import { useMemo } from "react";
import { env } from "@/client-env";

export const Route = createFileRoute("/_layout/$teamSlugOrId/workspaces")({
  component: WorkspacesRoute,
  loader: async ({ params }) => {
    const { teamSlugOrId } = params;
    // In web mode, exclude local workspaces
    const excludeLocalWorkspaces = env.NEXT_PUBLIC_WEB_MODE || undefined;
    void convexQueryClient.queryClient.ensureQueryData(
      convexQuery(api.tasks.getWithNotificationOrder, { teamSlugOrId, excludeLocalWorkspaces })
    );
  },
});

function WorkspacesRoute() {
  const { teamSlugOrId } = Route.useParams();
  // In web mode, exclude local workspaces
  const excludeLocalWorkspaces = env.NEXT_PUBLIC_WEB_MODE || undefined;
  // Use notification-aware ordering: unread notifications first, then by createdAt
  const tasks = useQuery(api.tasks.getWithNotificationOrder, { teamSlugOrId, excludeLocalWorkspaces });
  const tasksWithUnread = useQuery(api.taskNotifications.getTasksWithUnread, {
    teamSlugOrId,
  });
  const { expandTaskIds } = useExpandTasks();

  // Tasks are already sorted by the query (unread notifications first)
  const orderedTasks = useMemo(
    () => tasks ?? ([] as NonNullable<typeof tasks>),
    [tasks]
  );

  // Create a Set for quick lookup of task IDs with unread notifications
  const tasksWithUnreadSet = useMemo(() => {
    if (!tasksWithUnread) return new Set<string>();
    return new Set(tasksWithUnread.map((t) => t.taskId));
  }, [tasksWithUnread]);

  const taskRunQueries = useMemo(() => {
    return orderedTasks
      .filter((task) => !isFakeConvexId(task._id))
      .reduce(
        (acc, task) => ({
          ...acc,
          [task._id]: {
            query: api.taskRuns.getByTask,
            args: { teamSlugOrId, taskId: task._id },
          },
        }),
        {} as Record<
          Id<"tasks">,
          {
            query: typeof api.taskRuns.getByTask;
            args:
              | ((d: { params: { teamSlugOrId: string } }) => {
                  teamSlugOrId: string;
                  taskId: Id<"tasks">;
                })
              | { teamSlugOrId: string; taskId: Id<"tasks"> };
          }
        >
      );
  }, [orderedTasks, teamSlugOrId]);

  const taskRunResults = useQueries(
    taskRunQueries as Parameters<typeof useQueries>[0]
  );

  const tasksWithRuns = useMemo(
    () =>
      orderedTasks.map((task) => ({
        ...task,
        runs: taskRunResults?.[task._id] ?? [],
      })),
    [orderedTasks, taskRunResults]
  );

  return (
    <FloatingPane>
      <div className="grow h-full flex flex-col">
        <div className="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 select-none">
            Workspaces
          </h1>
        </div>
        <div className="overflow-y-auto px-4 pb-6">
          {tasks === undefined ? (
            <TaskTreeSkeleton count={10} />
          ) : tasksWithRuns.length === 0 ? (
            <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400 select-none">
              No workspaces yet.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {tasksWithRuns.map((task) => (
                <TaskTree
                  key={task._id}
                  task={task}
                  defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                  teamSlugOrId={teamSlugOrId}
                  hasUnreadNotification={tasksWithUnreadSet.has(task._id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </FloatingPane>
  );
}
