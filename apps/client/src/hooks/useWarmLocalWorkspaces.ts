import { useEffect, useMemo, useRef } from "react";
import { useQueries } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { isFakeConvexId } from "@/lib/fakeConvexId";
import { useLocalVSCodeServeWebQuery } from "@/queries/local-vscode-serve-web";
import { getWorkspaceUrl } from "@/lib/workspace-url";
import {
  preloadTaskRunIframes,
  setTaskRunIframePinned,
} from "@/lib/preloadTaskRunIframes";

type TaskWithUnread = Doc<"tasks"> & { hasUnread?: boolean };
type TaskRunListItem = (typeof api.taskRuns.getByTask._returnType)[number];

type WarmTarget = {
  taskRunId: TaskRunListItem["_id"];
  url: string;
  pinned: boolean;
};

const MAX_ACTIVE_LOCAL_WARMUPS = 2;
const MAX_WARM_LOCAL_WORKSPACES = 10;

export function useWarmLocalWorkspaces({
  teamSlugOrId,
  tasks,
  pinnedTasks,
  enabled = true,
}: {
  teamSlugOrId: string;
  tasks: TaskWithUnread[] | undefined;
  pinnedTasks: TaskWithUnread[] | undefined;
  enabled?: boolean;
}) {
  const localServeWeb = useLocalVSCodeServeWebQuery();

  const pinnedLocalTasks = useMemo(() => {
    return (pinnedTasks ?? []).filter((task) => task.isLocalWorkspace);
  }, [pinnedTasks]);

  const pinnedTaskIds = useMemo(() => {
    return new Set(pinnedLocalTasks.map((task) => task._id));
  }, [pinnedLocalTasks]);

  const activeLocalTasks = useMemo(() => {
    return (tasks ?? []).filter(
      (task) => task.isLocalWorkspace && !pinnedTaskIds.has(task._id)
    );
  }, [tasks, pinnedTaskIds]);

  const warmCandidateTasks = useMemo(() => {
    if (!enabled) {
      return [];
    }

    const candidates: TaskWithUnread[] = [];
    const seen = new Set<Id<"tasks">>();

    const addTask = (task: TaskWithUnread) => {
      if (isFakeConvexId(task._id)) {
        return;
      }
      if (seen.has(task._id)) {
        return;
      }
      if (candidates.length >= MAX_WARM_LOCAL_WORKSPACES) {
        return;
      }
      seen.add(task._id);
      candidates.push(task);
    };

    for (const task of pinnedLocalTasks) {
      addTask(task);
    }

    let activeCount = 0;
    for (const task of activeLocalTasks) {
      if (activeCount >= MAX_ACTIVE_LOCAL_WARMUPS) {
        break;
      }
      addTask(task);
      activeCount += 1;
    }

    return candidates;
  }, [activeLocalTasks, enabled, pinnedLocalTasks]);

  const taskRunQueries = useMemo(() => {
    const queries: Record<
      Id<"tasks">,
      {
        query: typeof api.taskRuns.getByTask;
        args: { teamSlugOrId: string; taskId: Id<"tasks"> };
      }
    > = {};

    if (!enabled) {
      return queries;
    }

    for (const task of warmCandidateTasks) {
      if (isFakeConvexId(task._id)) {
        continue;
      }
      queries[task._id] = {
        query: api.taskRuns.getByTask,
        args: { teamSlugOrId, taskId: task._id },
      };
    }

    return queries;
  }, [enabled, teamSlugOrId, warmCandidateTasks]);

  const taskRunResults = useQueries(taskRunQueries);

  const warmTargets = useMemo<WarmTarget[]>(() => {
    if (!enabled) {
      return [];
    }

    const baseUrl = localServeWeb.data?.baseUrl;
    if (!baseUrl) {
      return [];
    }

    const targets: WarmTarget[] = [];

    for (const task of warmCandidateTasks) {
      const taskRuns = taskRunResults[task._id];
      if (!taskRuns || taskRuns.length === 0) {
        continue;
      }

      const flattened = flattenRuns(taskRuns);
      const localRun = selectLocalWorkspaceRun(flattened);
      if (!localRun) {
        continue;
      }

      if (localRun.vscode?.provider !== "other") {
        continue;
      }

      if (localRun.vscode?.status !== "running") {
        continue;
      }

      const workspaceUrl = getWorkspaceUrl(
        localRun.vscode?.workspaceUrl,
        localRun.vscode?.provider,
        baseUrl
      );
      if (!workspaceUrl) {
        continue;
      }

      targets.push({
        taskRunId: localRun._id,
        url: workspaceUrl,
        pinned: pinnedTaskIds.has(task._id),
      });
    }

    return targets;
  }, [
    enabled,
    localServeWeb.data?.baseUrl,
    pinnedTaskIds,
    taskRunResults,
    warmCandidateTasks,
  ]);

  const pinnedRunIds = useMemo(
    () =>
      warmTargets
        .filter((target) => target.pinned)
        .map((target) => target.taskRunId),
    [warmTargets]
  );

  const previousPinnedRef = useRef<Set<TaskRunListItem["_id"]>>(new Set());

  useEffect(() => {
    if (!enabled) {
      if (previousPinnedRef.current.size > 0) {
        for (const runId of previousPinnedRef.current) {
          setTaskRunIframePinned(runId, false);
        }
        previousPinnedRef.current = new Set();
      }
      return;
    }

    const nextPinned = new Set(pinnedRunIds);
    const prevPinned = previousPinnedRef.current;

    for (const runId of nextPinned) {
      if (!prevPinned.has(runId)) {
        setTaskRunIframePinned(runId, true);
      }
    }

    for (const runId of prevPinned) {
      if (!nextPinned.has(runId)) {
        setTaskRunIframePinned(runId, false);
      }
    }

    previousPinnedRef.current = nextPinned;
  }, [enabled, pinnedRunIds]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (warmTargets.length === 0) {
      return;
    }
    void preloadTaskRunIframes(
      warmTargets.map(({ taskRunId, url }) => ({ taskRunId, url }))
    ).catch((error) => {
      console.error("Failed to warm local workspace iframes", error);
    });
  }, [enabled, warmTargets]);
}

function flattenRuns(runs: TaskRunListItem[]): TaskRunListItem[] {
  const acc: TaskRunListItem[] = [];
  const stack = [...runs];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    acc.push(current);
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }

  return acc;
}

function selectLocalWorkspaceRun(
  runs: TaskRunListItem[]
): TaskRunListItem | null {
  const active = runs.find(
    (run) => !run.isArchived && run.vscode?.provider === "other"
  );
  if (active) {
    return active;
  }

  return runs.find((run) => run.vscode?.provider === "other") ?? null;
}
