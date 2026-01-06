import { cn } from "@/lib/utils";
import { Code, Sparkles } from "lucide-react";

export type DiffViewMode = "diff" | "ai-review";

interface DiffViewToggleProps {
  value: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
  disabled?: boolean;
  className?: string;
}

export function DiffViewToggle({
  value,
  onChange,
  disabled = false,
  className,
}: DiffViewToggleProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800 p-0.5",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
      role="tablist"
      aria-label="Diff view mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "diff"}
        onClick={() => onChange("diff")}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all select-none",
          value === "diff"
            ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
            : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
        )}
      >
        <Code className="size-3" aria-hidden />
        <span>Diff</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "ai-review"}
        onClick={() => onChange("ai-review")}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all select-none",
          value === "ai-review"
            ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
            : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
        )}
      >
        <Sparkles className="size-3" aria-hidden />
        <span>AI Review</span>
      </button>
    </div>
  );
}
