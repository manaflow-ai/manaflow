import { describe, expect, test } from "vitest";
import { buildMobileInboxRows } from "./mobileInbox";
import { resolveMachineStatus } from "./mobileMachines";
import { reconcilePushTokenRows } from "./pushTokens";
import schema from "./schema";

describe("mobile dogfood schema", () => {
  test("includes mobile machine, workspace, and push token tables", () => {
    expect(schema.tables.mobileMachines).toBeDefined();
    expect(schema.tables.mobileMachineConnections).toBeDefined();
    expect(schema.tables.mobileWorkspaces).toBeDefined();
    expect(schema.tables.mobileWorkspaceEvents).toBeDefined();
    expect(schema.tables.mobileUserWorkspaceState).toBeDefined();
    expect(schema.tables.devicePushTokens).toBeDefined();
  });

  test("returns unread workspace rows ordered by latest workspace activity", () => {
    const rows = buildMobileInboxRows({
      machines: [
        {
          _id: "machine_doc_1" as never,
          _creationTime: 0,
          teamId: "team_123",
          userId: "user_123",
          machineId: "machine_123",
          displayName: "Orb",
          tailscaleHostname: "orb.tailnet.ts.net",
          tailscaleIPs: ["100.64.0.1"],
          status: "online",
          lastSeenAt: 100,
          lastWorkspaceSyncAt: 100,
        },
      ],
      workspaces: [
        {
          _id: "workspace_doc_1" as never,
          _creationTime: 0,
          teamId: "team_123",
          userId: "user_123",
          workspaceId: "workspace_old",
          machineId: "machine_123",
          taskId: undefined,
          taskRunId: undefined,
          title: "Older",
          preview: "old",
          phase: "idle",
          tmuxSessionName: "cmux-old",
          lastActivityAt: 10,
          latestEventSeq: 1,
          lastEventAt: 10,
        },
        {
          _id: "workspace_doc_2" as never,
          _creationTime: 0,
          teamId: "team_123",
          userId: "user_123",
          workspaceId: "workspace_new",
          machineId: "machine_123",
          taskId: undefined,
          taskRunId: undefined,
          title: "Newest",
          preview: "new",
          phase: "connected",
          tmuxSessionName: "cmux-new",
          lastActivityAt: 20,
          latestEventSeq: 4,
          lastEventAt: 20,
        },
      ],
      workspaceStates: [
        {
          _id: "workspace_state_doc_1" as never,
          _creationTime: 0,
          teamId: "team_123",
          userId: "user_123",
          workspaceId: "workspace_new",
          lastReadEventSeq: 2,
          pinned: undefined,
          archived: undefined,
          updatedAt: 20,
        },
      ],
    });

    expect(rows.map((row) => row.workspaceId)).toEqual([
      "workspace_new",
      "workspace_old",
    ]);
    expect(rows[0]?.unread).toBe(true);
    expect(rows[0]?.unreadCount).toBe(2);
    expect(rows[0]?.machineDisplayName).toBe("Orb");
  });

  test("marks stale online machines offline", () => {
    expect(
      resolveMachineStatus(
        {
          status: "online",
          lastSeenAt: 0,
        },
        200_000,
      ),
    ).toBe("offline");
  });

  test("upserts one device token per bundle and environment", () => {
    const existingRows = [
      {
        _id: "push_doc_1",
        _creationTime: 0,
        teamId: "team_123",
        userId: "user_123",
        token: "token_123",
        environment: "development" as const,
        platform: "ios",
        bundleId: "dev.cmux.app.dev",
        deviceId: "device_123",
        updatedAt: 1,
      },
      {
        _id: "push_doc_2",
        _creationTime: 0,
        teamId: "team_123",
        userId: "user_123",
        token: "token_123",
        environment: "development" as const,
        platform: "ios",
        bundleId: "dev.cmux.app.dev",
        deviceId: "device_123",
        updatedAt: 2,
      },
    ];

    const result = reconcilePushTokenRows(existingRows as never, {
      token: "token_123",
      environment: "development",
      platform: "ios",
      bundleId: "dev.cmux.app.dev",
      deviceId: "device_123",
      updatedAt: 3,
    });

    expect(result.canonical?._id).toBe("push_doc_1");
    expect(result.duplicateIds).toEqual(["push_doc_2"]);
  });
});
