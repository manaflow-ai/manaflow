import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useMemo } from "react";

export function useSetTaskReadState(teamSlugOrId: string) {
  const markAsReadMutation = useMutation(
    api.taskNotifications.markTaskAsRead
  ).withOptimisticUpdate((localStore, args) => {
    // Update hasUnreadForTask query
    const hasUnreadArgs = { teamSlugOrId: args.teamSlugOrId, taskId: args.taskId };
    const hasUnread = localStore.getQuery(
      api.taskNotifications.hasUnreadForTask,
      hasUnreadArgs
    );
    if (hasUnread !== undefined) {
      localStore.setQuery(api.taskNotifications.hasUnreadForTask, hasUnreadArgs, false);
    }

    // Update getTasksWithUnread query - remove this task from the list
    const tasksWithUnreadArgs = { teamSlugOrId: args.teamSlugOrId };
    const tasksWithUnread = localStore.getQuery(
      api.taskNotifications.getTasksWithUnread,
      tasksWithUnreadArgs
    );
    if (tasksWithUnread !== undefined) {
      localStore.setQuery(
        api.taskNotifications.getTasksWithUnread,
        tasksWithUnreadArgs,
        tasksWithUnread.filter((t) => t.taskId !== args.taskId)
      );
    }

    // Update getUnreadCount query - decrement by the count for this task
    const unreadCountArgs = { teamSlugOrId: args.teamSlugOrId };
    const unreadCount = localStore.getQuery(
      api.taskNotifications.getUnreadCount,
      unreadCountArgs
    );
    if (unreadCount !== undefined && tasksWithUnread !== undefined) {
      const taskUnread = tasksWithUnread.find((t) => t.taskId === args.taskId);
      const decrementBy = taskUnread?.unreadCount ?? 1;
      localStore.setQuery(
        api.taskNotifications.getUnreadCount,
        unreadCountArgs,
        Math.max(0, unreadCount - decrementBy)
      );
    }
  });

  const markAsUnreadMutation = useMutation(
    api.taskNotifications.markTaskAsUnread
  ).withOptimisticUpdate((localStore, args) => {
    // Update hasUnreadForTask query
    const hasUnreadArgs = { teamSlugOrId: args.teamSlugOrId, taskId: args.taskId };
    const hasUnread = localStore.getQuery(
      api.taskNotifications.hasUnreadForTask,
      hasUnreadArgs
    );
    if (hasUnread !== undefined) {
      localStore.setQuery(api.taskNotifications.hasUnreadForTask, hasUnreadArgs, true);
    }

    // Update getTasksWithUnread query - add this task to the list
    const tasksWithUnreadArgs = { teamSlugOrId: args.teamSlugOrId };
    const tasksWithUnread = localStore.getQuery(
      api.taskNotifications.getTasksWithUnread,
      tasksWithUnreadArgs
    );
    if (tasksWithUnread !== undefined) {
      const alreadyExists = tasksWithUnread.some((t) => t.taskId === args.taskId);
      if (!alreadyExists) {
        localStore.setQuery(
          api.taskNotifications.getTasksWithUnread,
          tasksWithUnreadArgs,
          [
            ...tasksWithUnread,
            { taskId: args.taskId, unreadCount: 1, latestNotificationAt: Date.now() },
          ]
        );
      }
    }

    // Update getUnreadCount query - increment
    const unreadCountArgs = { teamSlugOrId: args.teamSlugOrId };
    const unreadCount = localStore.getQuery(
      api.taskNotifications.getUnreadCount,
      unreadCountArgs
    );
    if (unreadCount !== undefined) {
      localStore.setQuery(
        api.taskNotifications.getUnreadCount,
        unreadCountArgs,
        unreadCount + 1
      );
    }
  });

  // Memoize mutations object to keep reference stable
  const mutations = useMemo(
    () => ({ markAsReadMutation, markAsUnreadMutation }),
    [markAsReadMutation, markAsUnreadMutation]
  );

  return useCallback(
    (taskId: Id<"tasks">, isRead: boolean) => {
      if (isRead) {
        return mutations.markAsReadMutation({ teamSlugOrId, taskId });
      }
      return mutations.markAsUnreadMutation({ teamSlugOrId, taskId });
    },
    [mutations, teamSlugOrId]
  );
}
