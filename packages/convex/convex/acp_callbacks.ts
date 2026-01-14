import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Content block validator
const contentBlockValidator = v.object({
  type: v.union(
    v.literal("text"),
    v.literal("image"),
    v.literal("resource_link")
  ),
  text: v.optional(v.string()),
  data: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  uri: v.optional(v.string()),
  name: v.optional(v.string()),
});

// Tool call validator
const toolCallValidator = v.object({
  id: v.string(),
  name: v.string(),
  arguments: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed")
  ),
  result: v.optional(v.string()),
});

/**
 * Append a message chunk to an existing or new assistant message.
 * Called by sandbox during streaming responses.
 */
export const appendMessageChunk = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.optional(v.id("conversationMessages")),
    content: contentBlockValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // If no messageId, create a new assistant message
    if (!args.messageId) {
      const newMessageId = await ctx.db.insert("conversationMessages", {
        conversationId: args.conversationId,
        role: "assistant",
        content: [args.content],
        createdAt: now,
      });

      // Update conversation activity
      await ctx.db.patch(args.conversationId, {
        lastMessageAt: now,
        updatedAt: now,
      });

      return newMessageId;
    }

    // Append to existing message
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    // For text chunks, try to append to the last text block if possible
    if (args.content.type === "text" && args.content.text) {
      const lastBlock = message.content[message.content.length - 1];
      if (lastBlock?.type === "text" && lastBlock.text !== undefined) {
        // Append to existing text block
        const updatedContent = [...message.content];
        updatedContent[updatedContent.length - 1] = {
          ...lastBlock,
          text: (lastBlock.text ?? "") + args.content.text,
        };
        await ctx.db.patch(args.messageId, { content: updatedContent });
      } else {
        // Add new text block
        await ctx.db.patch(args.messageId, {
          content: [...message.content, args.content],
        });
      }
    } else {
      // Add new content block
      await ctx.db.patch(args.messageId, {
        content: [...message.content, args.content],
      });
    }

    // Update conversation activity
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      updatedAt: now,
    });

    return args.messageId;
  },
});

/**
 * Append a reasoning/thought chunk to a message.
 * Called by sandbox during extended thinking responses.
 */
export const appendReasoningChunk = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.optional(v.id("conversationMessages")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // If no messageId, create a new assistant message with reasoning
    if (!args.messageId) {
      const newMessageId = await ctx.db.insert("conversationMessages", {
        conversationId: args.conversationId,
        role: "assistant",
        content: [],
        reasoning: args.text,
        createdAt: now,
      });

      // Update conversation activity
      await ctx.db.patch(args.conversationId, {
        lastMessageAt: now,
        updatedAt: now,
      });

      return newMessageId;
    }

    // Append to existing message's reasoning
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    const existingReasoning = message.reasoning ?? "";
    await ctx.db.patch(args.messageId, {
      reasoning: existingReasoning + args.text,
    });

    // Update conversation activity
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      updatedAt: now,
    });

    return args.messageId;
  },
});

/**
 * Mark a message as complete with stop reason.
 */
export const completeMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("conversationMessages"),
    stopReason: v.union(
      v.literal("end_turn"),
      v.literal("max_tokens"),
      v.literal("max_turn_requests"),
      v.literal("refusal"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Update conversation status based on stop reason
    const conversation = await ctx.db.get(args.conversationId);
    if (conversation && conversation.status === "active") {
      const newStatus =
        args.stopReason === "cancelled" ? "cancelled" : "completed";
      await ctx.db.patch(args.conversationId, {
        status: newStatus,
        stopReason: args.stopReason,
        lastMessageAt: now,
        updatedAt: now,
      });

      // Decrement sandbox conversation count when conversation ends
      if (conversation.acpSandboxId) {
        const sandbox = await ctx.db.get(conversation.acpSandboxId);
        if (sandbox) {
          await ctx.db.patch(conversation.acpSandboxId, {
            conversationCount: Math.max(0, sandbox.conversationCount - 1),
            lastActivityAt: now,
          });
        }
      }
    }
  },
});

/**
 * Record a tool call on a message.
 */
export const recordToolCall = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("conversationMessages"),
    toolCall: toolCallValidator,
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    const existingToolCalls = message.toolCalls ?? [];

    // Check if this tool call already exists (update) or is new (append)
    const existingIndex = existingToolCalls.findIndex(
      (tc) => tc.id === args.toolCall.id
    );

    let updatedToolCalls;
    if (existingIndex >= 0) {
      // Update existing
      updatedToolCalls = [...existingToolCalls];
      updatedToolCalls[existingIndex] = args.toolCall;
    } else {
      // Append new
      updatedToolCalls = [...existingToolCalls, args.toolCall];
    }

    await ctx.db.patch(args.messageId, { toolCalls: updatedToolCalls });

    // Update conversation activity
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Record an error on a conversation.
 */
export const recordError = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    code: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.error("[acp.callback] Conversation error", {
      conversationId: args.conversationId,
      code: args.code,
      detail: args.detail,
    });

    const now = Date.now();

    // Update conversation status to error
    const conversation = await ctx.db.get(args.conversationId);
    if (conversation) {
      await ctx.db.patch(args.conversationId, {
        status: "error",
        updatedAt: now,
      });

      // Decrement sandbox conversation count
      if (conversation.acpSandboxId) {
        const sandbox = await ctx.db.get(conversation.acpSandboxId);
        if (sandbox) {
          await ctx.db.patch(conversation.acpSandboxId, {
            conversationCount: Math.max(0, sandbox.conversationCount - 1),
            lastActivityAt: now,
          });
        }
      }
    }
  },
});

/**
 * Mark a sandbox as ready with its URL.
 * Called when sandbox finishes starting up.
 */
export const sandboxReady = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    sandboxUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      status: "running",
      sandboxUrl: args.sandboxUrl,
      lastActivityAt: Date.now(),
    });
  },
});
