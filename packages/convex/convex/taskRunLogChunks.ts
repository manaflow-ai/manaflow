import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

// Deprecated: do not write log chunks anymore (no-op)
export const appendChunk = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    // Intentionally not inserting chunks to reduce DB bandwidth and prepare removal.
    // Validate access but perform no write.
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    void userId;
    void teamId;
  },
});

// Deprecated: do not write log chunks anymore (no-op)
export const appendChunkPublic = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    // Intentionally not inserting chunks; keep for backward compatibility.
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    void userId;
    void teamId;
  },
});

export const getChunks = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Check if this is a preview task - if so, allow team-wide access
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun || taskRun.teamId !== teamId) {
      return [];
    }

    const task = await ctx.db.get(taskRun.taskId);
    const isPreviewTask = task?.isPreview === true;

    // For preview tasks, only require team membership; otherwise require user ownership
    if (!isPreviewTask && taskRun.userId !== userId) {
      return [];
    }

    const chunks = await ctx.db
      .query("taskRunLogChunks")
      .withIndex("by_taskRun", (q) => q.eq("taskRunId", args.taskRunId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .collect();

    return chunks;
  },
});
