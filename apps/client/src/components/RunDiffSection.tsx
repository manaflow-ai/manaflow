import { gitDiffQueryOptions } from "@/queries/git-diff";
import { useQueries } from "@tanstack/react-query";
import { useMemo, type ComponentProps } from "react";
import { GitDiffViewer } from "./git-diff-viewer";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

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
  /** Team slug or ID for web mode API calls */
  teamSlugOrId?: string;
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
    teamSlugOrId,
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
        teamSlugOrId,
      }),
      enabled: canFetch,
    })),
  });

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

  const combinedDiffs = repoFullNames.flatMap((repo, index) => {
    const data = queries[index]?.data ?? [];
    const prefix = shouldPrefix ? `${repo}:` : null;
    return data.map((entry) => applyRepoPrefix(entry, prefix));
  });

  if (combinedDiffs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-500 dark:text-neutral-400 text-sm select-none">
          No changes to display
        </div>
      </div>
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
