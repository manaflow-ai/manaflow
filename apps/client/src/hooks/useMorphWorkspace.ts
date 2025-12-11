import { useMutation, useQuery } from "@tanstack/react-query";
import { useQuery as useConvexQuery } from "convex/react";
import {
  postApiMorphTaskRunsByTaskRunIdIsPaused,
  type Options,
  type PostApiMorphTaskRunsByTaskRunIdResumeData,
  type PostApiMorphTaskRunsByTaskRunIdResumeResponse,
  type PostApiMorphTaskRunsByTaskRunIdRefreshGithubAuthData,
  type PostApiMorphTaskRunsByTaskRunIdRefreshGithubAuthResponse,
} from "@cmux/www-openapi-client";
import {
  postApiMorphTaskRunsByTaskRunIdResumeMutation,
  postApiMorphTaskRunsByTaskRunIdRefreshGithubAuthMutation,
} from "@cmux/www-openapi-client/react-query";
import { toast } from "sonner";
import { queryClient } from "@/query-client";
import { api } from "@cmux/convex/api";
import { type Id } from "@cmux/convex/dataModel";
import { useCallback, useEffect, useRef } from "react";
import { useUser } from "@stackframe/react";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";

interface MorphWorkspaceQueryArgs {
  taskRunId: Id<"taskRuns">;
  teamSlugOrId: string;
  enabled?: boolean;
}

interface UseResumeMorphWorkspaceArgs {
  taskRunId: Id<"taskRuns">;
  teamSlugOrId: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export function morphPauseQueryKey(taskRunId: string, teamSlugOrId: string) {
  return ["morph", "task-run", taskRunId, "paused", teamSlugOrId] as const;
}

export function useMorphInstancePauseQuery({
  taskRunId,
  teamSlugOrId,
  enabled,
}: MorphWorkspaceQueryArgs) {
  const taskRun = useConvexQuery(api.taskRuns.get, {
    teamSlugOrId,
    id: taskRunId,
  });
  const canResume = taskRun?.vscode?.provider === "morph";
  return useQuery({
    enabled: canResume && enabled,
    queryKey: morphPauseQueryKey(taskRunId, teamSlugOrId),
    queryFn: async ({ signal }) => {
      const { data } = await postApiMorphTaskRunsByTaskRunIdIsPaused({
        path: {
          taskRunId,
        },
        body: {
          teamSlugOrId,
        },
        signal,
        throwOnError: true,
      });
      return data;
    },
  });
}

export function useResumeMorphWorkspace({
  taskRunId,
  teamSlugOrId,
  onSuccess,
  onError,
}: UseResumeMorphWorkspaceArgs) {
  return useMutation<
    PostApiMorphTaskRunsByTaskRunIdResumeResponse,
    Error,
    Options<PostApiMorphTaskRunsByTaskRunIdResumeData>,
    { toastId: string | number }
  >({
    ...postApiMorphTaskRunsByTaskRunIdResumeMutation(),
    mutationKey: ["resume", "task-run", taskRunId],
    onMutate: async () => {
      const toastId = toast.loading("Resuming workspace…");
      return { toastId };
    },
    onSuccess: (_data, __, context) => {
      toast.success("Workspace resumed", { id: context?.toastId });
      queryClient.setQueryData(morphPauseQueryKey(taskRunId, teamSlugOrId), {
        paused: false,
      });
      onSuccess?.();
    },
    onError: (error, _variables, context) => {
      const message =
        error instanceof Error ? error.message : "Failed to resume VM.";
      toast.error(message, { id: context?.toastId });
      onError?.(error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: morphPauseQueryKey(taskRunId, teamSlugOrId),
      });
    },
  });
}

