import { gitDiffQueryOptions } from "@/queries/git-diff";
import { useQueries } from "@tanstack/react-query";
import { useMemo, useRef, type ComponentProps } from "react";
import { GitDiffViewer, GitDiffViewerWithHeatmap } from "./git-diff-viewer";
import type { HeatmapColorSettings } from "@/components/heatmap-diff-viewer";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";
import type { ReviewHeatmapLine } from "@/lib/heatmap";

export interface RunDiffSectionProps {
  repoFullName: string;
  ref1: string;
  ref2: string;
  classNames?: ComponentProps<typeof GitDiffViewer>["classNames"];
  onControlsChange?: ComponentProps<typeof GitDiffViewer>["onControlsChange"];
  additionalRepoFullNames?: string[];
  withRepoPrefix?: boolean;
  metadataByRepo?: Record<
    string,
    {
      lastKnownBaseSha?: string;
      lastKnownMergeCommitSha?: string;
    }
  >;
  /** Use the heatmap-enabled diff viewer (GitHub style) */
  useHeatmapViewer?: boolean;
  /** Heatmap data keyed by file path */
  heatmapByFile?: Map<string, ReviewHeatmapLine[]>;
  /** Heatmap threshold for filtering entries (0-1) */
  heatmapThreshold?: number;
  /** Custom heatmap colors */
  heatmapColors?: HeatmapColorSettings;
}

function applyRepoPrefix(
  entry: ReplaceDiffEntry,
  prefix: string | null,
): ReplaceDiffEntry {
  if (!prefix) {
    return entry;
  }
  const normalizedPrefix = prefix.endsWith(":") ? prefix : `${prefix}:`;
  return {
    ...entry,
    filePath: `${normalizedPrefix}${entry.filePath}`,
    oldPath: entry.oldPath
      ? `${normalizedPrefix}${entry.oldPath}`
      : entry.oldPath,
  };
}

export function RunDiffSection(props: RunDiffSectionProps) {
  const {
    repoFullName,
    ref1,
    ref2,
    classNames,
    onControlsChange,
    additionalRepoFullNames,
    withRepoPrefix,
    metadataByRepo,
    useHeatmapViewer = true, // Default to heatmap viewer
    heatmapByFile,
    heatmapThreshold,
    heatmapColors,
  } = props;

  const repoFullNames = useMemo(() => {
    const unique = new Set<string>();
    if (repoFullName?.trim()) {
      unique.add(repoFullName.trim());
    }
    additionalRepoFullNames
      ?.map((name) => name?.trim())
      .filter((name): name is string => Boolean(name))
      .forEach((name) => unique.add(name));
    return Array.from(unique);
  }, [repoFullName, additionalRepoFullNames]);

  const canFetch = repoFullNames.length > 0 && Boolean(ref1) && Boolean(ref2);

  const queries = useQueries({
    queries: repoFullNames.map((repo) => ({
      ...gitDiffQueryOptions({
        repoFullName: repo,
        baseRef: ref1,
        headRef: ref2,
        lastKnownBaseSha: metadataByRepo?.[repo]?.lastKnownBaseSha,
        lastKnownMergeCommitSha:
          metadataByRepo?.[repo]?.lastKnownMergeCommitSha,
      }),
      enabled: canFetch,
    })),
  });

  // IMPORTANT: Refs must be declared before any early returns (React hooks rule)
  // These refs maintain stable combinedDiffs reference to prevent infinite loops
  const combinedDiffsRef = useRef<ReplaceDiffEntry[]>([]);
  const prevDepsRef = useRef<{
    queryData: Array<ReplaceDiffEntry[] | undefined>;
    repoFullNames: string[];
    shouldPrefix: boolean;
  }>({ queryData: [], repoFullNames: [], shouldPrefix: false });

  const isPending = queries.some(
    (query) => query.isPending || query.isFetching,
  );
  const firstError = queries.find((query) => query.isError);

  if (!canFetch) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-500 dark:text-neutral-400 text-sm select-none">
          Missing repository or branch information for diff.
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-500 dark:text-neutral-400 text-sm select-none">
          Loading diffs...
        </div>
      </div>
    );
  }

  if (firstError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500 dark:text-red-400 text-sm select-none">
          Failed to load diffs.
          <pre>{JSON.stringify(firstError.error)}</pre>
        </div>
      </div>
    );
  }

  const shouldPrefix = withRepoPrefix ?? repoFullNames.length > 1;

  // Check if any dependencies have actually changed
  const currentQueryData = queries.map((q) => q.data);
  const depsChanged =
    currentQueryData.length !== prevDepsRef.current.queryData.length ||
    currentQueryData.some((data, i) => data !== prevDepsRef.current.queryData[i]) ||
    repoFullNames.length !== prevDepsRef.current.repoFullNames.length ||
    repoFullNames.some((name, i) => name !== prevDepsRef.current.repoFullNames[i]) ||
    shouldPrefix !== prevDepsRef.current.shouldPrefix;

  if (depsChanged) {
    prevDepsRef.current = {
      queryData: currentQueryData,
      repoFullNames: [...repoFullNames],
      shouldPrefix,
    };
    combinedDiffsRef.current = repoFullNames.flatMap((repo, index) => {
      const data = queries[index]?.data ?? [];
      const prefix = shouldPrefix ? `${repo}:` : null;
      return data.map((entry) => applyRepoPrefix(entry, prefix));
    });
  }

  const combinedDiffs = combinedDiffsRef.current;

  if (combinedDiffs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-500 dark:text-neutral-400 text-sm select-none">
          No changes to display
        </div>
      </div>
    );
  }

  if (useHeatmapViewer) {
    return (
      <GitDiffViewerWithHeatmap
        key={`heatmap:${repoFullNames.join("|")}:${ref1}:${ref2}`}
        diffs={combinedDiffs}
        heatmapByFile={heatmapByFile}
        heatmapThreshold={heatmapThreshold}
        heatmapColors={heatmapColors}
        onControlsChange={onControlsChange}
        classNames={classNames}
      />
    );
  }

  return (
    <GitDiffViewer
      key={`${repoFullNames.join("|")}:${ref1}:${ref2}`}
      diffs={combinedDiffs}
      onControlsChange={onControlsChange}
      classNames={classNames}
    />
  );
}
