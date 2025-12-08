import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Upsert a user from Stack Auth webhook payload.
 * Called by the HTTP endpoint when receiving user.created or user.updated events.
 */
export const upsertFromWebhook = internalMutation({
  args: {
    userId: v.string(),
    primaryEmail: v.optional(v.string()),
    primaryEmailVerified: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    selectedTeamId: v.optional(v.string()),
    selectedTeamDisplayName: v.optional(v.string()),
    selectedTeamProfileImageUrl: v.optional(v.string()),
    hasPassword: v.optional(v.boolean()),
    signedUpAtMillis: v.optional(v.number()),
    lastActiveAtMillis: v.optional(v.number()),
    clientMetadata: v.optional(v.any()),
    clientReadOnlyMetadata: v.optional(v.any()),
    serverMetadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      // Update existing user
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return { action: "updated", id: existing._id };
    } else {
      // Create new user
      const id = await ctx.db.insert("users", {
        ...args,
        createdAt: now,
        updatedAt: now,
      });
      return { action: "created", id };
    }
  },
});

/**
 * Delete a user (called when user.deleted webhook is received)
 */
export const deleteFromWebhook = internalMutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { action: "deleted", id: existing._id };
    }
    return { action: "not_found" };
  },
});

/**
 * Get a user by their Stack Auth user ID
 */
export const getByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
  },
});
