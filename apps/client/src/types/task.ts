import { type Doc } from "@cmux/convex/dataModel";

export type RunEnvironmentSummary = Pick<
  Doc<"environments">,
  "_id" | "name" | "selectedRepos"
>;

export interface TaskRunWithChildren extends Doc<"taskRuns"> {
  children: TaskRunWithChildren[];
  environment: RunEnvironmentSummary | null;
}

export interface AnnotatedTaskRun extends TaskRunWithChildren {
  agentOrdinal?: number;
  hasDuplicateAgentName?: boolean;
  children: AnnotatedTaskRun[];
}

export interface Repo {
  fullName: string;
  org: string;
  name: string;
}

export interface TaskVersion extends Doc<"taskVersions"> {
  task: Doc<"tasks">;
  version: number;
}
