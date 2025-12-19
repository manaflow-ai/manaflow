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
import { FolderOpen, Cloud, Loader2, Plus } from "lucide-react";
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
              toast.success(
                `Local workspace "${reservation.workspaceName}" created`
              );
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
  ]);

  const handleCreateCloudWorkspace = useCallback(async () => {
    if (!socket) {
      toast.error("Socket not connected");
      return;
    }

    if (selectedProject.length === 0) {
      toast.error("Please select an environment first");
      return;
    }

    if (!isEnvSelected) {
      toast.error("Cloud workspaces require an environment, not a repository");
      return;
    }

    const projectFullName = selectedProject[0];
    const environmentId = projectFullName.replace(
      /^env:/,
      ""
    ) as Id<"environments">;

    // Extract environment name from the selectedProject (format is "env:id")
    const environmentName = "Cloud Workspace";

    setIsCreatingCloud(true);

    try {
      // Create task in Convex with environment name
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
            if (response.success) {
              toast.success("Cloud workspace created");
            } else {
              toast.error(
                response.error || "Failed to create cloud workspace"
              );
            }
            resolve();
          }
        );
      });
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
  ]);

  const canCreateLocal = selectedProject.length > 0 && !isEnvSelected;
  const canCreateCloud = selectedProject.length > 0 && isEnvSelected;
  const isCreating = isCreatingLocal || isCreatingCloud;

  // Show different content based on selection state
  if (selectedProject.length === 0) {
    return (
      <div className={clsx("flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400", className)}>
        <Plus className="w-3.5 h-3.5" />
        <span>Select a project to create a workspace</span>
      </div>
    );
  }

  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <span className="text-xs text-neutral-500 dark:text-neutral-400 mr-1">
        Quick actions:
      </span>

      {/* Local Workspace Button - shown when repo is selected */}
      {!isEnvSelected && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCreateLocalWorkspace}
              disabled={!canCreateLocal || isCreating}
              className={clsx(
                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors",
                "bg-neutral-100 dark:bg-neutral-700/50",
                "text-neutral-700 dark:text-neutral-300",
                "hover:bg-neutral-200 dark:hover:bg-neutral-600/50",
                "border border-neutral-200 dark:border-neutral-600/50",
                "disabled:opacity-50 disabled:cursor-not-allowed"
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
            <p>Create a local Docker workspace with this repository</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Cloud Workspace Button - shown when environment is selected */}
      {isEnvSelected && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCreateCloudWorkspace}
              disabled={!canCreateCloud || isCreating}
              className={clsx(
                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors",
                "bg-blue-50 dark:bg-blue-900/20",
                "text-blue-700 dark:text-blue-300",
                "hover:bg-blue-100 dark:hover:bg-blue-800/30",
                "border border-blue-200 dark:border-blue-700/50",
                "disabled:opacity-50 disabled:cursor-not-allowed"
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
            <p>Create a cloud workspace with this environment</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
