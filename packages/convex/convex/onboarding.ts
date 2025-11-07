import { v } from "convex/values";
import { authMutation, authQuery } from "./users/utils";

/**
 * Get the current user's onboarding state
 */
export const getOnboardingState = authQuery({
  args: {},
  handler: async (ctx) => {
    const userId = ctx.identity.subject;

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!user) {
      return {
        hasCompletedOnboarding: false,
        onboardingStep: undefined,
        onboardingCompletedAt: undefined,
      };
    }

    return {
      hasCompletedOnboarding: user.hasCompletedOnboarding ?? false,
      onboardingStep: user.onboardingStep ?? undefined,
      onboardingCompletedAt: user.onboardingCompletedAt ?? undefined,
    };
  },
});

/**
 * Update the user's current onboarding step
 */
export const updateOnboardingStep = authMutation({
  args: {
    step: v.string(),
  },
  handler: async (ctx, { step }) => {
    const userId = ctx.identity.subject;

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      onboardingStep: step,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Mark onboarding as complete
 */
export const completeOnboarding = authMutation({
  args: {},
  handler: async (ctx) => {
    const userId = ctx.identity.subject;

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      hasCompletedOnboarding: true,
      onboardingCompletedAt: Date.now(),
      onboardingStep: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Reset onboarding state (for testing or re-onboarding)
 */
export const resetOnboarding = authMutation({
  args: {},
  handler: async (ctx) => {
    const userId = ctx.identity.subject;

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      hasCompletedOnboarding: false,
      onboardingCompletedAt: undefined,
      onboardingStep: undefined,
      updatedAt: Date.now(),
    });
  },
});
