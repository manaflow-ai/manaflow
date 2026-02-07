import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { ChatMessage } from "./sms_llm";

// ============= Internal Queries =============
// All SMS queries are internal-only to prevent unauthorized access

// Get all messages - internal only
export const getAllMessages = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("smsMessages").order("desc").take(100);
  },
});

// Get conversation with a specific number - internal only
export const getConversation = internalQuery({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const fromMessages = await ctx.db
      .query("smsMessages")
      .withIndex("by_from_number", (q) => q.eq("fromNumber", args.phoneNumber))
      .collect();

    const toMessages = await ctx.db
      .query("smsMessages")
      .withIndex("by_to_number", (q) => q.eq("toNumber", args.phoneNumber))
      .collect();

    const allMessages = [...fromMessages, ...toMessages];
    return allMessages.sort((a, b) => a._creationTime - b._creationTime);
  },
});

// Get webhook logs - internal only (for debugging)
export const getWebhookLogs = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("smsWebhookLogs").order("desc").take(50);
  },
});

// Get conversation history for LLM context
export const getConversationHistory = internalQuery({
  args: {
    phoneNumber: v.string(),
    groupId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ChatMessage[]> => {
    const limit = args.limit ?? 20;

    let allMessages;

    if (args.groupId) {
      // Group chat: fetch by group_id
      allMessages = await ctx.db
        .query("smsMessages")
        .withIndex("by_group_id", (q) => q.eq("groupId", args.groupId))
        .collect();
    } else {
      // 1:1 chat: fetch by phone number (existing logic)
      const fromMessages = await ctx.db
        .query("smsMessages")
        .withIndex("by_from_number", (q) => q.eq("fromNumber", args.phoneNumber))
        .collect();

      const toMessages = await ctx.db
        .query("smsMessages")
        .withIndex("by_to_number", (q) => q.eq("toNumber", args.phoneNumber))
        .collect();

      // Filter out group messages from 1:1 history
      allMessages = [...fromMessages, ...toMessages].filter(
        (msg) => !msg.groupId
      );
    }

    // Sort by creation time and take the most recent N messages
    const sortedMessages = allMessages
      .sort((a, b) => a._creationTime - b._creationTime)
      .slice(-limit);

    // Map to ChatMessage format
    // For group chats, prefix user messages with sender's last 4 digits
    // Annotate media URLs so the agent can see them and call view_media
    return sortedMessages.map((msg) => {
      let text = msg.content || "";
      if (msg.mediaUrl) {
        text += text ? `\n[image attached: ${msg.mediaUrl}]` : `[image attached: ${msg.mediaUrl}]`;
      }

      if (msg.isOutbound) {
        return { role: "assistant" as const, content: text };
      }
      // For inbound messages in groups, include sender identity
      if (args.groupId) {
        const senderShort = msg.fromNumber.slice(-4);
        return {
          role: "user" as const,
          content: `[${senderShort}]: ${text}`,
        };
      }
      return { role: "user" as const, content: text };
    });
  },
});

// Check if we've sent at least one message to a number (for typing indicator route check)
export const hasOutboundMessage = internalQuery({
  args: { toNumber: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const message = await ctx.db
      .query("smsMessages")
      .withIndex("by_to_number", (q) => q.eq("toNumber", args.toNumber))
      .filter((q) => q.eq(q.field("isOutbound"), true))
      .first();
    return message !== null;
  },
});

// ============= Internal Mutations =============

export const logWebhook = internalMutation({
  args: {
    eventType: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("smsWebhookLogs", {
      eventType: args.eventType,
      payload: args.payload,
      processedAt: Date.now(),
    });
  },
});

export const processWebhookMessage = internalMutation({
  args: {
    content: v.string(),
    fromNumber: v.string(),
    toNumber: v.string(),
    isOutbound: v.boolean(),
    status: v.string(),
    service: v.optional(v.string()),
    messageHandle: v.optional(v.string()),
    dateSent: v.optional(v.string()),
    errorCode: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    // Group chat fields
    groupId: v.optional(v.string()),
    participants: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Check for duplicates by message handle
    if (args.messageHandle) {
      const existing = await ctx.db
        .query("smsMessages")
        .withIndex("by_message_handle", (q) =>
          q.eq("messageHandle", args.messageHandle)
        )
        .first();

      if (existing) {
        // Update existing message status
        await ctx.db.patch(existing._id, {
          status: args.status,
          errorCode: args.errorCode,
          errorMessage: args.errorMessage,
        });
        return existing._id;
      }
    }

    // Insert new message
    return await ctx.db.insert("smsMessages", {
      content: args.content,
      fromNumber: args.fromNumber,
      toNumber: args.toNumber,
      isOutbound: args.isOutbound,
      status: args.status,
      service: args.service,
      messageHandle: args.messageHandle,
      dateSent: args.dateSent,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      mediaUrl: args.mediaUrl,
      groupId: args.groupId,
      participants: args.participants,
    });
  },
});

export const storeOutboundMessage = internalMutation({
  args: {
    content: v.string(),
    toNumber: v.string(),
    fromNumber: v.string(),
    sendStyle: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("smsMessages", {
      content: args.content,
      fromNumber: args.fromNumber,
      toNumber: args.toNumber,
      isOutbound: true,
      status: "pending",
      sendStyle: args.sendStyle,
      mediaUrl: args.mediaUrl,
    });
  },
});

export const storeOutboundGroupMessage = internalMutation({
  args: {
    content: v.string(),
    groupId: v.string(),
    fromNumber: v.string(),
    mediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("smsMessages", {
      content: args.content,
      fromNumber: args.fromNumber,
      toNumber: "", // Group messages don't have a single toNumber
      isOutbound: true,
      status: "pending",
      groupId: args.groupId,
      mediaUrl: args.mediaUrl,
    });
  },
});

export const updateMessageStatus = internalMutation({
  args: {
    messageId: v.id("smsMessages"),
    status: v.string(),
    messageHandle: v.optional(v.string()),
    errorCode: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      status: args.status,
      messageHandle: args.messageHandle,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
    });
  },
});

