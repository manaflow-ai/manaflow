import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import type { MutationCtx } from "./_generated/server";
import { authMutation } from "./users/utils";

async function requireTeamMembership(
  ctx: MutationCtx,
  teamSlugOrId: string
): Promise<{ teamId: string; userId: string }> {
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

  return { teamId, userId: identity.subject };
}

export const markRead = authMutation({
  args: {
    teamSlugOrId: v.string(),
    conversationId: v.id("conversations"),
    lastReadAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { teamId, userId } = await requireTeamMembership(
      ctx,
      args.teamSlugOrId
    );
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.teamId !== teamId) {
      throw new Error("Conversation not found");
    }

    const now = args.lastReadAt ?? Date.now();
    const existing = await ctx.db
      .query("conversationReads")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", args.conversationId).eq("userId", userId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastReadAt: now,
        updatedAt: now,
      });
      return { lastReadAt: now };
    }

    await ctx.db.insert("conversationReads", {
      conversationId: args.conversationId,
      teamId,
      userId,
      lastReadAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { lastReadAt: now };
  },
});
