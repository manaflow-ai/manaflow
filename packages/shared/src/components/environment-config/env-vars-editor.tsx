"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import clsx from "clsx";
import type { EnvVar } from "../../environment-config/types";
import { parseEnvBlock } from "../../environment-config/parse-env-block";

const MASKED_ENV_VALUE = "••••••••••••••••";

// Inline icon components to avoid external dependencies
function EyeIcon({ className }: { className?: string }) {
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
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
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
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
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
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
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
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export interface EnvVarsEditorProps {
  envVars: EnvVar[];
  onEnvVarsChange: (updater: (prev: EnvVar[]) => EnvVar[]) => void;
  disabled?: boolean;
  /**
   * Compact mode reduces spacing for sidebar layouts.
   */
  compact?: boolean;
  /**
   * Show header labels (Key, Value).
   */
  showHeader?: boolean;
  /**
   * Class name for the container.
   */
  className?: string;
}

export function EnvVarsEditor({
  envVars,
  onEnvVarsChange,
  disabled = false,
  compact = false,
  showHeader = true,
  className,
}: EnvVarsEditorProps) {
  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(
    null
  );
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(
    null
  );
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);

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

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
        e.preventDefault();
        const items = parseEnvBlock(text);
        if (items.length > 0) {
          onEnvVarsChange((prev) => {
            const map = new Map(
              prev
                .filter(
                  (r) =>
                    r.name.trim().length > 0 || r.value.trim().length > 0
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
    [onEnvVarsChange]
  );

  const handleAddVariable = useCallback(() => {
    onEnvVarsChange((prev) => [
      ...prev,
      { name: "", value: "", isSecret: true },
    ]);
  }, [onEnvVarsChange]);

  const handleRemoveVariable = useCallback(
    (idx: number) => {
      onEnvVarsChange((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        return next.length > 0 ? next : [{ name: "", value: "", isSecret: true }];
      });
    },
    [onEnvVarsChange]
  );

  const handleKeyChange = useCallback(
    (idx: number, value: string) => {
      onEnvVarsChange((prev) => {
        const next = [...prev];
        const current = next[idx];
        if (current) {
          next[idx] = { ...current, name: value };
        }
        return next;
      });
    },
    [onEnvVarsChange]
  );

  const handleValueChange = useCallback(
    (idx: number, value: string) => {
      onEnvVarsChange((prev) => {
        const next = [...prev];
        const current = next[idx];
        if (current) {
          next[idx] = { ...current, value };
        }
        return next;
      });
    },
    [onEnvVarsChange]
  );

  const inputHeight = compact ? "h-8" : "h-9";
  const buttonSize = compact ? "h-8 w-8" : "h-9 w-[44px]";
  const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";
  const textSize = compact ? "text-xs" : "text-sm";

  return (
    <div className={clsx("space-y-2", className)} onPasteCapture={handlePaste}>
      {showHeader && (
        <div className="flex items-center justify-between pb-1">
          <div
            className={clsx(
              "grid gap-2 text-xs text-neutral-500 dark:text-neutral-500 items-center",
              textSize
            )}
            style={{
              gridTemplateColumns: compact
                ? "minmax(0, 1fr) minmax(0, 1.5fr) 32px"
                : "minmax(0, 1fr) minmax(0, 1.4fr) 44px",
            }}
          >
            <span>Key</span>
            <span>Value</span>
            <span />
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveEnvValueIndex(null);
              setAreEnvValuesHidden((prev) => !prev);
            }}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
              compact ? "text-[10px]" : "text-xs"
            )}
          >
            {areEnvValuesHidden ? (
              <>
                <EyeOffIcon className={clsx(compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
                Reveal
              </>
            ) : (
              <>
                <EyeIcon className={clsx(compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
                Hide
              </>
            )}
          </button>
        </div>
      )}

      <div className={clsx("space-y-2", compact && "space-y-1.5")}>
        {envVars.map((row, idx) => {
          const isEditingValue = activeEnvValueIndex === idx;
          const shouldMaskValue =
            areEnvValuesHidden &&
            row.value.trim().length > 0 &&
            !isEditingValue;

          return (
            <div
              key={idx}
              className="grid gap-2 items-center"
              style={{
                gridTemplateColumns: compact
                  ? "minmax(0, 1fr) minmax(0, 1.5fr) 32px"
                  : "minmax(0, 1fr) minmax(0, 1.4fr) 44px",
              }}
            >
              <input
                type="text"
                value={row.name}
                disabled={disabled}
                ref={(el) => {
                  keyInputRefs.current[idx] = el;
                }}
                onChange={(e) => handleKeyChange(idx, e.target.value)}
                placeholder="EXAMPLE_NAME"
                className={clsx(
                  "w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700",
                  inputHeight,
                  textSize,
                  disabled && "opacity-60 cursor-not-allowed"
                )}
              />
              <input
                type={shouldMaskValue ? "password" : "text"}
                value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                disabled={disabled}
                onChange={
                  shouldMaskValue
                    ? undefined
                    : (e) => handleValueChange(idx, e.target.value)
                }
                onFocus={() => setActiveEnvValueIndex(idx)}
                onBlur={() =>
                  setActiveEnvValueIndex((current) =>
                    current === idx ? null : current
                  )
                }
                readOnly={shouldMaskValue}
                placeholder="value"
                className={clsx(
                  "w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700",
                  inputHeight,
                  textSize,
                  disabled && "opacity-60 cursor-not-allowed"
                )}
              />
              <button
                type="button"
                disabled={disabled || envVars.length <= 1}
                onClick={() => handleRemoveVariable(idx)}
                className={clsx(
                  "rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 grid place-items-center",
                  buttonSize,
                  disabled || envVars.length <= 1
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                )}
                aria-label="Remove variable"
              >
                <MinusIcon className={iconSize} />
              </button>
            </div>
          );
        })}
      </div>

      <div className={clsx(compact ? "pt-1" : "pt-2")}>
        <button
          type="button"
          onClick={handleAddVariable}
          disabled={disabled}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed",
            textSize
          )}
        >
          <PlusIcon className={iconSize} /> Add variable
        </button>
      </div>

      <p
        className={clsx(
          "text-neutral-500 dark:text-neutral-500",
          compact ? "text-[10px] pt-1" : "text-xs pt-2"
        )}
      >
        Tip: Paste a .env file to auto-fill
      </p>
    </div>
  );
}
