"use client";

import { type ReactNode } from "react";
import clsx from "clsx";
import { StepBadge } from "./step-badge";

function ChevronDownIcon({ className }: { className?: string }) {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  /**
   * Whether the section is open by default.
   */
  defaultOpen?: boolean;
  /**
   * Show step badge with step number.
   */
  showStepBadge?: boolean;
  /**
   * Step number (1-indexed).
   */
  stepNumber?: number;
  /**
   * Whether this step is marked as done.
   */
  isDone?: boolean;
  /**
   * Whether the section is compact.
   */
  compact?: boolean;
  /**
   * Optional header accessory (e.g., toggle button).
   */
  headerAccessory?: ReactNode;
  /**
   * Class name for the container.
   */
  className?: string;
  /**
   * Callback when the section is toggled.
   */
  onToggle?: (open: boolean) => void;
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  showStepBadge = false,
  stepNumber = 1,
  isDone = false,
  compact = false,
  headerAccessory,
  className,
  onToggle,
}: CollapsibleSectionProps) {
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

  return (
    <details
      className={clsx("group", className)}
      open={defaultOpen}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary
        className={clsx(
          "flex items-center gap-2 cursor-pointer font-semibold text-neutral-900 dark:text-neutral-100 list-none",
          titleSize
        )}
      >
        <ChevronDownIcon
          className={clsx(
            iconSize,
            "text-neutral-400 transition-transform -rotate-90 group-open:rotate-0"
          )}
        />
        {showStepBadge && <StepBadge step={stepNumber} done={isDone} />}
        <span className="flex-1">{title}</span>
        {headerAccessory && (
          <div
            className="ml-auto flex items-center gap-2"
            onClick={(e) => e.preventDefault()}
          >
            {headerAccessory}
          </div>
        )}
      </summary>
      <div className={contentPadding}>{children}</div>
    </details>
  );
}
