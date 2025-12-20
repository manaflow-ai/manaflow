import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  EnvVar,
  EnvVarGroup,
  EnvironmentConfigDraft,
  EnvironmentFlowStep,
  FrameworkPreset,
  PackageManager,
  WorkspaceConfigStep,
} from "../../environment-flow/types";
import {
  createEmptyEnvironmentConfigDraft,
  ensureInitialEnvVars,
  envVarsToGroups,
} from "../../environment-flow/types";
import { getFrameworkPresetConfig } from "../../environment-flow/framework-presets";

// State shape
interface EnvironmentFlowHookState {
  // Flow step
  step: EnvironmentFlowStep;
  workspaceConfigStep: WorkspaceConfigStep;
  completedWorkspaceSteps: Set<WorkspaceConfigStep>;

  // Repository selection
  selectedRepos: string[];

  // Sandbox instance
  instanceId?: string;
  vscodeUrl?: string;
  vncUrl?: string;

  // Configuration
  config: EnvironmentConfigDraft;
  envVarGroups: EnvVarGroup[];

  // Framework detection
  isDetectingFramework: boolean;
  detectedFramework?: FrameworkPreset;
  detectedPackageManager?: PackageManager;

  // UI state
  areEnvValuesHidden: boolean;
  splitRatio: number;
  previewMode: "split" | "vscode" | "browser";

  // Dirty state tracking
  isDirty: boolean;
  isSaving: boolean;
}

// Action types
type EnvironmentFlowAction =
  | { type: "SET_STEP"; step: EnvironmentFlowStep }
  | { type: "SET_WORKSPACE_CONFIG_STEP"; step: WorkspaceConfigStep }
  | { type: "COMPLETE_WORKSPACE_STEP"; step: WorkspaceConfigStep }
  | { type: "SET_SELECTED_REPOS"; repos: string[] }
  | { type: "SET_INSTANCE"; instanceId: string; vscodeUrl?: string; vncUrl?: string }
  | { type: "UPDATE_CONFIG"; partial: Partial<EnvironmentConfigDraft> }
  | { type: "SET_ENV_VARS"; envVars: EnvVar[] }
  | { type: "SET_ENV_VAR_GROUPS"; groups: EnvVarGroup[] }
  | { type: "SET_FRAMEWORK_DETECTION_LOADING"; loading: boolean }
  | { type: "SET_DETECTED_FRAMEWORK"; framework: FrameworkPreset; packageManager: PackageManager; maintenanceScript?: string; devScript?: string }
  | { type: "APPLY_FRAMEWORK_PRESET"; preset: FrameworkPreset; packageManager?: PackageManager }
  | { type: "TOGGLE_ENV_VALUES_HIDDEN" }
  | { type: "SET_SPLIT_RATIO"; ratio: number }
  | { type: "SET_PREVIEW_MODE"; mode: "split" | "vscode" | "browser" }
  | { type: "SET_IS_SAVING"; isSaving: boolean }
  | { type: "RESET" };

// Initial state factory
function createInitialState(options?: {
  initialStep?: EnvironmentFlowStep;
  initialSelectedRepos?: string[];
  initialConfig?: Partial<EnvironmentConfigDraft>;
}): EnvironmentFlowHookState {
  const config: EnvironmentConfigDraft = {
    ...createEmptyEnvironmentConfigDraft(),
    ...options?.initialConfig,
  };

  return {
    step: options?.initialStep ?? "select",
    workspaceConfigStep: "run-scripts",
    completedWorkspaceSteps: new Set(),
    selectedRepos: options?.initialSelectedRepos ?? [],
    config,
    envVarGroups: [
      {
        id: "default",
        label: "Environment Variables",
        vars: config.envVars,
        isExpanded: true,
      },
    ],
    isDetectingFramework: false,
    areEnvValuesHidden: true,
    splitRatio: 0.5,
    previewMode: "split",
    isDirty: false,
    isSaving: false,
  };
}

