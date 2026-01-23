import { ConvexError, v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

// Get all notifications for the current user (paginated, newest first)
export const list = authQuery({
  args: {
    teamSlugOrId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const take = Math.max(1, Math.min(args.limit ?? 50, 100));

    const notifications = await ctx.db
      .query("taskNotifications")
      .withIndex("by_team_user_created", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .order("desc")
      .take(take);

    // Fetch associated tasks for display
    const taskIds = [...new Set(notifications.map((n) => n.taskId))];
    const tasks = await Promise.all(taskIds.map((id) => ctx.db.get(id)));
    const taskMap = new Map(tasks.filter(Boolean).map((t) => [t!._id, t!]));

    // Fetch associated task runs for display
    const runIds = notifications
      .filter((n) => n.taskRunId)
      .map((n) => n.taskRunId as Id<"taskRuns">);
    const runs = await Promise.all(runIds.map((id) => ctx.db.get(id)));
    const runMap = new Map(runs.filter(Boolean).map((r) => [r!._id, r!]));

    // Check which task runs are unread (explicit unread tracking)
    const unreadRunIds = new Set<string>();
    for (const runId of runIds) {
      const unread = await ctx.db
        .query("unreadTaskRuns")
        .withIndex("by_run_user", (q) =>
          q.eq("taskRunId", runId).eq("userId", userId),
        )
        .first();
      if (unread) {
        unreadRunIds.add(runId);
      }
    }

    return notifications.map((n) => ({
      ...n,
      task: taskMap.get(n.taskId) ?? null,
      taskRun: n.taskRunId ? (runMap.get(n.taskRunId) ?? null) : null,
      isUnread: n.taskRunId ? unreadRunIds.has(n.taskRunId) : false,
    }));
  },
});

// Check if a task has any unread runs (for auto-mark-as-read triggering)
export const hasUnreadForTask = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Verify task belongs to this team
    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== teamId) {
      throw new ConvexError("Task not found");
    }

    // Check if any unread runs exist for this task
    const unread = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_task_user", (q) =>
        q.eq("taskId", args.taskId).eq("userId", userId),
      )
      .first();

    return unread !== null;
  },
});

// Get unread notification count
// Counts unique unread task runs (not individual notifications)
export const getUnreadCount = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Count unread runs for this user in this team
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .collect();

    return unreadRuns.length;
  },
});

// Get tasks with unread notifications (for sidebar dots)
// Uses explicit unread tracking - row exists = unread
export const getTasksWithUnread = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Get all unread runs for this user in this team
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .collect();

    if (unreadRuns.length === 0) {
      return [];
    }

    // Get task runs to find their taskIds
    const taskRuns = await Promise.all(
      unreadRuns.map((ur) => ctx.db.get(ur.taskRunId)),
    );

    // Group by taskId
    const taskUnreadMap = new Map<Id<"tasks">, { count: number }>();

    for (const run of taskRuns) {
      if (!run) continue;
      const existing = taskUnreadMap.get(run.taskId);
      if (!existing) {
        taskUnreadMap.set(run.taskId, { count: 1 });
      } else {
        existing.count++;
      }
    }

    // Convert to array format
    const result: Array<{
      taskId: Id<"tasks">;
      unreadCount: number;
      latestNotificationAt: number;
    }> = [];

    for (const [taskId, data] of taskUnreadMap) {
      result.push({
        taskId,
        unreadCount: data.count,
        latestNotificationAt: Date.now(), // Not tracking this anymore
      });
    }

    return result;
  },
});

