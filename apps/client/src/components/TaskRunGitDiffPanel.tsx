import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useQuery } from "convex/react";
import { MonacoGitDiffViewer } from "./monaco/monaco-git-diff-viewer";
import { RunScreenshotGallery } from "./RunScreenshotGallery";
import { useCombinedWorkflowData, WorkflowRunsSection } from "./WorkflowRunsSection";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import type { TaskRunWithChildren } from "@/types/task";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { api } from "@cmux/convex/api";

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
  teamSlugOrId: string;
  taskId: Id<"tasks">;
  selectedRunId: Id<"taskRuns"> | null | undefined;
}

export function TaskRunGitDiffPanel({ task, selectedRun, teamSlugOrId, taskId, selectedRunId }: TaskRunGitDiffPanelProps) {
  const normalizedBaseBranch = useMemo(() => {
    const candidate = task?.baseBranch;
    if (candidate && candidate.trim()) {
      return normalizeGitRef(candidate);
    }
    return normalizeGitRef("main");
  }, [task?.baseBranch]);

  const normalizedHeadBranch = useMemo(
    () => normalizeGitRef(selectedRun?.newBranch),
    [selectedRun?.newBranch],
  );

  const environmentRepos = useMemo<string[]>(() => {
    const repos = selectedRun?.environment?.selectedRepos ?? [];
    const trimmed = repos
      .map((repo: string | undefined) => repo?.trim())
      .filter((repo): repo is string => Boolean(repo));
    return Array.from(new Set(trimmed));
  }, [selectedRun]);

  const repoFullNames = useMemo(() => {
    const names = new Set<string>();
    if (task?.projectFullName?.trim()) {
      names.add(task.projectFullName.trim());
    }
    for (const repo of environmentRepos) {
      names.add(repo);
    }
    return Array.from(names);
  }, [task?.projectFullName, environmentRepos]);

  const diffQueries = useQueries({
    queries: repoFullNames.map((repoFullName) => ({
      ...gitDiffQueryOptions({
        repoFullName,
        baseRef: normalizedBaseBranch || undefined,
        headRef: normalizedHeadBranch ?? "",
      }),
      enabled:
        Boolean(repoFullName?.trim()) && Boolean(normalizedHeadBranch?.trim()),
    })),
  });

  const allDiffs = useMemo(() => {
    return diffQueries.flatMap((query) => query.data ?? []);
  }, [diffQueries]);

  const isLoading = diffQueries.some((query) => query.isLoading);
  const hasError = diffQueries.some((query) => query.isError);

  // Fetch screenshot sets for the selected run
  const runDiffContext = useQuery(
    api.taskRuns.getRunDiffContext,
    selectedRunId && teamSlugOrId && taskId
      ? { teamSlugOrId, taskId, runId: selectedRunId }
      : "skip"
  );

  const screenshotSets = runDiffContext?.screenshotSets ?? [];
  const screenshotSetsLoading = runDiffContext === undefined && screenshotSets.length === 0;

  // PR info for workflow runs/checks display
  const prInfo = runDiffContext?.prInfo;

  // Fetch workflow data if this run has an associated PR
  const workflowData = useCombinedWorkflowData({
    teamSlugOrId,
    repoFullName: prInfo?.repoFullName || "",
    prNumber: prInfo?.prNumber || 0,
  });

  // Only show workflow section if we have PR info
  const hasWorkflowData = Boolean(prInfo && prInfo.prNumber > 0);

  // Track expanded state for workflow checks - auto-expand if any check failed
  const hasAnyFailure = useMemo(() => {
    return workflowData.allRuns.some(
      (run) => run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "action_required"
    );
  }, [workflowData.allRuns]);

  const [checksExpandedOverride, setChecksExpandedOverride] = useState<boolean | null>(null);
  const checksExpanded = checksExpandedOverride !== null ? checksExpandedOverride : hasAnyFailure;

  const handleToggleChecks = () => {
    setChecksExpandedOverride(!checksExpanded);
  };

  if (!selectedRun || !normalizedHeadBranch) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a run to view git diffs
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Loading diffs...
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Failed to load diffs
      </div>
    );
  }

  if (allDiffs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No changes found
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-auto">
      {screenshotSetsLoading ? (
        <div className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 px-3.5 py-3 text-sm text-neutral-500 dark:text-neutral-400">
          Loading screenshots...
        </div>
      ) : (
        <RunScreenshotGallery
          screenshotSets={screenshotSets}
          highlightedSetId={selectedRun?.latestScreenshotSetId ?? null}
        />
      )}
      {hasWorkflowData && (
        <WorkflowRunsSection
          allRuns={workflowData.allRuns}
          isLoading={workflowData.isLoading}
          isExpanded={checksExpanded}
          onToggle={handleToggleChecks}
        />
      )}
      <MonacoGitDiffViewer diffs={allDiffs} />
    </div>
  );
}
