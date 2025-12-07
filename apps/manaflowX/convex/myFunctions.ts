import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Example queries and mutations for the xagi schema
// These are starter examples - expand as needed

// Get tasks for the feed
export const listTasks = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("in_review"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("completed")
      )
    ),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    let tasksQuery = ctx.db.query("tasks").order("desc");

    if (args.status) {
      tasksQuery = ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc");
    }

    const tasks = await tasksQuery.take(limit);

    return {
      viewer: (await ctx.auth.getUserIdentity())?.name ?? null,
      tasks,
    };
  },
});

// Create a new task
export const createTask = mutation({
  args: {
    title: v.string(),
    content: v.string(),
    type: v.union(
      v.literal("code_review"),
      v.literal("approval"),
      v.literal("verification"),
      v.literal("decision"),
      v.literal("triage"),
      v.literal("feedback"),
      v.literal("discussion")
    ),
    priority: v.optional(
      v.union(
        v.literal("critical"),
        v.literal("high"),
        v.literal("medium"),
        v.literal("low")
      )
    ),
    parentId: v.optional(v.id("tasks")),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // If this is a reply, get parent info for tree structure
    let depth = 0;
    let threadRootId = undefined;
    let path = undefined;

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (parent) {
        depth = parent.depth + 1;
        threadRootId = parent.threadRootId ?? parent._id;
        path = parent.path ? `${parent.path}/${args.parentId}` : `${args.parentId}`;

        // Update parent's child count
        await ctx.db.patch(args.parentId, {
          childCount: parent.childCount + 1,
        });

        // Update all ancestors' descendant counts
        if (threadRootId) {
          const root = await ctx.db.get(threadRootId);
          if (root) {
            await ctx.db.patch(threadRootId, {
              descendantCount: root.descendantCount + 1,
            });
          }
        }
      }
    }

    const taskId = await ctx.db.insert("tasks", {
      title: args.title,
      content: args.content,
      type: args.type,
      status: "pending",
      priority: args.priority ?? "medium",
      urgencyScore: args.priority === "critical" ? 100 : args.priority === "high" ? 75 : 50,
      parentId: args.parentId,
      threadRootId,
      path,
      depth,
      childCount: 0,
      descendantCount: 0,
      tags: args.tags ?? [],
      attachments: [],
      replyCount: 0,
      reactionCount: 0,
      viewCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return taskId;
  },
});

// Get a task with its replies (tree)
export const getTaskWithReplies = query({
  args: {
    taskId: v.id("tasks"),
    maxDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;

    // Get all replies in the thread
    const threadRootId = task.threadRootId ?? task._id;
    const maxDepth = args.maxDepth ?? 10;

    const replies = await ctx.db
      .query("tasks")
      .withIndex("by_thread_root", (q) => q.eq("threadRootId", threadRootId))
      .filter((q) => q.lte(q.field("depth"), task.depth + maxDepth))
      .order("asc")
      .collect();

    return {
      task,
      replies,
    };
  },
});
