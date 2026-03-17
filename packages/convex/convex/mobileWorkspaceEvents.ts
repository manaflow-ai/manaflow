import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { computeUnreadState } from "./mobileWorkspaces";

type DevicePushTokenDoc = Doc<"devicePushTokens">;

export function selectPushTargets(
  tokens: DevicePushTokenDoc[],
  excludedDeviceId?: string,
) {
  const unique = new Map<string, DevicePushTokenDoc>();
  for (const token of tokens) {
    if (excludedDeviceId && token.deviceId === excludedDeviceId) {
      continue;
    }
    unique.set(
      `${token.token}:${token.bundleId}:${token.environment}`,
      token,
    );
  }
  return [...unique.values()].map((token) => ({
    token: token.token,
    environment: token.environment,
    bundleId: token.bundleId,
    deviceId: token.deviceId,
  }));
}

export const appendInternal = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    workspaceId: v.string(),
    eventSeq: v.number(),
    kind: v.string(),
    preview: v.optional(v.string()),
    createdAt: v.number(),
    shouldNotify: v.boolean(),
    sourceDeviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("mobileWorkspaceEvents")
      .withIndex("by_workspace_event", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("eventSeq", args.eventSeq),
      )
      .first();
    if (existingEvent) {
      return { inserted: false, notified: false };
    }

    await ctx.db.insert("mobileWorkspaceEvents", {
      teamId: args.teamId,
      userId: args.userId,
      workspaceId: args.workspaceId,
      eventSeq: args.eventSeq,
      kind: args.kind,
      preview: args.preview,
      createdAt: args.createdAt,
      shouldNotify: args.shouldNotify,
    });

    const workspace = await ctx.db
      .query("mobileWorkspaces")
      .withIndex("by_team_user_workspace", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("userId", args.userId)
          .eq("workspaceId", args.workspaceId),
      )
      .first();
    if (workspace) {
      await ctx.db.patch(workspace._id, {
        preview: args.preview ?? workspace.preview,
        latestEventSeq: Math.max(workspace.latestEventSeq, args.eventSeq),
        lastEventAt: args.createdAt,
        lastActivityAt: args.createdAt,
      });
    }

    if (!args.shouldNotify || !workspace) {
      return { inserted: true, notified: false };
    }

    const workspaceState = await ctx.db
      .query("mobileUserWorkspaceState")
      .withIndex("by_team_user_workspace", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("userId", args.userId)
          .eq("workspaceId", args.workspaceId),
      )
      .first();
    const lastReadEventSeq = workspaceState?.lastReadEventSeq ?? 0;
    const unread = computeUnreadState(
      Math.max(workspace.latestEventSeq, args.eventSeq),
      lastReadEventSeq,
    );
    if (!unread) {
      return { inserted: true, notified: false };
    }

    const tokens = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_team_user_updated", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId),
      )
      .order("desc")
      .collect();
    const pushTargets = selectPushTargets(tokens, args.sourceDeviceId);
    if (pushTargets.length === 0) {
      return { inserted: true, notified: false };
    }

    await ctx.scheduler.runAfter(
      0,
      internal.pushNotificationsActions.sendWorkspaceEvent,
      {
        tokens: pushTargets,
        workspaceId: args.workspaceId,
        machineId: workspace.machineId,
        title: workspace.title,
        body: args.preview ?? workspace.preview ?? "New workspace activity",
      },
    );

    return { inserted: true, notified: true };
  },
});
