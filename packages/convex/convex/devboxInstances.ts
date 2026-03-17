import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { authQuery, authMutation } from "./users/utils";
import { getTeamId } from "../_shared/team";

const instanceStatusValidator = v.union(
  v.literal("running"),
  v.literal("paused"),
  v.literal("stopped"),
  v.literal("unknown")
);

/**
 * Generate a friendly ID for CLI users (cr_xxxxxxxx)
 */
function generateDevboxId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "cr_";
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (let i = 0; i < 8; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

/**
 * List devbox instances for the authenticated user in a team.
 */
export const list = authQuery({
  args: {
    teamSlugOrId: v.string(),
    includeStoppedAfter: v.optional(v.number()),
    provider: v.optional(v.union(v.literal("morph"), v.literal("e2b"), v.literal("modal"))),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instancesQuery = ctx.db
      .query("devboxInstances")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .order("desc");

    let rawInstances = await instancesQuery.collect();

    // If provider filter is specified, join with devboxInfo to filter
    if (args.provider) {
      const devboxInfos = await ctx.db
        .query("devboxInfo")
        .collect();

      const devboxIdsByProvider = new Set(
        devboxInfos
          .filter((info) => info.provider === args.provider)
          .map((info) => info.devboxId)
      );

      rawInstances = rawInstances.filter((instance) =>
        devboxIdsByProvider.has(instance.devboxId)
      );
    }

    // Filter based on stopped status
    if (args.includeStoppedAfter !== undefined) {
      return rawInstances.filter((instance) => {
        if (instance.status === "stopped" && instance.stoppedAt) {
          return instance.stoppedAt >= args.includeStoppedAfter!;
        }
        return true;
      });
    }

    // By default, exclude stopped instances
    return rawInstances.filter((instance) => instance.status !== "stopped");
  },
});

/**
 * Get a specific devbox instance by ID (cr_xxxxxxxx).
 */
export const getById = authQuery({
  args: {
    teamSlugOrId: v.string(),
    id: v.string(), // The devboxId (cr_xxx)
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instance = await ctx.db
      .query("devboxInstances")
      .withIndex("by_devboxId", (q) => q.eq("devboxId", args.id))
      .first();

    // Verify ownership
    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      return null;
    }

    return instance;
  },
});

/**
 * Internal query to get instance by ID (for HTTP handlers).
 */
export const getByIdInternal = internalQuery({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devboxInstances")
      .withIndex("by_devboxId", (q) => q.eq("devboxId", args.id))
      .first();
  },
});

/**
 * Get the provider info for a devbox instance.
 */
export const getInfo = internalQuery({
  args: {
    devboxId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devboxInfo")
      .withIndex("by_devboxId", (q) => q.eq("devboxId", args.devboxId))
      .first();
  },
});

/**
 * Get devbox ID from provider instance ID.
 */
export const getDevboxIdFromProvider = internalQuery({
  args: {
    providerInstanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const info = await ctx.db
      .query("devboxInfo")
      .withIndex("by_providerInstanceId", (q) =>
        q.eq("providerInstanceId", args.providerInstanceId)
      )
      .first();
    return info?.devboxId ?? null;
  },
});

/**
 * Get devbox instance by provider instance ID.
 */
export const getByProviderInstanceId = authQuery({
  args: {
    teamSlugOrId: v.string(),
    providerInstanceId: v.string(),
    provider: v.optional(v.union(v.literal("morph"), v.literal("e2b"), v.literal("modal"))),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Look up devbox ID from provider info
    const info = await ctx.db
      .query("devboxInfo")
      .withIndex("by_providerInstanceId", (q) =>
        q.eq("providerInstanceId", args.providerInstanceId)
      )
      .first();

    if (!info) {
      return null;
    }

    // Verify provider matches if specified
    if (args.provider && info.provider !== args.provider) {
      return null;
    }

    const instance = await ctx.db
      .query("devboxInstances")
      .withIndex("by_devboxId", (q) => q.eq("devboxId", info.devboxId))
      .first();

    // Verify ownership
    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      return null;
    }

    return { ...instance, provider: info.provider, providerInstanceId: info.providerInstanceId };
  },
});

/**
 * Create a new devbox instance record with provider info.
 */
export const create = authMutation({
  args: {
    teamSlugOrId: v.string(),
    providerInstanceId: v.string(), // e.g., morphvm_xxx or E2B sandbox ID
    provider: v.optional(v.union(v.literal("morph"), v.literal("e2b"), v.literal("modal"))),
    name: v.optional(v.string()),
    snapshotId: v.optional(v.string()),
    templateId: v.optional(v.string()), // For E2B templates
    vscodeUrl: v.optional(v.string()),
    workerUrl: v.optional(v.string()),
    vncUrl: v.optional(v.string()),
    environmentId: v.optional(v.id("environments")),
    metadata: v.optional(v.record(v.string(), v.string())),
    source: v.optional(v.union(v.literal("cli"), v.literal("web"))),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Check if info for this provider instance already exists
    const existingInfo = await ctx.db
      .query("devboxInfo")
      .withIndex("by_providerInstanceId", (q) =>
        q.eq("providerInstanceId", args.providerInstanceId)
      )
      .first();

    if (existingInfo) {
      // Instance already exists, update it
      const existing = await ctx.db
        .query("devboxInstances")
        .withIndex("by_devboxId", (q) => q.eq("devboxId", existingInfo.devboxId))
        .first();

      if (existing) {
        // Security: Verify ownership before allowing reuse
        // This prevents authenticated users from hijacking other users' instances
        // by guessing or obtaining their providerInstanceId
        if (existing.userId !== userId || existing.teamId !== teamId) {
          throw new Error(
            "Provider instance already exists and belongs to a different user/team"
          );
        }

        const now = Date.now();
        await ctx.db.patch(existing._id, {
          status: "running",
          name: args.name ?? existing.name,
          metadata: args.metadata ?? existing.metadata,
          updatedAt: now,
          lastAccessedAt: now,
        });
        return { id: existing.devboxId, isExisting: true };
      }
    }

    const now = Date.now();
    const devboxId = generateDevboxId();

    // Create the devbox instance (user-facing data only)
    await ctx.db.insert("devboxInstances", {
      devboxId,
      userId,
      teamId,
      name: args.name,
      source: args.source,
      status: "running",
      environmentId: args.environmentId,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    });

    // Create the provider info (provider-specific data)
    await ctx.db.insert("devboxInfo", {
      devboxId,
      provider: args.provider ?? "morph",
      providerInstanceId: args.providerInstanceId,
      snapshotId: args.snapshotId,
      createdAt: now,
    });

    return { id: devboxId, isExisting: false };
  },
});

