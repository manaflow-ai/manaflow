import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { authMutation } from "./users/utils";

type DevicePushTokenDoc = Doc<"devicePushTokens">;

type IncomingPushToken = {
  token: string;
  environment: "development" | "production";
  platform: string;
  bundleId: string;
  deviceId?: string;
  updatedAt: number;
};

export function reconcilePushTokenRows(
  existingRows: DevicePushTokenDoc[],
  incoming: IncomingPushToken,
) {
  const sameTokenRows = existingRows.filter(
    (row) =>
      row.token === incoming.token &&
      row.bundleId === incoming.bundleId &&
      row.environment === incoming.environment,
  );
  const sameDeviceRows =
    incoming.deviceId === undefined
      ? []
      : existingRows.filter(
          (row) =>
            row.deviceId === incoming.deviceId &&
            row.bundleId === incoming.bundleId &&
            row.environment === incoming.environment,
        );

  const canonical = sameTokenRows[0] ?? sameDeviceRows[0] ?? null;
  const duplicateIds = new Set<DevicePushTokenDoc["_id"]>();

  for (const row of sameTokenRows.slice(1)) {
    duplicateIds.add(row._id);
  }
  for (const row of sameDeviceRows) {
    if (row._id !== canonical?._id) {
      duplicateIds.add(row._id);
    }
  }

  return {
    canonical,
    duplicateIds: [...duplicateIds],
  };
}

async function resolveDefaultTeamId(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (user?.selectedTeamId) {
    return user.selectedTeamId;
  }

  const membership = await ctx.db
    .query("teamMemberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (membership) {
    return membership.teamId;
  }

  throw new ConvexError("No team available for push token registration");
}

export const upsert = authMutation({
  args: {
    token: v.string(),
    environment: v.union(v.literal("development"), v.literal("production")),
    platform: v.string(),
    bundleId: v.string(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveDefaultTeamId(ctx, userId);
    const existingRows = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_team_user_updated", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .order("desc")
      .collect();
    const updatedAt = Date.now();
    const { canonical, duplicateIds } = reconcilePushTokenRows(existingRows, {
      ...args,
      updatedAt,
    });

    for (const duplicateId of duplicateIds) {
      await ctx.db.delete(duplicateId);
    }

    if (canonical) {
      await ctx.db.patch(canonical._id, {
        token: args.token,
        environment: args.environment,
        platform: args.platform,
        bundleId: args.bundleId,
        deviceId: args.deviceId,
        updatedAt,
      });
      return canonical._id;
    }

    return await ctx.db.insert("devicePushTokens", {
      teamId,
      userId,
      token: args.token,
      environment: args.environment,
      platform: args.platform,
      bundleId: args.bundleId,
      deviceId: args.deviceId,
      updatedAt,
    });
  },
});

export const remove = authMutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveDefaultTeamId(ctx, userId);
    const matchingRows = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .collect();

    for (const row of matchingRows) {
      if (row.userId === userId && row.teamId === teamId) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

export const sendTest = authMutation({
  args: {
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveDefaultTeamId(ctx, userId);
    const tokens = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_team_user_updated", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .order("desc")
      .collect();

    if (tokens.length === 0) {
      throw new ConvexError("No push token registered");
    }

    await ctx.scheduler.runAfter(
      0,
      internal.pushNotificationsActions.sendTestPush,
      {
        tokens: tokens.map((token) => ({
          token: token.token,
          environment: token.environment,
          bundleId: token.bundleId,
          deviceId: token.deviceId,
        })),
        title: args.title,
        body: args.body,
      },
    );

    return { scheduledCount: tokens.length };
  },
});
