import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

// List all comments for a task run
export const listByTaskRun = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Verify the task run belongs to the team
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun || taskRun.teamId !== teamId) {
      throw new Error("Task run not found or unauthorized");
    }

    const comments = await ctx.db
      .query("diffComments")
      .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      .collect();

    // Sort by createdAt
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  },
});

// List comments for a specific file in a task run
export const listByFile = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Verify the task run belongs to the team
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun || taskRun.teamId !== teamId) {
      throw new Error("Task run not found or unauthorized");
    }

    const comments = await ctx.db
      .query("diffComments")
      .withIndex("by_task_run_file", (q) =>
        q.eq("taskRunId", args.taskRunId).eq("filePath", args.filePath)
      )
      .collect();

    // Sort by createdAt
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  },
});

// Create a new comment on a diff line
export const create = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
    filePath: v.string(),
    lineNumber: v.number(),
    side: v.union(v.literal("old"), v.literal("new")),
    content: v.string(),
    profileImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Verify the task run belongs to the team
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun || taskRun.teamId !== teamId) {
      throw new Error("Task run not found or unauthorized");
    }

    const now = Date.now();
    const commentId = await ctx.db.insert("diffComments", {
      taskRunId: args.taskRunId,
      filePath: args.filePath,
      lineNumber: args.lineNumber,
      side: args.side,
      content: args.content,
      resolved: false,
      userId,
      teamId,
      profileImageUrl: args.profileImageUrl,
      createdAt: now,
      updatedAt: now,
    });

    return commentId;
  },
});

// Update a comment's content
export const update = authMutation({
  args: {
    teamSlugOrId: v.string(),
    commentId: v.id("diffComments"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.teamId !== teamId) {
      throw new Error("Comment not found or unauthorized");
    }

    // Only the author can edit their comment
    if (comment.userId !== userId) {
      throw new Error("Only the comment author can edit");
    }

    await ctx.db.patch(args.commentId, {
      content: args.content,
      updatedAt: Date.now(),
    });
  },
});

// Mark a comment as resolved
export const resolve = authMutation({
  args: {
    teamSlugOrId: v.string(),
    commentId: v.id("diffComments"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.teamId !== teamId) {
      throw new Error("Comment not found or unauthorized");
    }

    await ctx.db.patch(args.commentId, {
      resolved: true,
      updatedAt: Date.now(),
    });
  },
});

// Mark a comment as unresolved
export const unresolve = authMutation({
  args: {
    teamSlugOrId: v.string(),
    commentId: v.id("diffComments"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.teamId !== teamId) {
      throw new Error("Comment not found or unauthorized");
    }

    await ctx.db.patch(args.commentId, {
      resolved: false,
      updatedAt: Date.now(),
    });
  },
});

// Delete a comment (only author can delete)
export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    commentId: v.id("diffComments"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.teamId !== teamId) {
      throw new Error("Comment not found or unauthorized");
    }

    // Only the author can delete their comment
    if (comment.userId !== userId) {
      throw new Error("Only the comment author can delete");
    }

    // Delete all replies first
    const replies = await ctx.db
      .query("diffCommentReplies")
      .withIndex("by_comment", (q) => q.eq("diffCommentId", args.commentId))
      .collect();

    for (const reply of replies) {
      await ctx.db.delete(reply._id);
    }

    await ctx.db.delete(args.commentId);
  },
});

// Add a reply to a comment
export const addReply = authMutation({
  args: {
    teamSlugOrId: v.string(),
    diffCommentId: v.id("diffComments"),
    content: v.string(),
    profileImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const comment = await ctx.db.get(args.diffCommentId);
    if (!comment || comment.teamId !== teamId) {
      throw new Error("Comment not found or unauthorized");
    }

    const now = Date.now();
    const replyId = await ctx.db.insert("diffCommentReplies", {
      diffCommentId: args.diffCommentId,
      content: args.content,
      userId,
      teamId,
      profileImageUrl: args.profileImageUrl,
      createdAt: now,
      updatedAt: now,
    });

    return replyId;
  },
});

// Get replies for a comment
export const getReplies = authQuery({
  args: {
    teamSlugOrId: v.string(),
    diffCommentId: v.id("diffComments"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const comment = await ctx.db.get(args.diffCommentId);
    if (!comment || comment.teamId !== teamId) {
      throw new Error("Comment not found or unauthorized");
    }

    const replies = await ctx.db
      .query("diffCommentReplies")
      .withIndex("by_comment", (q) => q.eq("diffCommentId", args.diffCommentId))
      .collect();

    // Sort by createdAt
    return replies.sort((a, b) => a.createdAt - b.createdAt);
  },
});

// Delete a reply (only author can delete)
export const deleteReply = authMutation({
  args: {
    teamSlugOrId: v.string(),
    replyId: v.id("diffCommentReplies"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const reply = await ctx.db.get(args.replyId);
    if (!reply || reply.teamId !== teamId) {
      throw new Error("Reply not found or unauthorized");
    }

    // Only the author can delete their reply
    if (reply.userId !== userId) {
      throw new Error("Only the reply author can delete");
    }

    await ctx.db.delete(args.replyId);
  },
});

// Get comment counts per file for a task run
export const getCountsByFile = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Verify the task run belongs to the team
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun || taskRun.teamId !== teamId) {
      throw new Error("Task run not found or unauthorized");
    }

    const comments = await ctx.db
      .query("diffComments")
      .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      .collect();

    // Group by file path and count
    const counts: Record<string, { total: number; unresolved: number }> = {};
    for (const comment of comments) {
      if (!counts[comment.filePath]) {
        counts[comment.filePath] = { total: 0, unresolved: 0 };
      }
      counts[comment.filePath].total += 1;
      if (!comment.resolved) {
        counts[comment.filePath].unresolved += 1;
      }
    }

    return counts;
  },
});
