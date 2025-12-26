import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { authMutation } from "./users/utils";
import { getTeamId } from "../_shared/team";

/**
 * Get the activity record for a Morph instance (public query).
 */
export const getActivity = query({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

/**
 * Get the activity record for a Morph instance (internal, for cron jobs).
 */
export const getActivityInternal = internalQuery({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

/**
 * Record that an instance was resumed via the UI.
 * Requires auth and verifies the user belongs to the team that owns the instance.
 */
export const recordResume = authMutation({
  args: {
    instanceId: v.string(),
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify user belongs to this team
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Find the taskRun that uses this instance to verify ownership
    const taskRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_vscode_container_name", (q) =>
        q.eq("vscode.containerName", args.instanceId)
      )
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .first();

    if (!taskRun) {
      throw new Error("Instance not found or not authorized");
    }

    const existing = await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastResumedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("morphInstanceActivity", {
        instanceId: args.instanceId,
        lastResumedAt: Date.now(),
      });
    }
  },
});

/**
 * Record that a Morph instance was paused (internal, for cron jobs).
 */
export const recordPauseInternal = internalMutation({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastPausedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("morphInstanceActivity", {
        instanceId: args.instanceId,
        lastPausedAt: Date.now(),
      });
    }
  },
});

/**
 * Record that a Morph instance was stopped (internal, for cron jobs).
 */
export const recordStopInternal = internalMutation({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stoppedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("morphInstanceActivity", {
        instanceId: args.instanceId,
        stoppedAt: Date.now(),
      });
    }
  },
});
