import { env } from "@/client-env";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { useTheme } from "@/components/theme/use-theme";
import {
  rewriteLocalWorkspaceUrlIfNeeded,
  toProxyWorkspaceUrl,
} from "@/lib/toProxyWorkspaceUrl";
import { useLocalVSCodeServeWebQuery } from "@/queries/local-vscode-serve-web";
import { preloadTaskRunIframes } from "@/lib/preloadTaskRunIframes";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import type {
  CreateLocalWorkspaceResponse,
  CreateCloudWorkspaceResponse,
} from "@cmux/shared";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState, useCallback } from "react";
import { toast } from "sonner";

interface UseCreateWorkspaceOptions {
  teamSlugOrId: string;
}

export function useCreateWorkspace({ teamSlugOrId }: UseCreateWorkspaceOptions) {
  const { socket } = useSocket();
  const { theme } = useTheme();
  const { addTaskToExpand } = useExpandTasks();
  const navigate = useNavigate();
  const router = useRouter();
  const localServeWeb = useLocalVSCodeServeWebQuery();

  const [isCreatingLocalWorkspace, setIsCreatingLocalWorkspace] = useState(false);
  const [isCreatingCloudWorkspace, setIsCreatingCloudWorkspace] = useState(false);

  const createTask = useMutation(api.tasks.create);
  const reserveLocalWorkspace = useMutation(api.localWorkspaces.reserve);
  const failTaskRun = useMutation(api.taskRuns.fail);
  const environments = useQuery(api.environments.list, { teamSlugOrId });

  const isWebMode = Boolean(env.NEXT_PUBLIC_WEB_MODE);

  const createLocalWorkspace = useCallback(
    async (projectFullName: string) => {
      if (isCreatingLocalWorkspace) {
        return;
      }
      if (!socket) {
        console.warn(
          "Socket is not connected yet. Please try again momentarily."
        );
        return;
      }

      setIsCreatingLocalWorkspace(true);
      let reservedTaskId: Id<"tasks"> | null = null;
      let reservedTaskRunId: Id<"taskRuns"> | null = null;

      try {
        const repoUrl = `https://github.com/${projectFullName}.git`;
        const reservation = await reserveLocalWorkspace({
          teamSlugOrId,
          projectFullName,
          repoUrl,
        });
        if (!reservation) {
          throw new Error("Unable to reserve workspace name");
        }

        reservedTaskId = reservation.taskId;
        reservedTaskRunId = reservation.taskRunId;

        addTaskToExpand(reservation.taskId);

        await new Promise<void>((resolve) => {
          socket.emit(
            "create-local-workspace",
            {
              teamSlugOrId,
              projectFullName,
              repoUrl,
              taskId: reservation.taskId,
              taskRunId: reservation.taskRunId,
              workspaceName: reservation.workspaceName,
              descriptor: reservation.descriptor,
            },
            async (response: CreateLocalWorkspaceResponse) => {
              try {
                if (!response?.success) {
                  const message =
                    response?.error ??
                    `Unable to create workspace for ${projectFullName}`;
                  if (reservedTaskRunId) {
                    await failTaskRun({
                      teamSlugOrId,
                      id: reservedTaskRunId,
                      errorMessage: message,
                    }).catch(() => undefined);
                  }
                  toast.error(message);
                  return;
                }

                const effectiveTaskId = response.taskId ?? reservedTaskId;
                const effectiveTaskRunId =
                  response.taskRunId ?? reservedTaskRunId;
                const effectiveWorkspaceName =
                  response.workspaceName ??
                  reservation.workspaceName ??
                  projectFullName;

                console.log(
                  response.pending
                    ? `${effectiveWorkspaceName} is provisioning…`
                    : `${effectiveWorkspaceName} is ready`
                );

                const normalizedWorkspaceUrl = response.workspaceUrl
                  ? rewriteLocalWorkspaceUrlIfNeeded(
                      response.workspaceUrl,
                      localServeWeb.data?.baseUrl
                    )
                  : null;

                if (response.workspaceUrl && effectiveTaskRunId) {
                  const proxiedUrl = toProxyWorkspaceUrl(
                    response.workspaceUrl,
                    localServeWeb.data?.baseUrl
                  );
                  if (proxiedUrl) {
                    void preloadTaskRunIframes([
                      { url: proxiedUrl, taskRunId: effectiveTaskRunId },
                    ]).catch(() => undefined);
                  }
                }

                if (effectiveTaskId && effectiveTaskRunId) {
                  void router
                    .preloadRoute({
                      to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                      params: {
                        teamSlugOrId,
                        taskId: effectiveTaskId,
                        runId: effectiveTaskRunId,
                      },
                    })
                    .catch(() => undefined);
                  void navigate({
                    to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                    params: {
                      teamSlugOrId,
                      taskId: effectiveTaskId,
                      runId: effectiveTaskRunId,
                    },
                  });
                } else if (normalizedWorkspaceUrl) {
                  window.location.assign(normalizedWorkspaceUrl);
                }
              } catch (callbackError) {
                const message =
                  callbackError instanceof Error
                    ? callbackError.message
                    : String(callbackError ?? "Unknown");
                console.error("Failed to create workspace", message);
              } finally {
                resolve();
              }
            }
          );
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "Unknown");
        if (reservedTaskRunId) {
          await failTaskRun({
            teamSlugOrId,
            id: reservedTaskRunId,
            errorMessage: message,
          }).catch(() => undefined);
        }
        console.error("Failed to create workspace", message);
        toast.error("Failed to create local workspace");
      } finally {
        setIsCreatingLocalWorkspace(false);
      }
    },
    [
      addTaskToExpand,
      failTaskRun,
      isCreatingLocalWorkspace,
      localServeWeb.data?.baseUrl,
      navigate,
      reserveLocalWorkspace,
      router,
      socket,
      teamSlugOrId,
    ]
  );

  const createCloudWorkspaceFromEnvironment = useCallback(
    async (environmentId: Id<"environments">) => {
      if (isCreatingCloudWorkspace) {
        return;
      }
      if (!socket) {
        console.warn(
          "Socket is not connected yet. Please try again momentarily."
        );
        return;
      }

      setIsCreatingCloudWorkspace(true);

      try {
        const environment = environments?.find(
          (env) => env._id === environmentId
        );
        const environmentName = environment?.name ?? "Unknown Environment";

        const { taskId } = await createTask({
          teamSlugOrId,
          text: `Cloud Workspace: ${environmentName}`,
          projectFullName: undefined,
          baseBranch: undefined,
          environmentId,
          isCloudWorkspace: true,
        });

        addTaskToExpand(taskId);

        await new Promise<void>((resolve) => {
          socket.emit(
            "create-cloud-workspace",
            {
              teamSlugOrId,
              environmentId,
              taskId,
              theme,
            },
            async (response: CreateCloudWorkspaceResponse) => {
              try {
                if (response.success) {
                  toast.success("Cloud workspace created successfully");
                } else {
                  toast.error(
                    response.error || "Failed to create cloud workspace"
                  );
                }
              } catch (callbackError) {
                const message =
                  callbackError instanceof Error
                    ? callbackError.message
                    : String(callbackError ?? "Unknown");
                console.error("Failed to create cloud workspace", message);
              } finally {
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error("Error creating cloud workspace:", error);
        toast.error("Failed to create cloud workspace");
      } finally {
        setIsCreatingCloudWorkspace(false);
      }
    },
    [
      addTaskToExpand,
      createTask,
      environments,
      isCreatingCloudWorkspace,
      socket,
      teamSlugOrId,
      theme,
    ]
  );

  const createCloudWorkspaceFromRepo = useCallback(
    async (projectFullName: string) => {
      if (isCreatingCloudWorkspace) {
        return;
      }
      if (!socket) {
        console.warn(
          "Socket is not connected yet. Please try again momentarily."
        );
        return;
      }

      setIsCreatingCloudWorkspace(true);

      try {
        const repoUrl = `https://github.com/${projectFullName}.git`;

        const { taskId } = await createTask({
          teamSlugOrId,
          text: `Cloud Workspace: ${projectFullName}`,
          projectFullName,
          baseBranch: undefined,
          environmentId: undefined,
          isCloudWorkspace: true,
        });

        addTaskToExpand(taskId);

        await new Promise<void>((resolve) => {
          socket.emit(
            "create-cloud-workspace",
            {
              teamSlugOrId,
              projectFullName,
              repoUrl,
              taskId,
              theme,
            },
            async (response: CreateCloudWorkspaceResponse) => {
              try {
                if (response.success) {
                  toast.success("Cloud workspace created successfully");
                } else {
                  toast.error(
                    response.error || "Failed to create cloud workspace"
                  );
                }
              } catch (callbackError) {
                const message =
                  callbackError instanceof Error
                    ? callbackError.message
                    : String(callbackError ?? "Unknown");
                console.error("Failed to create cloud workspace", message);
              } finally {
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error("Error creating cloud workspace:", error);
        toast.error("Failed to create cloud workspace");
      } finally {
        setIsCreatingCloudWorkspace(false);
      }
    },
    [
      addTaskToExpand,
      createTask,
      isCreatingCloudWorkspace,
      socket,
      teamSlugOrId,
      theme,
    ]
  );

  return {
    createLocalWorkspace,
    createCloudWorkspaceFromEnvironment,
    createCloudWorkspaceFromRepo,
    isCreatingLocalWorkspace,
    isCreatingCloudWorkspace,
    isCreating: isCreatingLocalWorkspace || isCreatingCloudWorkspace,
    isWebMode,
    environments,
  };
}
