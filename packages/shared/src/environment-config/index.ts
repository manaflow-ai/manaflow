/**
 * Environment configuration module.
 * Shared types, utilities, and logic for environment setup flows.
 */

// Types
export type {
  EnvVar,
  FrameworkPreset,
  PackageManager,
  EnvironmentConfigStep,
  LayoutPhase,
  EnvironmentConfigDraft,
  EnvironmentDraftMetadata,
  EnvironmentDraft,
  SandboxInstance,
  PreviewPlaceholder,
  EnvironmentWizardConfig,
} from "./types";

export {
  DEFAULT_WIZARD_CONFIGS,
  ensureInitialEnvVars,
  createEmptyEnvironmentConfig,
} from "./types";

// Environment parsing
export type { ParsedEnv } from "./parse-env-block";
export { parseEnvBlock } from "./parse-env-block";

// Framework presets
export type {
  FrameworkPresetConfig,
  FrameworkIconKey,
} from "./framework-presets";

export {
  getFrameworkPresetConfig,
  FRAMEWORK_PRESETS,
  getFrameworkPresetOptions,
  getFrameworkDisplayName,
} from "./framework-presets";

// Platform context
export {
  EnvironmentWizardProvider,
  useEnvironmentWizardConfig,
  useIsElectron,
  useMultiRepoSupport,
  useWorkspaceBasePath,
  type EnvironmentWizardProviderProps,
} from "./platform-context";
