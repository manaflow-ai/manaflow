import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import type { Doc } from "./_generated/dataModel";
import { authMutation, authQuery } from "./users/utils";

function assertTaskAccess(
  task: Doc<"tasks"> | null,
  teamId: string,
  userId: string,
) {
  if (!task || task.teamId !== teamId) {
    throw new Error("Task not found or unauthorized");
  }
  if (task.isPreview === true) {
    return;
  }
  if (task.userId !== userId) {
    throw new Error("Task not found or unauthorized");
  }
}

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
    assertTaskAccess(task, teamId, userId);

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
    assertTaskAccess(task, teamId, userId);

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
    assertTaskAccess(task, teamId, userId);

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
    assertTaskAccess(task, teamId, userId);

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
