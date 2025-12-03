import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { PreviewRunGroup } from "@/components/PreviewRunGroup";
import { groupPreviewTasks } from "@/lib/preview-task-groups";
import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";
import { useMemo } from "react";

type Props = {
  teamSlugOrId: string;
};

export function SidebarPreviewList({ teamSlugOrId }: Props) {
  const tasks = useQuery(api.tasks.getPreviewTasks, { teamSlugOrId });
  const previewGroups = useMemo(
    () => (tasks ? groupPreviewTasks(tasks) : []),
    [tasks]
  );

  if (tasks === undefined) {
    return <TaskTreeSkeleton count={3} />;
  }

  if (previewGroups.length === 0) {
    return (
      <p className="mt-1 pl-2 pr-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 select-none">
        No preview runs
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {previewGroups.map((group) => (
        <PreviewRunGroup
          key={group.key}
          group={group}
          teamSlugOrId={teamSlugOrId}
          variant="sidebar"
        />
      ))}
    </div>
  );
}

export default SidebarPreviewList;
