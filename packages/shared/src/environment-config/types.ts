/**
 * Shared types for environment configuration flow.
 * Used by both apps/client and apps/www.
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

/**
 * Configuration steps in the environment setup wizard.
 * - select: Repository selection
 * - framework: Framework preset and scripts configuration
 * - env-vars: Environment variables
 * - run-scripts: Execute scripts in terminal
 * - browser-setup: Browser/VNC configuration
 */
export type EnvironmentConfigStep =
  | "select"
  | "framework"
  | "env-vars"
  | "run-scripts"
  | "browser-setup";

/**
 * Layout phases for the configuration wizard.
 * - initial-setup: Full-page form for initial configuration
 * - transitioning: Animation between phases
 * - workspace-config: Split-pane with sidebar and preview
 */
export type LayoutPhase = "initial-setup" | "transitioning" | "workspace-config";

/**
 * Environment configuration draft state.
 * Represents the in-progress configuration before saving.
 */
export interface EnvironmentConfigDraft {
  envName: string;
  envVars: EnvVar[];
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
  frameworkPreset: FrameworkPreset;
}

/**
 * Metadata for environment draft (repos, instance info).
 */
export interface EnvironmentDraftMetadata {
  selectedRepos: string[];
  instanceId?: string;
  snapshotId?: string;
}

/**
 * Complete environment draft including metadata.
 */
export interface EnvironmentDraft extends EnvironmentDraftMetadata {
  step: EnvironmentConfigStep;
  config: EnvironmentConfigDraft;
  lastUpdatedAt: number;
}

/**
 * Sandbox instance info for preview panels.
 */
export interface SandboxInstance {
  instanceId: string;
  vscodeUrl: string;
  workerUrl: string;
  vncUrl?: string;
  provider: string;
}

/**
 * Placeholder content for preview panels.
 */
export interface PreviewPlaceholder {
  title: string;
  description?: string;
}

/**
 * Configuration for the environment wizard.
 */
export interface EnvironmentWizardConfig {
  /**
   * Whether multiple repositories can be selected.
   * When true, workspace root is one level above repo roots.
   * When false (preview.new style), repo root = workspace root.
   */
  multiRepoSupport: boolean;

  /**
   * Whether to show the browser setup step.
   * May be hidden in electron or certain web modes.
   */
  showBrowserSetup: boolean;

  /**
   * Whether to show the VNC browser preview panel.
   */
  showBrowserPreview: boolean;

  /**
   * Platform context for feature gating.
   */
  platform: "electron" | "web" | "www";

  /**
   * Base path for workspace inside sandbox.
   * Default: /root/workspace
   */
  workspaceBasePath: string;

  /**
   * Whether repos are cloned into subdirectories of workspace.
   * true = /root/workspace/repo-name (multi-repo)
   * false = /root/workspace is repo root (single-repo)
   */
  reposInSubdirectories: boolean;
}

/**
 * Default configuration for different platforms.
 */
export const DEFAULT_WIZARD_CONFIGS: Record<
  "electron" | "web" | "www",
  EnvironmentWizardConfig
> = {
  electron: {
    multiRepoSupport: true,
    showBrowserSetup: true,
    showBrowserPreview: true,
    platform: "electron",
    workspaceBasePath: "/root/workspace",
    reposInSubdirectories: true,
  },
  web: {
    multiRepoSupport: true,
    showBrowserSetup: true,
    showBrowserPreview: true,
    platform: "web",
    workspaceBasePath: "/root/workspace",
    reposInSubdirectories: true,
  },
  www: {
    multiRepoSupport: false, // preview.new is single-repo
    showBrowserSetup: true,
    showBrowserPreview: true,
    platform: "www",
    workspaceBasePath: "/root/workspace",
    reposInSubdirectories: false, // repo root = workspace root
  },
};

/**
 * Helper to ensure env vars array has an empty row at the end.
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
 * Create an empty environment config draft.
 */
export function createEmptyEnvironmentConfig(): EnvironmentConfigDraft {
  return {
    envName: "",
    envVars: ensureInitialEnvVars(),
    maintenanceScript: "",
    devScript: "",
    exposedPorts: "",
    frameworkPreset: "other",
  };
}
