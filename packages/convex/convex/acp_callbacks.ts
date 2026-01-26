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

function isVisibleContentBlock(
  content: { type: string; text?: string | null }
): boolean {
  if (content.type === "text") {
    return Boolean(content.text?.trim());
  }
  return content.type === "image" || content.type === "resource_link";
}

/**
 * Append a message chunk to an existing or new assistant message.
 * Called by sandbox during streaming responses.
 */
export const appendMessageChunk = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.optional(v.id("conversationMessages")),
    createdAt: v.optional(v.number()),
    eventSeq: v.optional(v.number()),
    content: contentBlockValidator,
  },
  handler: async (ctx, args) => {
    // Always use Convex server time for message creation.
    // Sandbox timestamps can be stale after snapshot restore due to clock sync delays.
    const now = Date.now();
    const shouldUpdateVisible = isVisibleContentBlock(args.content);

    // If no messageId, create a new assistant message
    if (!args.messageId) {
      const newMessageId = await ctx.db.insert("conversationMessages", {
        conversationId: args.conversationId,
        role: "assistant",
        content: [args.content],
        acpSeq: args.eventSeq,
        createdAt: now,
      });

      // Update conversation activity
      await ctx.db.patch(args.conversationId, {
        lastMessageAt: now,
        updatedAt: now,
        ...(shouldUpdateVisible ? { lastAssistantVisibleAt: now } : {}),
      });

      return newMessageId;
    }

    // Append to existing message
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    // Track the highest sequence number for the message
    const nextSeq =
      args.eventSeq !== undefined
        ? Math.max(message.acpSeq ?? 0, args.eventSeq)
        : message.acpSeq;

    // Add content block with sequence number for chronological ordering
    const contentWithSeq = {
      ...args.content,
      acpSeq: args.eventSeq,
    };

    if (args.content.type === "text" && args.content.text) {
      const lastBlock = message.content[message.content.length - 1];
      // Only append to the last text block if it has the same sequence number
      // (i.e., it's part of the same streaming chunk, not a new segment after tool calls)
      if (
        lastBlock?.type === "text" &&
        lastBlock.text !== undefined &&
        lastBlock.acpSeq === args.eventSeq
      ) {
        // Append to existing text block with same sequence
        const updatedContent = [...message.content];
        updatedContent[updatedContent.length - 1] = {
          ...lastBlock,
          text: (lastBlock.text ?? "") + args.content.text,
        };
        await ctx.db.patch(args.messageId, {
          content: updatedContent,
          acpSeq: nextSeq,
        });
      } else {
        // Add new text block with sequence number
        await ctx.db.patch(args.messageId, {
          content: [...message.content, contentWithSeq],
          acpSeq: nextSeq,
        });
      }
    } else {
      // Add new content block with sequence number
      await ctx.db.patch(args.messageId, {
        content: [...message.content, contentWithSeq],
        acpSeq: nextSeq,
      });
    }

    // Update conversation activity
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      updatedAt: now,
      ...(shouldUpdateVisible
        ? { lastAssistantVisibleAt: message.createdAt }
        : {}),
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
    createdAt: v.optional(v.number()),
    eventSeq: v.optional(v.number()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    // Always use Convex server time - sandbox timestamps can be stale after snapshot restore.
    const now = Date.now();

    // If no messageId, create a new assistant message with reasoning
    if (!args.messageId) {
      const newMessageId = await ctx.db.insert("conversationMessages", {
        conversationId: args.conversationId,
        role: "assistant",
        content: [],
        reasoning: args.text,
        acpSeq: args.eventSeq,
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
      acpSeq:
        args.eventSeq !== undefined
          ? Math.max(message.acpSeq ?? 0, args.eventSeq)
          : message.acpSeq,
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

    // Mark the message as final (this message ends the turn)
    await ctx.db.patch(args.messageId, {
      isFinal: true,
    });

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
    eventSeq: v.optional(v.number()),
    toolCall: toolCallValidator,
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    const existingToolCalls = message.toolCalls ?? [];

    // Add sequence number to the tool call for chronological ordering
    const toolCallWithSeq = {
      ...args.toolCall,
      acpSeq: args.eventSeq,
    };

    // Check if this tool call already exists (update) or is new (append)
    const existingIndex = existingToolCalls.findIndex(
      (tc) => tc.id === args.toolCall.id
    );

    let updatedToolCalls;
    if (existingIndex >= 0) {
      // Update existing - preserve the original sequence number
      updatedToolCalls = [...existingToolCalls];
      updatedToolCalls[existingIndex] = {
        ...toolCallWithSeq,
        acpSeq: existingToolCalls[existingIndex].acpSeq ?? args.eventSeq,
      };
    } else {
      // Append new
      updatedToolCalls = [...existingToolCalls, toolCallWithSeq];
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
 * Record an error on a sandbox (when conversation ID is not available).
 * Looks up the most recent active conversation for the sandbox and marks it as error.
 * Used by the API proxy when it detects persistent errors (e.g., 429 after retries).
 */
export const recordSandboxError = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    teamId: v.string(),
    code: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.error("[acp.callback] Sandbox error", {
      sandboxId: args.sandboxId,
      teamId: args.teamId,
      code: args.code,
      detail: args.detail,
    });

    const now = Date.now();

    // Find the most recent active conversation for this sandbox
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_acp_sandbox", (q) => q.eq("acpSandboxId", args.sandboxId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .first();

    if (!conversation) {
      console.warn(
        "[acp.callback] No active conversation found for sandbox error",
        { sandboxId: args.sandboxId }
      );
      return;
    }

    // Update conversation status to error
    await ctx.db.patch(conversation._id, {
      status: "error",
      updatedAt: now,
    });

    // Log error to raw events for debugging
    await ctx.db.insert("acpRawEvents", {
      conversationId: conversation._id,
      sandboxId: args.sandboxId,
      teamId: args.teamId,
      seq: now,
      raw: JSON.stringify({
        type: "sandbox_error",
        code: args.code,
        detail: args.detail,
        timestamp: new Date(now).toISOString(),
      }),
      direction: "inbound",
      eventType: "error",
      createdAt: now,
    });

    // Decrement sandbox conversation count
    const sandbox = await ctx.db.get(args.sandboxId);
    if (sandbox) {
      await ctx.db.patch(args.sandboxId, {
        conversationCount: Math.max(0, sandbox.conversationCount - 1),
        lastActivityAt: now,
      });
    }
  },
});

/**
 * Record raw ACP events for a conversation.
 */
export const appendRawEvents = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    sandboxId: v.id("acpSandboxes"),
    teamId: v.string(),
    rawEvents: v.array(
      v.object({
        seq: v.number(),
        raw: v.string(),
        createdAt: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let hasError = false;
    let errorMessage: string | undefined;

    for (const event of args.rawEvents) {
      await ctx.db.insert("acpRawEvents", {
        conversationId: args.conversationId,
        sandboxId: args.sandboxId,
        teamId: args.teamId,
        seq: event.seq,
        raw: event.raw,
        direction: "inbound",
        eventType: "rpc",
        createdAt: event.createdAt ?? now,
      });

      // Check if this is a JSON-RPC error response
      // Format: {"jsonrpc":"2.0","id":"...","error":{"code":..,"message":"..."}}
      try {
        const parsed = JSON.parse(event.raw);
        if (parsed.jsonrpc === "2.0" && parsed.error) {
          hasError = true;
          const errData = parsed.error.data;
          errorMessage =
            errData?.message || parsed.error.message || "Unknown error";
          console.error("[acp.callback] JSON-RPC error detected", {
            conversationId: args.conversationId,
            code: parsed.error.code,
            message: errorMessage,
          });
        }
      } catch {
        // Not JSON or malformed - ignore
      }
    }

    // If any event contained an error, mark conversation as error
    if (hasError) {
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
              lastError: errorMessage,
            });
          }
        }
      }
    } else {
      await ctx.db.patch(args.conversationId, {
        lastMessageAt: now,
        updatedAt: now,
      });
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
