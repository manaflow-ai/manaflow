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
