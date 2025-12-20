import { useCallback, type ReactNode } from "react";
import clsx from "clsx";

interface ScriptsSectionProps {
  /** Current maintenance script value */
  maintenanceScript: string;
  /** Callback when maintenance script changes */
  onMaintenanceScriptChange: (value: string) => void;
  /** Current dev script value */
  devScript: string;
  /** Callback when dev script changes */
  onDevScriptChange: (value: string) => void;
  /** Whether this section is disabled */
  disabled?: boolean;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Whether to show as collapsible */
  collapsible?: boolean;
  /** Default open state for collapsible */
  defaultOpen?: boolean;
  /** Step badge number (for wizard) */
  stepNumber?: number;
  /** Whether step is completed */
  isStepCompleted?: boolean;
  /** Icon components (to allow different icon libs) */
  icons?: {
    ChevronDown?: ReactNode;
  };
  /** CSS class name */
  className?: string;
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
      {done ? "✓" : step}
    </span>
  );
}

export function ScriptsSection({
  maintenanceScript,
  onMaintenanceScriptChange,
  devScript,
  onDevScriptChange,
  disabled = false,
  compact = false,
  collapsible = true,
  defaultOpen = true,
  stepNumber,
  isStepCompleted = false,
  icons,
  className,
}: ScriptsSectionProps) {
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

  const content = (
    <div className={clsx(contentPadding, "space-y-4")}>
      <div>
        <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
          Maintenance Script
        </label>
        <textarea
          value={maintenanceScript}
          onChange={(e) => onMaintenanceScriptChange(e.target.value)}
          disabled={disabled}
          placeholder="npm install, bun install, pip install -r requirements.txt"
          rows={2}
          className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none disabled:opacity-60 disabled:cursor-not-allowed"
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
          value={devScript}
          onChange={(e) => onDevScriptChange(e.target.value)}
          disabled={disabled}
          placeholder="npm run dev, bun dev, python manage.py runserver"
          rows={2}
          className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-neutral-400 mt-1">
          Starts the development server
        </p>
      </div>
    </div>
  );

  if (!collapsible) {
    return (
      <div className={className}>
        <h3
          className={clsx(
            "font-semibold text-neutral-900 dark:text-neutral-100 mb-2",
            titleSize
          )}
        >
          Maintenance and Dev Scripts
        </h3>
        {content}
      </div>
    );
  }

  return (
    <details className={clsx("group", className)} open={defaultOpen}>
      <summary
        className={clsx(
          "flex items-center gap-2 cursor-pointer font-semibold text-neutral-900 dark:text-neutral-100 list-none",
          titleSize
        )}
      >
        {icons?.ChevronDown ?? (
          <span
            className={clsx(
              iconSize,
              "text-neutral-400 transition-transform -rotate-90 group-open:rotate-0"
            )}
          >
            ▼
          </span>
        )}
        {stepNumber !== undefined && (
          <StepBadge step={stepNumber} done={isStepCompleted} />
        )}
        Maintenance and Dev Scripts
      </summary>
      {content}
    </details>
  );
}

export default ScriptsSection;
