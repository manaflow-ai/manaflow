import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { FloatingPane } from "@/components/floating-pane";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

export const Route = createFileRoute("/_layout/$teamSlugOrId/previews")({
  component: PreviewsRoute,
  loader: async ({ params }) => {
    const { teamSlugOrId } = params;
    void convexQueryClient.queryClient.ensureQueryData(
      convexQuery(api.tasks.getPreviewTasks, { teamSlugOrId })
    );
  },
});

function PreviewsRoute() {
  const { teamSlugOrId } = Route.useParams();
  const tasks = useQuery(api.tasks.getPreviewTasks, { teamSlugOrId });
  const { expandTaskIds } = useExpandTasks();

  return (
    <FloatingPane>
      <div className="grow h-full flex flex-col">
        <div className="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 select-none">
            Previews
          </h1>
        </div>
        <div className="overflow-y-auto px-4 pb-6">
          {tasks === undefined ? (
            <TaskTreeSkeleton count={10} />
          ) : tasks.length === 0 ? (
            <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400 select-none">
              No preview runs yet.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {tasks.map((task) => (
                <TaskTree
                  key={task._id}
                  task={task}
                  defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                  teamSlugOrId={teamSlugOrId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </FloatingPane>
  );
}
