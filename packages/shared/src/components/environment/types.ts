/**
 * Shared types for environment configuration across cmux client and www apps.
 *
 * Key difference from preview.new:
 * - cmux workspace root is one level above repo roots (supports multiple repos)
 * - preview.new workspace root = repo root (single repo only)
 */

export type EnvVar = {
  name: string;
  value: string;
  isSecret: boolean;
};

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

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export type ConfigStep =
  | "scripts"
  | "env-vars"
  | "run-scripts"
  | "browser-setup";

export const ALL_CONFIG_STEPS: readonly ConfigStep[] = [
  "scripts",
  "env-vars",
  "run-scripts",
  "browser-setup",
] as const;

export type LayoutPhase =
  | "initial-setup"
  | "transitioning"
  | "workspace-config";

export interface EnvironmentConfigState {
  envName: string;
  envVars: EnvVar[];
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
  frameworkPreset: FrameworkPreset;
}

export interface EnvironmentSetupContext {
  teamSlugOrId: string;
  selectedRepos: string[];
  instanceId?: string;
  vscodeUrl?: string;
  browserUrl?: string;
  vncWebsocketUrl?: string;
  isProvisioning: boolean;
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
 * Callbacks for environment configuration actions
 */
export interface EnvironmentConfigCallbacks {
  onSave: (config: EnvironmentConfigState, instanceId: string) => Promise<void>;
  onApplyEnvVars?: (instanceId: string, envVarsContent: string) => Promise<void>;
  onBack?: () => void;
  onCancel?: () => void;
}

/**
 * Configuration for how the workspace is structured.
 * cmux: workspace root is /root/workspace, repos are cloned inside
 * preview.new: workspace root = repo root at /root/workspace
 */
export interface WorkspaceConfig {
  /**
   * Whether workspace root is one level above repo roots (cmux style)
   * or workspace root = repo root (preview.new style)
   */
  multiRepoSupport: boolean;

  /**
   * The workspace root path
   */
  workspaceRoot: string;
}

export const CMUX_WORKSPACE_CONFIG: WorkspaceConfig = {
  multiRepoSupport: true,
  workspaceRoot: "/root/workspace",
};

export const PREVIEW_WORKSPACE_CONFIG: WorkspaceConfig = {
  multiRepoSupport: false,
  workspaceRoot: "/root/workspace",
};