/**
 * Update the status of a devbox instance by ID or provider instance ID.
 */
export const updateStatus = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.optional(v.string()), // The devboxId
    providerInstanceId: v.optional(v.string()), // Or provider instance ID
    provider: v.optional(v.union(v.literal("morph"), v.literal("e2b"), v.literal("modal"))),
    status: instanceStatusValidator,
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    let instance;

    const devboxId = args.id;
    const providerInstanceId = args.providerInstanceId;

    if (devboxId) {
      instance = await ctx.db
        .query("devboxInstances")
        .withIndex("by_devboxId", (q) => q.eq("devboxId", devboxId))
        .first();
    } else if (providerInstanceId) {
      // Look up by provider instance ID
      const info = await ctx.db
        .query("devboxInfo")
        .withIndex("by_providerInstanceId", (q) =>
          q.eq("providerInstanceId", providerInstanceId)
        )
        .first();

      if (info) {
        instance = await ctx.db
          .query("devboxInstances")
          .withIndex("by_devboxId", (q) => q.eq("devboxId", info.devboxId))
          .first();
      }
    }

    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    const now = Date.now();
    const updates: {
      status: typeof args.status;
      updatedAt: number;
      stoppedAt?: number;
      lastAccessedAt?: number;
    } = {
      status: args.status,
      updatedAt: now,
    };

    if (args.status === "stopped") {
      updates.stoppedAt = now;
    } else if (args.status === "running") {
      updates.lastAccessedAt = now;
    }

    await ctx.db.patch(instance._id, updates);
  },
});

/**
 * Record access for a devbox instance by ID or provider instance ID.
 */
export const recordAccess = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.optional(v.string()), // The devboxId
    providerInstanceId: v.optional(v.string()), // Or provider instance ID
    provider: v.optional(v.union(v.literal("morph"), v.literal("e2b"), v.literal("modal"))),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    let instance;

    const devboxId = args.id;
    const providerInstanceId = args.providerInstanceId;

    if (devboxId) {
      instance = await ctx.db
        .query("devboxInstances")
        .withIndex("by_devboxId", (q) => q.eq("devboxId", devboxId))
        .first();
    } else if (providerInstanceId) {
      // Look up by provider instance ID
      const info = await ctx.db
        .query("devboxInfo")
        .withIndex("by_providerInstanceId", (q) =>
          q.eq("providerInstanceId", providerInstanceId)
        )
        .first();

      if (info) {
        instance = await ctx.db
          .query("devboxInstances")
          .withIndex("by_devboxId", (q) => q.eq("devboxId", info.devboxId))
          .first();
      }
    }

    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    await ctx.db.patch(instance._id, {
      lastAccessedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal mutation to update instance status (for cron jobs or internal use).
 */
export const updateStatusInternal = internalMutation({
  args: {
    providerInstanceId: v.string(),
    status: instanceStatusValidator,
  },
  handler: async (ctx, args) => {
    // Look up devbox ID from provider info
    const info = await ctx.db
      .query("devboxInfo")
      .withIndex("by_providerInstanceId", (q) =>
        q.eq("providerInstanceId", args.providerInstanceId)
      )
      .first();

    if (!info) {
      return; // Instance not tracked, nothing to do
    }

    const instance = await ctx.db
      .query("devboxInstances")
      .withIndex("by_devboxId", (q) => q.eq("devboxId", info.devboxId))
      .first();

    if (!instance) {
      return;
    }

    const now = Date.now();
    const updates: {
      status: typeof args.status;
      updatedAt: number;
      stoppedAt?: number;
    } = {
      status: args.status,
      updatedAt: now,
    };

    if (args.status === "stopped") {
      updates.stoppedAt = now;
    }

    await ctx.db.patch(instance._id, updates);
  },
});

/**
 * Delete a devbox instance by ID.
 */
export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.string(), // The devboxId
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instance = await ctx.db
      .query("devboxInstances")
      .withIndex("by_devboxId", (q) => q.eq("devboxId", args.id))
      .first();

    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    // Also delete the provider info
    const info = await ctx.db
      .query("devboxInfo")
      .withIndex("by_devboxId", (q) => q.eq("devboxId", args.id))
      .first();

    if (info) {
      await ctx.db.delete(info._id);
    }

    await ctx.db.delete(instance._id);
  },
});