// Mark a task run as read (delete unread row)
export const markTaskRunAsRead = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    // Verify user has access to this team
    await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Delete the unread row if it exists
    const existing = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_run_user", (q) =>
        q.eq("taskRunId", args.taskRunId).eq("userId", userId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// Mark a task run as unread (insert unread row)
export const markTaskRunAsUnread = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Get the task run to find taskId and validate ownership
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun || taskRun.teamId !== teamId || taskRun.userId !== userId) {
      throw new Error("Task run not found or unauthorized");
    }

    // Check if unread row already exists
    const existing = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_run_user", (q) =>
        q.eq("taskRunId", args.taskRunId).eq("userId", userId),
      )
      .first();

    // Only insert if not already unread
    if (!existing) {
      await ctx.db.insert("unreadTaskRuns", {
        taskRunId: args.taskRunId,
        taskId: taskRun.taskId,
        userId,
        teamId,
      });
    }
  },
});

// Mark all runs for a task as read (delete unread rows)
export const markTaskAsRead = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    // teamSlugOrId is validated by authMutation but we don't need teamId here
    // since we query by taskId directly

    // Get all unread rows for this task using by_task_user index (O(1) lookup)
    const unreadRows = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_task_user", (q) =>
        q.eq("taskId", args.taskId).eq("userId", userId),
      )
      .collect();

    // Delete all unread rows for this task
    await Promise.all(unreadRows.map((row) => ctx.db.delete(row._id)));
  },
});

// Mark all runs for a task as unread (insert unread rows)
export const markTaskAsUnread = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Get all runs for this task
    const runs = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();

    // Insert unread rows for each run (if not already unread)
    for (const run of runs) {
      if (run.teamId !== teamId) continue;

      const existing = await ctx.db
        .query("unreadTaskRuns")
        .withIndex("by_run_user", (q) =>
          q.eq("taskRunId", run._id).eq("userId", userId),
        )
        .first();

      if (!existing) {
        await ctx.db.insert("unreadTaskRuns", {
          taskRunId: run._id,
          taskId: args.taskId,
          userId,
          teamId,
        });
      }
    }
  },
});

// Mark all task runs as read (delete all unread rows for user in this team)
export const markAllAsRead = authMutation({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Get all unread rows for this user in this team and delete them
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .collect();

    for (const unread of unreadRuns) {
      await ctx.db.delete(unread._id);
    }
  },
});

// Internal mutation to create a notification (called from taskRuns on completion)
export const createInternal = internalMutation({
  args: {
    taskId: v.id("tasks"),
    taskRunId: v.optional(v.id("taskRuns")),
    teamId: v.string(),
    userId: v.string(),
    type: v.union(v.literal("run_completed"), v.literal("run_failed")),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.insert("taskNotifications", {
      taskId: args.taskId,
      taskRunId: args.taskRunId,
      teamId: args.teamId,
      userId: args.userId,
      type: args.type,
      message: args.message,
      createdAt: now,
    });

    // NOTE: We intentionally do NOT update lastActivityAt here.
    // Updating lastActivityAt on notification creation causes the sidebar to
    // reorder tasks when notifications arrive, which is disruptive UX.
    // The blue dot indicator (via unreadTaskRuns) is sufficient for notification visibility.
    // lastActivityAt should only be updated when the user actively interacts with a task
    // (e.g., creating it, starting a run, etc.) - not on passive notification events.

    // Insert unread row for this task run (if taskRunId provided)
    if (args.taskRunId) {
      // Check if already unread (avoid duplicates)
      const existing = await ctx.db
        .query("unreadTaskRuns")
        .withIndex("by_run_user", (q) =>
          q.eq("taskRunId", args.taskRunId!).eq("userId", args.userId),
        )
        .first();

      if (!existing) {
        await ctx.db.insert("unreadTaskRuns", {
          taskRunId: args.taskRunId,
          taskId: args.taskId,
          userId: args.userId,
          teamId: args.teamId,
        });
      }
    }
  },
});

// Internal query to check if a task has unread notifications
export const hasUnreadForTaskInternal = internalQuery({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // O(1) lookup using by_task_user index (taskId is denormalized on unreadTaskRuns)
    const unread = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_task_user", (q) =>
        q.eq("taskId", args.taskId).eq("userId", args.userId),
      )
      .first();

    return unread !== null;
  },
});
