import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// Enqueue a task to solve an issue
export const enqueueIssue = internalMutation({
  args: {
    issueId: v.id("issues"),
    repoFullName: v.string(),
    gitRemote: v.string(),
    branch: v.string(),
    installationId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("workflowQueue", {
      type: "solve_issue",
      status: "pending",
      issueId: args.issueId,
      repoFullName: args.repoFullName,
      gitRemote: args.gitRemote,
      branch: args.branch,
      installationId: args.installationId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Get pending tasks (for Next.js to poll/process)
export const getPendingTasks = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("workflowQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(10);
  },
});

// Claim a task for processing (atomic operation)
export const claimTask = mutation({
  args: { taskId: v.id("workflowQueue") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.status !== "pending") {
      return null; // Already claimed or doesn't exist
    }

    await ctx.db.patch(taskId, {
      status: "processing",
      updatedAt: Date.now(),
    });

    // Get the associated issue for context
    const issue = await ctx.db.get(task.issueId);

    return {
      ...task,
      issue,
    };
  },
});

// Mark task as completed with PR URL
export const completeTask = mutation({
  args: {
    taskId: v.id("workflowQueue"),
    workflowId: v.optional(v.string()),
    prUrl: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, workflowId, prUrl }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "completed",
      workflowId,
      prUrl,
      updatedAt: now,
      processedAt: now,
    });
  },
});

// Mark task as failed
export const failTask = mutation({
  args: {
    taskId: v.id("workflowQueue"),
    error: v.string(),
  },
  handler: async (ctx, { taskId, error }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "failed",
      error,
      updatedAt: now,
      processedAt: now,
    });
  },
});

// Get task by issue ID (to check if already queued)
export const getTaskByIssue = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    return await ctx.db
      .query("workflowQueue")
      .withIndex("by_issue", (q) => q.eq("issueId", issueId))
      .first();
  },
});


