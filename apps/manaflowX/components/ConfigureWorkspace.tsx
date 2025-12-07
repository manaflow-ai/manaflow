"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback, useEffect } from "react";
import type { Id } from "@/convex/_generated/dataModel";

// Icons
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SaveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

interface EnvVar {
  key: string;
  value: string;
}

interface ConfigureWorkspaceProps {
  repoId: Id<"repos">;
  className?: string;
}

export function ConfigureWorkspace({
  repoId,
  className = "",
}: ConfigureWorkspaceProps) {
  // Fetch existing config
  const existingConfig = useQuery(api.workspaceConfig.getWorkspaceConfig, {
    repoId,
  });

  // Mutations
  const updateSetupScripts = useMutation(
    api.workspaceConfig.updateSetupScripts
  );
  const updateDevScripts = useMutation(api.workspaceConfig.updateDevScripts);

  // Local state
  const [setupScript, setSetupScript] = useState("");
  const [devScript, setDevScript] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>([{ key: "", value: "" }]);
  const [showValues, setShowValues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Collapse state for sections (default expanded)
  const [maintenanceOpen, setMaintenanceOpen] = useState(true);
  const [devOpen, setDevOpen] = useState(true);
  const [envOpen, setEnvOpen] = useState(true);

  // Load from existing config
  useEffect(() => {
    if (existingConfig) {
      const setupStr =
        existingConfig.setupScripts?.map((s) => s.command).join("\n") || "";
      const devStr =
        existingConfig.devScripts?.map((s) => s.command).join("\n") || "";
      setSetupScript(setupStr);
      setDevScript(devStr);
    }
  }, [existingConfig]);

  // Track changes
  const handleScriptChange = useCallback(
    (setter: (v: string) => void) => (value: string) => {
      setter(value);
      setHasChanges(true);
      setSaved(false);
    },
    []
  );

  const handleEnvVarChange = useCallback(
    (index: number, field: keyof EnvVar, value: string) => {
      const updated = [...envVars];
      updated[index] = { ...updated[index], [field]: value };
      setEnvVars(updated);
      setHasChanges(true);
      setSaved(false);
    },
    [envVars]
  );

  const addEnvVar = useCallback(() => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  }, [envVars]);

  const removeEnvVar = useCallback(
    (index: number) => {
      if (envVars.length > 1) {
        setEnvVars(envVars.filter((_, i) => i !== index));
        setHasChanges(true);
        setSaved(false);
      }
    },
    [envVars]
  );

  // Convert script string to array format
  const scriptToArray = (script: string) =>
    script
      .split("\n")
      .filter((line) => line.trim())
      .map((command) => ({ name: "", command, description: "" }));

  // Save handler
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateSetupScripts({ repoId, setupScripts: scriptToArray(setupScript) }),
        updateDevScripts({ repoId, devScripts: scriptToArray(devScript) }),
      ]);
      setHasChanges(false);
      setSaved(true);
      // Reset saved indicator after 2 seconds
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [repoId, setupScript, devScript, updateSetupScripts, updateDevScripts]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Maintenance Script Section */}
      <div className="border border-neutral-800 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setMaintenanceOpen(!maintenanceOpen)}
          className="w-full px-3 py-2.5 flex items-center justify-between bg-neutral-900/50 hover:bg-neutral-800/50 transition-colors"
        >
          <div className="text-left">
            <h4 className="text-sm font-medium text-neutral-200">
              Maintenance script
            </h4>
            <p className="text-xs text-neutral-500 mt-0.5">
              Runs once after cloning. Install dependencies here.
            </p>
          </div>
          <ChevronDownIcon
            className={`h-4 w-4 text-neutral-500 transition-transform shrink-0 ml-2 ${
              maintenanceOpen ? "" : "-rotate-90"
            }`}
          />
        </button>
        {maintenanceOpen && (
          <div className="bg-neutral-950 border-t border-neutral-800 p-3 font-mono text-sm">
            <textarea
              value={setupScript}
              onChange={(e) =>
                handleScriptChange(setSetupScript)(e.target.value)
              }
              placeholder={"# e.g.\npnpm install\nuv sync"}
              rows={3}
              className="w-full bg-transparent text-neutral-300 placeholder-neutral-600 resize-none focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Dev Script Section */}
      <div className="border border-neutral-800 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setDevOpen(!devOpen)}
          className="w-full px-3 py-2.5 flex items-center justify-between bg-neutral-900/50 hover:bg-neutral-800/50 transition-colors"
        >
          <div className="text-left">
            <h4 className="text-sm font-medium text-neutral-200">
              Dev script
            </h4>
            <p className="text-xs text-neutral-500 mt-0.5">
              Start dev servers or watch files.
            </p>
          </div>
          <ChevronDownIcon
            className={`h-4 w-4 text-neutral-500 transition-transform shrink-0 ml-2 ${
              devOpen ? "" : "-rotate-90"
            }`}
          />
        </button>
        {devOpen && (
          <div className="bg-neutral-950 border-t border-neutral-800 p-3 font-mono text-sm">
            <textarea
              value={devScript}
              onChange={(e) => handleScriptChange(setDevScript)(e.target.value)}
              placeholder={"# e.g.\nnpm run dev"}
              rows={2}
              className="w-full bg-transparent text-neutral-300 placeholder-neutral-600 resize-none focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Environment Variables Section */}
      <div className="border border-neutral-800 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setEnvOpen(!envOpen)}
          className="w-full px-3 py-2.5 flex items-center justify-between bg-neutral-900/50 hover:bg-neutral-800/50 transition-colors"
        >
          <div className="text-left">
            <h4 className="text-sm font-medium text-neutral-200">
              Environment variables
            </h4>
            <p className="text-xs text-neutral-500 mt-0.5">
              Injected when scripts run. Paste from .env files.
            </p>
          </div>
          <ChevronDownIcon
            className={`h-4 w-4 text-neutral-500 transition-transform shrink-0 ml-2 ${
              envOpen ? "" : "-rotate-90"
            }`}
          />
        </button>
        {envOpen && (
          <div className="border-t border-neutral-800 p-3">
            {/* Reveal button */}
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setShowValues(!showValues)}
                className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                <EyeIcon className="h-3.5 w-3.5" />
                <span>{showValues ? "Hide" : "Reveal"}</span>
              </button>
            </div>

            {/* Table header */}
            <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2 mb-2 text-xs text-neutral-500">
              <span>Key</span>
              <span>Value</span>
              <span className="w-7"></span>
            </div>

            {/* Env var rows */}
            <div className="space-y-2">
              {envVars.map((envVar, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_1.5fr_auto] gap-2 items-center"
                >
                  <input
                    type="text"
                    value={envVar.key}
                    onChange={(e) =>
                      handleEnvVarChange(index, "key", e.target.value)
                    }
                    placeholder="EXAMPLE_KEY"
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-300 placeholder-neutral-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                  />
                  <input
                    type={showValues ? "text" : "password"}
                    value={envVar.value}
                    onChange={(e) =>
                      handleEnvVarChange(index, "value", e.target.value)
                    }
                    placeholder="secret-value"
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-300 placeholder-neutral-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvVar(index)}
                    className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors"
                  >
                    <MinusIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add variable button */}
            <button
              type="button"
              onClick={addEnvVar}
              className="flex items-center gap-1.5 mt-3 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Add variable</span>
            </button>
          </div>
        )}
      </div>

      {/* Save button - only show when there are changes */}
      {hasChanges && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm font-medium rounded transition-colors"
          >
            {saving ? (
              <>
                <LoaderIcon className="h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : saved ? (
              <>
                <CheckIcon className="h-4 w-4" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <SaveIcon className="h-4 w-4" />
                <span>Save</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default ConfigureWorkspace;
