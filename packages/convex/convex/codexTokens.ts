import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";
import { internalMutation } from "./_generated/server";

/**
 * Get Codex tokens for the current user in a team
 */
export const get = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    return await ctx.db
      .query("codexTokens")
      .withIndex("by_user_team", (q) =>
        q.eq("userId", userId).eq("teamId", teamId)
      )
      .first();
  },
});

/**
 * Save or update Codex tokens after OAuth flow
 */
export const save = authMutation({
  args: {
    teamSlugOrId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    idToken: v.optional(v.string()),
    accountId: v.optional(v.string()),
    planType: v.optional(v.string()),
    email: v.optional(v.string()),
    expiresIn: v.number(), // seconds until expiration
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();
    const expiresAt = now + args.expiresIn * 1000;

    const existing = await ctx.db
      .query("codexTokens")
      .withIndex("by_user_team", (q) =>
        q.eq("userId", userId).eq("teamId", teamId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        idToken: args.idToken,
        accountId: args.accountId,
        planType: args.planType,
        email: args.email,
        expiresAt,
        lastRefresh: now,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("codexTokens", {
        userId,
        teamId,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        idToken: args.idToken,
        accountId: args.accountId,
        planType: args.planType,
        email: args.email,
        expiresAt,
        lastRefresh: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Remove Codex tokens (disconnect account)
 */
export const remove = authMutation({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("codexTokens")
      .withIndex("by_user_team", (q) =>
        q.eq("userId", userId).eq("teamId", teamId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Internal mutation to update tokens after refresh (called by HTTP endpoint)
 * This does NOT require auth since it's called internally
 */
export const updateAfterRefresh = internalMutation({
  args: {
    userId: v.string(),
    teamId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresIn: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + args.expiresIn * 1000;

    const existing = await ctx.db
      .query("codexTokens")
      .withIndex("by_user_team", (q) =>
        q.eq("userId", args.userId).eq("teamId", args.teamId)
      )
      .first();

    if (!existing) {
      throw new Error("No tokens found for user/team");
    }

    await ctx.db.patch(existing._id, {
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt,
      lastRefresh: now,
      updatedAt: now,
    });

    return existing._id;
  },
});

/**
 * Internal query to get tokens by proxy token (for refresh endpoint)
 */
export const getByProxyToken = internalMutation({
  args: {
    proxyToken: v.string(),
  },
  handler: async (ctx, args) => {
    // Proxy token format: "cmux_<userId>_<teamId>"
    const parts = args.proxyToken.split("_");
    if (parts.length !== 3 || parts[0] !== "cmux") {
      return null;
    }

    const [, userId, teamId] = parts;

    return await ctx.db
      .query("codexTokens")
      .withIndex("by_user_team", (q) =>
        q.eq("userId", userId).eq("teamId", teamId)
      )
      .first();
  },
});
