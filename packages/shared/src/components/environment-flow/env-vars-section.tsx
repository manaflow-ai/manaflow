import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import clsx from "clsx";
import type { EnvVar, EnvVarGroup } from "../../environment-flow/types";
import { ensureInitialEnvVars } from "../../environment-flow/types";
import { parseEnvBlock, looksLikeEnvContent } from "../../environment-flow/parse-env-block";

const MASKED_ENV_VALUE = "••••••••••••••••";

interface EnvVarsSectionProps {
  /** Current env vars */
  envVars: EnvVar[];
  /** Callback when env vars change */
  onEnvVarsChange: (envVars: EnvVar[]) => void;
  /** Whether env values are hidden */
  areValuesHidden?: boolean;
  /** Callback to toggle hidden state */
  onToggleHidden?: () => void;
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
    Eye?: ReactNode;
    EyeOff?: ReactNode;
    Plus?: ReactNode;
    Minus?: ReactNode;
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

export function EnvVarsSection({
  envVars,
  onEnvVarsChange,
  areValuesHidden: controlledHidden,
  onToggleHidden,
  disabled = false,
  compact = false,
  collapsible = true,
  defaultOpen = true,
  stepNumber,
  isStepCompleted = false,
  icons,
  className,
}: EnvVarsSectionProps) {
  // Internal hidden state if not controlled
  const [internalHidden, setInternalHidden] = useState(true);
  const areValuesHidden = controlledHidden ?? internalHidden;
  const toggleHidden = onToggleHidden ?? (() => setInternalHidden((prev) => !prev));

  // Track which value field is being actively edited (to show unmasked)
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(null);
  // Pending focus after adding new row
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Handle pending focus
  useEffect(() => {
    if (pendingFocusIndex !== null) {
      const el = keyInputRefs.current[pendingFocusIndex];
      if (el) {
        setTimeout(() => {
          el.focus();
          try {
            el.scrollIntoView({ block: "nearest" });
          } catch (_e) {
            void 0;
          }
        }, 0);
        setPendingFocusIndex(null);
      }
    }
  }, [pendingFocusIndex, envVars]);

  const updateEnvVars = useCallback(
    (updater: (prev: EnvVar[]) => EnvVar[]) => {
      onEnvVarsChange(updater(envVars));
    },
    [envVars, onEnvVarsChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (text && looksLikeEnvContent(text)) {
        e.preventDefault();
        const items = parseEnvBlock(text);
        if (items.length > 0) {
          updateEnvVars((prev) => {
            const map = new Map(
              prev
                .filter(
                  (r) => r.name.trim().length > 0 || r.value.trim().length > 0
                )
                .map((r) => [r.name, r] as const)
            );
            for (const it of items) {
              if (!it.name) continue;
              const existing = map.get(it.name);
              if (existing) {
                map.set(it.name, { ...existing, value: it.value });
              } else {
                map.set(it.name, {
                  name: it.name,
                  value: it.value,
                  isSecret: true,
                });
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
    [updateEnvVars]
  );

  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

  const content = (
    <div
      className={clsx(contentPadding, "space-y-2")}
      onPasteCapture={handlePaste}
    >
      {/* Header row */}
      <div
        className="grid gap-2 text-xs text-neutral-500 items-center mb-1"
        style={{
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px",
        }}
      >
        <span>Name</span>
        <span>Value</span>
        <span />
      </div>

      {/* Env var rows */}
      {envVars.map((row, idx) => {
        const isEditingValue = activeEnvValueIndex === idx;
        const shouldMaskValue =
          areValuesHidden && row.value.trim().length > 0 && !isEditingValue;
        return (
          <div
            key={idx}
            className="grid gap-2 items-center min-h-9"
            style={{
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px",
            }}
          >
            <input
              type="text"
              value={row.name}
              disabled={disabled}
              ref={(el) => {
                keyInputRefs.current[idx] = el;
              }}
              onChange={(e) => {
                updateEnvVars((prev) => {
                  const next = [...prev];
                  if (next[idx]) next[idx] = { ...next[idx], name: e.target.value };
                  return next;
                });
              }}
              placeholder="EXAMPLE_NAME"
              className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <input
              type={shouldMaskValue ? "password" : "text"}
              value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
              disabled={disabled}
              onChange={
                shouldMaskValue
                  ? undefined
                  : (e) => {
                      updateEnvVars((prev) => {
                        const next = [...prev];
                        if (next[idx])
                          next[idx] = { ...next[idx], value: e.target.value };
                        return next;
                      });
                    }
              }
              onFocus={() => setActiveEnvValueIndex(idx)}
              onBlur={() =>
                setActiveEnvValueIndex((current) =>
                  current === idx ? null : current
                )
              }
              readOnly={shouldMaskValue}
              placeholder="I9JU23NF394R6HH"
              className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <button
              type="button"
              disabled={disabled || envVars.length <= 1}
              onClick={() =>
                updateEnvVars((prev) => {
                  const next = prev.filter((_, i) => i !== idx);
                  return next.length > 0
                    ? next
                    : [{ name: "", value: "", isSecret: true }];
                })
              }
              className={clsx(
                "h-9 w-9 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 grid place-items-center",
                disabled || envVars.length <= 1
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
              )}
              aria-label="Remove variable"
            >
              {icons?.Minus ?? <span className="text-sm">−</span>}
            </button>
          </div>
        );
      })}

      {/* Add button */}
      <div className="mt-1">
        <button
          type="button"
          onClick={() =>
            updateEnvVars((prev) => [
              ...prev,
              { name: "", value: "", isSecret: true },
            ])
          }
          disabled={disabled}
          className="inline-flex items-center gap-2 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {icons?.Plus ?? <span className="text-sm">+</span>} Add variable
        </button>
      </div>
    </div>
  );

  const tip = (
    <p
      className={clsx(
        "text-xs text-neutral-400 mt-4",
        compact ? "pl-5" : "pl-6"
      )}
    >
      Tip: Paste a .env file to auto-fill
    </p>
  );

  if (!collapsible) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-2">
          <h3
            className={clsx(
              "font-semibold text-neutral-900 dark:text-neutral-100",
              titleSize
            )}
          >
            Environment Variables
          </h3>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setActiveEnvValueIndex(null);
              toggleHidden();
            }}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
            aria-label={areValuesHidden ? "Reveal values" : "Hide values"}
          >
            {areValuesHidden
              ? icons?.EyeOff ?? <span className={iconSize}>👁</span>
              : icons?.Eye ?? <span className={iconSize}>👁</span>}
          </button>
        </div>
        {content}
        {tip}
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
        <span>Environment Variables</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setActiveEnvValueIndex(null);
              toggleHidden();
            }}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
            aria-label={areValuesHidden ? "Reveal values" : "Hide values"}
          >
            {areValuesHidden
              ? icons?.EyeOff ?? <span className={iconSize}>🙈</span>
              : icons?.Eye ?? <span className={iconSize}>👁</span>}
          </button>
        </div>
      </summary>
      {content}
      {tip}
    </details>
  );
}

export default EnvVarsSection;
