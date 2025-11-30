import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useLocalStorage } from "@mantine/hooks";
import { useQuery } from "convex/react";
import clsx from "clsx";
import { memo, useCallback, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";
import { ChevronRight } from "lucide-react";

type TaskCategoryKey =
  | "pinned"
  | "workspaces"
  | "ready_to_review"
  | "in_progress"
  | "merged";

const CATEGORY_ORDER: TaskCategoryKey[] = [
  "pinned",
  "workspaces",
  "ready_to_review",
  "in_progress",
  "merged",
];

const CATEGORY_META: Record<
  TaskCategoryKey,
  { title: string; emptyLabel: string }
> = {
  pinned: {
    title: "Pinned",
    emptyLabel: "No pinned items.",
  },
  workspaces: {
    title: "Workspaces",
    emptyLabel: "No workspace sessions yet.",
  },
  ready_to_review: {
    title: "Ready to review",
    emptyLabel: "Nothing is waiting for review.",
  },
  in_progress: {
    title: "In progress",
    emptyLabel: "No tasks are currently in progress.",
  },
  merged: {
    title: "Merged",
    emptyLabel: "No merged tasks yet.",
  },
};

const createEmptyCategoryBuckets = (): Record<
  TaskCategoryKey,
  Doc<"tasks">[]
> => ({
  pinned: [],
  workspaces: [],
  ready_to_review: [],
  in_progress: [],
  merged: [],
});

const getTaskCategory = (task: Doc<"tasks">): TaskCategoryKey => {
  if (task.isCloudWorkspace || task.isLocalWorkspace) {
    return "workspaces";
  }
  if (task.mergeStatus === "pr_merged") {
    return "merged";
  }
  if (task.crownEvaluationStatus === "succeeded") {
    return "ready_to_review";
  }
  return "in_progress";
};

const sortByRecentUpdate = (tasks: Doc<"tasks">[]): Doc<"tasks">[] => {
  if (tasks.length <= 1) {
    return tasks;
  }
  return [...tasks].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
  );
};

const categorizeTasks = (
  tasks: Doc<"tasks">[] | undefined
): Record<TaskCategoryKey, Doc<"tasks">[]> | null => {
  if (!tasks) {
    return null;
  }
  const buckets = createEmptyCategoryBuckets();
  for (const task of tasks) {
    const key = getTaskCategory(task);
    buckets[key].push(task);
  }
  for (const key of CATEGORY_ORDER) {
    buckets[key] = sortByRecentUpdate(buckets[key]);
  }
  return buckets;
};

const createCollapsedCategoryState = (
  defaultValue = false
): Record<TaskCategoryKey, boolean> => ({
  pinned: defaultValue,
  workspaces: defaultValue,
  ready_to_review: defaultValue,
  in_progress: defaultValue,
  merged: defaultValue,
});

type PreviewTaskEntry = {
  task: Doc<"tasks">;
  latestPreviewRun: Doc<"taskRuns"> | null;
};

type PreviewCategoryKey = "in_progress" | "completed";

const PREVIEW_CATEGORY_ORDER: PreviewCategoryKey[] = [
  "in_progress",
  "completed",
];

const PREVIEW_CATEGORY_META: Record<
  PreviewCategoryKey,
  { title: string; emptyLabel: string }
> = {
  in_progress: {
    title: "In progress",
    emptyLabel: "No previews are currently running.",
  },
  completed: {
    title: "Completed",
    emptyLabel: "No completed previews yet.",
  },
};

const createEmptyPreviewCategoryBuckets = (): Record<
  PreviewCategoryKey,
  PreviewTaskEntry[]
> => ({
  in_progress: [],
  completed: [],
});

const getPreviewCategory = (entry: PreviewTaskEntry): PreviewCategoryKey => {
  const status = entry.latestPreviewRun?.status;
  if (status === "completed" || status === "skipped") {
    return "completed";
  }
  return "in_progress";
};

