"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "../_shared/convex-env";

/**
 * Clean up stale warm pool entries.
 * Called by a daily cron job.
 */
export const cleanupWarmPool = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!env.CONVEX_IS_PRODUCTION) {
      console.log("[warmPool:cleanup] Skipping: not in production");
      return;
    }

    const result = await ctx.runMutation(
      internal.warmPool.cleanupStaleEntries
    );
    console.log(
      `[warmPool:cleanup] Removed ${result.removedCount} stale entries`
    );
  },
});
