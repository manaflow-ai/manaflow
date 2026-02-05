"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Handle conversation completion - create inbox entry and optionally send proactive SMS.
 * This is called by acp_callbacks.completeMessage when a conversation completes.
 */
export const onConversationComplete = internalAction({
  args: {
    conversationId: v.id("conversations"),
    status: v.string(),
    stopReason: v.string(),
  },
  handler: async (ctx, args) => {
    // Get the conversation to find the user
    const conversation = await ctx.runQuery(
      internal.conversations.getByIdInternal,
      { conversationId: args.conversationId }
    );

    if (!conversation || !conversation.userId) {
      // No user associated with this conversation
      return;
    }

    // Look up if the user has an SMS phone number linked
    const phoneUsers = await ctx.runQuery(
      internal.sms_phone_users.getByUserId,
      { userId: conversation.userId }
    );

    if (!phoneUsers || phoneUsers.length === 0) {
      // User doesn't have an SMS phone linked
      return;
    }

    // Get the last assistant message for the summary
    const messages = await ctx.runQuery(
      internal.conversationMessages.listByConversationInternal,
      { conversationId: args.conversationId, limit: 5 }
    );

    const lastAssistant = messages
      .filter((m) => m.role === "assistant")
      .pop();

    // Build short notification - don't truncate verbose responses
    // User can ask the SMS agent for details via get_status
    let summary: string;
    if (args.status === "completed") {
      // Just use title or generic completion
      const title = conversation.title;
      if (title && title.length < 40) {
        summary = title.toLowerCase();
      } else {
        summary = "task done";
      }
    } else if (args.status === "cancelled") {
      summary = "task cancelled";
    } else {
      // Error - try to get a short error message
      let errorMsg = "something went wrong";
      if (lastAssistant && lastAssistant.content) {
        const textContent = lastAssistant.content
          .filter((block) => block.type === "text" && block.text)
          .map((block) => block.text)
          .join(" ");
        // Only use if it's short enough to be useful
        if (textContent && textContent.length < 60) {
          errorMsg = textContent;
        }
      }
      summary = `hit a snag: ${errorMsg}`;
    }

    // For each phone user, add inbox entry and optionally send notification
    for (const phoneUser of phoneUsers) {
      // Add inbox entry
      await ctx.runMutation(internal.sms_queries.addInboxEntry, {
        phoneNumber: phoneUser.phoneNumber,
        conversationId: args.conversationId,
        type: args.status === "completed" ? "completed" : "error",
        summary,
      });

      // Trigger agent with notification context if user has notifications enabled
      // The agent will decide how to respond naturally using send_sms
      if (phoneUser.notifyOnCompletion) {
        await ctx.scheduler.runAfter(0, internal.sms.triggerAgentWithNotification, {
          phoneNumber: phoneUser.phoneNumber,
          conversationId: args.conversationId,
        });
      }
    }
  },
});
