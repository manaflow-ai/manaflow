import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { useTheme } from "@/components/theme/use-theme";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import type {
  CreateLocalWorkspaceResponse,
  CreateCloudWorkspaceResponse,
} from "@cmux/shared";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, Cloud, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";

type WorkspaceQuickActionsProps = {
  teamSlugOrId: string;
  selectedProject: string[];
  isEnvSelected: boolean;
  className?: string;
};

export function WorkspaceQuickActions({
  teamSlugOrId,
  selectedProject,
  isEnvSelected,
  className,
}: WorkspaceQuickActionsProps) {
  const { socket } = useSocket();
  const { addTaskToExpand } = useExpandTasks();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [isCreatingLocal, setIsCreatingLocal] = useState(false);
  const [isCreatingCloud, setIsCreatingCloud] = useState(false);

  const reserveLocalWorkspace = useMutation(api.localWorkspaces.reserve);
  const createTask = useMutation(api.tasks.create);

  const handleCreateLocalWorkspace = useCallback(async () => {
    if (!socket) {
      toast.error("Socket not connected");
      return;
    }

    if (selectedProject.length === 0) {
      toast.error("Please select a repository first");
      return;
    }

    if (isEnvSelected) {
      toast.error("Local workspaces require a repository, not an environment");
      return;
    }

    const projectFullName = selectedProject[0];
    const repoUrl = `https://github.com/${projectFullName}.git`;

    setIsCreatingLocal(true);

    try {
      const reservation = await reserveLocalWorkspace({
        teamSlugOrId,
        projectFullName,
        repoUrl,
      });

      if (!reservation) {
        throw new Error("Unable to reserve workspace name");
      }

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
            if (response.success) {
              const effectiveTaskId = response.taskId ?? reservation.taskId;
              const effectiveTaskRunId =
                response.taskRunId ?? reservation.taskRunId;

              // Navigate to the workspace
              if (effectiveTaskId && effectiveTaskRunId) {
                void navigate({
                  to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                  params: {
                    teamSlugOrId,
                    taskId: effectiveTaskId,
                    runId: effectiveTaskRunId,
                  },
                });
              }
            } else {
              toast.error(
                response.error || "Failed to create local workspace"
              );
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error("Error creating local workspace:", error);
      toast.error("Failed to create local workspace");
    } finally {
      setIsCreatingLocal(false);
    }
  }, [
    socket,
    selectedProject,
    isEnvSelected,
    teamSlugOrId,
    reserveLocalWorkspace,
    addTaskToExpand,
    navigate,
  ]);

  const handleCreateCloudWorkspace = useCallback(async () => {
    if (!socket) {
      toast.error("Socket not connected");
      return;
    }

    if (selectedProject.length === 0) {
      toast.error("Please select a project first");
      return;
    }

    setIsCreatingCloud(true);

    try {
      if (isEnvSelected) {
        // Environment-based cloud workspace
        const projectFullName = selectedProject[0];
        const environmentId = projectFullName.replace(
          /^env:/,
          ""
        ) as Id<"environments">;

        const { taskId } = await createTask({
          teamSlugOrId,
          text: "Cloud Workspace",
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
              if (response.success) {
                const effectiveTaskId = response.taskId ?? taskId;
                const effectiveTaskRunId = response.taskRunId;

                // Navigate to the workspace
                if (effectiveTaskId && effectiveTaskRunId) {
                  void navigate({
                    to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                    params: {
                      teamSlugOrId,
                      taskId: effectiveTaskId,
                      runId: effectiveTaskRunId,
                    },
                  });
                }
              } else {
                toast.error(
                  response.error || "Failed to create cloud workspace"
                );
              }
              resolve();
            }
          );
        });
      } else {
        // Repository-based cloud workspace
        const projectFullName = selectedProject[0];
        const repoUrl = `https://github.com/${projectFullName}.git`;

        const { taskId } = await createTask({
          teamSlugOrId,
          text: `Cloud Workspace: ${projectFullName}`,
          projectFullName,
          baseBranch: undefined,
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
              if (response.success) {
                const effectiveTaskId = response.taskId ?? taskId;
                const effectiveTaskRunId = response.taskRunId;

                // Navigate to the workspace
                if (effectiveTaskId && effectiveTaskRunId) {
                  void navigate({
                    to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                    params: {
                      teamSlugOrId,
                      taskId: effectiveTaskId,
                      runId: effectiveTaskRunId,
                    },
                  });
                }
              } else {
                toast.error(
                  response.error || "Failed to create cloud workspace"
                );
              }
              resolve();
            }
          );
        });
      }
    } catch (error) {
      console.error("Error creating cloud workspace:", error);
      toast.error("Failed to create cloud workspace");
    } finally {
      setIsCreatingCloud(false);
    }
  }, [
    socket,
    selectedProject,
    isEnvSelected,
    teamSlugOrId,
    createTask,
    addTaskToExpand,
    theme,
    navigate,
  ]);

  const canCreateLocal = selectedProject.length > 0 && !isEnvSelected;
  const canCreateCloud = selectedProject.length > 0;
  const isCreating = isCreatingLocal || isCreatingCloud;

  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">
        Quick actions:
      </span>

      {/* Local Workspace Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCreateLocalWorkspace}
            disabled={!canCreateLocal || isCreating}
            className={clsx(
              "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all",
              "border",
              canCreateLocal
                ? [
                    "bg-white dark:bg-neutral-800",
                    "text-neutral-700 dark:text-neutral-200",
                    "border-neutral-200 dark:border-neutral-600",
                    "hover:bg-neutral-50 dark:hover:bg-neutral-700",
                    "hover:border-neutral-300 dark:hover:border-neutral-500",
                  ]
                : [
                    "bg-neutral-50 dark:bg-neutral-800/50",
                    "text-neutral-400 dark:text-neutral-500",
                    "border-neutral-100 dark:border-neutral-700",
                    "cursor-not-allowed",
                  ],
              isCreatingLocal && "cursor-wait"
            )}
          >
            {isCreatingLocal ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5" />
            )}
            <span>Local Workspace</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {canCreateLocal ? (
            <p>Create a local workspace</p>
          ) : (
            <p>Select a repository to create a local workspace</p>
          )}
        </TooltipContent>
      </Tooltip>

      {/* Cloud Workspace Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCreateCloudWorkspace}
            disabled={!canCreateCloud || isCreating}
            className={clsx(
              "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all",
              "border",
              canCreateCloud
                ? [
                    "bg-white dark:bg-neutral-800",
                    "text-neutral-700 dark:text-neutral-200",
                    "border-neutral-200 dark:border-neutral-600",
                    "hover:bg-neutral-50 dark:hover:bg-neutral-700",
                    "hover:border-neutral-300 dark:hover:border-neutral-500",
                  ]
                : [
                    "bg-neutral-50 dark:bg-neutral-800/50",
                    "text-neutral-400 dark:text-neutral-500",
                    "border-neutral-100 dark:border-neutral-700",
                    "cursor-not-allowed",
                  ],
              isCreatingCloud && "cursor-wait"
            )}
          >
            {isCreatingCloud ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Cloud className="w-3.5 h-3.5" />
            )}
            <span>Cloud Workspace</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {canCreateCloud ? (
            <p>Create a cloud workspace</p>
          ) : (
            <p>Select a project to create a cloud workspace</p>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
