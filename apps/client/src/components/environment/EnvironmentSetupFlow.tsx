/**
 * Environment Setup Flow
 *
 * Orchestrates the two-phase environment configuration flow:
 * 1. Initial Setup Phase - Full-page form for repos, framework, scripts, env vars
 * 2. Workspace Configuration Phase - Split view with VS Code/Browser for verification
 *
 * This flow is inspired by preview.new but supports:
 * - Multiple repositories (workspace root is one level above repo roots)
 * - Both electron and web versions
 */

import type {
  ConfigStep,
  EnvVar,
  LayoutPhase,
} from "@cmux/shared/components/environment";
import {
  deriveVncWebsocketUrl,
  deriveVscodeUrl,
  ensureInitialEnvVars,
} from "@cmux/shared/components/environment";
import { formatEnvVarsContent } from "@cmux/shared/utils/format-env-vars-content";
import type { Id } from "@cmux/convex/dataModel";
import { validateExposedPorts } from "@cmux/shared/utils/validate-exposed-ports";
import {
  postApiEnvironmentsMutation,
  postApiSandboxesByIdEnvMutation,
  postApiSandboxesByIdRunScriptsMutation,
} from "@cmux/www-openapi-client/react-query";
import { useMutation as useRQMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  updateEnvironmentDraftConfig,
  updateEnvironmentDraftConfigStep,
  updateEnvironmentDraftLayoutPhase,
} from "@/state/environment-draft-store";
import { toast } from "sonner";
import { EnvironmentInitialSetup } from "./EnvironmentInitialSetup";
import { EnvironmentWorkspaceConfig } from "./EnvironmentWorkspaceConfig";

interface EnvironmentSetupFlowProps {
  teamSlugOrId: string;
  selectedRepos: string[];
  instanceId?: string;
  initialEnvName?: string;
  initialMaintenanceScript?: string;
  initialDevScript?: string;
  initialExposedPorts?: string;
  initialEnvVars?: EnvVar[];
  initialLayoutPhase?: LayoutPhase;
  initialConfigStep?: ConfigStep;
  onEnvironmentSaved?: () => void;
  onBack?: () => void;
}

