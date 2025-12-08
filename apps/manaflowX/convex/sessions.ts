import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// =============================================================================
// SESSIONS - AI conversation containers
// =============================================================================

export const createSession = mutation({
  args: {
    source: v.union(
      v.literal("api"),
      v.literal("opencode"),
      v.literal("workflow")
    ),
    postId: v.optional(v.id("posts")),
    workflowRunId: v.optional(v.string()),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    agent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const sessionId = await ctx.db.insert("sessions", {
      source: args.source,
      postId: args.postId,
      workflowRunId: args.workflowRunId,
      status: "active",
      model: args.model,
      provider: args.provider,
      agent: args.agent,
      createdAt: now,
      updatedAt: now,
    });

    return sessionId;
  },
});

export const updateSession = mutation({
  args: {
    sessionId: v.id("sessions"),
    status: v.optional(
      v.union(v.literal("active"), v.literal("completed"), v.literal("failed"))
    ),
    tokens: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
        reasoning: v.optional(v.number()),
        cacheRead: v.optional(v.number()),
        cacheWrite: v.optional(v.number()),
      })
    ),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.status) {
      updates.status = args.status;
      if (args.status === "completed" || args.status === "failed") {
        updates.completedAt = now;
      }
    }
    if (args.tokens) updates.tokens = args.tokens;
    if (args.cost !== undefined) updates.cost = args.cost;

    await ctx.db.patch(args.sessionId, updates);
  },
});

export const getSession = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const listSessionsByPost = query({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .order("desc")
      .collect();
  },
});

// =============================================================================
// TURNS - AI messages with inline parts
// =============================================================================

// Part type for validation
const partValidator = v.object({
  type: v.union(
    v.literal("text"),
    v.literal("reasoning"),
    v.literal("tool_call"),
    v.literal("tool_result"),
    v.literal("file"),
    v.literal("step_start"),
    v.literal("step_finish"),
    v.literal("error")
  ),
  text: v.optional(v.string()),
  toolCallId: v.optional(v.string()),
  toolName: v.optional(v.string()),
  toolInput: v.optional(v.any()),
  toolOutput: v.optional(v.string()),
  toolStatus: v.optional(
    v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("error")
    )
  ),
  // Progress tracking for long-running tools
  toolProgress: v.optional(
    v.object({
      stage: v.string(),
      message: v.string(),
      sessionId: v.optional(v.string()),
      instanceId: v.optional(v.string()),
    })
  ),
  fileUrl: v.optional(v.string()),
  fileMime: v.optional(v.string()),
  fileName: v.optional(v.string()),
  stepTokens: v.optional(
    v.object({
      input: v.number(),
      output: v.number(),
    })
  ),
  isComplete: v.boolean(),
});

export const createTurn = mutation({
  args: {
    sessionId: v.id("sessions"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool")
    ),
    toolCallId: v.optional(v.string()),
    toolName: v.optional(v.string()),
    parts: v.optional(v.array(partValidator)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the next order number for this session
    const existingTurns = await ctx.db
      .query("turns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();

    const order = existingTurns ? existingTurns.order + 1 : 0;

    const turnId = await ctx.db.insert("turns", {
      sessionId: args.sessionId,
      role: args.role,
      toolCallId: args.toolCallId,
      toolName: args.toolName,
      status: "pending",
      parts: args.parts ?? [],
      order,
      createdAt: now,
      updatedAt: now,
    });

    return turnId;
  },
});

export const updateTurn = mutation({
  args: {
    turnId: v.id("turns"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("streaming"),
        v.literal("complete"),
        v.literal("error")
      )
    ),
    parts: v.optional(v.array(partValidator)),
    error: v.optional(
      v.object({
        name: v.string(),
        message: v.string(),
      })
    ),
    tokens: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
      })
    ),
    finishReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.status) updates.status = args.status;
    if (args.parts) updates.parts = args.parts;
    if (args.error) updates.error = args.error;
    if (args.tokens) updates.tokens = args.tokens;
    if (args.finishReason) updates.finishReason = args.finishReason;

    await ctx.db.patch(args.turnId, updates);
  },
});

export const appendTextToPart = mutation({
  args: {
    turnId: v.id("turns"),
    partIndex: v.number(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn) throw new Error("Turn not found");

    const parts = [...turn.parts];
    if (args.partIndex >= parts.length) {
      // Add new text part
      parts.push({
        type: "text",
        text: args.text,
        isComplete: false,
      });
    } else {
      // Append to existing part
      const part = parts[args.partIndex];
      if (part.type === "text" || part.type === "reasoning") {
        parts[args.partIndex] = {
          ...part,
          text: (part.text ?? "") + args.text,
        };
      }
    }

    await ctx.db.patch(args.turnId, {
      parts,
      status: "streaming",
      updatedAt: Date.now(),
    });
  },
});

export const addPart = mutation({
  args: {
    turnId: v.id("turns"),
    part: partValidator,
  },
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn) throw new Error("Turn not found");

    const parts = [...turn.parts, args.part];

    await ctx.db.patch(args.turnId, {
      parts,
      status: "streaming",
      updatedAt: Date.now(),
    });
  },
});

export const updatePartStatus = mutation({
  args: {
    turnId: v.id("turns"),
    partIndex: v.number(),
    toolStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("error")
      )
    ),
    toolOutput: v.optional(v.string()),
    isComplete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn) throw new Error("Turn not found");

    const parts = [...turn.parts];
    if (args.partIndex < parts.length) {
      const part = parts[args.partIndex];
      parts[args.partIndex] = {
        ...part,
        ...(args.toolStatus !== undefined && { toolStatus: args.toolStatus }),
        ...(args.toolOutput !== undefined && { toolOutput: args.toolOutput }),
        ...(args.isComplete !== undefined && { isComplete: args.isComplete }),
      };

      await ctx.db.patch(args.turnId, {
        parts,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Update tool progress for a specific tool call in a turn.
 * Used by long-running tools like delegateToCodingAgent to show progress.
 */
export const updateToolProgress = mutation({
  args: {
    sessionId: v.id("sessions"),
    toolCallId: v.string(),
    progress: v.object({
      stage: v.string(),
      message: v.string(),
      sessionId: v.optional(v.string()),
      instanceId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Find the turn with this tool call
    const turns = await ctx.db
      .query("turns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    for (const turn of turns) {
      const partIndex = turn.parts.findIndex(
        (p) => p.type === "tool_call" && p.toolCallId === args.toolCallId
      );

      if (partIndex >= 0) {
        const parts = [...turn.parts];
        parts[partIndex] = {
          ...parts[partIndex],
          toolProgress: args.progress,
          // Set to running if not already completed
          toolStatus:
            parts[partIndex].toolStatus === "completed" ||
            parts[partIndex].toolStatus === "error"
              ? parts[partIndex].toolStatus
              : "running",
        };

        await ctx.db.patch(turn._id, {
          parts,
          updatedAt: Date.now(),
        });
        return;
      }
    }
  },
});

export const getTurn = query({
  args: {
    turnId: v.id("turns"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.turnId);
  },
});

export const listTurnsBySession = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("turns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

// Get session with all turns - convenience query
export const getSessionWithTurns = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    const turns = await ctx.db
      .query("turns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    return { session, turns };
  },
});
