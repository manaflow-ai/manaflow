"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback, useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import type { Id } from "@/convex/_generated/dataModel";

export interface ConfigureWorkspaceRef {
  save: () => Promise<void>;
  hasChanges: boolean;
  saving: boolean;
  saved: boolean;
}

// Fetch env vars from the Data Vault
async function fetchEnvVars(repoId: string): Promise<{ key: string; value: string }[]> {
  const response = await fetch(`/api/vault/env-vars?repoId=${repoId}`);
  if (!response.ok) {
    console.error("Failed to fetch env vars:", await response.text());
    return [];
  }
  const data = await response.json();
  return data.envVars || [];
}

// Save env vars to the Data Vault
async function saveEnvVars(repoId: string, envVars: { key: string; value: string }[]): Promise<void> {
  const response = await fetch("/api/vault/env-vars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId, envVars }),
  });
  if (!response.ok) {
    throw new Error("Failed to save env vars");
  }
}

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

function EyeOffIcon({ className }: { className?: string }) {
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
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
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

interface EnvVar {
  key: string;
  value: string;
}

interface ConfigureWorkspaceProps {
  repoId: Id<"repos">;
  className?: string;
}

export const ConfigureWorkspace = forwardRef<ConfigureWorkspaceRef, ConfigureWorkspaceProps>(
  function ConfigureWorkspace({ repoId, className = "" }, ref) {
  // Fetch repo with scripts
  const repo = useQuery(api.github.getRepoById, { repoId });

  // Mutation to update scripts
  const updateRepoScripts = useMutation(api.github.updateRepoScripts);

  // Local state
  const [maintenanceScript, setMaintenanceScript] = useState("");
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

  // Track which value input is currently focused (to show it even in hidden mode)
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null);

  // Track loading state for env vars from vault
  const [loadingEnvVars, setLoadingEnvVars] = useState(true);
  const loadingEnvVarsRef = useRef(false);

  // Parse .env content and add to env vars
  const parseEnvContent = useCallback((content: string) => {
    const lines = content.split("\n");
    const newVars: EnvVar[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Match KEY=VALUE pattern (handle quotes)
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        const key = match[1];
        let value = match[2];
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        newVars.push({ key, value });
      }
    }

    return newVars;
  }, []);

  // Handle paste in key input - detect .env content
  const handleKeyPaste = useCallback((index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData("text");

    // Check if this looks like .env content (multiple lines or KEY=VALUE format)
    if (pastedText.includes("\n") || pastedText.match(/^[A-Za-z_][A-Za-z0-9_]*=.+/)) {
      e.preventDefault();
      const parsedVars = parseEnvContent(pastedText);

      if (parsedVars.length > 0) {
        // Replace current row and add new ones
        const newEnvVars = [...envVars];
        newEnvVars.splice(index, 1, ...parsedVars);
        // Remove any trailing empty rows, but keep at least one
        while (newEnvVars.length > 1 &&
               newEnvVars[newEnvVars.length - 1].key === "" &&
               newEnvVars[newEnvVars.length - 1].value === "") {
          newEnvVars.pop();
        }
        setEnvVars(newEnvVars);
        setHasChanges(true);
        setSaved(false);
      }
    }
  }, [envVars, parseEnvContent]);

  // Load scripts from Convex
  useEffect(() => {
    if (repo?.scripts) {
      setMaintenanceScript(repo.scripts.maintenanceScript || "");
      setDevScript(repo.scripts.devScript || "");
    } else {
      // Reset to defaults when no scripts exist
      setMaintenanceScript("");
      setDevScript("");
    }
    // Reset change tracking when loading new data
    setHasChanges(false);
    setSaved(false);
  }, [repo?.scripts]);

  // Load env vars from the Data Vault
  useEffect(() => {
    if (!repoId || loadingEnvVarsRef.current) return;

    loadingEnvVarsRef.current = true;
    setLoadingEnvVars(true);

    fetchEnvVars(repoId)
      .then((vars) => {
        if (vars.length > 0) {
          setEnvVars(vars);
        } else {
          setEnvVars([{ key: "", value: "" }]);
        }
      })
      .catch((err) => {
        console.error("Failed to load env vars:", err);
        setEnvVars([{ key: "", value: "" }]);
      })
      .finally(() => {
        loadingEnvVarsRef.current = false;
        setLoadingEnvVars(false);
      });
  }, [repoId]);

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

  // Save handler
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Filter out empty env vars before saving
      const filteredEnvVars = envVars.filter(
        (env) => env.key.trim() !== ""
      );

      // Save scripts to Convex and env vars to Data Vault in parallel
      await Promise.all([
        // Save scripts to Convex (no longer includes envVars)
        updateRepoScripts({
          repoId,
          scripts: {
            maintenanceScript,
            devScript,
          },
        }),
        // Save env vars to Data Vault (encrypted)
        saveEnvVars(repoId, filteredEnvVars),
      ]);

      setHasChanges(false);
      setSaved(true);
      // Reset saved indicator after 2 seconds
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [repoId, maintenanceScript, devScript, envVars, updateRepoScripts]);

  // Expose save state and function via ref
  useImperativeHandle(ref, () => ({
    save: handleSave,
    hasChanges,
    saving,
    saved,
  }), [handleSave, hasChanges, saving, saved]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Maintenance Script Section */}
      <div>
        <button
          type="button"
          onClick={() => setMaintenanceOpen(!maintenanceOpen)}
          className="w-full px-1 py-2 flex items-center justify-between hover:bg-accent/30 transition-colors rounded"
        >
          <div className="text-left">
            <h4 className="text-sm font-medium text-foreground">
              Maintenance script
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Runs once after cloning. Install dependencies here.
            </p>
          </div>
          <ChevronDownIcon
            className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ml-2 ${
              maintenanceOpen ? "" : "-rotate-90"
            }`}
          />
        </button>
        {maintenanceOpen && (
          <div className="mt-2 font-mono text-xs">
            <textarea
              value={maintenanceScript}
              onChange={(e) =>
                handleScriptChange(setMaintenanceScript)(e.target.value)
              }
              placeholder={"# e.g.\npnpm install\nuv sync"}
              rows={3}
              className="w-full bg-muted border border-border rounded-md p-3 text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      {/* Dev Script Section */}
      <div>
        <button
          type="button"
          onClick={() => setDevOpen(!devOpen)}
          className="w-full px-1 py-2 flex items-center justify-between hover:bg-accent/30 transition-colors rounded"
        >
          <div className="text-left">
            <h4 className="text-sm font-medium text-foreground">
              Dev script
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Start dev servers or watch files.
            </p>
          </div>
          <ChevronDownIcon
            className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ml-2 ${
              devOpen ? "" : "-rotate-90"
            }`}
          />
        </button>
        {devOpen && (
          <div className="mt-2 font-mono text-xs">
            <textarea
              value={devScript}
              onChange={(e) => handleScriptChange(setDevScript)(e.target.value)}
              placeholder={"# e.g.\nnpm run dev"}
              rows={2}
              className="w-full bg-muted border border-border rounded-md p-3 text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      {/* Environment Variables Section */}
      <div>
        <div className="w-full px-1 py-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setEnvOpen(!envOpen)}
            className="flex-1 text-left hover:bg-accent/30 transition-colors rounded -m-1 p-1"
          >
            <h4 className="text-sm font-medium text-foreground">
              Environment variables
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Injected when scripts run. Paste from .env files.
            </p>
          </button>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {/* Reveal button */}
            <button
              type="button"
              onClick={() => setShowValues(!showValues)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showValues ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
              <span>{showValues ? "Hide" : "Reveal"}</span>
            </button>
            <button
              type="button"
              onClick={() => setEnvOpen(!envOpen)}
              className="p-1 -m-1 hover:bg-accent/30 rounded transition-colors"
            >
              <ChevronDownIcon
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  envOpen ? "" : "-rotate-90"
                }`}
              />
            </button>
          </div>
        </div>
        {envOpen && (
          <div className="mt-2">
            {loadingEnvVars ? (
              <div className="flex items-center justify-center py-6">
                <LoaderIcon className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2 mb-2 text-xs text-muted-foreground">
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
                        onPaste={(e) => handleKeyPaste(index, e)}
                        placeholder="EXAMPLE_KEY"
                        className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder-muted-foreground font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                      />
                      <input
                        type={showValues || focusedValueIndex === index ? "text" : "password"}
                        value={envVar.value}
                        onChange={(e) =>
                          handleEnvVarChange(index, "value", e.target.value)
                        }
                        onFocus={() => setFocusedValueIndex(index)}
                        onBlur={() => setFocusedValueIndex(null)}
                        placeholder="secret-value"
                        className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder-muted-foreground font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => removeEnvVar(index)}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
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
                  className="flex items-center gap-1.5 mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <PlusIcon className="h-4 w-4" />
                  <span>Add variable</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
});

export default ConfigureWorkspace;
