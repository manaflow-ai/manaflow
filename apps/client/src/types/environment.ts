/**
 * Environment types for the client app.
 * Re-exports shared types and adds client-specific extensions.
 */
import type { MorphSnapshotId } from "@cmux/shared";
import {
  type EnvVar as SharedEnvVar,
  ensureInitialEnvVars as sharedEnsureInitialEnvVars,
  createEmptyEnvironmentConfig as sharedCreateEmptyEnvironmentConfig,
} from "@cmux/shared/environment-config";

// Re-export shared types
export type EnvVar = SharedEnvVar;
export const ensureInitialEnvVars = sharedEnsureInitialEnvVars;

// Client-specific environment config draft (without frameworkPreset for now)
export interface EnvironmentConfigDraft {
  envName: string;
  envVars: EnvVar[];
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
}

export interface EnvironmentDraftMetadata {
  selectedRepos: string[];
  instanceId?: string;
  snapshotId?: MorphSnapshotId;
}

export const createEmptyEnvironmentConfig = (): EnvironmentConfigDraft => {
  const base = sharedCreateEmptyEnvironmentConfig();
  return {
    envName: base.envName,
    envVars: base.envVars,
    maintenanceScript: base.maintenanceScript,
    devScript: base.devScript,
    exposedPorts: base.exposedPorts,
  };
};
