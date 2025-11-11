import { TaskCreationCard } from "@/components/dashboard/TaskCreationCard";
import { useTaskCreationForm } from "@/components/dashboard/useTaskCreationForm";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";

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
    onTaskDescriptionChange,
    lexicalRepoUrl,
    lexicalEnvironmentId,
    lexicalBranch,
    projectOptions,
    selectedProject,
    onProjectChange,
    onProjectSearchPaste,
    branchOptions,
    selectedBranch,
    onBranchChange,
    selectedAgents,
    onAgentChange,
    isCloudMode,
    onCloudModeToggle,
    isLoadingProjects,
    isLoadingBranches,
    providerStatus,
    canSubmit,
    startTask,
    isEnvSelected,
  } = useTaskCreationForm({
    teamSlugOrId,
    enableGlobalKeydown: false,
  });

  const branchDisabled = isEnvSelected || !selectedProject[0];

  const handleStartTask = useCallback(async () => {
    const started = await startTask();
    if (started) {
      onOpenChange(false);
    }
  }, [onOpenChange, startTask]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    void handleStartTask();
  }, [canSubmit, handleStartTask]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-neutral-950/60 backdrop-blur-sm z-[var(--z-commandbar)+1]" />
        <Dialog.Content className="fixed inset-0 z-[var(--z-commandbar)+2] flex items-center justify-center px-4 py-8 focus:outline-none">
          <div className="w-full max-w-3xl rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
              <div>
                <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                  Start a new task
                </Dialog.Title>
                <Dialog.Description className="text-sm text-neutral-500 dark:text-neutral-400">
                  Describe what you need and select a repo, branch, and agents.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
              <TaskCreationCard
                editorApiRef={editorApiRef}
                onTaskDescriptionChange={onTaskDescriptionChange}
                onSubmit={handleSubmit}
                lexicalRepoUrl={lexicalRepoUrl}
                lexicalEnvironmentId={lexicalEnvironmentId}
                lexicalBranch={lexicalBranch}
                projectOptions={projectOptions}
                selectedProject={selectedProject}
                onProjectChange={onProjectChange}
                onProjectSearchPaste={onProjectSearchPaste}
                branchOptions={branchOptions}
                selectedBranch={selectedBranch}
                onBranchChange={onBranchChange}
                selectedAgents={selectedAgents}
                onAgentChange={onAgentChange}
                isCloudMode={isCloudMode}
                onCloudModeToggle={onCloudModeToggle}
                isLoadingProjects={isLoadingProjects}
                isLoadingBranches={isLoadingBranches}
                teamSlugOrId={teamSlugOrId}
                cloudToggleDisabled={isEnvSelected}
                branchDisabled={branchDisabled}
                providerStatus={providerStatus}
                canSubmit={canSubmit}
                onStartTask={() => {
                  void handleStartTask();
                }}
              />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
