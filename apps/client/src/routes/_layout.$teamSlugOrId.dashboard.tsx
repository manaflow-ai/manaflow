import { TaskCreationCard } from "@/components/dashboard/TaskCreationCard";
import { TaskList } from "@/components/dashboard/TaskList";
import { WorkspaceCreationButtons } from "@/components/dashboard/WorkspaceCreationButtons";
import { FloatingPane } from "@/components/floating-pane";
import { WorkspaceSetupPanel } from "@/components/WorkspaceSetupPanel";
import { TitleBar } from "@/components/TitleBar";
import { useTaskCreationForm } from "@/components/dashboard/useTaskCreationForm";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/$teamSlugOrId/dashboard")({
  component: DashboardComponent,
});

function DashboardComponent() {
  const { teamSlugOrId } = Route.useParams();
  const searchParams = Route.useSearch() as { environmentId?: string };

  const {
    editorApiRef,
    onTaskDescriptionChange,
    onSubmit,
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
    selectedRepoFullName,
    shouldShowWorkspaceSetup,
  } = useTaskCreationForm({
    teamSlugOrId,
    searchEnvironmentId: searchParams?.environmentId,
    enableGlobalKeydown: true,
  });

  const branchDisabled = isEnvSelected || !selectedProject[0];

  return (
    <FloatingPane header={<TitleBar title="cmux" />}>
      <div className="flex flex-col grow overflow-y-auto">
        <div className="flex-1 flex justify-center px-4 pt-60 pb-4">
          <div className="w-full max-w-4xl min-w-0">
            <WorkspaceCreationButtons
              teamSlugOrId={teamSlugOrId}
              selectedProject={selectedProject}
              isEnvSelected={isEnvSelected}
            />

            <TaskCreationCard
              editorApiRef={editorApiRef}
              onTaskDescriptionChange={onTaskDescriptionChange}
              onSubmit={onSubmit}
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
                void startTask();
              }}
            />

            {shouldShowWorkspaceSetup ? (
              <WorkspaceSetupPanel
                teamSlugOrId={teamSlugOrId}
                projectFullName={selectedRepoFullName!}
              />
            ) : null}

            <TaskList teamSlugOrId={teamSlugOrId} />
          </div>
        </div>
      </div>
    </FloatingPane>
  );
}
