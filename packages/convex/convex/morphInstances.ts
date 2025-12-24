import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Check if an instance has been stopped by the cleanup cron.
 * Returns the stop record if found, null otherwise.
 */
export const getStopRecord = query({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("morphInstanceStops")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
    return record;
  },
});

/**
 * Check if an instance is stopped (simple boolean check).
 */
export const isStopped = query({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("morphInstanceStops")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
    return record !== null;
  },
});
