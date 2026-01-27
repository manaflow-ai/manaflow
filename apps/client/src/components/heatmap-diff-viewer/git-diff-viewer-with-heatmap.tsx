// GitDiffViewerWithHeatmap - A GitHub-style diff viewer with heatmap support
// This component wraps the HeatmapDiffViewer and converts ReplaceDiffEntry format

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";
import { cn } from "@/lib/utils";
import type { ReviewHeatmapLine } from "@/lib/heatmap";
import { HeatmapDiffViewer, type HeatmapColorSettings } from "./index";

// ============================================================================
// Types
// ============================================================================

export type GitDiffViewerWithHeatmapProps = {
  /** Array of diff entries to display */
  diffs: ReplaceDiffEntry[];
  /** Optional heatmap data keyed by file path */
  heatmapByFile?: Map<string, ReviewHeatmapLine[]>;
  /** Global heatmap threshold */
  heatmapThreshold?: number;
  /** Custom heatmap colors */
  heatmapColors?: HeatmapColorSettings;
  /** Callback when controls become available */
  onControlsChange?: (controls: DiffViewerControls) => void;
  /** Custom class names */
  classNames?: {
    container?: string;
    fileDiffRow?: {
      button?: string;
      container?: string;
    };
  };
};

export type DiffViewerControls = {
  expandAll: () => void;
  collapseAll: () => void;
  totalAdditions: number;
  totalDeletions: number;
};

type FileCollapsedState = Map<string, boolean>;

// ============================================================================
// Helper Functions
// ============================================================================

type DiffOperation = {
  type: "=" | "-" | "+";
  oldIdx?: number;
  newIdx?: number;
  line: string;
};

const DEFAULT_CONTEXT_LINES = 3;

function computeLineDiff(
  oldLines: string[],
  newLines: string[],
): DiffOperation[] {
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = (dp[i - 1]?.[j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0);
      }
    }
  }

  let i = m;
  let j = n;
  const operations: DiffOperation[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      operations.unshift({
        type: "=",
        oldIdx: i - 1,
        newIdx: j - 1,
        line: oldLines[i - 1] ?? "",
      });
      i -= 1;
      j -= 1;
    } else if (
      j > 0 &&
      (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))
    ) {
      operations.unshift({
        type: "+",
        newIdx: j - 1,
        line: newLines[j - 1] ?? "",
      });
      j -= 1;
    } else if (i > 0) {
      operations.unshift({
        type: "-",
        oldIdx: i - 1,
        line: oldLines[i - 1] ?? "",
      });
      i -= 1;
    }
  }

  return operations;
}

function generateUnifiedHunks(
  operations: DiffOperation[],
  contextLines: number = DEFAULT_CONTEXT_LINES,
): string[] {
  const hunks: string[] = [];
  const changeIndices: number[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    if (operations[index]?.type !== "=") {
      changeIndices.push(index);
    }
  }

  if (changeIndices.length === 0) {
    return [];
  }

  const hunkRanges: Array<{ start: number; end: number }> = [];
  let currentStart = Math.max(0, (changeIndices[0] ?? 0) - contextLines);
  let currentEnd = Math.min(
    operations.length - 1,
    (changeIndices[0] ?? 0) + contextLines,
  );

  for (let index = 1; index < changeIndices.length; index += 1) {
    const changeIdx = changeIndices[index] ?? 0;
    const rangeStart = Math.max(0, changeIdx - contextLines);
    const rangeEnd = Math.min(operations.length - 1, changeIdx + contextLines);

    if (rangeStart <= currentEnd + 1) {
      currentEnd = rangeEnd;
    } else {
      hunkRanges.push({ start: currentStart, end: currentEnd });
      currentStart = rangeStart;
      currentEnd = rangeEnd;
    }
  }
  hunkRanges.push({ start: currentStart, end: currentEnd });

  for (const range of hunkRanges) {
    let oldStart = 1;
    let newStart = 1;

    for (let index = 0; index < range.start; index += 1) {
      const op = operations[index];
      if (op?.type === "=" || op?.type === "-") {
        oldStart += 1;
      }
      if (op?.type === "=" || op?.type === "+") {
        newStart += 1;
      }
    }

    let oldCount = 0;
    let newCount = 0;
    const lines: string[] = [];

    for (let index = range.start; index <= range.end; index += 1) {
      const op = operations[index];
      if (!op) {
        continue;
      }

      if (op.type === "=") {
        lines.push(` ${op.line}`);
        oldCount += 1;
        newCount += 1;
      } else if (op.type === "-") {
        lines.push(`-${op.line}`);
        oldCount += 1;
      } else if (op.type === "+") {
        lines.push(`+${op.line}`);
        newCount += 1;
      }
    }

    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    hunks.push(...lines);
  }

  return hunks;
}

function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function buildUnifiedDiff(entry: ReplaceDiffEntry): string {
  if (entry.patch) {
    return entry.patch;
  }

  const oldContent = entry.oldContent ?? "";
  const newContent = entry.newContent ?? "";
  const oldPath = entry.oldPath ?? entry.filePath;
  const newPath = entry.filePath;

  const header = [
    `diff --git a/${oldPath} b/${newPath}`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
  ];

  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);

  if (oldLines.length === 1 && oldLines[0] === "") {
    oldLines.length = 0;
  }
  if (newLines.length === 1 && newLines[0] === "") {
    newLines.length = 0;
  }

  let hunks: string[] = [];

  if (entry.status === "added" || oldLines.length === 0) {
    if (newLines.length > 0) {
      hunks.push(`@@ -0,0 +1,${newLines.length} @@`);
      for (const line of newLines) {
        hunks.push(`+${line}`);
      }
    }
  } else if (entry.status === "deleted" || newLines.length === 0) {
    if (oldLines.length > 0) {
      hunks.push(`@@ -1,${oldLines.length} +0,0 @@`);
      for (const line of oldLines) {
        hunks.push(`-${line}`);
      }
    }
  } else {
    const operations = computeLineDiff(oldLines, newLines);
    hunks = generateUnifiedHunks(operations, DEFAULT_CONTEXT_LINES);
    if (hunks.length === 0) {
      return "";
    }
  }

  return [...header, ...hunks].join("\n");
}

