import { describe, expect, it } from "vitest";
import {
  buildMobileHeartbeatPayload,
  buildWorkspaceHeartbeatRow,
  type MobileMachineInfo,
} from "./mobile-heartbeat";
import type { Id } from "@cmux/convex/dataModel";

const machine: MobileMachineInfo = {
  machineId: "cmux-macmini.tail.ts.net",
  displayName: "Mac mini",
  hostname: "cmux-macmini",
  tailscaleHostname: "cmux-macmini.tail.ts.net",
  tailscaleIPs: ["100.64.0.10"],
};

describe("mobile-heartbeat", () => {
  it("builds a workspace row from a local workspace task", () => {
    const row = buildWorkspaceHeartbeatRow({
      task: {
        _id: "task_123" as Id<"tasks">,
        _creationTime: 1,
        text: "orb / cmux",
        description: "feature/ios-dogfood",
        projectFullName: "imputnet/helium",
        worktreePath: undefined,
        isCompleted: false,
        createdAt: 1,
        updatedAt: 25,
        lastActivityAt: 25,
        userId: "user_123",
        teamId: "team_123",
        isLocalWorkspace: true,
        linkedFromCloudTaskRunId: undefined,
      },
      runs: [
        {
          _id: "run_123" as Id<"taskRuns">,
          _creationTime: 2,
          taskId: "task_123" as Id<"tasks">,
          prompt: "orb / cmux",
          agentName: "local-workspace",
          status: "running",
          isArchived: false,
          createdAt: 2,
          updatedAt: 30,
          userId: "user_123",
          teamId: "team_123",
          isLocalWorkspace: true,
          vscode: {
            provider: "other",
            status: "running",
            workspaceUrl: "http://127.0.0.1:39378/?folder=/tmp/cmux",
            startedAt: 2,
          },
          children: [],
          environment: null,
        },
      ],
    });

    expect(row.workspaceId).toBe("task_123");
    expect(row.taskRunId).toBe("run_123");
    expect(row.phase).toBe("running");
    expect(row.preview).toBe("feature/ios-dogfood");
    expect(row.tmuxSessionName).toBe("local-task_123");
    expect(row.latestEventSeq).toBe(30);
  });

  it("builds a machine heartbeat sorted by latest workspace activity", () => {
    const payload = buildMobileHeartbeatPayload({
      machine,
      tasks: [
        {
          _id: "task_old" as Id<"tasks">,
          _creationTime: 1,
          text: "Old",
          description: "old",
          projectFullName: undefined,
          worktreePath: undefined,
          isCompleted: false,
          createdAt: 1,
          updatedAt: 10,
          lastActivityAt: 10,
          userId: "user_123",
          teamId: "team_123",
          isLocalWorkspace: true,
          linkedFromCloudTaskRunId: undefined,
        },
        {
          _id: "task_new" as Id<"tasks">,
          _creationTime: 1,
          text: "New",
          description: "new",
          projectFullName: undefined,
          worktreePath: undefined,
          isCompleted: false,
          createdAt: 1,
          updatedAt: 50,
          lastActivityAt: 50,
          userId: "user_123",
          teamId: "team_123",
          isLocalWorkspace: true,
          linkedFromCloudTaskRunId: undefined,
        },
      ],
      taskRunsByTaskId: {},
      now: 100,
    });

    expect(payload.machineId).toBe("cmux-macmini.tail.ts.net");
    expect(payload.workspaces.map((workspace) => workspace.workspaceId)).toEqual([
      "task_new",
      "task_old",
    ]);
    expect(payload.lastSeenAt).toBe(100);
    expect(payload.lastWorkspaceSyncAt).toBe(100);
  });
});
