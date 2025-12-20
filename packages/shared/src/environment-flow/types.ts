// Environment Flow Types - shared between electron and web apps
// These types support multiple repositories and nested environment variables

import type { MorphSnapshotId } from "../morph-snapshots";

/**
 * Single environment variable with secret flag
 */
export interface EnvVar {
  name: string;
  value: string;
  isSecret: boolean;
}

/**
 * Group of environment variables for a specific context
 * Supports nested env vars by allowing multiple groups
 */
export interface EnvVarGroup {
  /** Unique identifier for the group */
  id: string;
  /** Display name for the group (e.g., "Database", "API Keys", "Feature Flags") */
  label: string;
  /** Optional description of what this group is for */
  description?: string;
  /** Environment variables in this group */
  vars: EnvVar[];
  /** Whether this group is expanded in the UI */
  isExpanded?: boolean;
}

/**
 * Repository configuration within an environment
 * Supports multiple repositories with individual paths
 */
export interface RepoConfig {
  /** Full repository name (e.g., "owner/repo") */
  fullName: string;
  /** Branch to clone (defaults to main/master) */
  branch?: string;
  /** Subdirectory path within workspace where repo is cloned */
  workspacePath: string;
  /** Default/primary flag - the first/main repo */
  isPrimary?: boolean;
}

/**
 * Framework preset configuration
 */
export type FrameworkPreset =
  | "other"
  | "next"
  | "vite"
  | "remix"
  | "nuxt"
  | "sveltekit"
  | "angular"
  | "cra"
  | "vue";

/**
 * Package manager type
 */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/**
 * Configuration for scripts
 */
export interface ScriptsConfig {
  /** Command to install dependencies (e.g., "npm install") */
  maintenanceScript: string;
  /** Command to start dev server (e.g., "npm run dev") */
  devScript: string;
}

/**
 * Complete environment configuration
 * This is what gets saved when creating an environment
 */
export interface EnvironmentConfig {
  /** Environment name */
  name: string;
  /** Selected repositories with their workspace paths */
  repos: RepoConfig[];
  /** Environment variables - supports multiple groups for nesting */
  envVarGroups: EnvVarGroup[];
  /** Scripts configuration */
  scripts: ScriptsConfig;
  /** Exposed ports for preview URLs */
  exposedPorts: number[];
  /** Optional description */
  description?: string;
  /** Framework preset used (for reference) */
  frameworkPreset?: FrameworkPreset;
  /** Package manager detected/selected */
  packageManager?: PackageManager;
}

/**
 * Draft state for in-progress environment configuration
 * Used during the wizard flow
 */
export interface EnvironmentDraft {
  /** Current step in the wizard */
  step: EnvironmentFlowStep;
  /** Selected repository full names */
  selectedRepos: string[];
  /** Morph instance ID (if provisioned) */
  instanceId?: string;
  /** Snapshot preset ID being used */
  snapshotId?: MorphSnapshotId;
  /** Environment configuration being built */
  config: EnvironmentConfigDraft;
  /** Timestamp of last update */
  lastUpdatedAt: number;
}

/**
 * Partial config draft during the flow
 */
export interface EnvironmentConfigDraft {
  envName: string;
  /** Flat env vars for simple UI - converted to groups on save */
  envVars: EnvVar[];
  /** Optional grouped env vars for advanced UI */
  envVarGroups?: EnvVarGroup[];
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
  frameworkPreset?: FrameworkPreset;
  packageManager?: PackageManager;
}

/**
 * Steps in the environment flow wizard
 */
export type EnvironmentFlowStep =
  | "select" // Repository selection
  | "initial-setup" // Framework, scripts, env vars (full page)
  | "workspace-config"; // Workspace running, configure browser (split view)

/**
 * Substeps within workspace-config
 */
export type WorkspaceConfigStep =
  | "scripts" // Scripts review (collapsed from initial setup)
  | "env-vars" // Env vars review (collapsed from initial setup)
  | "run-scripts" // Run scripts in terminal
  | "browser-setup"; // Configure browser for auth

/**
 * Platform context for the flow
 * Used to customize behavior for electron vs web
 */
