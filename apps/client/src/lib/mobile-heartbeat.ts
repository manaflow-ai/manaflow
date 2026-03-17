import type { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";

export type TaskWithUnread = Doc<"tasks"> & { hasUnread?: boolean };
type TaskRunListItem = (typeof api.taskRuns.getByTask._returnType)[number];

export type MobileWorkspaceHeartbeatRow = {
  workspaceId: string;
  taskId: string;
  taskRunId?: string;
  title: string;
  preview?: string;
  phase: string;
  tmuxSessionName: string;
  lastActivityAt: number;
  latestEventSeq: number;
  lastEventAt?: number;
};

export type MobileMachineInfo = {
  machineId: string;
  displayName: string;
  hostname: string;
  tailscaleHostname?: string;
  tailscaleIPs: string[];
};

export type MobileHeartbeatPayload = {
  machineId: string;
  displayName: string;
  tailscaleHostname?: string;
  tailscaleIPs: string[];
  status: "online";
  lastSeenAt: number;
  lastWorkspaceSyncAt: number;
  workspaces: MobileWorkspaceHeartbeatRow[];
};

export function flattenTaskRuns(runs: TaskRunListItem[]): TaskRunListItem[] {
  const flattened: TaskRunListItem[] = [];
  const stack = [...runs];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    flattened.push(current);
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }

  return flattened;
}

export function selectLocalWorkspaceRun(
  runs: TaskRunListItem[],
): TaskRunListItem | null {
  const localRuns = flattenTaskRuns(runs).filter(
    (run) => run.vscode?.provider === "other",
  );

  const activeRun = localRuns.find((run) => !run.isArchived);
  if (activeRun) {
    return activeRun;
  }

  return localRuns[0] ?? null;
}

function trimOptionalString(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildWorkspacePreview(
  task: TaskWithUnread,
  run: TaskRunListItem | null,
): string | undefined {
  return (
    trimOptionalString(run?.summary) ??
    trimOptionalString(task.description) ??
    trimOptionalString(run?.prompt) ??
    trimOptionalString(task.projectFullName)
  );
}

export function buildWorkspaceHeartbeatRow(args: {
  task: TaskWithUnread;
  runs: TaskRunListItem[];
}): MobileWorkspaceHeartbeatRow {
  const selectedRun = selectLocalWorkspaceRun(args.runs);
  const lastActivityAt = Math.max(
    args.task.lastActivityAt ?? 0,
    selectedRun?.updatedAt ?? 0,
    selectedRun?.createdAt ?? 0,
  );
  const latestEventSeq = Math.max(1, lastActivityAt);
  const title = trimOptionalString(args.task.text) ?? "Workspace";

  return {
    workspaceId: args.task._id,
    taskId: args.task._id,
    taskRunId: selectedRun?._id,
    title,
    preview: buildWorkspacePreview(args.task, selectedRun),
    phase:
      trimOptionalString(selectedRun?.vscode?.status) ??
      trimOptionalString(selectedRun?.status) ??
      (args.task.isCompleted ? "completed" : "pending"),
    tmuxSessionName: `local-${args.task._id}`,
    lastActivityAt,
    latestEventSeq,
    lastEventAt: lastActivityAt,
  };
}

export function buildMobileHeartbeatPayload(args: {
  machine: MobileMachineInfo;
  tasks: TaskWithUnread[];
  taskRunsByTaskId: Partial<Record<Id<"tasks">, TaskRunListItem[]>>;
  now?: number;
}): MobileHeartbeatPayload {
  const now = args.now ?? Date.now();
  const workspaces = args.tasks
    .filter((task) => task.isLocalWorkspace)
    .map((task) =>
      buildWorkspaceHeartbeatRow({
        task,
        runs: args.taskRunsByTaskId[task._id] ?? [],
      }),
    )
    .sort((lhs, rhs) => rhs.lastActivityAt - lhs.lastActivityAt);

  return {
    machineId: args.machine.machineId,
    displayName: args.machine.displayName,
    tailscaleHostname: args.machine.tailscaleHostname,
    tailscaleIPs: args.machine.tailscaleIPs,
    status: "online",
    lastSeenAt: now,
    lastWorkspaceSyncAt: now,
    workspaces,
  };
}
