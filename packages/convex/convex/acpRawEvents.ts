import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { authQuery } from "./users/utils";

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

export const listByConversationPaginated = authQuery({
  args: {
    teamSlugOrId: v.string(),
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const teamId = await requireTeamMembership(ctx, args.teamSlugOrId);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.teamId !== teamId) {
      throw new Error("Conversation not found");
    }

    return await ctx.db
      .query("acpRawEvents")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listByConversationInternal = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    return await ctx.db
      .query("acpRawEvents")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .take(limit);
  },
});

export const appendOutboundEvent = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    sandboxId: v.id("acpSandboxes"),
    teamId: v.string(),
    raw: v.string(),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("acpRawEvents", {
      conversationId: args.conversationId,
      sandboxId: args.sandboxId,
      teamId: args.teamId,
      seq: now,
      raw: args.raw,
      direction: "outbound",
      eventType: args.eventType,
      createdAt: now,
    });
  },
});

/**
 * Log a sandbox error event for a conversation.
 * This creates a persistent record of all errors for debugging.
 */
export const appendError = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    sandboxId: v.id("acpSandboxes"),
    teamId: v.string(),
    errorMessage: v.string(),
    context: v.optional(v.string()), // e.g., "ensureSandboxReady", "sendMessage", etc.
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const raw = JSON.stringify({
      error: args.errorMessage,
      context: args.context,
      timestamp: new Date(now).toISOString(),
    });
    await ctx.db.insert("acpRawEvents", {
      conversationId: args.conversationId,
      sandboxId: args.sandboxId,
      teamId: args.teamId,
      seq: now,
      raw,
      direction: "inbound",
      eventType: "error",
      createdAt: now,
    });
  },
});

/**
 * Log a sandbox error event by sandbox ID only (when no conversation is available).
 * This is useful for errors that occur before a conversation is associated.
 */
export const appendErrorBySandbox = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    teamId: v.string(),
    errorMessage: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      return;
    }

    // Find the most recent conversation for this sandbox (if any)
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_acp_sandbox", (q) => q.eq("acpSandboxId", args.sandboxId))
      .order("desc")
      .first();

    if (!conversation) {
      // No conversation to log to - this is a sandbox-level error without conversation context
      // We could create a separate table for sandbox-level errors, but for now just skip
      console.error(
        `[acp] Sandbox error without conversation: ${args.errorMessage}`,
        { sandboxId: args.sandboxId, context: args.context }
      );
      return;
    }

    const now = Date.now();
    const raw = JSON.stringify({
      error: args.errorMessage,
      context: args.context,
      timestamp: new Date(now).toISOString(),
    });
    await ctx.db.insert("acpRawEvents", {
      conversationId: conversation._id,
      sandboxId: args.sandboxId,
      teamId: args.teamId,
      seq: now,
      raw,
      direction: "inbound",
      eventType: "error",
      createdAt: now,
    });
  },
});
