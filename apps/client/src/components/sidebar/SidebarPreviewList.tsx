import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";

type Props = {
  teamSlugOrId: string;
};

export function SidebarPreviewList({ teamSlugOrId }: Props) {
  const tasks = useQuery(api.tasks.getPreviewTasks, { teamSlugOrId });

  if (tasks === undefined) {
    return <TaskTreeSkeleton count={3} />;
  }

  if (tasks.length === 0) {
    return (
      <p className="mt-1 pl-2 pr-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 select-none">
        No preview runs
      </p>
    );
  }

  return (
    <div className="space-y-px">
      {tasks.map((task) => (
        <TaskTree
          key={task._id}
          task={task}
          defaultExpanded={false}
          teamSlugOrId={teamSlugOrId}
        />
      ))}
    </div>
  );
}

export default SidebarPreviewList;