export function EnvironmentSetupFlow({
  teamSlugOrId,
  selectedRepos,
  instanceId,
  initialEnvName = "",
  initialMaintenanceScript = "",
  initialDevScript = "",
  initialExposedPorts = "",
  initialEnvVars,
  initialLayoutPhase,
  initialConfigStep,
  onEnvironmentSaved,
  onBack,
}: EnvironmentSetupFlowProps) {
  const navigate = useNavigate();

  // Layout phase state - restore from draft if available
  const [layoutPhase, setLayoutPhase] = useState<LayoutPhase>(
    () => initialLayoutPhase ?? "initial-setup"
  );

  // Track previous initialLayoutPhase to detect external changes (e.g., draft loading after navigation)
  const prevInitialLayoutPhaseRef = useRef(initialLayoutPhase);
  useEffect(() => {
    // Only sync when initialLayoutPhase actually changes from outside (not from our own updates)
    if (initialLayoutPhase && initialLayoutPhase !== prevInitialLayoutPhaseRef.current) {
      prevInitialLayoutPhaseRef.current = initialLayoutPhase;
      setLayoutPhase(initialLayoutPhase);
    }
  }, [initialLayoutPhase]);

  // Configuration state - blank by default, placeholder shows the default pattern
  const [envName, setEnvName] = useState(initialEnvName);
  const [envVars, setEnvVars] = useState<EnvVar[]>(() =>
    ensureInitialEnvVars(initialEnvVars)
  );
  const [maintenanceScript, setMaintenanceScript] = useState(initialMaintenanceScript);
  const [devScript, setDevScript] = useState(initialDevScript);
  const [exposedPorts] = useState(initialExposedPorts);

  // Error state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Derived URLs
  const vscodeUrl = useMemo((): string | undefined => {
    if (!instanceId) return undefined;
    return deriveVscodeUrl(instanceId) ?? undefined;
  }, [instanceId]);

  const vncWebsocketUrl = useMemo((): string | undefined => {
    return deriveVncWebsocketUrl(instanceId, vscodeUrl) ?? undefined;
  }, [instanceId, vscodeUrl]);

  // Script detection from framework (only fetch if we have repos)
  const hasUserEditedScriptsRef = useRef(false);

  // Track when environment has been saved to prevent draft re-creation
  const hasSavedRef = useRef(false);

  // Track when scripts have been triggered to prevent re-triggering
  const scriptsTriggeredRef = useRef(false);
  // Track the instanceId we triggered scripts for, so we reset when it changes
  const scriptsTriggeredForInstanceRef = useRef<string | undefined>(undefined);

  // Reset script trigger state when instanceId changes (new VM provisioned)
  useEffect(() => {
    if (instanceId !== scriptsTriggeredForInstanceRef.current) {
      scriptsTriggeredRef.current = false;
      scriptsTriggeredForInstanceRef.current = instanceId;
    }
  }, [instanceId]);

  useEffect(() => {
    if (selectedRepos.length === 0) return;

    const detectScripts = async () => {
      try {
        // Use the first repo for framework detection
        const repo = selectedRepos[0];
        const response = await fetch(
          `/api/integrations/github/framework-detection?repo=${encodeURIComponent(repo)}`
        );
        if (!response.ok) {
          console.error("Framework detection failed:", response.statusText);
          return;
        }
        const data = (await response.json()) as {
          maintenanceScript: string;
          devScript: string;
        };

        // Only update scripts if user hasn't edited them yet
        if (!hasUserEditedScriptsRef.current) {
          if (!initialMaintenanceScript) {
            setMaintenanceScript(data.maintenanceScript);
          }
          if (!initialDevScript) {
            setDevScript(data.devScript);
          }
        }
      } catch (error) {
        console.error("Failed to detect framework:", error);
      }
    };

    void detectScripts();
  }, [selectedRepos, initialMaintenanceScript, initialDevScript]);

  // Mutations
  const createEnvironmentMutation = useRQMutation(postApiEnvironmentsMutation());
  const applySandboxEnvMutation = useRQMutation(postApiSandboxesByIdEnvMutation());
  const runScriptsMutation = useRQMutation(postApiSandboxesByIdRunScriptsMutation());

  // Auto-apply env vars to sandbox
  const lastSubmittedEnvContent = useRef<string | null>(null);

  useEffect(() => {
    if (!instanceId) return;

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ name: r.name, value: r.value }))
    );

    if (envVarsContent.length === 0 && lastSubmittedEnvContent.current === null) {
      return;
    }

    if (envVarsContent === lastSubmittedEnvContent.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      applySandboxEnvMutation.mutate(
        {
          path: { id: instanceId },
          body: { teamSlugOrId, envVarsContent },
        },
        {
          onSuccess: () => {
            lastSubmittedEnvContent.current = envVarsContent;
          },
          onError: (error) => {
            console.error("Failed to apply sandbox environment vars", error);
          },
        }
      );
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [applySandboxEnvMutation, envVars, instanceId, teamSlugOrId]);

  // Persist config changes to draft store immediately (localStorage is fast)
  // Skip if environment has been saved to prevent re-creating the draft
  useEffect(() => {
    if (hasSavedRef.current) return;
    updateEnvironmentDraftConfig(
      teamSlugOrId,
      {
        envName,
        envVars,
        maintenanceScript,
        devScript,
        exposedPorts,
      },
      { selectedRepos, instanceId }
    );
  }, [teamSlugOrId, envName, envVars, maintenanceScript, devScript, exposedPorts, selectedRepos, instanceId]);

  // Auto-run scripts when entering workspace-config phase
  // This ensures scripts run in tmux sessions for proper cleanup before snapshotting
  useEffect(() => {
    // Only run in workspace-config phase
    if (layoutPhase !== "workspace-config") {
      return;
    }

    // Need instanceId to run scripts
    if (!instanceId) {
      return;
    }

    // Don't re-trigger if already triggered
    if (scriptsTriggeredRef.current) {
      return;
    }

    // Need at least one script to run
    const normalizedMaintenance = maintenanceScript.trim();
    const normalizedDev = devScript.trim();
    if (!normalizedMaintenance && !normalizedDev) {
      return;
    }

    scriptsTriggeredRef.current = true;

    runScriptsMutation.mutate(
      {
        path: { id: instanceId },
        body: {
          teamSlugOrId,
          maintenanceScript: normalizedMaintenance || undefined,
          devScript: normalizedDev || undefined,
        },
      },
      {
        onSuccess: () => {
          console.log("[EnvironmentSetupFlow] Scripts started in tmux sessions");
        },
        onError: (error) => {
          console.error("[EnvironmentSetupFlow] Failed to run scripts:", error);
          // Reset so user can retry by navigating back and forward
          scriptsTriggeredRef.current = false;
        },
      }
    );
  }, [layoutPhase, instanceId, maintenanceScript, devScript, teamSlugOrId, runScriptsMutation]);

  // Handlers
  const handleEnvNameChange = useCallback((value: string) => {
    setEnvName(value);
  }, []);

  const handleMaintenanceScriptChange = useCallback((value: string) => {
    setMaintenanceScript(value);
    hasUserEditedScriptsRef.current = true;
  }, []);

  const handleDevScriptChange = useCallback((value: string) => {
    setDevScript(value);
    hasUserEditedScriptsRef.current = true;
  }, []);

  const handleEnvVarsChange = useCallback((updater: (prev: EnvVar[]) => EnvVar[]) => {
    setEnvVars((prev) => updater(prev));
  }, []);

  const handleContinueToWorkspaceConfig = useCallback(() => {
    setLayoutPhase("workspace-config");
    // Persist layoutPhase to draft so it survives navigation
    updateEnvironmentDraftLayoutPhase(teamSlugOrId, "workspace-config");
  }, [teamSlugOrId]);

  const handleBackToInitialSetup = useCallback(() => {
    setLayoutPhase("initial-setup");
    // Persist layoutPhase to draft so it survives navigation
    updateEnvironmentDraftLayoutPhase(teamSlugOrId, "initial-setup");
  }, [teamSlugOrId]);

  const handleConfigStepChange = useCallback(
    (step: ConfigStep) => {
      // Persist configStep to draft so it survives navigation
      updateEnvironmentDraftConfigStep(teamSlugOrId, step);
    },
    [teamSlugOrId]
  );

  const handleSaveEnvironment = useCallback(async () => {
    if (!instanceId) {
      console.error("Missing instanceId for save");
      return;
    }

    // Use env name or generate default: repo-YYYY-MM-DD
    const finalEnvName =
      envName.trim() ||
      `${selectedRepos[0]?.split("/").pop() || "environment"}-${new Date().toISOString().slice(0, 10)}`;

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ name: r.name, value: r.value }))
    );

    const normalizedMaintenanceScript = maintenanceScript.trim();
    const normalizedDevScript = devScript.trim();
    const requestMaintenanceScript =
      normalizedMaintenanceScript.length > 0 ? normalizedMaintenanceScript : undefined;
    const requestDevScript =
      normalizedDevScript.length > 0 ? normalizedDevScript : undefined;

    // Parse and validate ports
    const parsedPorts = exposedPorts
      .split(",")
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((n) => Number.isFinite(n));

    const validation = validateExposedPorts(parsedPorts);
    if (validation.reserved.length > 0) {
      setErrorMessage(`Reserved ports cannot be exposed: ${validation.reserved.join(", ")}`);
      return;
    }
    if (validation.invalid.length > 0) {
      setErrorMessage("Ports must be positive integers.");
      return;
    }

    setErrorMessage(null);
    const ports = validation.sanitized;

    createEnvironmentMutation.mutate(
      {
        body: {
          teamSlugOrId,
          name: finalEnvName,
          morphInstanceId: instanceId,
          envVarsContent,
          selectedRepos,
          maintenanceScript: requestMaintenanceScript,
          devScript: requestDevScript,
          exposedPorts: ports.length > 0 ? ports : undefined,
          description: undefined,
        },
      },
      {
        onSuccess: async (data) => {
          // Mark as saved to prevent draft re-creation from useEffect
          hasSavedRef.current = true;
          toast.success("Environment saved");
          onEnvironmentSaved?.();
          // Navigate to the newly created environment's details page
          await navigate({
            to: "/$teamSlugOrId/environments/$environmentId",
            params: {
              teamSlugOrId,
              environmentId: data.id as Id<"environments">,
            },
            search: {
              step: undefined,
              selectedRepos: undefined,
              connectionLogin: undefined,
              repoSearch: undefined,
              instanceId: undefined,
              snapshotId: undefined,
            },
          });
        },
        onError: (err) => {
          console.error("Failed to create environment:", err);
          setErrorMessage("Failed to create environment. Please try again.");
        },
      }
    );
  }, [
    createEnvironmentMutation,
    devScript,
    envName,
    envVars,
    exposedPorts,
    instanceId,
    maintenanceScript,
    navigate,
    onEnvironmentSaved,
    selectedRepos,
    teamSlugOrId,
  ]);

  // Initial Setup Phase - centered form with max-width
  if (layoutPhase === "initial-setup") {
    return (
      <div className="p-6 max-w-3xl w-full mx-auto overflow-auto h-full">
        <EnvironmentInitialSetup
          selectedRepos={selectedRepos}
          envName={envName}
          maintenanceScript={maintenanceScript}
          devScript={devScript}
          envVars={envVars}
          onEnvNameChange={handleEnvNameChange}
          onMaintenanceScriptChange={handleMaintenanceScriptChange}
          onDevScriptChange={handleDevScriptChange}
          onEnvVarsChange={handleEnvVarsChange}
          onContinue={handleContinueToWorkspaceConfig}
          onBack={onBack}
          backLabel="Back to repository selection"
        />
      </div>
    );
  }

  // Workspace Configuration Phase - full-width split view
  return (
    <EnvironmentWorkspaceConfig
      selectedRepos={selectedRepos}
      maintenanceScript={maintenanceScript}
      devScript={devScript}
      envVars={envVars}
      vscodeUrl={vscodeUrl}
      vncWebsocketUrl={vncWebsocketUrl}
      isSaving={createEnvironmentMutation.isPending}
      errorMessage={errorMessage}
      initialConfigStep={initialConfigStep}
      onMaintenanceScriptChange={handleMaintenanceScriptChange}
      onDevScriptChange={handleDevScriptChange}
      onEnvVarsChange={handleEnvVarsChange}
      onConfigStepChange={handleConfigStepChange}
      onSave={handleSaveEnvironment}
      onBack={handleBackToInitialSetup}
    />
  );
}
