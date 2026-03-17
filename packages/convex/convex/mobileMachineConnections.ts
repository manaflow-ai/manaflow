import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

type MobileMachineConnectionDoc = Doc<"mobileMachineConnections">;
type MobileMachineDoc = Doc<"mobileMachines">;

export const upsertInternal = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    machineId: v.string(),
    directPort: v.number(),
    directTlsPins: v.array(v.string()),
    ticketSecret: v.string(),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mobileMachineConnections")
      .withIndex("by_team_user_machine", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("userId", args.userId)
          .eq("machineId", args.machineId),
      )
      .first();

    const patch = {
      directPort: args.directPort,
      directTlsPins: args.directTlsPins,
      ticketSecret: args.ticketSecret,
      updatedAt: args.updatedAt ?? Date.now(),
    } satisfies Partial<MobileMachineConnectionDoc>;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("mobileMachineConnections", {
      teamId: args.teamId,
      userId: args.userId,
      machineId: args.machineId,
      ...patch,
    });
  },
});

export const getForServerInternal = internalQuery({
  args: {
    teamId: v.string(),
    userId: v.string(),
    serverId: v.string(),
  },
  handler: async (ctx, args) => {
    let machine = await ctx.db
      .query("mobileMachines")
      .withIndex("by_team_user_machine", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("userId", args.userId)
          .eq("machineId", args.serverId),
      )
      .first();

    if (!machine) {
      const candidateMachines = await ctx.db
        .query("mobileMachines")
        .withIndex("by_team_user_last_seen", (q) =>
          q.eq("teamId", args.teamId).eq("userId", args.userId),
        )
        .order("desc")
        .collect();
      machine =
        candidateMachines.find(
          (row) => row.tailscaleHostname?.trim() === args.serverId,
        ) ?? null;
    }

    if (!machine) {
      return null;
    }

    const connection = await ctx.db
      .query("mobileMachineConnections")
      .withIndex("by_team_user_machine", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("userId", args.userId)
          .eq("machineId", machine.machineId),
      )
      .first();

    if (!connection) {
      return null;
    }

    return buildDirectConnection(machine, connection);
  },
});

function buildDirectConnection(
  machine: MobileMachineDoc,
  connection: MobileMachineConnectionDoc,
) {
  return {
    machineId: machine.machineId,
    serverId: machine.machineId,
    directHost:
      machine.tailscaleHostname ??
      machine.tailscaleIPs.find((value) => value.trim().length > 0) ??
      machine.machineId,
    directPort: connection.directPort,
    directTlsPins: connection.directTlsPins,
    ticketSecret: connection.ticketSecret,
  };
}
