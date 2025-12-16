import type { MorphSnapshotId } from "@cmux/shared";

export type EnvVar = { name: string; value: string; isSecret: boolean };

export const ensureInitialEnvVars = (initial?: EnvVar[]): EnvVar[] => {
  const base = (initial ?? []).map((item) => ({
    name: item.name,
    value: item.value,
    isSecret: item.isSecret ?? true,
  }));
  if (base.length === 0) {
    return [{ name: "", value: "", isSecret: true }];
  }
  const last = base[base.length - 1];
  if (!last || last.name.trim().length > 0 || last.value.trim().length > 0) {
    base.push({ name: "", value: "", isSecret: true });
  }
  return base;
};

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

export const createEmptyEnvironmentConfig = (): EnvironmentConfigDraft => ({
  envName: "",
  envVars: ensureInitialEnvVars(),
  maintenanceScript: "",
  devScript: "",
  exposedPorts: "",
});
