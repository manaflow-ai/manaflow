import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import TextareaAutosize from "react-textarea-autosize";

export function ScriptTextareaField({
  description,
  subtitle,
  value,
  onChange,
  placeholder,
  disabled = false,
  minRows = 3,
  maxRows = 15,
  descriptionClassName,
  subtitleClassName,
  minHeightClassName,
}: {
  description?: ReactNode;
  subtitle?: ReactNode;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
  descriptionClassName?: string;
  subtitleClassName?: string;
  minHeightClassName?: string;
}) {
  return (
    <div className="space-y-2">
      {description ? (
        <p
          className={cn(
            "text-sm text-neutral-600 dark:text-neutral-400",
            descriptionClassName,
          )}
        >
          {description}
        </p>
      ) : null}
      {subtitle ? (
        <p
          className={cn(
            "text-xs text-neutral-500 dark:text-neutral-500",
            subtitleClassName,
          )}
        >
          {subtitle}
        </p>
      ) : null}
      <TextareaAutosize
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        minRows={minRows}
        maxRows={maxRows}
        className={cn(
          "w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-y",
          minHeightClassName,
          disabled && "opacity-80 cursor-not-allowed"
        )}
      />
    </div>
  );
}
