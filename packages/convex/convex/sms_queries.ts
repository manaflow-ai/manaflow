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
    return sortedMessages.map((msg) => {
      if (msg.isOutbound) {
        return { role: "assistant" as const, content: msg.content };
      }
      // For inbound messages in groups, include sender identity
      if (args.groupId) {
        const senderShort = msg.fromNumber.slice(-4);
        return {
          role: "user" as const,
          content: `[${senderShort}]: ${msg.content}`,
        };
      }
      return { role: "user" as const, content: msg.content };
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("smsMessages", {
      content: args.content,
      fromNumber: args.fromNumber,
      toNumber: args.toNumber,
      isOutbound: true,
      status: "pending",
      sendStyle: args.sendStyle,
    });
  },
});

export const storeOutboundGroupMessage = internalMutation({
  args: {
    content: v.string(),
    groupId: v.string(),
    fromNumber: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("smsMessages", {
      content: args.content,
      fromNumber: args.fromNumber,
      toNumber: "", // Group messages don't have a single toNumber
      isOutbound: true,
      status: "pending",
      groupId: args.groupId,
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
