import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * Set the title on a conversation.
 */
export const setTitle = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return;
    }

    await ctx.db.patch(args.conversationId, {
      title: args.title,
    });
  },
});

/**
 * Check if a conversation needs a title and schedule generation if so.
 * Called after the first message is sent.
 */
export const maybeScheduleTitle = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageText: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return;
    }

    // Skip if title already exists
    if (conversation.title) {
      return;
    }

    // Check if this is the first message
    const existingMessages = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .take(2);

    // Only generate title if this is the first or second message (allowing for the just-inserted one)
    if (existingMessages.length > 2) {
      return;
    }

    // Schedule title generation in background (non-blocking)
    await ctx.scheduler.runAfter(
      0,
      internal.conversationSummary.generateTitle,
      {
        conversationId: args.conversationId,
        firstMessageText: args.messageText,
        teamId: conversation.teamId,
        userId: conversation.userId ?? "",
      }
    );
  },
});