const sortPreviewEntries = (
  entries: ReadonlyArray<PreviewTaskEntry>
): PreviewTaskEntry[] => {
  if (entries.length <= 1) {
    return [...entries];
  }
  return [...entries].sort((a, b) => {
    const aTime =
      a.latestPreviewRun?.updatedAt ??
      a.task.updatedAt ??
      a.task.createdAt ??
      0;
    const bTime =
      b.latestPreviewRun?.updatedAt ??
      b.task.updatedAt ??
      b.task.createdAt ??
      0;
    return bTime - aTime;
  });
};

const categorizePreviewTasks = (
  entries: ReadonlyArray<PreviewTaskEntry> | undefined
): Record<PreviewCategoryKey, PreviewTaskEntry[]> | null => {
  if (!entries) {
    return null;
  }

  const buckets = createEmptyPreviewCategoryBuckets();

  for (const entry of entries) {
    const key = getPreviewCategory(entry);
    buckets[key].push(entry);
  }

  for (const key of PREVIEW_CATEGORY_ORDER) {
    buckets[key] = sortPreviewEntries(buckets[key]);
  }

  return buckets;
};

const createPreviewCollapsedState = (
  defaultValue = false
): Record<PreviewCategoryKey, boolean> => ({
  in_progress: defaultValue,
  completed: defaultValue,
});

