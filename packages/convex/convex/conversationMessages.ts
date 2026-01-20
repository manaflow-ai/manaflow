import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { authQuery } from "./users/utils";

// Content block validator matching ACP ContentBlock types
const contentBlockValidator = v.object({
  type: v.union(
    v.literal("text"),
    v.literal("image"),
    v.literal("audio"),
    v.literal("resource_link"),
    v.literal("resource")
  ),
  // Text content
  text: v.optional(v.string()),
  // Image/Audio content (base64 encoded)
  data: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  uri: v.optional(v.string()),
  // Resource content (embedded)
  resource: v.optional(
    v.object({
      uri: v.string(),
      text: v.optional(v.string()),
      blob: v.optional(v.string()),
      mimeType: v.optional(v.string()),
    })
  ),
  // Resource link properties
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  size: v.optional(v.number()),
  title: v.optional(v.string()),
  // Annotations
  annotations: v.optional(
    v.object({
      audience: v.optional(v.array(v.string())),
      lastModified: v.optional(v.string()),
      priority: v.optional(v.number()),
    })
  ),
});

function hasVisibleAssistantContent(
  content: Array<{
    type: string;
    text?: string | null;
  }>
): boolean {
  for (const block of content) {
    if (block.type === "text") {
      if (block.text?.trim()) {
        return true;
      }
      continue;
    }
    if (
      block.type === "image" ||
      block.type === "audio" ||
      block.type === "resource_link" ||
      block.type === "resource"
    ) {
      return true;
    }
  }
  return false;
}

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

const roleValidator = v.union(v.literal("user"), v.literal("assistant"));
const deliveryStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("error")
);
const OPTIMISTIC_CONVERSATION_PREFIX = "client-";
const DEFAULT_FIRST_PAGE_SIZE = 40;
const MAX_FIRST_PAGE_SIZE = 200;

function clampPageSize(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), MAX_FIRST_PAGE_SIZE);
}

async function requireTeamMembership(
  ctx: QueryCtx,
  teamSlugOrId: string
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const teamId = await resolveTeamIdLoose(ctx, teamSlugOrId);
  const membership = await ctx.db
    .query("teamMemberships")
    .withIndex("by_team_user", (q) =>
      q.eq("teamId", teamId).eq("userId", identity.subject)
    )
    .first();
  if (!membership) {
    throw new Error("Forbidden: Not a member of this team");
  }

  return teamId;
}

// Create a new message (internal - called from ACP server)
export const create = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: roleValidator,
    content: v.array(contentBlockValidator),
    toolCalls: v.optional(v.array(toolCallValidator)),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("conversationMessages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      toolCalls: args.toolCalls,
      deliveryStatus: args.role === "user" ? "queued" : undefined,
      deliverySwapAttempted: args.role === "user" ? false : undefined,
      createdAt: now,
    });

    // Update conversation's updatedAt
    await ctx.db.patch(args.conversationId, {
      updatedAt: now,
      ...(args.role === "assistant" &&
      hasVisibleAssistantContent(args.content)
        ? { lastAssistantVisibleAt: now }
        : {}),
    });

    return messageId;
  },
});

export const updateDeliveryStatus = internalMutation({
  args: {
    messageId: v.id("conversationMessages"),
    status: deliveryStatusValidator,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    await ctx.db.patch(args.messageId, {
      deliveryStatus: args.status,
      deliveryError: args.error,
    });
  },
});

export const markDeliverySwapAttempted = internalMutation({
  args: {
    messageId: v.id("conversationMessages"),
    attempted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    await ctx.db.patch(args.messageId, {
      deliverySwapAttempted: args.attempted,
    });
  },
});

// Update tool call status in a message
export const updateToolCall = internalMutation({
  args: {
    messageId: v.id("conversationMessages"),
    toolCallId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    result: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (!message.toolCalls) {
      throw new Error("Message has no tool calls");
    }

    const updatedToolCalls = message.toolCalls.map((tc) => {
      if (tc.id === args.toolCallId) {
        return {
          ...tc,
          status: args.status,
          result: args.result ?? tc.result,
        };
      }
      return tc;
    });

    await ctx.db.patch(args.messageId, {
      toolCalls: updatedToolCalls,
    });
  },
});

// Append content to an existing message (for streaming)
export const appendContent = internalMutation({
  args: {
    messageId: v.id("conversationMessages"),
    content: v.array(contentBlockValidator),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    await ctx.db.patch(args.messageId, {
      content: [...message.content, ...args.content],
    });

    // Update conversation's updatedAt
    await ctx.db.patch(message.conversationId, {
      updatedAt: Date.now(),
      ...(message.role === "assistant" &&
      hasVisibleAssistantContent(args.content)
        ? { lastAssistantVisibleAt: message.createdAt }
        : {}),
    });
  },
});

// Get messages for a conversation (internal)
export const listByConversationInternal = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc")
      .take(limit);
  },
});

// Get messages for a conversation (authenticated, paginated)
export const listByConversation = authQuery({
  args: {
    teamSlugOrId: v.string(),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamId = await requireTeamMembership(ctx, args.teamSlugOrId);

    // Verify conversation belongs to team
    const conversation = await ctx.db.get(args.conversationId);
    if (conversation && conversation.teamId !== teamId) {
      throw new Error("Conversation not found");
    }

    const limit = args.limit ?? 100;
    const result = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    return {
      messages: result.page,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const listByConversationPaginated = authQuery({
  args: {
    teamSlugOrId: v.string(),
    conversationId: v.union(v.id("conversations"), v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const teamId = await requireTeamMembership(ctx, args.teamSlugOrId);
    const conversationId = args.conversationId as Id<"conversations">;
    if (!args.conversationId.startsWith(OPTIMISTIC_CONVERSATION_PREFIX)) {
      const conversation = await ctx.db.get(conversationId);
      if (conversation && conversation.teamId !== teamId) {
        throw new Error("Conversation not found");
      }
    }

    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listByConversationFirstPage = authQuery({
  args: {
    teamSlugOrId: v.string(),
    conversationId: v.union(v.id("conversations"), v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await requireTeamMembership(ctx, args.teamSlugOrId);
    const conversationId = args.conversationId as Id<"conversations">;
    if (!args.conversationId.startsWith(OPTIMISTIC_CONVERSATION_PREFIX)) {
      const conversation = await ctx.db.get(conversationId);
      if (conversation && conversation.teamId !== teamId) {
        throw new Error("Conversation not found");
      }
    }

    const numItems = clampPageSize(args.numItems, DEFAULT_FIRST_PAGE_SIZE);
    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId)
      )
      .order("desc")
      .paginate({ numItems, cursor: null });
  },
});

// Get latest message for a conversation
export const getLatest = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .first();
  },
});

export const getByIdInternal = internalQuery({
  args: {
    messageId: v.id("conversationMessages"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

export const getByConversationClientMessageId = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    clientMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation_client_message_id", (q) =>
        q.eq("conversationId", args.conversationId).eq(
          "clientMessageId",
          args.clientMessageId
        )
      )
      .first();
  },
});

// Get message count for a conversation
export const count = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
    return messages.length;
  },
});
