import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

type SubscriptionType = "low" | "mid" | "high";

const CONCURRENCY_LIMITS: Record<SubscriptionType, number> = {
  low: 50,
  mid: 100,
  high: 500,
};

const DEFAULT_CONCURRENCY_LIMIT = 10;

// GPUs ungated per tier (cumulative — higher tiers include lower tier GPUs)
const GPU_ACCESS: Record<SubscriptionType, string[]> = {
  low: ["L40S", "A100"],
  mid: ["L40S", "A100", "A100-80GB", "H100"],
  high: ["L40S", "A100", "A100-80GB", "H100", "H200", "B200"],
};

/**
 * Check if a user is allowed to create/resume another sandbox.
 * Counts running cloudrouter (cr_) devboxInstances for the user
 * and compares against their subscription tier limit.
 */
export const checkConcurrencyLimit = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("cloudRouterSubscription")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const tier = subscription?.subscriptionType ?? null;
    const limit = tier ? CONCURRENCY_LIMITS[tier] : DEFAULT_CONCURRENCY_LIMIT;

    const instances = await ctx.db
      .query("devboxInstances")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const current = instances.filter(
      (instance) =>
        instance.status === "running" &&
        instance.devboxId.startsWith("cr_"),
    ).length;

    const ungatedGpus = tier ? GPU_ACCESS[tier] : [];

    return {
      allowed: current < limit,
      limit,
      current,
      tier,
      ungatedGpus,
    };
  },
});
