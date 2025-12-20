import clsx from "clsx";
import type { ReactNode } from "react";
import { validateExposedPorts, type ExposedPortValidationResult } from "../../utils/validate-exposed-ports";

/**
 * Parse a comma-separated port string and validate
 */
function parseAndValidatePorts(value: string): ExposedPortValidationResult & { hasError: boolean; errorMessage?: string } {
  const ports = value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => !Number.isNaN(n));

  const result = validateExposedPorts(ports);

  if (result.reserved.length > 0) {
    return {
      ...result,
      hasError: true,
      errorMessage: `Reserved ports cannot be exposed: ${result.reserved.join(", ")}`,
    };
  }

  if (result.invalid.length > 0) {
    return {
      ...result,
      hasError: true,
      errorMessage: "Ports must be positive integers",
    };
  }

  return { ...result, hasError: false };
}

interface ExposedPortsInputProps {
  /** Current ports value as string (comma-separated) */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Whether this input is disabled */
  disabled?: boolean;
  /** CSS class name */
  className?: string;
  /** Step badge number (for wizard) */
  stepNumber?: number;
  /** Whether step is completed */
  isStepCompleted?: boolean;
  /** Whether to show as collapsible */
  collapsible?: boolean;
  /** Default open state for collapsible */
  defaultOpen?: boolean;
  /** Icon components */
  icons?: {
    ChevronDown?: ReactNode;
  };
  /** Whether to show in compact mode */
  compact?: boolean;
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

export function ExposedPortsInput({
  value,
  onChange,
  disabled = false,
  className,
  stepNumber,
  isStepCompleted = false,
  collapsible = true,
  defaultOpen = true,
  icons,
  compact = false,
}: ExposedPortsInputProps) {
  const validation = parseAndValidatePorts(value);
  const hasError = validation.hasError && value.trim().length > 0;

  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

  const content = (
    <div className={clsx(contentPadding)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="3000, 5173, 8080"
        className={clsx(
          "w-full h-9 rounded-md border bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 disabled:opacity-60 disabled:cursor-not-allowed",
          hasError
            ? "border-red-300 dark:border-red-800 focus:ring-red-300 dark:focus:ring-red-700"
            : "border-neutral-200 dark:border-neutral-800 focus:ring-neutral-300 dark:focus:ring-neutral-700"
        )}
      />
      {hasError ? (
        <p className="text-xs text-red-500 dark:text-red-400 mt-1">
          {validation.errorMessage}
        </p>
      ) : (
        <p className="text-xs text-neutral-400 mt-1">
          Comma-separated list of ports to expose for preview URLs
        </p>
      )}
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
          Exposed Ports
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
        Exposed Ports
      </summary>
      {content}
    </details>
  );
}

export default ExposedPortsInput;
