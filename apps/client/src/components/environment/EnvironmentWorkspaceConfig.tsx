/**
 * Environment Workspace Configuration Phase
 *
 * Split view with sidebar + VS Code/Browser panels.
 * Guides user through step-by-step configuration:
 * 1. Scripts (completed from initial setup - collapsed)
 * 2. Environment variables (completed from initial setup - collapsed)
 * 3. Run scripts in VS Code terminal
 * 4. Configure browser for authentication
 */

import { GitHubIcon } from "@/components/icons/github";
import { PersistentWebView } from "@/components/persistent-webview";
import { WorkspaceLoadingIndicator } from "@/components/workspace-loading-indicator";
import {
  disableDragPointerEvents,
  restoreDragPointerEvents,
} from "@/lib/drag-pointer-events";
import { parseEnvBlock } from "@/lib/parseEnvBlock";
import {
  TASK_RUN_IFRAME_ALLOW,
  TASK_RUN_IFRAME_SANDBOX,
} from "@/lib/preloadTaskRunIframes";
import type {
  EnvVar,
  ConfigStep,
} from "@cmux/shared/components/environment";
import {
  ALL_CONFIG_STEPS,
  MASKED_ENV_VALUE,
} from "@cmux/shared/components/environment";
import { VncViewer, type VncConnectionStatus } from "@cmux/shared/components/vnc-viewer";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

interface EnvironmentWorkspaceConfigProps {
  selectedRepos: string[];
  maintenanceScript: string;
  devScript: string;
  envVars: EnvVar[];
  vscodeUrl?: string;
  vncWebsocketUrl?: string;
  isSaving: boolean;
  errorMessage?: string | null;
  onMaintenanceScriptChange: (value: string) => void;
  onDevScriptChange: (value: string) => void;
  onEnvVarsChange: (updater: (prev: EnvVar[]) => EnvVar[]) => void;
  onSave: () => void;
  onBack: () => void;
}

function StepBadge({ step, done }: { step: number; done: boolean }) {
  return (
    <span
      className={clsx(
        "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
        done
          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400/70 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
      )}
    >
      {done ? <Check className="h-3 w-3" /> : step}
    </span>
  );
}

