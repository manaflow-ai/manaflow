import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const ingestHeartbeat = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as {
    teamId: string;
    userId: string;
    machineId: string;
    displayName: string;
    tailscaleHostname?: string;
    tailscaleIPs: string[];
    status: "online" | "offline" | "unknown";
    lastSeenAt: number;
    lastWorkspaceSyncAt?: number;
    directConnect?: {
      directPort: number;
      directTlsPins: string[];
      ticketSecret: string;
    };
    workspaces: Array<{
      workspaceId: string;
      taskId?: string;
      taskRunId?: string;
      title: string;
      preview?: string;
      phase: string;
      tmuxSessionName: string;
      lastActivityAt: number;
      latestEventSeq: number;
      lastEventAt?: number;
    }>;
  };

  await ctx.runMutation(internal.mobileMachines.upsertHeartbeatInternal, {
    teamId: body.teamId,
    userId: body.userId,
    machineId: body.machineId,
    displayName: body.displayName,
    tailscaleHostname: body.tailscaleHostname,
    tailscaleIPs: body.tailscaleIPs,
    status: body.status,
    lastSeenAt: body.lastSeenAt,
    lastWorkspaceSyncAt: body.lastWorkspaceSyncAt,
  });

  await ctx.runMutation(
    internal.mobileWorkspaces.replaceMachineWorkspaceSnapshotInternal,
    {
      teamId: body.teamId,
      userId: body.userId,
      machineId: body.machineId,
      workspaces: body.workspaces,
    },
  );

  if (body.directConnect) {
    await ctx.runMutation(internal.mobileMachineConnections.upsertInternal, {
      teamId: body.teamId,
      userId: body.userId,
      machineId: body.machineId,
      directPort: body.directConnect.directPort,
      directTlsPins: body.directConnect.directTlsPins,
      ticketSecret: body.directConnect.ticketSecret,
      updatedAt: body.lastSeenAt,
    });
  }

  return new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
});
