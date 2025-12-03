import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const join = mutation({
  args: {
    email: v.string(),
    provider: v.union(v.literal("gitlab"), v.literal("bitbucket")),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if already on waitlist
    const existing = await ctx.db
      .query("previewWaitlist")
      .withIndex("by_email_provider", (q) =>
        q.eq("email", args.email).eq("provider", args.provider)
      )
      .first();

    if (existing) {
      // Already on waitlist, return existing entry
      return { id: existing._id, alreadyExists: true };
    }

    // Add to waitlist
    const id = await ctx.db.insert("previewWaitlist", {
      email: args.email,
      provider: args.provider,
      userId: args.userId,
      createdAt: Date.now(),
    });

    return { id, alreadyExists: false };
  },
});
