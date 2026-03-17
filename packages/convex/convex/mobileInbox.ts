import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { authQuery } from "./users/utils";
import { resolveTeamIdLoose } from "../_shared/team";
import { resolveMachineStatus } from "./mobileMachines";
import { computeUnreadState } from "./mobileWorkspaces";

type MobileMachineDoc = Doc<"mobileMachines">;
type MobileWorkspaceDoc = Doc<"mobileWorkspaces">;
type MobileWorkspaceStateDoc = Doc<"mobileUserWorkspaceState">;

export function buildMobileInboxRows(args: {
  machines: MobileMachineDoc[];
  workspaces: MobileWorkspaceDoc[];
  workspaceStates: MobileWorkspaceStateDoc[];
  now?: number;
}) {
  const machineByMachineId = new Map(
    args.machines.map((machine) => [machine.machineId, machine]),
  );
  const stateByWorkspaceId = new Map(
    args.workspaceStates.map((state) => [state.workspaceId, state]),
  );
  const now = args.now ?? Date.now();

  return [...args.workspaces]
    .map((workspace) => {
      const state = stateByWorkspaceId.get(workspace.workspaceId);
      const machine = machineByMachineId.get(workspace.machineId);
      const lastReadEventSeq = state?.lastReadEventSeq ?? 0;
      const unread = computeUnreadState(
        workspace.latestEventSeq,
        lastReadEventSeq,
      );

      return {
        kind: "workspace" as const,
        workspaceId: workspace.workspaceId,
        machineId: workspace.machineId,
        title: workspace.title,
        preview: workspace.preview ?? "",
        phase: workspace.phase,
        tmuxSessionName: workspace.tmuxSessionName,
        lastActivityAt: workspace.lastActivityAt,
        latestEventSeq: workspace.latestEventSeq,
        lastReadEventSeq,
        unread,
        unreadCount: unread ? 1 : 0,
        machineDisplayName: machine?.displayName ?? workspace.machineId,
        machineStatus: machine ? resolveMachineStatus(machine, now) : "unknown",
        tailscaleHostname: machine?.tailscaleHostname,
        tailscaleIPs: machine?.tailscaleIPs ?? [],
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
    const [machines, workspaces, workspaceStates] = await Promise.all([
      ctx.db
        .query("mobileMachines")
        .withIndex("by_team_user_last_seen", (q) =>
          q.eq("teamId", teamId).eq("userId", userId),
        )
        .order("desc")
        .collect(),
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

    return buildMobileInboxRows({
      machines,
      workspaces,
      workspaceStates,
    });
  },
});
