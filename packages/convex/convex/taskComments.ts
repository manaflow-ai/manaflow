import { v } from "convex/values";
import { canAccessTaskForReading, resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

export const listByTask = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const identity = ctx.identity;
    const userId = identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const task = await ctx.db.get(args.taskId);
    if (!task || !canAccessTaskForReading(task, teamId, userId)) {
      throw new Error("Task not found or unauthorized");
    }

    const comments = await ctx.db
      .query("taskComments")
      .withIndex("by_team_task", (q) =>
        q.eq("teamId", teamId).eq("taskId", args.taskId)
      )
      .collect();

    // Ensure chronological order
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const createForTask = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = ctx.identity;
    const userId = identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }

    const now = Date.now();
    return await ctx.db.insert("taskComments", {
      taskId: args.taskId,
      content: args.content,
      userId,
      teamId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Creates a system-authored comment on a task with userId "cmux"
export const createSystemForTask = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = ctx.identity;
    const userId = identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }

    const now = Date.now();
    return await ctx.db.insert("taskComments", {
      taskId: args.taskId,
      content: args.content,
      userId: "cmux",
      teamId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const latestSystemByTask = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const identity = ctx.identity;
    const userId = identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const task = await ctx.db.get(args.taskId);
    if (!task || !canAccessTaskForReading(task, teamId, userId)) {
      throw new Error("Task not found or unauthorized");
    }

    const comments = await ctx.db
      .query("taskComments")
      .withIndex("by_team_task", (q) =>
        q.eq("teamId", teamId).eq("taskId", args.taskId)
      )
      .filter((q) => q.eq(q.field("userId"), "cmux"))
      .order("desc")
      .take(1);

    return comments[0] ?? null;
  },
});