// Reducer
function environmentFlowReducer(
  state: EnvironmentFlowHookState,
  action: EnvironmentFlowAction
): EnvironmentFlowHookState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };

    case "SET_WORKSPACE_CONFIG_STEP":
      return { ...state, workspaceConfigStep: action.step };

    case "COMPLETE_WORKSPACE_STEP":
      return {
        ...state,
        completedWorkspaceSteps: new Set([
          ...state.completedWorkspaceSteps,
          action.step,
        ]),
      };

    case "SET_SELECTED_REPOS":
      return { ...state, selectedRepos: action.repos, isDirty: true };

    case "SET_INSTANCE":
      return {
        ...state,
        instanceId: action.instanceId,
        vscodeUrl: action.vscodeUrl,
        vncUrl: action.vncUrl,
      };

    case "UPDATE_CONFIG":
      return {
        ...state,
        config: { ...state.config, ...action.partial },
        isDirty: true,
      };

    case "SET_ENV_VARS": {
      const envVars = ensureInitialEnvVars(action.envVars);
      return {
        ...state,
        config: { ...state.config, envVars },
        isDirty: true,
      };
    }

    case "SET_ENV_VAR_GROUPS":
      return {
        ...state,
        envVarGroups: action.groups,
        config: {
          ...state.config,
          envVars: action.groups.flatMap((g) => g.vars),
        },
        isDirty: true,
      };

    case "SET_FRAMEWORK_DETECTION_LOADING":
      return { ...state, isDetectingFramework: action.loading };

    case "SET_DETECTED_FRAMEWORK": {
      const hasExistingScripts =
        state.config.maintenanceScript.trim().length > 0 ||
        state.config.devScript.trim().length > 0;

      // Only auto-apply if no scripts are set
      if (hasExistingScripts) {
        return {
          ...state,
          isDetectingFramework: false,
          detectedFramework: action.framework,
          detectedPackageManager: action.packageManager,
        };
      }

      return {
        ...state,
        isDetectingFramework: false,
        detectedFramework: action.framework,
        detectedPackageManager: action.packageManager,
        config: {
          ...state.config,
          frameworkPreset: action.framework,
          packageManager: action.packageManager,
          maintenanceScript: action.maintenanceScript ?? state.config.maintenanceScript,
          devScript: action.devScript ?? state.config.devScript,
        },
        isDirty: true,
      };
    }

    case "APPLY_FRAMEWORK_PRESET": {
      const pm = action.packageManager ?? state.config.packageManager ?? "npm";
      const presetConfig = getFrameworkPresetConfig(action.preset, pm);
      return {
        ...state,
        config: {
          ...state.config,
          frameworkPreset: action.preset,
          packageManager: pm,
          maintenanceScript: presetConfig.maintenanceScript,
          devScript: presetConfig.devScript,
        },
        isDirty: true,
      };
    }

    case "TOGGLE_ENV_VALUES_HIDDEN":
      return { ...state, areEnvValuesHidden: !state.areEnvValuesHidden };

    case "SET_SPLIT_RATIO":
      return { ...state, splitRatio: action.ratio };

    case "SET_PREVIEW_MODE":
      return { ...state, previewMode: action.mode };

    case "SET_IS_SAVING":
      return { ...state, isSaving: action.isSaving };

    case "RESET":
      return createInitialState();

    default:
      return state;
  }
}

// Hook options
export interface UseEnvironmentFlowOptions {
  initialStep?: EnvironmentFlowStep;
  initialSelectedRepos?: string[];
  initialConfig?: Partial<EnvironmentConfigDraft>;
  onStepChange?: (step: EnvironmentFlowStep) => void;
  onConfigChange?: (config: EnvironmentConfigDraft) => void;
}

/**
 * Headless hook for managing environment flow state
 * Can be used in both electron and www apps
 */
