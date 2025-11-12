import { useMemo, useState } from "react";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";
import { parseDiff } from "./utils";
import { Diff, Hunk } from "./diff";
import { FileDiffHeader } from "../file-diff-header";
import { cn } from "@/lib/utils";
import { kitties } from "../kitties";

export interface ShadcnGitDiffViewerProps {
  diffs: ReplaceDiffEntry[];
  onControlsChange?: (args: {
    expandAll: () => void;
    collapseAll: () => void;
    totalAdditions: number;
    totalDeletions: number;
  }) => void;
  classNames?: {
    fileDiffRow?: {
      button?: string;
      container?: string;
    };
  };
  onFileToggle?: (filePath: string, isExpanded: boolean) => void;
}

function generateUnifiedDiff(diff: ReplaceDiffEntry): string {
  if (!diff.patch) {
    // Generate a simple diff from old/new content
    const oldLines = (diff.oldContent || "").split("\n");
    const newLines = (diff.newContent || "").split("\n");

    let result = `--- a/${diff.oldPath || diff.filePath}\n`;
    result += `+++ b/${diff.filePath}\n`;
    result += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

    // Simple line-by-line diff
    const maxLength = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLength; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine !== undefined && newLine === undefined) {
        result += `-${oldLine}\n`;
      } else if (oldLine === undefined && newLine !== undefined) {
        result += `+${newLine}\n`;
      } else if (oldLine !== newLine) {
        if (oldLine !== undefined) result += `-${oldLine}\n`;
        if (newLine !== undefined) result += `+${newLine}\n`;
      } else {
        result += ` ${oldLine}\n`;
      }
    }

    return result;
  }

  return diff.patch;
}

export function ShadcnGitDiffViewer({
  diffs,
  onControlsChange,
  classNames,
  onFileToggle,
}: ShadcnGitDiffViewerProps) {
  const kitty = useMemo(() => {
    return kitties[Math.floor(Math.random() * kitties.length)];
  }, []);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(diffs.map((diff) => diff.filePath)),
  );

  const parsedDiffs = useMemo(() => {
    return diffs.map((diff) => {
      const unifiedDiff = generateUnifiedDiff(diff);
      const files = parseDiff(unifiedDiff);
      return {
        original: diff,
        parsed: files[0] || null,
      };
    });
  }, [diffs]);

  const expandAll = () => {
    setExpandedFiles(new Set(diffs.map((f) => f.filePath)));
  };

  const collapseAll = () => {
    setExpandedFiles(new Set());
  };

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      const wasExpanded = next.has(filePath);
      if (wasExpanded) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      try {
        onFileToggle?.(filePath, !wasExpanded);
      } catch {
        // ignore
      }
      return next;
    });
  };

  const totalAdditions = diffs.reduce((sum, diff) => sum + diff.additions, 0);
  const totalDeletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0);

  useMemo(() => {
    onControlsChange?.({
      expandAll,
      collapseAll,
      totalAdditions,
      totalDeletions,
    });
  }, [totalAdditions, totalDeletions, diffs.length]);

  return (
    <div className="grow bg-white dark:bg-neutral-900">
      <div className="flex flex-col -space-y-[2px]">
        {parsedDiffs.map(({ original, parsed }, index) => {
          const isExpanded = expandedFiles.has(original.filePath);
          const canRenderDiff =
            !original.isBinary &&
            !original.contentOmitted &&
            original.status !== "deleted" &&
            original.status !== "renamed" &&
            parsed &&
            parsed.hunks.length > 0;

          return (
            <div
              key={original.filePath}
              className={cn(
                "bg-white dark:bg-neutral-900",
                classNames?.fileDiffRow?.container,
              )}
            >
              <FileDiffHeader
                filePath={original.filePath}
                oldPath={original.oldPath}
                status={original.status}
                additions={original.additions}
                deletions={original.deletions}
                isExpanded={isExpanded}
                onToggle={() => toggleFile(original.filePath)}
                className={cn(
                  classNames?.fileDiffRow?.button,
                  index === 0 && "!border-t-0",
                )}
              />

              {isExpanded && (
                <div className="border-b border-neutral-200 dark:border-neutral-800">
                  {original.status === "renamed" ? (
                    <div className="space-y-2 bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-400 grid place-content-center">
                      <p className="select-none">File was renamed.</p>
                      {original.oldPath ? (
                        <p className="select-none font-mono text-[11px] text-neutral-600 dark:text-neutral-300">
                          {original.oldPath} → {original.filePath}
                        </p>
                      ) : null}
                    </div>
                  ) : original.isBinary ? (
                    <div className="bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-400 grid place-content-center">
                      Binary file not shown
                    </div>
                  ) : original.status === "deleted" ? (
                    <div className="bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-400 grid place-content-center">
                      File was deleted
                    </div>
                  ) : original.contentOmitted ? (
                    <div className="bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-400 grid place-content-center">
                      Diff content omitted due to size
                    </div>
                  ) : canRenderDiff ? (
                    <Diff hunks={parsed.hunks}>
                      {parsed.hunks.map((hunk) => (
                        <Hunk key={hunk.id} hunk={hunk} />
                      ))}
                    </Diff>
                  ) : (
                    <div className="bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-400 grid place-content-center">
                      No changes to display
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <hr className="border-neutral-200 dark:border-neutral-800" />
        <div className="px-3 py-6 text-center">
          <span className="select-none text-xs text-neutral-500 dark:text-neutral-400">
            You've reached the end of the diff!
          </span>
          <div className="grid place-content-center">
            <pre className="mt-2 pb-20 select-none text-left text-[8px] font-mono text-neutral-500 dark:text-neutral-400">
              {kitty}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