export interface EnvironmentFlowPlatform {
  /** Whether running in Electron */
  isElectron: boolean;
  /** Whether running in www (Next.js) */
  isWeb: boolean;
  /** GitHub app slug for installations (from env) */
  githubAppSlug?: string;
  /** Team slug or ID */
  teamSlugOrId: string;
}

/**
 * Sandbox instance info
 */
export interface SandboxInstance {
  instanceId: string;
  vscodeUrl: string;
  workerUrl?: string;
  vncUrl?: string;
  provider: string;
}

/**
 * Framework detection result from the API
 */
export interface FrameworkDetectionResult {
  framework: FrameworkPreset;
  packageManager: PackageManager;
  maintenanceScript: string;
  devScript: string;
}

/**
 * Callbacks for environment flow events
 */
export interface EnvironmentFlowCallbacks {
  /** Called when repos are selected and user clicks continue */
  onReposSelected?: (repos: string[]) => void;
  /** Called when initial setup is complete */
  onInitialSetupComplete?: () => void;
  /** Called when configuration is saved */
  onSaveConfiguration?: (config: EnvironmentConfig) => Promise<void>;
  /** Called when user goes back to previous step */
  onBack?: () => void;
  /** Called when user discards and exits */
  onDiscardAndExit?: () => void;
  /** Called when environment is saved successfully */
  onEnvironmentSaved?: (environmentId: string) => void;
}

/**
 * Props for the main environment flow component
 */
export interface EnvironmentFlowProps {
  /** Platform context */
  platform: EnvironmentFlowPlatform;
  /** Initial step (defaults to "select") */
  initialStep?: EnvironmentFlowStep;
  /** Initial selected repos */
  initialSelectedRepos?: string[];
  /** Initial snapshot ID */
  initialSnapshotId?: MorphSnapshotId;
  /** Pre-populated env vars content (from existing config) */
  initialEnvVarsContent?: string;
  /** Pre-populated maintenance script */
  initialMaintenanceScript?: string;
  /** Pre-populated dev script */
  initialDevScript?: string;
  /** Primary repo for framework detection */
  primaryRepo?: string;
  /** Callbacks */
  callbacks?: EnvironmentFlowCallbacks;
  /** Whether in preview.new mode (single repo, repo root = workspace root) */
  previewNewMode?: boolean;
}

// Helper functions

/**
 * Ensures env vars array always has an empty row at the end
 */
export function ensureInitialEnvVars(initial?: EnvVar[]): EnvVar[] {
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
}

/**
 * Creates an empty environment config draft
 */
export function createEmptyEnvironmentConfigDraft(): EnvironmentConfigDraft {
  return {
    envName: "",
    envVars: ensureInitialEnvVars(),
    maintenanceScript: "",
    devScript: "",
    exposedPorts: "",
  };
}

/**
 * Converts flat env vars to a default group
 */
export function envVarsToGroups(envVars: EnvVar[]): EnvVarGroup[] {
  return [
    {
      id: "default",
      label: "Environment Variables",
      vars: envVars.filter((v) => v.name.trim().length > 0),
      isExpanded: true,
    },
  ];
}

/**
 * Flattens env var groups back to a flat array
 */
export function envVarGroupsToFlat(groups: EnvVarGroup[]): EnvVar[] {
  return groups.flatMap((g) => g.vars);
}

/**
 * Generates workspace path for a repo
 * For multiple repos: /root/workspace/repo-name
 * For single repo in cmux mode: /root/workspace/repo-name
 * For preview.new mode: /root/workspace (repo root = workspace root)
 */
export function getRepoWorkspacePath(
  repoFullName: string,
  isPreviewNewMode: boolean
): string {
  if (isPreviewNewMode) {
    return "/root/workspace";
  }
  const repoName = repoFullName.split("/").pop() ?? repoFullName;
  return `/root/workspace/${repoName}`;
}

/**
 * Creates repo configs from selected repo names
 */
export function createRepoConfigs(
  selectedRepos: string[],
  isPreviewNewMode: boolean
): RepoConfig[] {
  return selectedRepos.map((fullName, index) => ({
    fullName,
    workspacePath: getRepoWorkspacePath(fullName, isPreviewNewMode),
    isPrimary: index === 0,
  }));
}
