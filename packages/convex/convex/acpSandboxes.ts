import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
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
  v.literal("daytona"),
  v.literal("e2b"),
  v.literal("blaxel")
);

const poolStateValidator = v.union(
  v.literal("available"),
  v.literal("reserved"),
  v.literal("claimed")
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
    streamSecret: v.string(),
    sandboxUrl: v.optional(v.string()),
    poolState: v.optional(poolStateValidator),
    warmExpiresAt: v.optional(v.number()),
    warmReservedUserId: v.optional(v.string()),
    warmReservedTeamId: v.optional(v.string()),
    warmReservedAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
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
      streamSecret: args.streamSecret,
      lastActivityAt: now,
      conversationCount: 0,
      snapshotId: args.snapshotId,
      poolState: args.poolState ?? "claimed",
      warmExpiresAt: args.warmExpiresAt,
      warmReservedUserId: args.warmReservedUserId,
      warmReservedTeamId: args.warmReservedTeamId,
      warmReservedAt: args.warmReservedAt,
      claimedAt: args.claimedAt ?? (args.poolState === "claimed" ? now : undefined),
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
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      return;
    }

    const updates: Record<string, unknown> = {
      status: args.status,
      lastActivityAt: Date.now(),
    };
    if (args.sandboxUrl !== undefined) {
      updates.sandboxUrl = args.sandboxUrl;
    }
    if (args.status === "error") {
      updates.lastError =
        args.errorMessage ??
        sandbox.lastError ??
        "Sandbox reported error status";
    }
    // Note: We no longer clear lastError when status changes away from "error"
    // This preserves error history for debugging. Errors are cleared explicitly
    // via clearLastError mutation or when a new error replaces it.
    await ctx.db.patch(args.sandboxId, updates);
  },
});

/**
 * Record a sandbox error message without changing status.
 */
export const setLastError = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      return;
    }
    await ctx.db.patch(args.sandboxId, {
      lastError: args.errorMessage,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Clear the lastError field explicitly.
 * Use this when the sandbox has recovered and you want to hide the error from the UI.
 */
export const clearLastError = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      return;
    }
    await ctx.db.patch(args.sandboxId, {
      lastError: undefined,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Update stream secret for sandbox auth.
 */
export const updateStreamSecret = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    streamSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      return;
    }
    await ctx.db.patch(args.sandboxId, {
      streamSecret: args.streamSecret,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Reserve a warm sandbox for a user + team, or claim an available one.
 */
export const reserveWarmSandbox = internalMutation({
  args: {
    userId: v.string(),
    teamId: v.string(),
    extendMs: v.number(),
    snapshotId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + args.extendMs;
    const snapshotId = args.snapshotId;

    const reserved = await ctx.db
      .query("acpSandboxes")
      .withIndex("by_pool_reservation", (q) =>
        q
          .eq("poolState", "reserved")
          .eq("warmReservedUserId", args.userId)
          .eq("warmReservedTeamId", args.teamId)
      )
      .order("desc")
      .first();

    if (
      reserved &&
      reserved.warmExpiresAt &&
      reserved.warmExpiresAt > now &&
      (!snapshotId || reserved.snapshotId === snapshotId)
    ) {
      await ctx.db.patch(reserved._id, {
        warmExpiresAt: expiresAt,
        warmReservedAt: now,
        lastActivityAt: now,
      });
      return reserved;
    }

    const available = await ctx.db
      .query("acpSandboxes")
      .withIndex("by_pool_state", (q) => q.eq("poolState", "available"))
      .order("asc")
      .take(10);

    const candidate = available.find(
      (sandbox) =>
        (!snapshotId || sandbox.snapshotId === snapshotId) &&
        sandbox.status !== "stopped" &&
        sandbox.status !== "error" &&
        sandbox.warmExpiresAt &&
        sandbox.warmExpiresAt > now
    );

    if (!candidate) {
      return null;
    }

    await ctx.db.patch(candidate._id, {
      poolState: "reserved",
      warmReservedUserId: args.userId,
      warmReservedTeamId: args.teamId,
      warmReservedAt: now,
      warmExpiresAt: expiresAt,
      lastActivityAt: now,
    });

    return candidate;
  },
});

/**
 * Claim a reserved or available warm sandbox for a team.
 */
export const claimWarmSandbox = internalMutation({
  args: {
    userId: v.string(),
    teamId: v.string(),
    sandboxId: v.optional(v.id("acpSandboxes")),
    snapshotId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const claimCandidate = async (candidate: Doc<"acpSandboxes">) => {
      if (
        candidate.status === "stopped" ||
        candidate.status === "error" ||
        !candidate.warmExpiresAt ||
        candidate.warmExpiresAt <= now
      ) {
        return null;
      }
      if (args.snapshotId && candidate.snapshotId !== args.snapshotId) {
        return null;
      }
      if (candidate.poolState === "reserved") {
        if (
          candidate.warmReservedUserId !== args.userId ||
          candidate.warmReservedTeamId !== args.teamId
        ) {
          return null;
        }
      } else if (candidate.poolState !== "available") {
        return null;
      }

      await ctx.db.patch(candidate._id, {
        poolState: "claimed",
        teamId: args.teamId,
        claimedAt: now,
        lastActivityAt: now,
      });
      return candidate;
    };

    if (args.sandboxId) {
      const sandbox = await ctx.db.get(args.sandboxId);
      if (!sandbox) {
        return null;
      }
      const claimed = await claimCandidate(sandbox);
      if (claimed) {
        return claimed;
      }
    }

    const reserved = await ctx.db
      .query("acpSandboxes")
      .withIndex("by_pool_reservation", (q) =>
        q
          .eq("poolState", "reserved")
          .eq("warmReservedUserId", args.userId)
          .eq("warmReservedTeamId", args.teamId)
      )
      .order("desc")
      .first();

    if (reserved) {
      const claimed = await claimCandidate(reserved);
      if (claimed) {
        return claimed;
      }
    }

    const available = await ctx.db
      .query("acpSandboxes")
      .withIndex("by_pool_state", (q) => q.eq("poolState", "available"))
      .order("asc")
      .take(10);

    for (const candidate of available) {
      const claimed = await claimCandidate(candidate);
      if (claimed) {
        return claimed;
      }
    }

    return null;
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
 * Clear warm reservation metadata after a warm sandbox is fully claimed.
 */
export const clearWarmReservation = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      warmReservedUserId: "",
      warmReservedTeamId: "",
      warmReservedAt: 0,
      warmExpiresAt: 0,
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
