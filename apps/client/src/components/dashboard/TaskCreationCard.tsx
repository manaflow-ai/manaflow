import {
  DashboardInput,
  type EditorApi,
} from "@/components/dashboard/DashboardInput";
import { DashboardInputControls } from "@/components/dashboard/DashboardInputControls";
import { DashboardInputFooter } from "@/components/dashboard/DashboardInputFooter";
import { DashboardStartTaskButton } from "@/components/dashboard/DashboardStartTaskButton";
import type { SelectOption } from "@/components/ui/searchable-select";
import type { ProviderStatusResponse } from "@cmux/shared";
import type { Id } from "@cmux/convex/dataModel";
import type { RefObject } from "react";

export type TaskCreationCardProps = {
  editorApiRef: RefObject<EditorApi | null>;
  onTaskDescriptionChange: (value: string) => void;
  onSubmit: () => void;
  lexicalRepoUrl?: string;
  lexicalEnvironmentId?: Id<"environments">;
  lexicalBranch?: string;
  projectOptions: SelectOption[];
  selectedProject: string[];
  onProjectChange: (newProjects: string[]) => void;
  onProjectSearchPaste?: (value: string) => boolean | Promise<boolean>;
  branchOptions: string[];
  selectedBranch: string[];
  onBranchChange: (newBranches: string[]) => void;
  selectedAgents: string[];
  onAgentChange: (newAgents: string[]) => void;
  isCloudMode: boolean;
  onCloudModeToggle: () => void;
  isLoadingProjects: boolean;
  isLoadingBranches: boolean;
  teamSlugOrId: string;
  cloudToggleDisabled: boolean;
  branchDisabled: boolean;
  providerStatus: ProviderStatusResponse | null;
  canSubmit: boolean;
  onStartTask: () => void;
};

export function TaskCreationCard({
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
  teamSlugOrId,
  cloudToggleDisabled,
  branchDisabled,
  providerStatus,
  canSubmit,
  onStartTask,
}: TaskCreationCardProps) {
  return (
    <div className="relative bg-white dark:bg-neutral-700/50 border border-neutral-500/15 dark:border-neutral-500/15 rounded-2xl transition-all">
      <DashboardInput
        ref={editorApiRef}
        onTaskDescriptionChange={onTaskDescriptionChange}
        onSubmit={onSubmit}
        repoUrl={lexicalRepoUrl}
        environmentId={lexicalEnvironmentId}
        branch={lexicalBranch}
        persistenceKey="dashboard-task-description"
        maxHeight="300px"
      />

      <DashboardInputFooter>
        <DashboardInputControls
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
          cloudToggleDisabled={cloudToggleDisabled}
          branchDisabled={branchDisabled}
          providerStatus={providerStatus}
        />
        <DashboardStartTaskButton
          canSubmit={canSubmit}
          onStartTask={onStartTask}
        />
      </DashboardInputFooter>
    </div>
  );
}
