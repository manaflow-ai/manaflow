import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useQueries } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { isElectron } from "@/lib/electron";
import {
  buildMobileHeartbeatPayload,
  type MobileMachineInfo,
  type TaskWithUnread,
} from "@/lib/mobile-heartbeat";
import { stackClientApp } from "@/lib/stack";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";

const HEARTBEAT_INTERVAL_MS = 60_000;
const MACHINE_SESSION_REFRESH_SKEW_MS = 60_000;

type MachineSession = {
  token: string;
  expiresAt: number;
};

export function useMobileMachineHeartbeat({
  teamSlugOrId,
  tasks,
}: {
  teamSlugOrId: string;
  tasks: TaskWithUnread[] | undefined;
}) {
  const [machineInfo, setMachineInfo] = useState<MobileMachineInfo | null>(null);
  const sessionRef = useRef<MachineSession | null>(null);
  const payloadRef = useRef<ReturnType<typeof buildMobileHeartbeatPayload> | null>(
    null,
  );

  useEffect(() => {
    if (!isElectron || !window.cmux?.machine?.getInfo) {
      setMachineInfo(null);
      return;
    }

    let cancelled = false;
    void window.cmux.machine
      .getInfo()
      .then((info) => {
        if (!cancelled) {
          setMachineInfo(info);
        }
      })
      .catch((error) => {
        console.error("[mobile-heartbeat] Failed to load machine info", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const localTasks = useMemo(
    () => (tasks ?? []).filter((task) => task.isLocalWorkspace),
    [tasks],
  );

  const taskRunQueries = useMemo(() => {
    const queries: Record<
      Id<"tasks">,
      {
        query: typeof api.taskRuns.getByTask;
        args: { teamSlugOrId: string; taskId: Id<"tasks"> };
      }
    > = {};

    for (const task of localTasks) {
      queries[task._id] = {
        query: api.taskRuns.getByTask,
        args: { teamSlugOrId, taskId: task._id },
      };
    }

    return queries;
  }, [localTasks, teamSlugOrId]);

  const taskRunResults = useQueries(taskRunQueries);

  const payload = useMemo(() => {
    if (!isElectron || !machineInfo) {
      return null;
    }

    return buildMobileHeartbeatPayload({
      machine: machineInfo,
      tasks: localTasks,
      taskRunsByTaskId: taskRunResults,
    });
  }, [localTasks, machineInfo, taskRunResults]);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    let cancelled = false;

    const publish = async () => {
      try {
        await publishCurrentPayload({
          payload,
          sessionRef,
          teamSlugOrId,
        });
        if (cancelled) {
          return;
        }
      } catch (error) {
        console.error("[mobile-heartbeat] Failed to publish heartbeat", error);
      }
    };

    void publish();

    const intervalId = window.setInterval(() => {
      const nextPayload = payloadRef.current;
      if (!nextPayload) {
        return;
      }
      void publishCurrentPayload({
        payload: nextPayload,
        sessionRef,
        teamSlugOrId,
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [payload, teamSlugOrId]);
}

async function publishCurrentPayload(args: {
  payload: ReturnType<typeof buildMobileHeartbeatPayload>;
  sessionRef: React.MutableRefObject<MachineSession | null>;
  teamSlugOrId: string;
}) {
  const payload = args.payload;
  if (!payload) {
    return;
  }

  try {
    const session = await ensureMachineSession({
      teamSlugOrId: args.teamSlugOrId,
      machineId: payload.machineId,
      displayName: payload.displayName,
      sessionRef: args.sessionRef,
    });

    const response = await fetch(new URL("/api/mobile/heartbeat", WWW_ORIGIN), {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Heartbeat publish failed with status ${response.status}`);
    }
  } catch (error) {
    console.error("[mobile-heartbeat] Failed to publish heartbeat", error);
  }
}

async function ensureMachineSession(args: {
  teamSlugOrId: string;
  machineId: string;
  displayName: string;
  sessionRef: React.MutableRefObject<MachineSession | null>;
}) {
  const existing = args.sessionRef.current;
  if (
    existing &&
    existing.expiresAt - Date.now() > MACHINE_SESSION_REFRESH_SKEW_MS
  ) {
    return existing;
  }

  const user = await cachedGetUser(stackClientApp);
  if (!user) {
    throw new Error("User not available for mobile machine session");
  }
  const authHeaders = await user.getAuthHeaders();
  const response = await fetch(new URL("/api/mobile/machine-session", WWW_ORIGIN), {
    method: "POST",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      teamSlugOrId: args.teamSlugOrId,
      machineId: args.machineId,
      displayName: args.displayName,
    }),
  });

  if (!response.ok) {
    throw new Error(`Machine session request failed with status ${response.status}`);
  }

  const session = (await response.json()) as MachineSession;
  args.sessionRef.current = session;
  return session;
}
