// Re-export types from shared package
// This maintains backward compatibility while using the shared types
export type {
  EnvVar,
  EnvVarGroup,
  EnvironmentConfigDraft,
  EnvironmentFlowStep,
  WorkspaceConfigStep,
  RepoConfig,
  FrameworkPreset,
  PackageManager,
} from "@cmux/shared/environment-flow";

export {
  ensureInitialEnvVars,
  createEmptyEnvironmentConfigDraft as createEmptyEnvironmentConfig,
  envVarsToGroups,
  envVarGroupsToFlat,
  getRepoWorkspacePath,
  createRepoConfigs,
} from "@cmux/shared/environment-flow";

import type { MorphSnapshotId } from "@cmux/shared";

// Keep the metadata type here since it's client-specific
export interface EnvironmentDraftMetadata {
  selectedRepos: string[];
  instanceId?: string;
  snapshotId?: MorphSnapshotId;
}
