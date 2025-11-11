import { TaskCreationCard } from "@/components/dashboard/TaskCreationCard";
import { useTaskCreationForm } from "@/components/dashboard/useTaskCreationForm";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback } from "react";

type NewTaskDialogProps = {
  teamSlugOrId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewTaskDialog({
  teamSlugOrId,
  open,
  onOpenChange,
}: NewTaskDialogProps) {
  const {
    editorApiRef,
    handleTaskDescriptionChange,
    lexicalRepoUrl,
    lexicalEnvironmentId,
    lexicalBranch,
    projectOptions,
    selectedProject,
    handleProjectChange,
    handleProjectSearchPaste,
    branchOptions,
    selectedBranch,
    handleBranchChange,
    selectedAgents,
    handleAgentChange,
    isCloudMode,
    handleCloudModeToggle,
    isLoadingProjects,
    isLoadingBranches,
    providerStatus,
    canSubmit,
    handleStartTask,
    branchDisabled,
    cloudToggleDisabled,
  } = useTaskCreationForm({ teamSlugOrId });

  const handleSubmit = useCallback(() => {
    if (canSubmit) {
      void handleStartTask();
    }
  }, [canSubmit, handleStartTask]);

  const handleDialogChange = useCallback(
    (next: boolean) => {
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleDialogChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-neutral-950/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-5xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-200 bg-white shadow-2xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5 dark:border-neutral-800">
            <div>
              <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                Start a new task
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Pick a repository or environment, describe the work, and kick
                off a run without leaving your current page.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="max-h-[calc(90vh-5rem)] overflow-y-auto px-6 py-6">
            <TaskCreationCard
              editorApiRef={editorApiRef}
              onTaskDescriptionChange={handleTaskDescriptionChange}
              onSubmit={handleSubmit}
              lexicalRepoUrl={lexicalRepoUrl}
              lexicalEnvironmentId={lexicalEnvironmentId}
              lexicalBranch={lexicalBranch}
              projectOptions={projectOptions}
              selectedProject={selectedProject}
              onProjectChange={handleProjectChange}
              onProjectSearchPaste={handleProjectSearchPaste}
              branchOptions={branchOptions}
              selectedBranch={selectedBranch}
              onBranchChange={handleBranchChange}
              selectedAgents={selectedAgents}
              onAgentChange={handleAgentChange}
              isCloudMode={isCloudMode}
              onCloudModeToggle={handleCloudModeToggle}
              isLoadingProjects={isLoadingProjects}
              isLoadingBranches={isLoadingBranches}
              teamSlugOrId={teamSlugOrId}
              cloudToggleDisabled={cloudToggleDisabled}
              branchDisabled={branchDisabled}
              providerStatus={providerStatus}
              canSubmit={canSubmit}
              onStartTask={handleStartTask}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
