import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Get phone user by phone number.
 * Returns null if not found.
 */
export const getByPhone = internalQuery({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args): Promise<Doc<"smsPhoneUsers"> | null> => {
    return await ctx.db
      .query("smsPhoneUsers")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();
  },
});

/**
 * Get all phone users for a user ID.
 * Used to find SMS-linked phones for notification purposes.
 */
export const getByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<Doc<"smsPhoneUsers">[]> => {
    return await ctx.db
      .query("smsPhoneUsers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

/**
 * Get or create a phone user.
 * If the phone number doesn't exist, creates an anonymous user + team.
 */
export const getOrCreate = internalMutation({
  args: { phoneNumber: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    phoneUser: Doc<"smsPhoneUsers">;
    isNew: boolean;
  }> => {
    // Check if phone user already exists
    const existing = await ctx.db
      .query("smsPhoneUsers")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (existing) {
      return { phoneUser: existing, isNew: false };
    }

    // Create new anonymous user + team
    const now = Date.now();
    const phoneLast4 = args.phoneNumber.slice(-4);

    // Generate a unique user ID for the anonymous user
    const userId = `sms-anon-${phoneLast4}-${now}`;
    const teamId = `sms-team-${phoneLast4}-${now}`;
    const teamSlug = `sms-${phoneLast4}`;

    // Create the user record
    await ctx.db.insert("users", {
      userId,
      displayName: `SMS User ${phoneLast4}`,
      isAnonymous: true,
      selectedTeamId: teamId,
      createdAt: now,
      updatedAt: now,
    });

    // Create the team record
    await ctx.db.insert("teams", {
      teamId,
      slug: teamSlug,
      displayName: `SMS Team ${phoneLast4}`,
      createdAt: now,
      updatedAt: now,
    });

    // Create team membership
    await ctx.db.insert("teamMemberships", {
      teamId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });

    // Create the phone user mapping
    const phoneUserId = await ctx.db.insert("smsPhoneUsers", {
      phoneNumber: args.phoneNumber,
      userId,
      defaultTeamId: teamId,
      displayName: `SMS User ${phoneLast4}`,
      notifyOnCompletion: true, // Default to on
      isAnonymous: true,
      createdAt: now,
      updatedAt: now,
    });

    const phoneUser = await ctx.db.get(phoneUserId);
    if (!phoneUser) {
      throw new Error("Failed to create phone user");
    }

    return { phoneUser, isNew: true };
  },
});

/**
 * Update phone user settings.
 */
export const update = internalMutation({
  args: {
    phoneNumber: v.string(),
    displayName: v.optional(v.string()),
    notifyOnCompletion: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    const phoneUser = await ctx.db
      .query("smsPhoneUsers")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (!phoneUser) {
      throw new Error("Phone user not found");
    }

    await ctx.db.patch(phoneUser._id, {
      ...(args.displayName !== undefined && { displayName: args.displayName }),
      ...(args.notifyOnCompletion !== undefined && {
        notifyOnCompletion: args.notifyOnCompletion,
      }),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Link an anonymous phone user to a real web account.
 * Future enhancement - allows users to link their SMS identity to their web account.
 */
export const linkToUser = internalMutation({
  args: {
    phoneNumber: v.string(),
    realUserId: v.string(),
    realTeamId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const phoneUser = await ctx.db
      .query("smsPhoneUsers")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (!phoneUser) {
      throw new Error("Phone user not found");
    }

    if (!phoneUser.isAnonymous) {
      throw new Error("Phone user is already linked to a real account");
    }

    // Update phone user to point to real account
    await ctx.db.patch(phoneUser._id, {
      userId: args.realUserId,
      defaultTeamId: args.realTeamId,
      isAnonymous: false,
      updatedAt: Date.now(),
    });
  },
});
