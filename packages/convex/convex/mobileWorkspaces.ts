import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { authMutation, authQuery } from "./users/utils";
import { internalMutation } from "./_generated/server";
import { resolveTeamIdLoose } from "../_shared/team";

type MobileWorkspaceDoc = Doc<"mobileWorkspaces">;
type MobileWorkspaceStateDoc = Doc<"mobileUserWorkspaceState">;

export function computeUnreadState(
  latestEventSeq: number,
  lastReadEventSeq: number,
) {
  return latestEventSeq > lastReadEventSeq;
}

export function buildWorkspaceRows(
  workspaces: MobileWorkspaceDoc[],
  workspaceStates: MobileWorkspaceStateDoc[],
) {
  const stateByWorkspaceId = new Map(
    workspaceStates.map((state) => [state.workspaceId, state]),
  );

  return [...workspaces]
    .map((workspace) => {
      const state = stateByWorkspaceId.get(workspace.workspaceId);
      const lastReadEventSeq = state?.lastReadEventSeq ?? 0;
      return {
        ...workspace,
        lastReadEventSeq,
        unread: computeUnreadState(workspace.latestEventSeq, lastReadEventSeq),
      };
    })
    .sort((lhs, rhs) => rhs.lastActivityAt - lhs.lastActivityAt);
}

export const listForUser = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const [workspaces, workspaceStates] = await Promise.all([
      ctx.db
        .query("mobileWorkspaces")
        .withIndex("by_team_user_last_activity", (q) =>
          q.eq("teamId", teamId).eq("userId", userId),
        )
        .order("desc")
        .collect(),
      ctx.db
        .query("mobileUserWorkspaceState")
        .withIndex("by_team_user_updated", (q) =>
          q.eq("teamId", teamId).eq("userId", userId),
        )
        .order("desc")
        .collect(),
    ]);

    return buildWorkspaceRows(workspaces, workspaceStates);
  },
});

export const markRead = authMutation({
  args: {
    teamSlugOrId: v.string(),
    workspaceId: v.string(),
    latestEventSeq: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const workspace = await ctx.db
      .query("mobileWorkspaces")
      .withIndex("by_team_user_workspace", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("workspaceId", args.workspaceId),
      )
      .first();

    if (!workspace) {
      throw new ConvexError("Workspace not found");
    }

    const state = await ctx.db
      .query("mobileUserWorkspaceState")
      .withIndex("by_team_user_workspace", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("workspaceId", args.workspaceId),
      )
      .first();

    const lastReadEventSeq = args.latestEventSeq ?? workspace.latestEventSeq;
    const updatedAt = Date.now();

    if (state) {
      await ctx.db.patch(state._id, {
        lastReadEventSeq,
        updatedAt,
      });
      return state._id;
    }

    return await ctx.db.insert("mobileUserWorkspaceState", {
      teamId,
      userId,
      workspaceId: args.workspaceId,
      lastReadEventSeq,
      updatedAt,
    });
  },
});

export const markUnread = authMutation({
  args: {
    teamSlugOrId: v.string(),
    workspaceId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const workspace = await ctx.db
      .query("mobileWorkspaces")
      .withIndex("by_team_user_workspace", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("workspaceId", args.workspaceId),
      )
      .first();

    if (!workspace) {
      throw new ConvexError("Workspace not found");
    }

    const state = await ctx.db
      .query("mobileUserWorkspaceState")
      .withIndex("by_team_user_workspace", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("workspaceId", args.workspaceId),
      )
      .first();

    const lastReadEventSeq = Math.max(workspace.latestEventSeq - 1, 0);
    const updatedAt = Date.now();

    if (state) {
      await ctx.db.patch(state._id, {
        lastReadEventSeq,
        updatedAt,
      });
      return state._id;
    }

    return await ctx.db.insert("mobileUserWorkspaceState", {
      teamId,
      userId,
      workspaceId: args.workspaceId,
      lastReadEventSeq,
      updatedAt,
    });
  },
});

export const replaceMachineWorkspaceSnapshotInternal = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    machineId: v.string(),
    workspaces: v.array(
      v.object({
        workspaceId: v.string(),
        taskId: v.optional(v.string()),
        taskRunId: v.optional(v.string()),
        title: v.string(),
        preview: v.optional(v.string()),
        phase: v.string(),
        tmuxSessionName: v.string(),
        lastActivityAt: v.number(),
        latestEventSeq: v.number(),
        lastEventAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("mobileWorkspaces")
      .withIndex("by_machine_last_activity", (q) => q.eq("machineId", args.machineId))
      .collect();
    const scopedRows = existingRows.filter(
      (row) => row.teamId === args.teamId && row.userId === args.userId,
    );
    const rowsByWorkspaceId = new Map(
      scopedRows.map((row) => [row.workspaceId, row]),
    );
    const snapshotWorkspaceIds = new Set(
      args.workspaces.map((workspace) => workspace.workspaceId),
    );

    for (const existing of scopedRows) {
      if (!snapshotWorkspaceIds.has(existing.workspaceId)) {
        await ctx.db.delete(existing._id);
      }
    }

    for (const workspace of args.workspaces) {
      const existing = rowsByWorkspaceId.get(workspace.workspaceId);
      const patch = {
        machineId: args.machineId,
        taskId: workspace.taskId,
        taskRunId: workspace.taskRunId,
        title: workspace.title,
        preview: workspace.preview,
        phase: workspace.phase,
        tmuxSessionName: workspace.tmuxSessionName,
        lastActivityAt: workspace.lastActivityAt,
        latestEventSeq: workspace.latestEventSeq,
        lastEventAt: workspace.lastEventAt,
      } satisfies Partial<MobileWorkspaceDoc>;

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        if (workspace.latestEventSeq > existing.latestEventSeq) {
          await ctx.scheduler.runAfter(
            0,
            internal.mobileWorkspaceEvents.appendInternal,
            {
              teamId: args.teamId,
              userId: args.userId,
              workspaceId: workspace.workspaceId,
              eventSeq: workspace.latestEventSeq,
              kind: "heartbeat-sync",
              preview: workspace.preview,
              createdAt: workspace.lastEventAt ?? workspace.lastActivityAt,
              shouldNotify: true,
            },
          );
        }
      } else {
        await ctx.db.insert("mobileWorkspaces", {
          teamId: args.teamId,
          userId: args.userId,
          workspaceId: workspace.workspaceId,
          ...patch,
        });
      }
    }
  },
});