interface UseRefreshGitHubAuthArgs {
  taskRunId: Id<"taskRuns">;
  teamSlugOrId: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export function useRefreshMorphGitHubAuth({
  taskRunId,
  teamSlugOrId: _teamSlugOrId,
  onSuccess,
  onError,
}: UseRefreshGitHubAuthArgs) {
  return useMutation<
    PostApiMorphTaskRunsByTaskRunIdRefreshGithubAuthResponse,
    Error,
    Options<PostApiMorphTaskRunsByTaskRunIdRefreshGithubAuthData>,
    { toastId: string | number }
  >({
    ...postApiMorphTaskRunsByTaskRunIdRefreshGithubAuthMutation(),
    mutationKey: ["refresh-github-auth", "task-run", taskRunId],
    onMutate: async () => {
      const toastId = toast.loading("Refreshing GitHub authentication…");
      return { toastId };
    },
    onSuccess: (_data, __, context) => {
      toast.success("GitHub authentication refreshed", { id: context?.toastId });
      onSuccess?.();
    },
    onError: (error, _variables, context) => {
      let message = "Failed to refresh GitHub auth.";
      if (error instanceof Error) {
        // Handle specific error cases
        if (error.message.includes("409") || error.message.includes("paused")) {
          message = "VM is paused. Resume it first.";
        } else if (
          error.message.includes("401") ||
          error.message.includes("GitHub")
        ) {
          message = "GitHub account not connected. Check your settings.";
        } else {
          message = error.message;
        }
      }
      toast.error(message, { id: context?.toastId });
      onError?.(error);
    },
  });
}

/**
 * Configuration for the TTL extension hook
 */
interface UseMorphTtlExtensionArgs {
  /** The task run ID to extend TTL for */
  taskRunId: Id<"taskRuns">;
  /** The team slug or ID */
  teamSlugOrId: string;
  /**
   * Whether the hook is enabled. Should be true when the user is actively
   * viewing a task run page.
   */
  enabled?: boolean;
  /**
   * How often to extend the TTL in milliseconds.
   * Default: 10 minutes (600000ms)
   */
  intervalMs?: number;
  /**
   * How many seconds to extend the TTL by each time.
   * Default: 30 minutes (1800s)
   */
  ttlSeconds?: number;
}

/**
 * Hook that automatically extends the TTL of a Morph instance while the user
 * is actively viewing a task run. It checks for:
 * - Network connectivity (navigator.onLine)
 * - Document visibility (document.visibilityState)
 * - Whether the task run uses a Morph instance
 *
 * The TTL is extended at regular intervals while all conditions are met.
 */
export function useMorphTtlExtension({
  taskRunId,
  teamSlugOrId,
  enabled = true,
  intervalMs = 10 * 60 * 1000, // 10 minutes
  ttlSeconds = 30 * 60, // 30 minutes
}: UseMorphTtlExtensionArgs) {
  const user = useUser({ or: "redirect" });
  const taskRun = useConvexQuery(
    api.taskRuns.get,
    enabled && taskRunId ? { teamSlugOrId, id: taskRunId } : "skip"
  );

  const isMorphProvider = taskRun?.vscode?.provider === "morph";
  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const extendTtl = useCallback(async () => {
    if (!isMorphProvider || !taskRunId) {
      return;
    }

    // Check network connectivity
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      console.log("[useMorphTtlExtension] Skipping TTL extension - offline");
      return;
    }

    // Check document visibility
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      console.log("[useMorphTtlExtension] Skipping TTL extension - page not visible");
      return;
    }

    try {
      const headers = await user.getAuthHeaders();
      const response = await fetch(
        `${WWW_ORIGIN}/api/morph/task-runs/${taskRunId}/extend-ttl`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          credentials: "include",
          body: JSON.stringify({ teamSlugOrId, ttlSeconds }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`[useMorphTtlExtension] Extended TTL for ${taskRunId} by ${ttlSeconds}s`);
    } catch (error) {
      // Log but don't throw - TTL extension failure shouldn't break the UI
      console.error("[useMorphTtlExtension] Failed to extend TTL:", error);
    }
  }, [isMorphProvider, taskRunId, teamSlugOrId, ttlSeconds, user]);

  // Handle visibility and online status changes
  useEffect(() => {
    if (!enabled || !isMorphProvider) {
      return;
    }

    const checkAndExtend = () => {
      const isOnline = typeof navigator === "undefined" || navigator.onLine;
      const isVisible = typeof document === "undefined" || document.visibilityState === "visible";
      const shouldBeActive = isOnline && isVisible;

      if (shouldBeActive && !isActiveRef.current) {
        // Becoming active - extend TTL immediately and start interval
        isActiveRef.current = true;
        void extendTtl();
      } else if (!shouldBeActive && isActiveRef.current) {
        // Becoming inactive - clear interval
        isActiveRef.current = false;
      }
    };

    // Initial check
    checkAndExtend();

    // Listen for visibility changes
    const handleVisibilityChange = () => {
      checkAndExtend();
    };

    // Listen for online/offline changes
    const handleOnline = () => {
      checkAndExtend();
    };

    const handleOffline = () => {
      checkAndExtend();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }, [enabled, isMorphProvider, extendTtl]);

  // Set up the interval for periodic TTL extension
  useEffect(() => {
    if (!enabled || !isMorphProvider) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Set up interval
    intervalRef.current = setInterval(() => {
      if (isActiveRef.current) {
        void extendTtl();
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isMorphProvider, intervalMs, extendTtl]);

  return {
    /** Whether the task run uses a Morph provider */
    isMorphProvider,
    /** Manually trigger a TTL extension */
    extendTtl,
  };
}