export function EnvironmentWorkspaceConfig({
  selectedRepos,
  maintenanceScript,
  devScript,
  envVars,
  vscodeUrl,
  vncWebsocketUrl,
  isSaving,
  errorMessage,
  onMaintenanceScriptChange,
  onDevScriptChange,
  onEnvVarsChange,
  onSave,
  onBack,
}: EnvironmentWorkspaceConfigProps) {
  // Current step (starts at run-scripts since scripts and env-vars were done in initial setup)
  const [currentConfigStep, setCurrentConfigStep] = useState<ConfigStep>("run-scripts");

  // Track which steps have been completed (scripts and env-vars are pre-completed from initial setup)
  const [completedSteps, setCompletedSteps] = useState<Set<ConfigStep>>(
    () => new Set(["scripts", "env-vars"] as ConfigStep[])
  );

  const [commandsCopied, setCommandsCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(null);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // VNC connection status
  const [_vncStatus, setVncStatus] = useState<VncConnectionStatus>("disconnected");

  // Resizable sidebar state
  const MIN_SIDEBAR_WIDTH = 320;
  const MAX_SIDEBAR_WIDTH = 600;
  const DEFAULT_SIDEBAR_WIDTH = 420;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
    const stored = localStorage.getItem("cmux:env-workspace-sidebar-width");
    if (stored) {
      const parsed = Number.parseInt(stored, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerLeftRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);

  // Persist width to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("cmux:env-workspace-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  // Smooth resize using requestAnimationFrame (matches Sidebar.tsx pattern)
  const onMouseMove = useCallback((e: MouseEvent) => {
    // Batch width updates to once per animation frame to reduce layout thrashing
    if (rafIdRef.current != null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const containerLeft = containerLeftRef.current;
      const clientX = e.clientX;
      const newWidth = Math.min(
        Math.max(clientX - containerLeft, MIN_SIDEBAR_WIDTH),
        MAX_SIDEBAR_WIDTH
      );
      setSidebarWidth(newWidth);
    });
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.classList.remove("select-none");
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    restoreDragPointerEvents();
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopResizing);
  }, [onMouseMove]);

  const startResizing = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.classList.add("select-none");
      // Snapshot the container's left position so we don't force layout on every move
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        containerLeftRef.current = rect.left;
      }
      disableDragPointerEvents();
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", stopResizing);
    },
    [onMouseMove, stopResizing]
  );

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [onMouseMove, stopResizing]);

  const resetWidth = useCallback(() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH), []);

  // Clean up copy timeout
  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

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

  const handleCopyCommands = useCallback(async () => {
    const combined = [maintenanceScript.trim(), devScript.trim()]
      .filter(Boolean)
      .join(" && ");
    if (!combined) return;

    try {
      await navigator.clipboard.writeText(combined);
      setCommandsCopied(true);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCommandsCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy commands:", error);
    }
  }, [devScript, maintenanceScript]);

  const handleNextConfigStep = useCallback(() => {
    const currentIndex = ALL_CONFIG_STEPS.indexOf(currentConfigStep);
    // Mark current step as completed
    setCompletedSteps((prev) => new Set([...prev, currentConfigStep]));
    // Move to next step if not at end
    if (currentIndex < ALL_CONFIG_STEPS.length - 1) {
      setCurrentConfigStep(ALL_CONFIG_STEPS[currentIndex + 1]);
    }
  }, [currentConfigStep]);

  const isStepVisible = useCallback(
    (step: ConfigStep) => completedSteps.has(step) || step === currentConfigStep,
    [completedSteps, currentConfigStep]
  );

  const isCurrentStep = useCallback(
    (step: ConfigStep) => step === currentConfigStep,
    [currentConfigStep]
  );

  const isStepCompleted = useCallback(
    (step: ConfigStep) => completedSteps.has(step),
    [completedSteps]
  );

  const handleGoToStep = useCallback((step: ConfigStep) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.delete(step);
      return next;
    });
    setCurrentConfigStep(step);
  }, []);

  const handleEnvVarsPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const text = e.clipboardData?.getData("text") ?? "";
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

  // Show browser only for browser-setup step, VSCode for others
  const showBrowser = currentConfigStep === "browser-setup";

  const workspacePlaceholder = useMemo(
    () =>
      vscodeUrl
        ? null
        : {
            title: "Waiting for VS Code",
            description: "The editor opens automatically once the environment finishes booting.",
          },
    [vscodeUrl]
  );

  const browserPlaceholder = useMemo(
    () =>
      vncWebsocketUrl
        ? null
        : {
            title: "Waiting for browser",
            description: "We'll embed the browser session as soon as the environment exposes it.",
          },
    [vncWebsocketUrl]
  );

  // Render scripts section
  const renderScriptsSection = (options?: {
    defaultOpen?: boolean;
    showStepBadge?: boolean;
    stepNumber?: number;
    isDone?: boolean;
  }) => {
    const {
      defaultOpen = true,
      showStepBadge = false,
      stepNumber = 1,
      isDone = false,
    } = options ?? {};

    return (
      <details className="group" open={defaultOpen}>
        <summary
          className={clsx(
            "flex items-center gap-2 cursor-pointer text-[13px] font-medium text-neutral-900 dark:text-neutral-100 list-none",
            isSaving && "cursor-not-allowed opacity-60"
          )}
          onClick={(e) => {
            // Just prevent interaction when saving - let details toggle naturally
            // Don't call handleGoToStep for scripts section to keep it always completed
            if (isSaving) {
              e.preventDefault();
            }
          }}
        >
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
          {showStepBadge && <StepBadge step={stepNumber} done={isDone} />}
          Maintenance and Dev Scripts
        </summary>
        <div className="mt-3 pl-5 space-y-4">
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
  };

  // Render env vars section
  const renderEnvVarsSection = (options?: {
    defaultOpen?: boolean;
    showStepBadge?: boolean;
    stepNumber?: number;
    isDone?: boolean;
  }) => {
    const {
      defaultOpen = true,
      showStepBadge = false,
      stepNumber = 2,
      isDone = false,
    } = options ?? {};

    return (
      <details className="group" open={defaultOpen}>
        <summary
          className={clsx(
            "flex items-center gap-2 cursor-pointer text-[13px] font-medium text-neutral-900 dark:text-neutral-100 list-none",
            isSaving && "cursor-not-allowed opacity-60"
          )}
          onClick={(e) => {
            // Just prevent interaction when saving - let details toggle naturally
            // Don't call handleGoToStep for env-vars section to keep it always completed
            if (isSaving) {
              e.preventDefault();
            }
          }}
        >
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
          {showStepBadge && <StepBadge step={stepNumber} done={isDone} />}
          <span>Environment Variables</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setActiveEnvValueIndex(null);
                setAreEnvValuesHidden((prev) => !prev);
              }}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
              aria-label={areEnvValuesHidden ? "Reveal values" : "Hide values"}
            >
              {areEnvValuesHidden ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </summary>
        <div className="mt-3 pl-5 space-y-2" onPasteCapture={handleEnvVarsPaste}>
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
                  onFocus={() => setActiveEnvValueIndex(idx)}
                  onBlur={() =>
                    setActiveEnvValueIndex((current) => (current === idx ? null : current))
                  }
                  readOnly={shouldMaskValue}
                  placeholder="I9JU23NF394R6HH"
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
        <p className="text-xs text-neutral-400 mt-4 pl-5">Tip: Paste a .env file to auto-fill</p>
      </details>
    );
  };

  // Render workspace step content
  const renderWorkspaceStepContent = () => {
    return (
      <div className="space-y-4">
        {/* Step 1: Scripts (completed from initial setup - collapsed) */}
        {isStepVisible("scripts") && (
          <div>
            {renderScriptsSection({
              defaultOpen: !isStepCompleted("scripts"),
              showStepBadge: true,
              stepNumber: 1,
              isDone: isStepCompleted("scripts"),
            })}
          </div>
        )}

        {/* Step 2: Environment Variables (completed from initial setup - collapsed) */}
        {isStepVisible("env-vars") && (
          <div>
            {renderEnvVarsSection({
              defaultOpen: !isStepCompleted("env-vars"),
              showStepBadge: true,
              stepNumber: 2,
              isDone: isStepCompleted("env-vars"),
            })}
          </div>
        )}

        {/* Step 3: Run Scripts */}
        {isStepVisible("run-scripts") && (
          <div>
            <details className="group" open={isCurrentStep("run-scripts")}>
              <summary
                className={clsx(
                  "flex items-center gap-2 list-none",
                  isSaving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                )}
                onClick={(e) => {
                  if (isSaving) return;
                  if (isStepCompleted("run-scripts") && !isCurrentStep("run-scripts")) {
                    e.preventDefault();
                    handleGoToStep("run-scripts");
                  }
                }}
              >
                <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
                <StepBadge
                  step={3}
                  done={isStepCompleted("run-scripts") && !isCurrentStep("run-scripts")}
                />
                <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                  Run scripts in VS Code terminal
                </span>
              </summary>
              <div className="mt-3 ml-6 space-y-3">
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Setup VS Code development environment. Open terminal (
                  <kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-sans">
                    Ctrl+Shift+`
                  </kbd>{" "}
                  or{" "}
                  <kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-sans">
                    Cmd+J
                  </kbd>
                  ) and paste:
                </p>
                <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/50">
                    <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                      Commands
                    </span>
                    {(maintenanceScript.trim() || devScript.trim()) && (
                      <button
                        type="button"
                        onClick={handleCopyCommands}
                        className={clsx(
                          "p-0.5",
                          commandsCopied
                            ? "text-emerald-500"
                            : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        )}
                      >
                        {commandsCopied ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                  <pre className="px-3 py-2 text-[11px] font-mono text-neutral-900 dark:text-neutral-100 overflow-x-auto whitespace-pre-wrap break-all select-all">
                    {maintenanceScript.trim() || devScript.trim() ? (
                      [maintenanceScript.trim(), devScript.trim()].filter(Boolean).join(" && ")
                    ) : (
                      <span className="text-neutral-400 italic">No scripts configured</span>
                    )}
                  </pre>
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Proceed once dev script is running.
                </p>
              </div>
            </details>
            {/* Continue button outside chevron */}
            {isCurrentStep("run-scripts") && (
              <button
                type="button"
                onClick={handleNextConfigStep}
                className="w-full mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition cursor-pointer"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Step 4: Browser Setup */}
        {isStepVisible("browser-setup") && (
          <div>
            <details className="group" open={isCurrentStep("browser-setup")}>
              <summary
                className={clsx(
                  "flex items-center gap-2 list-none",
                  isSaving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                )}
                onClick={(e) => {
                  if (isSaving) return;
                  if (isStepCompleted("browser-setup") && !isCurrentStep("browser-setup")) {
                    e.preventDefault();
                    handleGoToStep("browser-setup");
                  }
                }}
              >
                <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
                <StepBadge
                  step={4}
                  done={isStepCompleted("browser-setup") && !isCurrentStep("browser-setup")}
                />
                <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                  Configure browser
                </span>
              </summary>
              <div className="mt-3 ml-6 space-y-3">
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Use the browser on the right to set up authentication:
                </p>
                <ul className="space-y-2 text-[11px] text-neutral-600 dark:text-neutral-400">
                  <li className="flex items-start gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">
                      1
                    </span>
                    <span>Sign in to any dashboards or SaaS tools</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">
                      2
                    </span>
                    <span>Dismiss cookie banners, popups, or MFA prompts</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">
                      3
                    </span>
                    <span>Navigate to your dev server URL (e.g., localhost:3000)</span>
                  </li>
                </ul>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Proceed once browser is set up properly.
                </p>
              </div>
            </details>
            {/* Save button outside chevron */}
            {isCurrentStep("browser-setup") && (
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving}
                className="w-full mt-4 inline-flex items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save configuration"
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render preview panel
  const renderPreviewPanel = () => {
    const placeholder = showBrowser ? browserPlaceholder : workspacePlaceholder;

    // Loading fallback for VNC viewer
    const vncLoadingFallback = (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
        <span className="text-sm text-neutral-400">Connecting to browser preview...</span>
      </div>
    );

    // Error fallback for VNC viewer
    const vncErrorFallback = (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
        <span className="text-sm text-red-400">Failed to connect to browser preview</span>
      </div>
    );

    return (
      <div className="h-full flex flex-col overflow-hidden relative">
        {/* Placeholder for VS Code or browser when not available */}
        {placeholder ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-neutral-500 dark:text-neutral-400">
            <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
              {placeholder.title}
            </div>
            {placeholder.description ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {placeholder.description}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* VS Code iframe (shown for non-browser-setup steps) */}
        {!showBrowser && vscodeUrl && (
          <div className={clsx("absolute inset-0", placeholder ? "opacity-0" : "opacity-100")}>
            <PersistentWebView
              persistKey={`env-workspace-config:vscode`}
              src={vscodeUrl}
              className="flex h-full"
              iframeClassName="select-none"
              allow={TASK_RUN_IFRAME_ALLOW}
              sandbox={TASK_RUN_IFRAME_SANDBOX}
              preflight
              retainOnUnmount
              fallback={<WorkspaceLoadingIndicator variant="vscode" status="loading" />}
              fallbackClassName="bg-neutral-50 dark:bg-black"
              errorFallback={<WorkspaceLoadingIndicator variant="vscode" status="error" />}
              errorFallbackClassName="bg-neutral-50/95 dark:bg-black/95"
              loadTimeoutMs={60_000}
            />
          </div>
        )}

        {/* VNC Viewer for browser preview (shown for browser-setup step) */}
        {showBrowser && vncWebsocketUrl && (
          <VncViewer
            url={vncWebsocketUrl}
            className={clsx(
              "absolute inset-0",
              browserPlaceholder ? "opacity-0" : "opacity-100"
            )}
            background="#000000"
            scaleViewport
            autoConnect
            autoReconnect
            reconnectDelay={1000}
            maxReconnectDelay={30000}
            focusOnClick
            onStatusChange={setVncStatus}
            loadingFallback={vncLoadingFallback}
            errorFallback={vncErrorFallback}
          />
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="flex h-full overflow-hidden font-sans text-[15px] leading-6"
      style={{ userSelect: isResizing ? "none" : undefined }}
    >
      {/* Left: Configuration Sidebar */}
      <div
        className="h-full flex flex-col overflow-hidden bg-white dark:bg-neutral-900 relative shrink-0"
        style={{ width: sidebarWidth }}
      >
        <div className="flex-shrink-0 px-5 pt-4 pb-2">
          <button
            type="button"
            onClick={onBack}
            disabled={isSaving}
            className={clsx(
              "inline-flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400 mb-3",
              isSaving
                ? "opacity-50 cursor-not-allowed"
                : "hover:text-neutral-900 dark:hover:text-neutral-100"
            )}
          >
            <ArrowLeft className="h-3 w-3" />
            Back to project setup
          </button>
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
            Configure workspace
          </h1>
          {selectedRepos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 pt-1">
              {selectedRepos.map((repo) => (
                <span key={repo} className="inline-flex items-center gap-1.5">
                  <GitHubIcon className="h-4 w-4 shrink-0" />
                  <span className="font-sans text-xs">{repo}</span>
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed pt-3">
            Your workspace root at{" "}
            <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
              /root/workspace
            </code>{" "}
            contains your repositories as subdirectories.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {renderWorkspaceStepContent()}

          {errorMessage && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-3 mt-4">
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            </div>
          )}
        </div>

        {/* Resize Handle - invisible but with comfortable hit area */}
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onMouseDown={startResizing}
          onDoubleClick={resetWidth}
          className="absolute top-0 right-0 h-full cursor-col-resize"
          style={{
            width: "14px",
            transform: "translateX(7px)",
            background: "transparent",
            zIndex: 10,
          }}
        />
      </div>

      {/* Right: Preview Panel */}
      <div className="flex-1 flex flex-col bg-neutral-950 overflow-hidden" data-drag-disable-pointer>
        {renderPreviewPanel()}
      </div>
    </div>
  );
}
