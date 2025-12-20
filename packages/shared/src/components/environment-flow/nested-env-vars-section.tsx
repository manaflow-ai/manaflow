import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import type { EnvVar, EnvVarGroup } from "../../environment-flow/types";
import { parseEnvBlock, looksLikeEnvContent } from "../../environment-flow/parse-env-block";

const MASKED_ENV_VALUE = "••••••••••••••••";

interface NestedEnvVarsSectionProps {
  /** Current env var groups */
  envVarGroups: EnvVarGroup[];
  /** Callback when env var groups change */
  onEnvVarGroupsChange: (groups: EnvVarGroup[]) => void;
  /** Whether env values are hidden */
  areValuesHidden?: boolean;
  /** Callback to toggle hidden state */
  onToggleHidden?: () => void;
  /** Whether this section is disabled */
  disabled?: boolean;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** CSS class name */
  className?: string;
  /** Icon components */
  icons?: {
    ChevronDown?: ReactNode;
    ChevronRight?: ReactNode;
    Eye?: ReactNode;
    EyeOff?: ReactNode;
    Plus?: ReactNode;
    Minus?: ReactNode;
    FolderPlus?: ReactNode;
  };
}

function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function EnvVarGroupComponent({
  group,
  onGroupChange,
  onDelete,
  areValuesHidden,
  disabled,
  icons,
}: {
  group: EnvVarGroup;
  onGroupChange: (updated: EnvVarGroup) => void;
  onDelete: () => void;
  areValuesHidden: boolean;
  disabled: boolean;
  icons?: NestedEnvVarsSectionProps["icons"];
}) {
  const [activeValueIndex, setActiveValueIndex] = useState<number | null>(null);
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (pendingFocusIndex !== null) {
      const el = keyInputRefs.current[pendingFocusIndex];
      if (el) {
        setTimeout(() => {
          el.focus();
        }, 0);
        setPendingFocusIndex(null);
      }
    }
  }, [pendingFocusIndex, group.vars]);

  const updateVars = useCallback(
    (updater: (prev: EnvVar[]) => EnvVar[]) => {
      onGroupChange({ ...group, vars: updater(group.vars) });
    },
    [group, onGroupChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (text && looksLikeEnvContent(text)) {
        e.preventDefault();
        const items = parseEnvBlock(text);
        if (items.length > 0) {
          updateVars((prev) => {
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
    [updateVars]
  );

  const canDelete = group.vars.length === 0 ||
    (group.vars.length === 1 && !group.vars[0]?.name.trim() && !group.vars[0]?.value.trim());

  return (
    <details
      className="group border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden"
      open={group.isExpanded}
      onToggle={(e) => {
        onGroupChange({ ...group, isExpanded: (e.target as HTMLDetailsElement).open });
      }}
    >
      <summary className="flex items-center gap-2 px-3 py-2.5 bg-neutral-50 dark:bg-neutral-900/50 cursor-pointer list-none">
        {icons?.ChevronRight ?? (
          <span className="text-neutral-400 text-xs transition-transform -rotate-90 group-open:rotate-0">▼</span>
        )}
        <input
          type="text"
          value={group.label}
          onChange={(e) => onGroupChange({ ...group, label: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          disabled={disabled}
          placeholder="Group name..."
          className="flex-1 bg-transparent text-sm font-medium text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
        />
        <span className="text-xs text-neutral-400">
          {group.vars.filter((v) => v.name.trim()).length} vars
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
            aria-label="Delete group"
          >
            {icons?.Minus ?? <span className="text-sm">×</span>}
          </button>
        )}
      </summary>

      <div className="p-3 space-y-2" onPasteCapture={handlePaste}>
        {group.description && (
          <p className="text-xs text-neutral-500 mb-2">{group.description}</p>
        )}

        {/* Header row */}
        <div
          className="grid gap-2 text-xs text-neutral-500 items-center"
          style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 32px" }}
        >
          <span>Name</span>
          <span>Value</span>
          <span />
        </div>

        {/* Env var rows */}
        {group.vars.map((row, idx) => {
          const isEditingValue = activeValueIndex === idx;
          const shouldMaskValue = areValuesHidden && row.value.trim().length > 0 && !isEditingValue;
          return (
            <div
              key={idx}
              className="grid gap-2 items-center"
              style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 32px" }}
            >
              <input
                type="text"
                value={row.name}
                disabled={disabled}
                ref={(el) => { keyInputRefs.current[idx] = el; }}
                onChange={(e) => {
                  updateVars((prev) => {
                    const next = [...prev];
                    if (next[idx]) next[idx] = { ...next[idx], name: e.target.value };
                    return next;
                  });
                }}
                placeholder="EXAMPLE_NAME"
                className="w-full min-w-0 h-8 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:focus:ring-neutral-600 disabled:opacity-60"
              />
              <input
                type={shouldMaskValue ? "password" : "text"}
                value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                disabled={disabled}
                onChange={shouldMaskValue ? undefined : (e) => {
                  updateVars((prev) => {
                    const next = [...prev];
                    if (next[idx]) next[idx] = { ...next[idx], value: e.target.value };
                    return next;
                  });
                }}
                onFocus={() => setActiveValueIndex(idx)}
                onBlur={() => setActiveValueIndex((c) => (c === idx ? null : c))}
                readOnly={shouldMaskValue}
                placeholder="value"
                className="w-full min-w-0 h-8 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:focus:ring-neutral-600 disabled:opacity-60"
              />
              <button
                type="button"
                disabled={disabled || group.vars.length <= 1}
                onClick={() => {
                  updateVars((prev) => {
                    const next = prev.filter((_, i) => i !== idx);
                    return next.length > 0 ? next : [{ name: "", value: "", isSecret: true }];
                  });
                }}
                className={clsx(
                  "h-8 w-8 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-500 grid place-items-center",
                  disabled || group.vars.length <= 1
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                )}
                aria-label="Remove variable"
              >
                {icons?.Minus ?? <span className="text-xs">−</span>}
              </button>
            </div>
          );
        })}

        {/* Add variable button */}
        <button
          type="button"
          onClick={() => {
            updateVars((prev) => [...prev, { name: "", value: "", isSecret: true }]);
          }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 h-8 px-2 rounded border border-dashed border-neutral-300 dark:border-neutral-700 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition disabled:opacity-60"
        >
          {icons?.Plus ?? <span>+</span>} Add variable
        </button>
      </div>
    </details>
  );
}

/**
 * Nested environment variables section
 * Supports multiple groups of env vars for better organization
 */
export function NestedEnvVarsSection({
  envVarGroups,
  onEnvVarGroupsChange,
  areValuesHidden: controlledHidden,
  onToggleHidden,
  disabled = false,
  compact = false,
  className,
  icons,
}: NestedEnvVarsSectionProps) {
  const [internalHidden, setInternalHidden] = useState(true);
  const areValuesHidden = controlledHidden ?? internalHidden;
  const toggleHidden = onToggleHidden ?? (() => setInternalHidden((prev) => !prev));

  const addGroup = useCallback(() => {
    onEnvVarGroupsChange([
      ...envVarGroups,
      {
        id: generateGroupId(),
        label: `Group ${envVarGroups.length + 1}`,
        vars: [{ name: "", value: "", isSecret: true }],
        isExpanded: true,
      },
    ]);
  }, [envVarGroups, onEnvVarGroupsChange]);

  const updateGroup = useCallback(
    (groupId: string, updated: EnvVarGroup) => {
      onEnvVarGroupsChange(
        envVarGroups.map((g) => (g.id === groupId ? updated : g))
      );
    },
    [envVarGroups, onEnvVarGroupsChange]
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      const filtered = envVarGroups.filter((g) => g.id !== groupId);
      // Ensure at least one group exists
      if (filtered.length === 0) {
        onEnvVarGroupsChange([
          {
            id: generateGroupId(),
            label: "Environment Variables",
            vars: [{ name: "", value: "", isSecret: true }],
            isExpanded: true,
          },
        ]);
      } else {
        onEnvVarGroupsChange(filtered);
      }
    },
    [envVarGroups, onEnvVarGroupsChange]
  );

  const titleSize = compact ? "text-[13px]" : "text-base";

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={clsx("font-semibold text-neutral-900 dark:text-neutral-100", titleSize)}>
          Environment Variables
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              toggleHidden();
            }}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
            aria-label={areValuesHidden ? "Reveal values" : "Hide values"}
          >
            {areValuesHidden ? (icons?.EyeOff ?? "🙈") : (icons?.Eye ?? "👁")}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {envVarGroups.map((group) => (
          <EnvVarGroupComponent
            key={group.id}
            group={group}
            onGroupChange={(updated) => updateGroup(group.id, updated)}
            onDelete={() => deleteGroup(group.id)}
            areValuesHidden={areValuesHidden}
            disabled={disabled}
            icons={icons}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={addGroup}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition disabled:opacity-60"
        >
          {icons?.FolderPlus ?? <span>📁+</span>} Add Group
        </button>
      </div>

      <p className="text-xs text-neutral-400 mt-3">
        Tip: Use groups to organize env vars by purpose (Database, API Keys, etc.)
      </p>
    </div>
  );
}

export default NestedEnvVarsSection;
