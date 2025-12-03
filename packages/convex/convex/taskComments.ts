import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

async function getAuthorizedTask(
  ctx: QueryCtx | MutationCtx,
  {
    teamSlugOrId,
    taskId,
    userId,
  }: { teamSlugOrId: string; taskId: Doc<"tasks">["_id"]; userId: string },
): Promise<{ task: Doc<"tasks">; teamId: string; isPreview: boolean }> {
  const teamId = await getTeamId(ctx, teamSlugOrId);
  const task = await ctx.db.get(taskId);

  if (!task || task.teamId !== teamId) {
    throw new Error("Task not found or unauthorized");
  }

  const isPreview = task.isPreview === true;
  if (!isPreview && task.userId !== userId) {
    throw new Error("Task not found or unauthorized");
  }

  return { task, teamId, isPreview };
}

export const listByTask = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const { teamId } = await getAuthorizedTask(ctx, { ...args, userId });

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
    const userId = ctx.identity.subject;
    const { teamId } = await getAuthorizedTask(ctx, { ...args, userId });

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
    const userId = ctx.identity.subject;
    const { teamId } = await getAuthorizedTask(ctx, { ...args, userId });

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
    const userId = ctx.identity.subject;
    const { teamId } = await getAuthorizedTask(ctx, { ...args, userId });

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
