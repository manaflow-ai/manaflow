import { TaskCreationCard } from "@/components/dashboard/TaskCreationCard";
import { TaskList } from "@/components/dashboard/TaskList";
import { WorkspaceCreationButtons } from "@/components/dashboard/WorkspaceCreationButtons";
import { useTaskCreationForm } from "@/components/dashboard/useTaskCreationForm";
import { FloatingPane } from "@/components/floating-pane";
import { WorkspaceSetupPanel } from "@/components/WorkspaceSetupPanel";
import { TitleBar } from "@/components/TitleBar";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

export const Route = createFileRoute("/_layout/$teamSlugOrId/dashboard")({
  component: DashboardComponent,
});

function DashboardComponent() {
  const { teamSlugOrId } = Route.useParams();
  const searchParams = Route.useSearch() as { environmentId?: string };

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
    isEnvSelected,
    selectedRepoFullName,
    branchDisabled,
    cloudToggleDisabled,
  } = useTaskCreationForm({ teamSlugOrId });

  useEffect(() => {
    if (searchParams?.environmentId) {
      handleProjectChange([`env:${searchParams.environmentId}`]);
    }
  }, [handleProjectChange, searchParams?.environmentId]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isEditor =
        activeElement?.getAttribute("data-cmux-input") === "true";
      const isCommentInput = activeElement?.id === "cmux-comments-root";
      if (
        !isEditor &&
        (activeElement?.tagName === "INPUT" ||
          activeElement?.tagName === "TEXTAREA" ||
          activeElement?.getAttribute("contenteditable") === "true" ||
          activeElement?.closest('[contenteditable="true"]') ||
          isCommentInput)
      ) {
        return;
      }

      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.key === "Tab" ||
        e.key === "Escape" ||
        e.key === "Enter" ||
        e.key.startsWith("F") ||
        e.key.startsWith("Arrow") ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === "PageUp" ||
        e.key === "PageDown" ||
        e.key === "Delete" ||
        e.key === "Backspace" ||
        e.key === "CapsLock" ||
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.key === "ContextMenu"
      ) {
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        if (editorApiRef.current?.focus) {
          editorApiRef.current.focus();
          editorApiRef.current.insertText?.(e.key);
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [editorApiRef]);

  const handleSubmit = useCallback(() => {
    if (canSubmit) {
      void handleStartTask();
    }
  }, [canSubmit, handleStartTask]);

  const shouldShowWorkspaceSetup =
    Boolean(selectedRepoFullName) && !isEnvSelected;

  return (
    <FloatingPane header={<TitleBar title="cmux" />}>
      <div className="flex flex-col grow overflow-y-auto">
        {/* Main content area */}
        <div className="flex-1 flex justify-center px-4 pt-60 pb-4">
          <div className="w-full max-w-4xl min-w-0">
            {/* Workspace Creation Buttons */}
            <WorkspaceCreationButtons
              teamSlugOrId={teamSlugOrId}
              selectedProject={selectedProject}
              isEnvSelected={isEnvSelected}
            />

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
            {shouldShowWorkspaceSetup ? (
              <WorkspaceSetupPanel
                teamSlugOrId={teamSlugOrId}
                projectFullName={selectedRepoFullName}
              />
            ) : null}

            {/* Task List */}
            <TaskList teamSlugOrId={teamSlugOrId} />
          </div>
        </div>
      </div>
    </FloatingPane>
  );
}
