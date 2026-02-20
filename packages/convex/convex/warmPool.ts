import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Create a prewarm entry when a user starts typing a task description.
 * Called from the www /sandboxes/prewarm endpoint.
 * Returns the entry ID so the background provisioner can update it.
 */
export const createPrewarmEntry = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    snapshotId: v.string(),
    repoUrl: v.optional(v.string()),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Cancel any existing provisioning/ready entries for this user+team+repo
    // to avoid accumulating stale prewarmed instances
    const existing = await ctx.db
      .query("warmPool")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "provisioning")
      )
      .collect();

    const existingReady = await ctx.db
      .query("warmPool")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "ready")
      )
      .collect();

    for (const entry of [...existing, ...existingReady]) {
      if (entry.userId === args.userId) {
        // If same repo is already prewarming/ready, skip creating a new one
        if (entry.repoUrl === args.repoUrl) {
          return { id: entry._id, alreadyExists: true };
        }
        // Different repo - mark old one as failed so cleanup removes it
        await ctx.db.patch(entry._id, {
          status: "failed",
          errorMessage: "Superseded by new prewarm request",
          updatedAt: now,
        });
      }
    }

    const id = await ctx.db.insert("warmPool", {
      instanceId: "",
      snapshotId: args.snapshotId,
      status: "provisioning",
      teamId: args.teamId,
      userId: args.userId,
      repoUrl: args.repoUrl,
      branch: args.branch,
      createdAt: now,
      updatedAt: now,
    });

    return { id, alreadyExists: false };
  },
});

/**
 * Claim a ready prewarmed instance matching the given team and repo.
 * Returns the claimed entry or null if no match found.
 */
export const claimInstance = mutation({
  args: {
    teamId: v.string(),
    repoUrl: v.optional(v.string()),
    taskRunId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find ready instances for this team
    const readyInstances = await ctx.db
      .query("warmPool")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "ready")
      )
      .collect();

    // Find the best match: same repo URL
    const match = readyInstances.find(
      (entry) => entry.repoUrl === args.repoUrl
    );

    if (!match) {
      return null;
    }

    await ctx.db.patch(match._id, {
      status: "claimed",
      claimedAt: Date.now(),
      claimedByTaskRunId: args.taskRunId,
      updatedAt: Date.now(),
    });

    return {
      instanceId: match.instanceId,
      vscodeUrl: match.vscodeUrl,
      workerUrl: match.workerUrl,
      repoUrl: match.repoUrl,
      branch: match.branch,
    };
  },
});

/**
 * Mark a provisioning instance as ready with its Morph instance details.
 * Public mutation so the www server can call it after background provisioning.
 */
export const markInstanceReady = mutation({
  args: {
    id: v.id("warmPool"),
    instanceId: v.string(),
    vscodeUrl: v.string(),
    workerUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.status !== "provisioning") {
      // Entry was superseded or cleaned up
      return;
    }
    await ctx.db.patch(args.id, {
      status: "ready",
      instanceId: args.instanceId,
      vscodeUrl: args.vscodeUrl,
      workerUrl: args.workerUrl,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Mark a provisioning instance as failed.
 * Public mutation so the www server can call it after background provisioning.
 */
export const markInstanceFailed = mutation({
  args: {
    id: v.id("warmPool"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.id);
    if (!entry) return;
    await ctx.db.patch(args.id, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Remove a warm pool entry by Morph instance ID.
 * Used when cleanup crons pause/stop warm pool instances.
 */
export const removeByInstanceId = internalMutation({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("warmPool")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (entry) {
      await ctx.db.delete(entry._id);
    }
  },
});

/**
 * Remove stale entries from the warm pool.
 * - Failed entries older than 1 hour
 * - Claimed entries older than 24 hours
 * - Provisioning entries older than 10 minutes (stuck)
 * - Ready entries older than 50 minutes (approaching TTL pause)
 */
export const cleanupStaleEntries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;
    const TEN_MINUTES = 10 * 60 * 1000;
    const FIFTY_MINUTES = 50 * 60 * 1000;

    const allEntries = await ctx.db.query("warmPool").collect();

    let removedCount = 0;

    for (const entry of allEntries) {
      const age = now - entry.createdAt;
      let shouldRemove = false;

      switch (entry.status) {
        case "failed":
          shouldRemove = age > ONE_HOUR;
          break;
        case "claimed":
          shouldRemove = age > TWENTY_FOUR_HOURS;
          break;
        case "provisioning":
          shouldRemove = age > TEN_MINUTES;
          break;
        case "ready":
          shouldRemove = age > FIFTY_MINUTES;
          break;
      }

      if (shouldRemove) {
        await ctx.db.delete(entry._id);
        removedCount++;
      }
    }

    return { removedCount };
  },
});