export const updateMessageMediaUrl = internalMutation({
  args: {
    messageId: v.id("smsMessages"),
    mediaUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      mediaUrl: args.mediaUrl,
    });
  },
});

// ============= SMS Agent Inbox Queries/Mutations =============

/**
 * Get unread inbox entries for a phone number.
 */
export const getUnreadInbox = internalQuery({
  args: {
    phoneNumber: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("smsAgentInbox")
      .withIndex("by_phone_unread", (q) =>
        q.eq("phoneNumber", args.phoneNumber).eq("isRead", false)
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * Get all inbox entries for a phone number (for list_conversations).
 */
export const getInboxForPhone = internalQuery({
  args: {
    phoneNumber: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("smsAgentInbox")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .order("desc")
      .take(limit);
  },
});

/**
 * Mark inbox entries as read.
 */
export const markInboxRead = internalMutation({
  args: {
    phoneNumber: v.string(),
    conversationIds: v.optional(v.array(v.id("conversations"))),
  },
  handler: async (ctx, args) => {
    // If specific conversation IDs provided, mark only those
    if (args.conversationIds && args.conversationIds.length > 0) {
      for (const conversationId of args.conversationIds) {
        const entries = await ctx.db
          .query("smsAgentInbox")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conversationId)
          )
          .filter((q) =>
            q.and(
              q.eq(q.field("phoneNumber"), args.phoneNumber),
              q.eq(q.field("isRead"), false)
            )
          )
          .collect();

        for (const entry of entries) {
          await ctx.db.patch(entry._id, { isRead: true });
        }
      }
    } else {
      // Mark all unread entries for this phone as read
      const entries = await ctx.db
        .query("smsAgentInbox")
        .withIndex("by_phone_unread", (q) =>
          q.eq("phoneNumber", args.phoneNumber).eq("isRead", false)
        )
        .collect();

      for (const entry of entries) {
        await ctx.db.patch(entry._id, { isRead: true });
      }
    }
  },
});

/**
 * Mark all inbox entries as read for a phone number.
 * Used by triggerAgentWithNotification after the agent processes notifications.
 */
export const markAllInboxRead = internalMutation({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("smsAgentInbox")
      .withIndex("by_phone_unread", (q) =>
        q.eq("phoneNumber", args.phoneNumber).eq("isRead", false)
      )
      .collect();

    for (const entry of unread) {
      await ctx.db.patch(entry._id, { isRead: true });
    }
  },
});

/**
 * Add an inbox entry for a phone number.
 */
export const addInboxEntry = internalMutation({
  args: {
    phoneNumber: v.string(),
    conversationId: v.id("conversations"),
    type: v.union(
      v.literal("started"),
      v.literal("message"),
      v.literal("completed"),
      v.literal("error")
    ),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("smsAgentInbox", {
      phoneNumber: args.phoneNumber,
      conversationId: args.conversationId,
      type: args.type,
      summary: args.summary,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

/**
 * Get conversations for a phone number's user.
 * Used by the list_conversations and search_conversations tools.
 */
export const getConversationsForPhone = internalQuery({
  args: {
    phoneNumber: v.string(),
    userId: v.string(),
    teamId: v.string(),
    status: v.optional(
      v.union(v.literal("active"), v.literal("completed"), v.literal("all"))
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const status = args.status ?? "all";

    let query = ctx.db
      .query("conversations")
      .withIndex("by_team_user_updated", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .order("desc");

    if (status !== "all") {
      query = query.filter((q) => q.eq(q.field("status"), status));
    }

    return await query.take(limit);
  },
});

/**
 * Search conversations by query string.
 */
export const searchConversations = internalQuery({
  args: {
    userId: v.string(),
    teamId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const queryLower = args.query.toLowerCase();

    // Get all conversations for this user
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_team_user_updated", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .order("desc")
      .take(100); // Limit to recent 100 for search

    // Filter by query (matching title)
    const matching = conversations.filter((conv) => {
      if (conv.title && conv.title.toLowerCase().includes(queryLower)) {
        return true;
      }
      return false;
    });

    return matching.slice(0, limit);
  },
});

/**
 * Get sandbox info for a conversation.
 * Returns the sandbox URL and instance ID for constructing port URLs.
 */
export const getSandboxInfo = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return { success: false, error: "Conversation not found" };
    }

    if (!conversation.acpSandboxId) {
      return { success: false, error: "Conversation has no sandbox" };
    }

    const sandbox = await ctx.db.get(conversation.acpSandboxId);
    if (!sandbox) {
      return { success: false, error: "Sandbox not found" };
    }

    return {
      success: true,
      provider: sandbox.provider,
      instanceId: sandbox.instanceId,
      sandboxUrl: sandbox.sandboxUrl,
      status: sandbox.status,
    };
  },
});
