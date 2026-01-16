/**
 * Environment Initial Setup Phase
 *
 * Full-page form for initial environment configuration including:
 * - Repository selection (supports multiple repos - cmux style)
 * - Maintenance & dev scripts
 * - Environment variables
 *
 * Similar to preview.new initial setup but with multi-repo support.
 */

import { GitHubIcon } from "@/components/icons/github";
import { parseEnvBlock } from "@/lib/parseEnvBlock";
import type { EnvVar } from "@cmux/shared/components/environment";
import { MASKED_ENV_VALUE } from "@cmux/shared/components/environment";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  Minus,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface EnvironmentInitialSetupProps {
  selectedRepos: string[];
  envName: string;
  maintenanceScript: string;
  devScript: string;
  envVars: EnvVar[];
  onEnvNameChange: (value: string) => void;
  onMaintenanceScriptChange: (value: string) => void;
  onDevScriptChange: (value: string) => void;
  onEnvVarsChange: (updater: (prev: EnvVar[]) => EnvVar[]) => void;
  onContinue: () => void;
  onBack?: () => void;
  backLabel?: string;
}

export function EnvironmentInitialSetup({
  selectedRepos,
  envName,
  maintenanceScript,
  devScript,
  envVars,
  onEnvNameChange,
  onMaintenanceScriptChange,
  onDevScriptChange,
  onEnvVarsChange,
  onContinue,
  onBack,
  backLabel = "Back to repository selection",
}: EnvironmentInitialSetupProps) {
  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(null);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Handle pending focus after env vars update
  useEffect(() => {
    if (pendingFocusIndex !== null) {
      const el = keyInputRefs.current[pendingFocusIndex];
      if (el) {
        setTimeout(() => {
          el.focus();
          try {
            el.scrollIntoView({ block: "nearest" });
          } catch {
            // Ignore scroll errors
          }
        }, 0);
        setPendingFocusIndex(null);
      }
    }
  }, [pendingFocusIndex, envVars]);

  const handleEnvVarsPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const inputType = target.getAttribute?.("data-env-input");
      const text = e.clipboardData?.getData("text") ?? "";

      // Always allow normal paste into value fields (values can contain =, :, URLs, etc.)
      if (inputType === "value") {
        return;
      }

      if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
        e.preventDefault();
        const items = parseEnvBlock(text);
        if (items.length > 0) {
          onEnvVarsChange((prev) => {
            const map = new Map(
              prev
                .filter((r) => r.name.trim().length > 0 || r.value.trim().length > 0)
                .map((r) => [r.name, r] as const)
            );
            for (const it of items) {
              if (!it.name) continue;
              const existing = map.get(it.name);
              if (existing) {
                map.set(it.name, { ...existing, value: it.value });
              } else {
                map.set(it.name, { name: it.name, value: it.value, isSecret: true });
              }
            }
            const next = Array.from(map.values());
            next.push({ name: "", value: "", isSecret: true });
            setPendingFocusIndex(next.length - 1);
            return next;
          });
        }
      }
    },
    [onEnvVarsChange]
  );

  return (
    <div>
      {/* Back button */}
      {onBack && (
        <div className="mb-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {backLabel}
          </button>
        </div>
      )}

      {/* Header */}
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        Configure workspace
      </h1>
      {selectedRepos.length > 0 && (
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {selectedRepos.map((repo, i) => (
            <span key={repo} className="inline-flex items-center gap-1.5">
              {i > 0 && ", "}
              <GitHubIcon className="h-3.5 w-3.5 shrink-0 inline" />
              <span>{repo}</span>
            </span>
          ))}
        </p>
      )}

      {/* Content */}
      <div className="space-y-6 mt-6">
          {/* Environment Name */}
          <div>
            <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">
              Environment Name
            </label>
            <input
              type="text"
              value={envName}
              onChange={(e) => onEnvNameChange(e.target.value)}
              placeholder={`${selectedRepos[0]?.split("/").pop() || "environment"}-${new Date().toISOString().slice(0, 10)}`}
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
            />
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              A unique name for this environment configuration
            </p>
          </div>

          {/* Maintenance and Dev Scripts */}
          <ScriptsSection
            maintenanceScript={maintenanceScript}
            devScript={devScript}
            selectedRepos={selectedRepos}
            onMaintenanceScriptChange={onMaintenanceScriptChange}
            onDevScriptChange={onDevScriptChange}
          />

          {/* Environment Variables */}
          <EnvVarsSection
            envVars={envVars}
            areEnvValuesHidden={areEnvValuesHidden}
            activeEnvValueIndex={activeEnvValueIndex}
            keyInputRefs={keyInputRefs}
            onToggleHidden={() => {
              setActiveEnvValueIndex(null);
              setAreEnvValuesHidden((prev) => !prev);
            }}
            onEnvVarsChange={onEnvVarsChange}
            onActiveIndexChange={setActiveEnvValueIndex}
            onPaste={handleEnvVarsPaste}
          />
        </div>

      {/* Footer Button */}
      <div className="flex items-center gap-3 pt-6">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-2 rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Scripts Section Component
function ScriptsSection({
  maintenanceScript,
  devScript,
  selectedRepos,
  onMaintenanceScriptChange,
  onDevScriptChange,
}: {
  maintenanceScript: string;
  devScript: string;
  selectedRepos: string[];
  onMaintenanceScriptChange: (value: string) => void;
  onDevScriptChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <details className="group" open={isOpen} onToggle={(e) => setIsOpen(e.currentTarget.open)}>
      <summary className="flex items-center gap-2 cursor-pointer font-semibold text-neutral-900 dark:text-neutral-100 list-none text-base">
        <ChevronDown
          className={clsx(
            "h-4 w-4 text-neutral-400 transition-transform",
            !isOpen && "-rotate-90"
          )}
        />
        Maintenance and Dev Scripts
      </summary>
      <div className="mt-4 pl-6 space-y-4">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Scripts run from{" "}
          <code className="font-mono text-neutral-600 dark:text-neutral-300">/root/workspace</code>
          {" "}which contains your repositor{selectedRepos.length > 1 ? "ies" : "y"} as subdirector{selectedRepos.length > 1 ? "ies" : "y"}.
        </p>

        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
            Maintenance Script
          </label>
          <textarea
            value={maintenanceScript ?? ""}
            onChange={(e) => onMaintenanceScriptChange(e.target.value)}
            placeholder="(cd [repo] && bun i)"
            rows={2}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
          />
          <p className="text-xs text-neutral-400 mt-1">
            Runs after git pull to install dependencies
          </p>
        </div>
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
            Dev Script
          </label>
          <textarea
            value={devScript ?? ""}
            onChange={(e) => onDevScriptChange(e.target.value)}
            placeholder="(cd [repo] && bun run dev)"
            rows={2}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
          />
          <p className="text-xs text-neutral-400 mt-1">Starts the development server</p>
        </div>
      </div>
    </details>
  );
}

// Environment Variables Section Component
function EnvVarsSection({
  envVars,
  areEnvValuesHidden,
  activeEnvValueIndex,
  keyInputRefs,
  onToggleHidden,
  onEnvVarsChange,
  onActiveIndexChange,
  onPaste,
}: {
  envVars: EnvVar[];
  areEnvValuesHidden: boolean;
  activeEnvValueIndex: number | null;
  keyInputRefs: React.MutableRefObject<Array<HTMLInputElement | null>>;
  onToggleHidden: () => void;
  onEnvVarsChange: (updater: (prev: EnvVar[]) => EnvVar[]) => void;
  onActiveIndexChange: (index: number | null) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <details className="group" open={isOpen} onToggle={(e) => setIsOpen(e.currentTarget.open)}>
      <summary className="flex items-center gap-2 cursor-pointer font-semibold text-neutral-900 dark:text-neutral-100 list-none text-base">
        <ChevronDown
          className={clsx(
            "h-4 w-4 text-neutral-400 transition-transform",
            !isOpen && "-rotate-90"
          )}
        />
        <span>Environment Variables</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onToggleHidden();
            }}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
            aria-label={areEnvValuesHidden ? "Reveal values" : "Hide values"}
          >
            {areEnvValuesHidden ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </summary>
      <div className="mt-4 pl-6 space-y-2" onPasteCapture={onPaste}>
        <div
          className="grid gap-2 text-xs text-neutral-500 items-center mb-1"
          style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px" }}
        >
          <span>Name</span>
          <span>Value</span>
          <span />
        </div>
        {envVars.map((row, idx) => {
          const isEditingValue = activeEnvValueIndex === idx;
          const shouldMaskValue =
            areEnvValuesHidden && row.value.trim().length > 0 && !isEditingValue;
          return (
            <div
              key={idx}
              className="grid gap-2 items-center min-h-9"
              style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px" }}
            >
              <input
                type="text"
                value={row.name}
                ref={(el) => {
                  keyInputRefs.current[idx] = el;
                }}
                onChange={(e) => {
                  onEnvVarsChange((prev) => {
                    const next = [...prev];
                    if (next[idx]) {
                      next[idx] = { ...next[idx], name: e.target.value };
                    }
                    return next;
                  });
                }}
                placeholder="EXAMPLE_NAME"
                data-env-input="key"
                className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
              />
              <input
                type={shouldMaskValue ? "password" : "text"}
                value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                onChange={
                  shouldMaskValue
                    ? undefined
                    : (e) => {
                        onEnvVarsChange((prev) => {
                          const next = [...prev];
                          if (next[idx]) {
                            next[idx] = { ...next[idx], value: e.target.value };
                          }
                          return next;
                        });
                      }
                }
                onFocus={() => onActiveIndexChange(idx)}
                onBlur={() =>
                  onActiveIndexChange(activeEnvValueIndex === idx ? null : activeEnvValueIndex)
                }
                readOnly={shouldMaskValue}
                placeholder="I9JU23NF394R6HH"
                data-env-input="value"
                className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
              />
              <button
                type="button"
                disabled={envVars.length <= 1}
                onClick={() =>
                  onEnvVarsChange((prev) => {
                    const next = prev.filter((_, i) => i !== idx);
                    return next.length > 0 ? next : [{ name: "", value: "", isSecret: true }];
                  })
                }
                className={clsx(
                  "h-9 w-9 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 grid place-items-center",
                  envVars.length <= 1
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                )}
                aria-label="Remove variable"
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>
          );
        })}
        <div className="mt-1">
          <button
            type="button"
            onClick={() =>
              onEnvVarsChange((prev) => [...prev, { name: "", value: "", isSecret: true }])
            }
            className="inline-flex items-center gap-2 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
          >
            <Plus className="w-4 h-4" /> Add variable
          </button>
        </div>
      </div>
      <p className="text-xs text-neutral-400 mt-4 pl-6">Tip: Paste a .env file to auto-fill</p>
    </details>
  );
}
