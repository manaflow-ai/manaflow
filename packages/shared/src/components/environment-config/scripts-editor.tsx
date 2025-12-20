"use client";

import clsx from "clsx";

export interface ScriptsEditorProps {
  maintenanceScript: string;
  devScript: string;
  onMaintenanceScriptChange: (value: string) => void;
  onDevScriptChange: (value: string) => void;
  disabled?: boolean;
  /**
   * Compact mode reduces spacing for sidebar layouts.
   */
  compact?: boolean;
  /**
   * Show section descriptions.
   */
  showDescriptions?: boolean;
  /**
   * Class name for the container.
   */
  className?: string;
}

export function ScriptsEditor({
  maintenanceScript,
  devScript,
  onMaintenanceScriptChange,
  onDevScriptChange,
  disabled = false,
  compact = false,
  showDescriptions = true,
  className,
}: ScriptsEditorProps) {
  const labelSize = compact ? "text-xs" : "text-sm";
  const inputSize = compact ? "text-xs py-1.5" : "text-sm py-2";
  const descSize = compact ? "text-[10px]" : "text-xs";
  const spacing = compact ? "space-y-3" : "space-y-4";

  return (
    <div className={clsx(spacing, className)}>
      {/* Maintenance Script */}
      <div>
        <label
          className={clsx(
            "block font-medium text-neutral-800 dark:text-neutral-200 mb-1.5",
            labelSize
          )}
        >
          Maintenance Script
        </label>
        <textarea
          value={maintenanceScript}
          onChange={(e) => onMaintenanceScriptChange(e.target.value)}
          disabled={disabled}
          placeholder="npm install, bun install, pip install -r requirements.txt"
          rows={compact ? 2 : 3}
          className={clsx(
            "w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none",
            inputSize,
            disabled && "opacity-60 cursor-not-allowed"
          )}
        />
        {showDescriptions && (
          <p className={clsx("text-neutral-500 mt-1", descSize)}>
            Runs after git pull to install dependencies
          </p>
        )}
      </div>

      {/* Dev Script */}
      <div>
        <label
          className={clsx(
            "block font-medium text-neutral-800 dark:text-neutral-200 mb-1.5",
            labelSize
          )}
        >
          Dev Script
        </label>
        <textarea
          value={devScript}
          onChange={(e) => onDevScriptChange(e.target.value)}
          disabled={disabled}
          placeholder="npm run dev, bun dev, python manage.py runserver"
          rows={compact ? 2 : 3}
          className={clsx(
            "w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none",
            inputSize,
            disabled && "opacity-60 cursor-not-allowed"
          )}
        />
        {showDescriptions && (
          <p className={clsx("text-neutral-500 mt-1", descSize)}>
            Starts the development server
          </p>
        )}
      </div>
    </div>
  );
}