export function useEnvironmentFlow(options?: UseEnvironmentFlowOptions) {
  const [state, dispatch] = useReducer(
    environmentFlowReducer,
    options,
    (opts) => createInitialState(opts)
  );

  // Track previous step for callbacks
  const prevStepRef = useRef(state.step);
  useEffect(() => {
    if (state.step !== prevStepRef.current) {
      options?.onStepChange?.(state.step);
      prevStepRef.current = state.step;
    }
  }, [state.step, options]);

  // Track config changes for callbacks
  const configChangedRef = useRef(false);
  useEffect(() => {
    if (configChangedRef.current) {
      options?.onConfigChange?.(state.config);
      configChangedRef.current = false;
    }
  }, [state.config, options]);

  // Actions
  const setStep = useCallback((step: EnvironmentFlowStep) => {
    dispatch({ type: "SET_STEP", step });
  }, []);

  const setWorkspaceConfigStep = useCallback((step: WorkspaceConfigStep) => {
    dispatch({ type: "SET_WORKSPACE_CONFIG_STEP", step });
  }, []);

  const completeWorkspaceStep = useCallback((step: WorkspaceConfigStep) => {
    dispatch({ type: "COMPLETE_WORKSPACE_STEP", step });
  }, []);

  const setSelectedRepos = useCallback((repos: string[]) => {
    dispatch({ type: "SET_SELECTED_REPOS", repos });
  }, []);

  const setInstance = useCallback(
    (instanceId: string, vscodeUrl?: string, vncUrl?: string) => {
      dispatch({ type: "SET_INSTANCE", instanceId, vscodeUrl, vncUrl });
    },
    []
  );

  const updateConfig = useCallback((partial: Partial<EnvironmentConfigDraft>) => {
    configChangedRef.current = true;
    dispatch({ type: "UPDATE_CONFIG", partial });
  }, []);

  const setEnvVars = useCallback((envVars: EnvVar[]) => {
    configChangedRef.current = true;
    dispatch({ type: "SET_ENV_VARS", envVars });
  }, []);

  const setEnvVarGroups = useCallback((groups: EnvVarGroup[]) => {
    configChangedRef.current = true;
    dispatch({ type: "SET_ENV_VAR_GROUPS", groups });
  }, []);

  const setFrameworkDetectionLoading = useCallback((loading: boolean) => {
    dispatch({ type: "SET_FRAMEWORK_DETECTION_LOADING", loading });
  }, []);

  const setDetectedFramework = useCallback(
    (
      framework: FrameworkPreset,
      packageManager: PackageManager,
      maintenanceScript?: string,
      devScript?: string
    ) => {
      dispatch({
        type: "SET_DETECTED_FRAMEWORK",
        framework,
        packageManager,
        maintenanceScript,
        devScript,
      });
    },
    []
  );

  const applyFrameworkPreset = useCallback(
    (preset: FrameworkPreset, packageManager?: PackageManager) => {
      dispatch({ type: "APPLY_FRAMEWORK_PRESET", preset, packageManager });
    },
    []
  );

  const toggleEnvValuesHidden = useCallback(() => {
    dispatch({ type: "TOGGLE_ENV_VALUES_HIDDEN" });
  }, []);

  const setSplitRatio = useCallback((ratio: number) => {
    dispatch({ type: "SET_SPLIT_RATIO", ratio });
  }, []);

  const setPreviewMode = useCallback((mode: "split" | "vscode" | "browser") => {
    dispatch({ type: "SET_PREVIEW_MODE", mode });
  }, []);

  const setIsSaving = useCallback((isSaving: boolean) => {
    dispatch({ type: "SET_IS_SAVING", isSaving });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  // Navigation helpers
  const goToInitialSetup = useCallback(() => {
    setStep("initial-setup");
  }, [setStep]);

  const goToWorkspaceConfig = useCallback(() => {
    setStep("workspace-config");
    // Mark scripts and env vars as completed since they were done in initial setup
    completeWorkspaceStep("scripts");
    completeWorkspaceStep("env-vars");
    setWorkspaceConfigStep("run-scripts");
  }, [setStep, completeWorkspaceStep, setWorkspaceConfigStep]);

  const goBackToSelect = useCallback(() => {
    setStep("select");
  }, [setStep]);

  // Computed values
  const isReadyToContinue = useMemo(() => {
    switch (state.step) {
      case "select":
        return state.selectedRepos.length > 0;
      case "initial-setup":
        // Can continue if we have some config (scripts or env name)
        return (
          state.config.maintenanceScript.trim().length > 0 ||
          state.config.devScript.trim().length > 0 ||
          state.config.envName.trim().length > 0
        );
      case "workspace-config":
        // Can save once we've run scripts and configured browser
        return (
          state.completedWorkspaceSteps.has("run-scripts") &&
          state.completedWorkspaceSteps.has("browser-setup")
        );
      default:
        return false;
    }
  }, [state.step, state.selectedRepos, state.config, state.completedWorkspaceSteps]);

  const hasEnvVars = useMemo(() => {
    return state.config.envVars.some(
      (v) => v.name.trim().length > 0 && v.value.trim().length > 0
    );
  }, [state.config.envVars]);

  return {
    // State
    ...state,

    // Actions
    setStep,
    setWorkspaceConfigStep,
    completeWorkspaceStep,
    setSelectedRepos,
    setInstance,
    updateConfig,
    setEnvVars,
    setEnvVarGroups,
    setFrameworkDetectionLoading,
    setDetectedFramework,
    applyFrameworkPreset,
    toggleEnvValuesHidden,
    setSplitRatio,
    setPreviewMode,
    setIsSaving,
    reset,

    // Navigation
    goToInitialSetup,
    goToWorkspaceConfig,
    goBackToSelect,

    // Computed
    isReadyToContinue,
    hasEnvVars,
  };
}

export type UseEnvironmentFlowReturn = ReturnType<typeof useEnvironmentFlow>;
