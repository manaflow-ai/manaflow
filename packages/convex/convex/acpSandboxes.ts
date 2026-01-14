import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { v } from "convex/values";

// Status type for type safety
const sandboxStatusValidator = v.union(
  v.literal("starting"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("stopped"),
  v.literal("error")
);

// Provider type for type safety
const providerValidator = v.union(
  v.literal("morph"),
  v.literal("freestyle"),
  v.literal("daytona")
);

/**
 * Create a new ACP sandbox record.
 * Called when spawning a new sandbox instance for ACP.
 */
export const create = internalMutation({
  args: {
    teamId: v.string(),
    provider: providerValidator,
    instanceId: v.string(),
    snapshotId: v.string(),
    callbackJwtHash: v.string(),
    sandboxUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("acpSandboxes", {
      teamId: args.teamId,
      provider: args.provider,
      instanceId: args.instanceId,
      status: "starting",
      sandboxUrl: args.sandboxUrl,
      callbackJwtHash: args.callbackJwtHash,
      lastActivityAt: now,
      conversationCount: 0,
      snapshotId: args.snapshotId,
      createdAt: now,
    });
  },
});

/**
 * Update sandbox status.
 */
export const updateStatus = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    status: sandboxStatusValidator,
    sandboxUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      status: args.status,
      lastActivityAt: Date.now(),
    };
    if (args.sandboxUrl !== undefined) {
      updates.sandboxUrl = args.sandboxUrl;
    }
    await ctx.db.patch(args.sandboxId, updates);
  },
});

/**
 * Record activity on a sandbox (e.g., message sent/received).
 */
export const recordActivity = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Increment conversation count when a new conversation is linked.
 */
export const incrementConversationCount = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      throw new Error("Sandbox not found");
    }
    await ctx.db.patch(args.sandboxId, {
      conversationCount: sandbox.conversationCount + 1,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Decrement conversation count when a conversation is closed.
 */
export const decrementConversationCount = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      throw new Error("Sandbox not found");
    }
    await ctx.db.patch(args.sandboxId, {
      conversationCount: Math.max(0, sandbox.conversationCount - 1),
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Find a running sandbox for a team that can be reused.
 */
export const findRunningForTeam = internalQuery({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find running sandboxes for this team, ordered by most recent activity
    const sandbox = await ctx.db
      .query("acpSandboxes")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "running")
      )
      .order("desc") // Most recently active first
      .first();

    return sandbox;
  },
});

/**
 * Get sandbox by ID (internal).
 */
export const getById = internalQuery({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sandboxId);
  },
});

/**
 * Get sandbox by instance ID.
 */
export const getByInstanceId = internalQuery({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("acpSandboxes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

/**
 * Verify callback JWT hash matches.
 */
export const verifyCallbackJwt = internalQuery({
  args: {
    sandboxId: v.id("acpSandboxes"),
    jwtHash: v.string(),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      return { valid: false, error: "Sandbox not found" };
    }
    if (sandbox.callbackJwtHash !== args.jwtHash) {
      return { valid: false, error: "Invalid callback JWT" };
    }
    return { valid: true, sandbox };
  },
});

/**
 * List all sandboxes for a team (public query for UI).
 */
export const listForTeam = query({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("acpSandboxes")
      .withIndex("by_team_status", (q) => q.eq("teamId", args.teamId))
      .order("desc")
      .take(50);
  },
});

/**
 * Get sandbox details (public query).
 */
export const get = query({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sandboxId);
  },
});

/**
 * Mark sandbox as stopped (for cleanup).
 */
export const markStopped = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      status: "stopped",
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Find stale sandboxes for cleanup (no activity in last N minutes).
 */
export const findStale = internalQuery({
  args: {
    maxAgeMs: v.number(), // e.g., 30 * 60 * 1000 for 30 minutes
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.maxAgeMs;

    // Get all running sandboxes
    const sandboxes = await ctx.db
      .query("acpSandboxes")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "running"),
          q.lt(q.field("lastActivityAt"), cutoff),
          q.eq(q.field("conversationCount"), 0) // Only cleanup if no active conversations
        )
      )
      .take(100);

    return sandboxes;
  },
});