export const TaskList = memo(function TaskList({
  teamSlugOrId,
}: {
  teamSlugOrId: string;
}) {
  const allTasks = useQuery(api.tasks.get, { teamSlugOrId });
  const archivedTasks = useQuery(api.tasks.get, {
    teamSlugOrId,
    archived: true,
  });
  const pinnedData = useQuery(api.tasks.getPinned, { teamSlugOrId });
  const previewTasks = useQuery(api.tasks.getPreviewTasks, { teamSlugOrId });
  const [tab, setTab] = useState<"all" | "previews" | "archived">("all");

  const previewTaskIds = useMemo(
    () => new Set((previewTasks ?? []).map((entry) => entry.task._id)),
    [previewTasks]
  );

  const tasksWithoutPreviews = useMemo(() => {
    if (!allTasks) {
      return allTasks;
    }
    if (previewTaskIds.size === 0) {
      return allTasks;
    }
    return allTasks.filter((task) => !previewTaskIds.has(task._id));
  }, [allTasks, previewTaskIds]);

  const filteredPinnedData = useMemo(
    () => pinnedData?.filter((task) => !previewTaskIds.has(task._id)),
    [pinnedData, previewTaskIds]
  );

  const categorizedTasks = useMemo(() => {
    const categorized = categorizeTasks(tasksWithoutPreviews);
    if (categorized && filteredPinnedData) {
      // Filter pinned tasks out from other categories
      const pinnedTaskIds = new Set(filteredPinnedData.map((t) => t._id));

      for (const key of CATEGORY_ORDER) {
        if (key !== "pinned") {
          categorized[key] = categorized[key].filter(
            (t) => !pinnedTaskIds.has(t._id)
          );
        }
      }

      // Add pinned tasks to the pinned category (already sorted by the API)
      categorized.pinned = filteredPinnedData;
    }
    return categorized;
  }, [filteredPinnedData, tasksWithoutPreviews]);
  const categoryBuckets = categorizedTasks ?? createEmptyCategoryBuckets();
  const previewCategorizedTasks = useMemo(
    () => categorizePreviewTasks(previewTasks),
    [previewTasks]
  );
  const previewCategoryBuckets =
    previewCategorizedTasks ?? createEmptyPreviewCategoryBuckets();
  const collapsedStorageKey = useMemo(
    () => `dashboard-collapsed-categories-${teamSlugOrId}`,
    [teamSlugOrId]
  );
  const defaultCollapsedState = useMemo(
    () => createCollapsedCategoryState(),
    []
  );
  const [collapsedCategories, setCollapsedCategories] = useLocalStorage<
    Record<TaskCategoryKey, boolean>
  >({
    key: collapsedStorageKey,
    defaultValue: defaultCollapsedState,
    getInitialValueInEffect: true,
  });
  const previewCollapsedStorageKey = useMemo(
    () => `dashboard-preview-collapsed-categories-${teamSlugOrId}`,
    [teamSlugOrId]
  );
  const previewDefaultCollapsedState = useMemo(
    () => createPreviewCollapsedState(),
    []
  );
  const [collapsedPreviewCategories, setCollapsedPreviewCategories] =
    useLocalStorage<Record<PreviewCategoryKey, boolean>>({
      key: previewCollapsedStorageKey,
      defaultValue: previewDefaultCollapsedState,
      getInitialValueInEffect: true,
    });

  const toggleCategoryCollapse = useCallback((categoryKey: TaskCategoryKey) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryKey]: !prev[categoryKey],
    }));
  }, [setCollapsedCategories]);

  const togglePreviewCategoryCollapse = useCallback(
    (categoryKey: PreviewCategoryKey) => {
      setCollapsedPreviewCategories((prev) => ({
        ...prev,
        [categoryKey]: !prev[categoryKey],
      }));
    },
    [setCollapsedPreviewCategories]
  );

  return (
    <div className="mt-6 w-full">
      <div className="mb-3 px-4">
        <div className="flex items-end gap-2.5 select-none">
          <button
            className={
              "text-sm font-medium transition-colors " +
              (tab === "all"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200")
            }
            onMouseDown={() => setTab("all")}
            onClick={() => setTab("all")}
          >
            Tasks
          </button>
          <button
            className={
              "text-sm font-medium transition-colors " +
              (tab === "previews"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200")
            }
            onMouseDown={() => setTab("previews")}
            onClick={() => setTab("previews")}
          >
            Previews
          </button>
          <button
            className={
              "text-sm font-medium transition-colors " +
              (tab === "archived"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200")
            }
            onMouseDown={() => setTab("archived")}
            onClick={() => setTab("archived")}
          >
            Archived
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1 w-full">
        {tab === "archived" ? (
          archivedTasks === undefined ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
              Loading...
            </div>
          ) : archivedTasks.length === 0 ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
              No archived tasks
            </div>
          ) : (
            archivedTasks.map((task) => (
              <TaskItem
                key={task._id}
                task={task}
                teamSlugOrId={teamSlugOrId}
              />
            ))
          )
        ) : tab === "previews" ? (
          previewTasks === undefined ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
              Loading...
            </div>
          ) : (
            <div className="mt-1 w-full flex flex-col space-y-[-1px] transform -translate-y-px">
              {PREVIEW_CATEGORY_ORDER.map((categoryKey) => (
                <PreviewCategorySection
                  key={categoryKey}
                  categoryKey={categoryKey}
                  entries={previewCategoryBuckets[categoryKey]}
                  teamSlugOrId={teamSlugOrId}
                  collapsed={Boolean(
                    collapsedPreviewCategories?.[categoryKey]
                  )}
                  onToggle={togglePreviewCategoryCollapse}
                />
              ))}
            </div>
          )
        ) : allTasks === undefined ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
            Loading...
          </div>
        ) : (
          <div className="mt-1 w-full flex flex-col space-y-[-1px] transform -translate-y-px">
            {CATEGORY_ORDER.map((categoryKey) => {
              // Don't render the pinned category if it's empty
              if (categoryKey === 'pinned' && categoryBuckets[categoryKey].length === 0) {
                return null;
              }
              return (
                <TaskCategorySection
                  key={categoryKey}
                  categoryKey={categoryKey}
                  tasks={categoryBuckets[categoryKey]}
                  teamSlugOrId={teamSlugOrId}
                  collapsed={Boolean(collapsedCategories[categoryKey])}
                  onToggle={toggleCategoryCollapse}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

function TaskCategorySection({
  categoryKey,
  tasks,
  teamSlugOrId,
  collapsed,
  onToggle,
}: {
  categoryKey: TaskCategoryKey;
  tasks: Doc<"tasks">[];
  teamSlugOrId: string;
  collapsed: boolean;
  onToggle: (key: TaskCategoryKey) => void;
}) {
  const meta = CATEGORY_META[categoryKey];
  const handleToggle = useCallback(
    () => onToggle(categoryKey),
    [categoryKey, onToggle]
  );
  const contentId = `task-category-${categoryKey}`;
  const toggleLabel = collapsed
    ? `Expand ${meta.title}`
    : `Collapse ${meta.title}`;
  return (
    <div className="w-full">
      <div
        className="sticky top-0 z-10 flex w-full border-y border-neutral-200 dark:border-neutral-900 bg-neutral-100 dark:bg-neutral-800 select-none"
        onDoubleClick={handleToggle}
      >
        <div className="flex w-full items-center pr-4">
          <button
            type="button"
            onClick={handleToggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            className="flex h-9 w-9 items-center justify-center text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 dark:focus-visible:outline-neutral-700 transition-colors"
          >
            <ChevronRight
              className={clsx(
                "h-3 w-3 transition-transform duration-200",
                !collapsed && "rotate-90"
              )}
              aria-hidden="true"
            />
          </button>
          <div className="flex items-center gap-2 text-xs font-medium tracking-tight text-neutral-900 dark:text-neutral-100">
            <span>{meta.title}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {tasks.length}
            </span>
          </div>
        </div>
      </div>
      {collapsed ? null : tasks.length > 0 ? (
        <div id={contentId} className="flex flex-col w-full">
          {tasks.map((task) => (
            <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
          ))}
        </div>
      ) : (
        <div className="flex w-full items-center px-4 py-3">
          <p className="pl-5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
            {meta.emptyLabel}
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewCategorySection({
  categoryKey,
  entries,
  teamSlugOrId,
  collapsed,
  onToggle,
}: {
  categoryKey: PreviewCategoryKey;
  entries: PreviewTaskEntry[];
  teamSlugOrId: string;
  collapsed: boolean;
  onToggle: (key: PreviewCategoryKey) => void;
}) {
  const meta = PREVIEW_CATEGORY_META[categoryKey];
  const handleToggle = useCallback(
    () => onToggle(categoryKey),
    [categoryKey, onToggle]
  );
  const contentId = `preview-category-${categoryKey}`;
  const toggleLabel = collapsed
    ? `Expand ${meta.title}`
    : `Collapse ${meta.title}`;

  return (
    <div className="w-full">
      <div
        className="sticky top-0 z-10 flex w-full border-y border-neutral-200 dark:border-neutral-900 bg-neutral-100 dark:bg-neutral-800 select-none"
        onDoubleClick={handleToggle}
      >
        <div className="flex w-full items-center pr-4">
          <button
            type="button"
            onClick={handleToggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            className="flex h-9 w-9 items-center justify-center text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 dark:focus-visible:outline-neutral-700 transition-colors"
          >
            <ChevronRight
              className={clsx(
                "h-3 w-3 transition-transform duration-200",
                !collapsed && "rotate-90"
              )}
              aria-hidden="true"
            />
          </button>
          <div className="flex items-center gap-2 text-xs font-medium tracking-tight text-neutral-900 dark:text-neutral-100">
            <span>{meta.title}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {entries.length}
            </span>
          </div>
        </div>
      </div>
      {collapsed ? null : entries.length > 0 ? (
        <div id={contentId} className="flex flex-col w-full">
          {entries.map((entry) => (
            <TaskItem
              key={entry.task._id}
              task={entry.task}
              teamSlugOrId={teamSlugOrId}
            />
          ))}
        </div>
      ) : (
        <div className="flex w-full items-center px-4 py-3">
          <p className="pl-5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
            {meta.emptyLabel}
          </p>
        </div>
      )}
    </div>
  );
}
