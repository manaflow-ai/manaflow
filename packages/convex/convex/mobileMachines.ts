import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { authQuery } from "./users/utils";
import { internalMutation } from "./_generated/server";
import { resolveTeamIdLoose } from "../_shared/team";

export const MACHINE_HEARTBEAT_STALE_MS = 120_000;

type MobileMachineDoc = Doc<"mobileMachines">;

export function resolveMachineStatus(
  machine: Pick<MobileMachineDoc, "status" | "lastSeenAt">,
  now: number = Date.now(),
) {
  if (machine.status !== "online") {
    return machine.status;
  }
  return now - machine.lastSeenAt > MACHINE_HEARTBEAT_STALE_MS
    ? "offline"
    : "online";
}

export function buildMachineList(
  machines: MobileMachineDoc[],
  now: number = Date.now(),
) {
  return [...machines]
    .map((machine) => ({
      ...machine,
      status: resolveMachineStatus(machine, now),
    }))
    .sort((lhs, rhs) => rhs.lastSeenAt - lhs.lastSeenAt);
}

export const listForUser = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const rows = await ctx.db
      .query("mobileMachines")
      .withIndex("by_team_user_last_seen", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .order("desc")
      .collect();

    return buildMachineList(rows);
  },
});

export const upsertHeartbeatInternal = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    machineId: v.string(),
    displayName: v.string(),
    tailscaleHostname: v.optional(v.string()),
    tailscaleIPs: v.array(v.string()),
    status: v.union(
      v.literal("online"),
      v.literal("offline"),
      v.literal("unknown"),
    ),
    lastSeenAt: v.number(),
    lastWorkspaceSyncAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mobileMachines")
      .withIndex("by_team_user_machine", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("userId", args.userId)
          .eq("machineId", args.machineId),
      )
      .first();

    const patch = {
      displayName: args.displayName,
      tailscaleHostname: args.tailscaleHostname,
      tailscaleIPs: args.tailscaleIPs,
      status: args.status,
      lastSeenAt: args.lastSeenAt,
      lastWorkspaceSyncAt: args.lastWorkspaceSyncAt,
    } satisfies Partial<MobileMachineDoc>;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("mobileMachines", {
      teamId: args.teamId,
      userId: args.userId,
      machineId: args.machineId,
      ...patch,
    });
  },
});
