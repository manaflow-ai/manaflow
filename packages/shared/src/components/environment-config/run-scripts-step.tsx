"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import clsx from "clsx";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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

export interface RunScriptsStepProps {
  maintenanceScript: string;
  devScript: string;
  /**
   * Whether the step is compact (sidebar mode).
   */
  compact?: boolean;
  /**
   * Class name for the container.
   */
  className?: string;
}

export function RunScriptsStep({
  maintenanceScript,
  devScript,
  compact = false,
  className,
}: RunScriptsStepProps) {
  const [commandsCopied, setCommandsCopied] = useState(false);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const combinedCommands = [maintenanceScript.trim(), devScript.trim()]
    .filter(Boolean)
    .join(" && ");

  const handleCopyCommands = useCallback(async () => {
    if (!combinedCommands) {
      return;
    }

    try {
      await navigator.clipboard.writeText(combinedCommands);
      setCommandsCopied(true);
      if (copyResetTimeoutRef.current !== null) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = setTimeout(() => {
        setCommandsCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy commands:", error);
    }
  }, [combinedCommands]);

  const textSize = compact ? "text-[11px]" : "text-xs";

  return (
    <div className={clsx("space-y-3", className)}>
      <p className={clsx("text-neutral-500 dark:text-neutral-400", textSize)}>
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
          {combinedCommands && (
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
                <CheckIcon className="h-3 w-3" />
              ) : (
                <CopyIcon className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
        <pre
          className={clsx(
            "px-3 py-2 font-mono text-neutral-900 dark:text-neutral-100 overflow-x-auto whitespace-pre-wrap break-all select-all",
            textSize
          )}
        >
          {combinedCommands || (
            <span className="text-neutral-400 italic">
              No scripts configured
            </span>
          )}
        </pre>
      </div>

      <p className={clsx("text-neutral-500 dark:text-neutral-400", textSize)}>
        Proceed once dev script is running.
      </p>
    </div>
  );
}