function mapStatusToHeatmapStatus(
  status: ReplaceDiffEntry["status"]
): "added" | "removed" | "modified" | "renamed" | "copied" | "changed" {
  switch (status) {
    case "added":
      return "added";
    case "deleted":
      return "removed";
    case "modified":
      return "modified";
    case "renamed":
      return "renamed";
    default:
      return "changed";
  }
}

// ============================================================================
// Component
// ============================================================================

export const GitDiffViewerWithHeatmap = memo(
  function GitDiffViewerWithHeatmapComponent({
    diffs,
    heatmapByFile,
    heatmapThreshold = 0,
    heatmapColors,
    onControlsChange,
    classNames,
  }: GitDiffViewerWithHeatmapProps) {
    const [collapsedState, setCollapsedState] = useState<FileCollapsedState>(
      () => new Map()
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const filePathSetRef = useRef<Set<string>>(
      new Set(diffs.map((diff) => diff.filePath))
    );

    useEffect(() => {
      const nextPaths = new Set(diffs.map((diff) => diff.filePath));
      if (!areStringSetsEqual(filePathSetRef.current, nextPaths)) {
        filePathSetRef.current = nextPaths;
        setCollapsedState(new Map());
      }
    }, [diffs]);

    // Calculate totals
    const { totalAdditions, totalDeletions } = useMemo(() => {
      let additions = 0;
      let deletions = 0;
      for (const diff of diffs) {
        additions += diff.additions ?? 0;
        deletions += diff.deletions ?? 0;
      }
      return { totalAdditions: additions, totalDeletions: deletions };
    }, [diffs]);

    // Build controls and notify parent
    const controls = useMemo<DiffViewerControls>(() => {
      return {
        expandAll: () => {
          setCollapsedState((prev) => {
            const next = new Map(prev);
            for (const diff of diffs) {
              next.set(diff.filePath, false);
            }
            return next;
          });
        },
        collapseAll: () => {
          setCollapsedState((prev) => {
            const next = new Map(prev);
            for (const diff of diffs) {
              next.set(diff.filePath, true);
            }
            return next;
          });
        },
        totalAdditions,
        totalDeletions,
      };
    }, [diffs, totalAdditions, totalDeletions]);

    useEffect(() => {
      onControlsChange?.(controls);
    }, [controls, onControlsChange]);

    const handleCollapseChange = useCallback(
      (filePath: string, collapsed: boolean) => {
        setCollapsedState((prev) => {
          const next = new Map(prev);
          next.set(filePath, collapsed);
          return next;
        });
      },
      []
    );

    // Convert diffs to unified format
    const fileEntries = useMemo(() => {
      return diffs.map((diff) => {
        const diffText = buildUnifiedDiff(diff);
        const heatmap = heatmapByFile?.get(diff.filePath) ?? [];

        return {
          key: diff.filePath,
          diffText,
          filename: diff.filePath,
          status: mapStatusToHeatmapStatus(diff.status),
          additions: diff.additions ?? 0,
          deletions: diff.deletions ?? 0,
          heatmap,
          isBinary: diff.isBinary ?? false,
          contentOmitted: diff.contentOmitted ?? false,
        };
      });
    }, [diffs, heatmapByFile]);

    if (diffs.length === 0) {
      return (
        <div className="flex items-center justify-center h-full p-6">
          <div className="text-neutral-500 dark:text-neutral-400 text-sm select-none">
            No changes to display
          </div>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className={cn(
          "flex flex-col gap-2 p-3.5 pb-28",
          classNames?.container
        )}
      >
        {fileEntries.map((entry) => {
          const isCollapsed = collapsedState.get(entry.key) ?? false;

          // Handle binary or omitted content
          if (entry.isBinary || entry.contentOmitted) {
            return (
              <article
                key={entry.key}
                className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-lg overflow-hidden"
              >
                <div className="px-3.5 py-2.5 text-sm text-neutral-600 dark:text-neutral-400">
                  {entry.isBinary
                    ? `Binary file: ${entry.filename}`
                    : `Content omitted: ${entry.filename}`}
                </div>
              </article>
            );
          }

          return (
            <HeatmapDiffViewer
              key={entry.key}
              diffText={entry.diffText}
              filename={entry.filename}
              status={entry.status}
              additions={entry.additions}
              deletions={entry.deletions}
              reviewHeatmap={entry.heatmap}
              heatmapThreshold={heatmapThreshold}
              heatmapColors={heatmapColors}
              defaultCollapsed={isCollapsed}
              onCollapseChange={(collapsed) =>
                handleCollapseChange(entry.key, collapsed)
              }
              className="rounded-lg overflow-hidden"
            />
          );
        })}

        {/* Cute kitty ASCII art at the end, similar to Monaco viewer */}
        <div className="mt-8 mb-4 flex justify-center">
          <pre className="text-neutral-300 dark:text-neutral-700 text-[10px] leading-tight font-mono select-none whitespace-pre">
            {`
    /\\_____/\\
   /  o   o  \\
  ( ==  ^  == )
   )         (
  (           )
 ( (  )   (  ) )
(__(__)___(__)__)
            `.trim()}
          </pre>
        </div>
      </div>
    );
  }
);
