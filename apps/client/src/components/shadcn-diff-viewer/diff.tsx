import { cn } from "@/lib/utils";
import type { Hunk } from "./utils";

export interface DiffProps {
  hunks: Hunk[];
  children?: React.ReactNode;
  className?: string;
}

export function Diff({ hunks, children, className }: DiffProps) {
  return (
    <div className={cn("border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden", className)}>
      {children || hunks.map((hunk) => <HunkComponent key={hunk.id} hunk={hunk} />)}
    </div>
  );
}

export interface HunkProps {
  hunk: Hunk;
}

export function Hunk({ hunk }: HunkProps) {
  return <HunkComponent hunk={hunk} />;
}

function HunkComponent({ hunk }: HunkProps) {
  return (
    <div className="font-mono text-xs">
      <div className="bg-neutral-100 dark:bg-neutral-900 px-3 py-1 text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      <div>
        {hunk.changes.map((change, index) => {
          const bgColor =
            change.type === "add"
              ? "bg-green-50 dark:bg-green-950/30"
              : change.type === "delete"
                ? "bg-red-50 dark:bg-red-950/30"
                : "bg-white dark:bg-neutral-950";

          const textColor =
            change.type === "add"
              ? "text-green-700 dark:text-green-400"
              : change.type === "delete"
                ? "text-red-700 dark:text-red-400"
                : "text-neutral-700 dark:text-neutral-300";

          const prefix =
            change.type === "add" ? "+" : change.type === "delete" ? "-" : " ";

          return (
            <div
              key={`${hunk.id}-${index}`}
              className={cn(
                "px-3 py-0.5 flex gap-3",
                bgColor,
                textColor,
              )}
            >
              <span className="opacity-50 select-none w-4 text-right shrink-0">
                {change.type === "delete" || change.type === "normal" ? change.oldLineNumber : ""}
              </span>
              <span className="opacity-50 select-none w-4 text-right shrink-0">
                {change.type === "add" || change.type === "normal" ? change.newLineNumber : ""}
              </span>
              <span className="select-none shrink-0 w-3">{prefix}</span>
              <span className="whitespace-pre-wrap break-all">
                {change.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface LinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

export function Link({ href, children, className }: LinkProps) {
  return (
    <a
      href={href}
      className={cn(
        "text-blue-600 dark:text-blue-400 hover:underline",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
