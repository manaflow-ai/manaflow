import { RunDiffSection } from "@/components/RunDiffSection";
import { Dropdown } from "@/components/ui/dropdown";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { api } from "@cmux/convex/api";
import { useQuery as useRQ, useMutation } from "@tanstack/react-query";
import { useQuery as useConvexQuery } from "convex/react";
import { ExternalLink, X, Check, Copy, GitBranch, Loader2 } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useClipboard } from "@mantine/hooks";
import clsx from "clsx";
import { MergeButton, type MergeMethod } from "@/components/ui/merge-button";
import { postApiIntegrationsGithubPrsCloseMutation, postApiIntegrationsGithubPrsMergeSimpleMutation } from "@cmux/www-openapi-client/react-query";
import type { PostApiIntegrationsGithubPrsCloseData, PostApiIntegrationsGithubPrsCloseResponse, PostApiIntegrationsGithubPrsMergeSimpleData, PostApiIntegrationsGithubPrsMergeSimpleResponse, Options } from "@cmux/www-openapi-client";
import { useCombinedWorkflowData, WorkflowRunsBadge, WorkflowRunsSection } from "@/components/WorkflowRunsSection";

const RUN_PENDING_STATUSES = new Set(["in_progress", "queued", "waiting", "pending"]);
const RUN_PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const PR_SYNC_GRACE_MS = 1500;
const PR_FINAL_NOT_FOUND_DELAY_MS = 10000;

type PullRequestDetailViewProps = {
  teamSlugOrId: string;
  owner: string;
  repo: string;
  number: string;
};

type DiffControls = {
  expandAll: () => void;
  collapseAll: () => void;
  totalAdditions: number;
  totalDeletions: number;
  expandChecks?: () => void;
  collapseChecks?: () => void;
};

type AdditionsAndDeletionsProps = {
  repoFullName: string;
  ref1: string;
  ref2: string;
};

function PullRequestLoadingState() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-neutral-500 dark:text-neutral-400 text-center">
        <Loader2 className="w-5 h-5 animate-spin" />
        <div className="text-sm font-medium">Loading pull request...</div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Hang tight while we fetch the latest data from GitHub.
        </p>
      </div>
    </div>
  );
}

function PullRequestUnavailableState({ variant }: { variant: "syncing" | "missing" }) {
  const isMissing = variant === "missing";
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-neutral-500 dark:text-neutral-400 text-center">
        {isMissing ? (
          <X className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
        ) : (
          <GitBranch className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
        )}
        <div className="text-sm font-medium">
          {isMissing ? "We couldn't find this pull request" : "Still syncing this PR..."}
        </div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {isMissing
            ? "Double-check the link or refresh; GitHub might not have this PR."
            : "We'll update the view as soon as the pull request finishes creating."}
        </p>
      </div>
    </div>
  );
}


function AdditionsAndDeletions({
  repoFullName,
  ref1,
  ref2,
}: AdditionsAndDeletionsProps) {
  const diffsQuery = useRQ(
    gitDiffQueryOptions({
      repoFullName,
      baseRef: normalizeGitRef(ref1),
      headRef: normalizeGitRef(ref2),
    })
  );

  const totals = diffsQuery.data
    ? diffsQuery.data.reduce(
      (acc, d) => {
        acc.add += d.additions || 0;
        acc.del += d.deletions || 0;
        return acc;
      },
      { add: 0, del: 0 }
    )
    : undefined;

  return (
    <div className="flex items-center gap-2 text-[11px] ml-2 shrink-0">
      {diffsQuery.isPending ? (
        <>
          <span className="inline-block rounded bg-neutral-200 dark:bg-neutral-800 min-w-[20px] h-[14px] animate-pulse" />
          <span className="inline-block rounded bg-neutral-200 dark:bg-neutral-800 min-w-[20px] h-[14px] animate-pulse" />
        </>
      ) : totals ? (
        <>
          <span className="text-green-600 dark:text-green-400 font-medium select-none">
            +{totals.add}
          </span>
          <span className="text-red-600 dark:text-red-400 font-medium select-none">
            -{totals.del}
          </span>
        </>
      ) : null}
    </div>
  );
}


export function PullRequestDetailView({
  teamSlugOrId,
  owner,
  repo,
  number,
}: PullRequestDetailViewProps) {
  const clipboard = useClipboard({ timeout: 2000 });

  const currentPR = useConvexQuery(api.github_prs.getPullRequest, {
    teamSlugOrId,
    repoFullName: `${owner}/${repo}`,
    number: Number(number),
  });

  const fileOutputs = useConvexQuery(api.codeReview.listFileOutputsForPr, {
    teamSlugOrId,
    repoFullName: `${owner}/${repo}`,
    prNumber: Number(number),
    commitRef: currentPR?.headSha ?? undefined,
  });

  const commitRefForLogging = currentPR?.headSha ?? null;

  useEffect(() => {
    if (fileOutputs && fileOutputs.length > 0) {
      console.log("[code-review] File outputs", {
        repoFullName: `${owner}/${repo}`,
        prNumber: Number(number),
        commitRef: commitRefForLogging,
        outputs: fileOutputs,
      });
    }
  }, [fileOutputs, commitRefForLogging, owner, repo, number]);

  const workflowData = useCombinedWorkflowData({
    teamSlugOrId,
    repoFullName: currentPR?.repoFullName || '',
    prNumber: currentPR?.number || 0,
    headSha: currentPR?.headSha,
  });

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

  const expandAllChecks = () => setChecksExpandedOverride(true);
  const collapseAllChecks = () => setChecksExpandedOverride(false);

  const [diffControls, setDiffControls] = useState<DiffControls | null>(null);

  const handleDiffControlsChange = (controls: DiffControls | null) => {
    setDiffControls(controls ? {
      ...controls,
      expandChecks: expandAllChecks,
      collapseChecks: collapseAllChecks,
    } : null);
  };

  const [shouldShowPrMissingState, setShouldShowPrMissingState] = useState(false);
  const [shouldShowDefinitiveMissingState, setShouldShowDefinitiveMissingState] = useState(false);

  useEffect(() => {
    if (currentPR === null) {
      const timeoutId = setTimeout(() => setShouldShowPrMissingState(true), PR_SYNC_GRACE_MS);
      return () => clearTimeout(timeoutId);
    }
    setShouldShowPrMissingState(false);
  }, [currentPR]);

  useEffect(() => {
    if (currentPR === null) {
      const timeoutId = setTimeout(() => setShouldShowDefinitiveMissingState(true), PR_FINAL_NOT_FOUND_DELAY_MS);
      return () => clearTimeout(timeoutId);
    }
    setShouldShowDefinitiveMissingState(false);
  }, [currentPR]);

  const closePrMutation = useMutation<
    PostApiIntegrationsGithubPrsCloseResponse,
    Error,
    Options<PostApiIntegrationsGithubPrsCloseData>
  >({
    ...postApiIntegrationsGithubPrsCloseMutation(),
    onSuccess: (data) => {
      toast.success(data.message || `PR #${currentPR?.number} closed successfully`);
    },
    onError: (error) => {
      toast.error(`Failed to close PR: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const mergePrMutation = useMutation<
    PostApiIntegrationsGithubPrsMergeSimpleResponse,
    Error,
    Options<PostApiIntegrationsGithubPrsMergeSimpleData>
  >({
    ...postApiIntegrationsGithubPrsMergeSimpleMutation(),
    onSuccess: (data) => {
      toast.success(data.message || `PR #${currentPR?.number} merged successfully`);
    },
    onError: (error) => {
      toast.error(`Failed to merge PR: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const { checksAllowMerge, checksDisabledReason } = useMemo(() => {
    if (workflowData.isLoading) {
      return {
        checksAllowMerge: false,
        checksDisabledReason: "Loading check status...",
      } as const;
    }

    const runs = workflowData.allRuns;
    if (runs.length === 0) {
      return {
        checksAllowMerge: true,
        checksDisabledReason: undefined,
      } as const;
    }

    const hasPending = runs.some((run) => {
      const status = run.status;
      return typeof status === "string" && RUN_PENDING_STATUSES.has(status);
    });

    if (hasPending) {
      return {
        checksAllowMerge: false,
        checksDisabledReason: "Tests are still running. Wait for all required checks to finish before merging.",
      } as const;
    }

    const allPassing = runs.every((run) => {
      const conclusion = run.conclusion;
      return typeof conclusion === "string" && RUN_PASSING_CONCLUSIONS.has(conclusion);
    });

    if (!allPassing) {
      return {
        checksAllowMerge: false,
        checksDisabledReason: "Some tests have not passed yet. Fix the failing checks before merging.",
      } as const;
    }

    return {
      checksAllowMerge: true,
      checksDisabledReason: undefined,
    } as const;
  }, [workflowData.allRuns, workflowData.isLoading]);

  const disabledBecauseOfChecks = !checksAllowMerge;
  const mergeDisabled =
    mergePrMutation.isPending ||
    closePrMutation.isPending ||
    disabledBecauseOfChecks;
  const mergeDisabledReason = disabledBecauseOfChecks
    ? checksDisabledReason
    : undefined;

  const handleClosePR = () => {
    if (!currentPR) return;
    closePrMutation.mutate({
      body: {
        teamSlugOrId,
        owner,
        repo,
        number: currentPR.number,
      },
    });
  };

  const handleMergePR = (method: MergeMethod) => {
    if (
      !currentPR ||
      mergePrMutation.isPending ||
      closePrMutation.isPending ||
      disabledBecauseOfChecks
    ) {
      return;
    }
    mergePrMutation.mutate({
      body: {
        teamSlugOrId,
        owner,
        repo,
        number: currentPR.number,
        method,
      },
    });
  };

  if (currentPR === undefined || (currentPR === null && !shouldShowPrMissingState)) {
    return <PullRequestLoadingState />;
  }

  if (!currentPR) {
    return (
      <PullRequestUnavailableState
        variant={shouldShowDefinitiveMissingState ? "missing" : "syncing"}
      />
    );
  }

  const gitDiffViewerClassNames = {
    fileDiffRow: { button: "top-[56px]" },
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 min-h-0">
        <div className="px-0 py-0">
          <div className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white px-3.5 sticky top-0 z-[var(--z-sticky)] py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1">
              <div className="col-start-1 row-start-1 flex items-center gap-2 relative min-w-0">
                <h1
                  className="text-sm font-bold truncate min-w-0"
                  title={currentPR.title}
                >
                  {currentPR.title}
                </h1>
                <Suspense
                  fallback={
                    <div className="flex items-center gap-2 text-[11px] ml-2 shrink-0" />
                  }
                >
                  <AdditionsAndDeletions
                    repoFullName={currentPR.repoFullName}
                    ref1={currentPR.baseRef || ""}
                    ref2={currentPR.headRef || ""}
                  />
                </Suspense>
                <Suspense fallback={null}>
                  <WorkflowRunsBadge
                    allRuns={workflowData.allRuns}
                    isLoading={workflowData.isLoading}
                  />
                </Suspense>
              </div>

              <div className="col-start-3 row-start-1 row-span-2 self-center flex items-center gap-2 shrink-0">
                {currentPR.state === "open" && !currentPR.merged && (
                  <>
                    <MergeButton
                      onMerge={handleMergePR}
                      isOpen={true}
                      disabled={mergeDisabled}
                      isLoading={mergePrMutation.isPending}
                      disabledReason={mergeDisabledReason}
                    />
                    <button
                      onClick={handleClosePR}
                      disabled={mergePrMutation.isPending || closePrMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1 h-[26px] bg-[#cf222e] dark:bg-[#da3633] text-white rounded hover:bg-[#cf222e]/90 dark:hover:bg-[#da3633]/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-xs select-none whitespace-nowrap transition-colors"
                    >
                      {closePrMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5" />
                      )}
                      {closePrMutation.isPending ? "Closing..." : "Close PR"}
                    </button>
                  </>
                )}
                {currentPR.htmlUrl ? (
                  <a
                    className="flex items-center gap-1.5 px-3 py-1 bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700 font-medium text-xs select-none whitespace-nowrap"
                    href={currentPR.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open on GitHub
                  </a>
                ) : null}
                <Dropdown.Root>
                  <Dropdown.Trigger
                    className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white select-none"
                    aria-label="More actions"
                  >
                    ⋯
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <Dropdown.Positioner sideOffset={5}>
                      <Dropdown.Popup>
                        <Dropdown.Arrow />
                        <Dropdown.Item
                          onClick={() => {
                            diffControls?.expandAll?.();
                            diffControls?.expandChecks?.();
                          }}
                        >
                          Expand all
                        </Dropdown.Item>
                        <Dropdown.Item
                          onClick={() => {
                            diffControls?.collapseAll?.();
                            diffControls?.collapseChecks?.();
                          }}
                        >
                          Collapse all
                        </Dropdown.Item>
                      </Dropdown.Popup>
                    </Dropdown.Positioner>
                  </Dropdown.Portal>
                </Dropdown.Root>
              </div>

              <div className="col-start-1 row-start-2 col-span-2 flex items-center gap-2 text-xs text-neutral-400 min-w-0">
                <span className="font-mono text-neutral-600 dark:text-neutral-300 truncate min-w-0 max-w-full select-none text-[11px]">
                  {currentPR.repoFullName}#{currentPR.number} •{" "}
                  {currentPR.authorLogin || ""}
                </span>
                <span className="text-neutral-500 dark:text-neutral-600 select-none">
                  •
                </span>
                <span className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300 flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (currentPR.headRef) {
                        clipboard.copy(currentPR.headRef);
                      }
                    }}
                    className="flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors cursor-pointer group"
                  >
                    <div className="relative w-3 h-3">
                      <GitBranch
                        className={clsx(
                          "w-3 h-3 absolute inset-0 z-0",
                          clipboard.copied ? "hidden" : "block group-hover:hidden",
                        )}
                        aria-hidden={clipboard.copied}
                      />
                      <Copy
                        className={clsx(
                          "w-3 h-3 absolute inset-0 z-[var(--z-low)]",
                          clipboard.copied ? "hidden" : "hidden group-hover:block",
                        )}
                        aria-hidden={clipboard.copied}
                      />
                      <Check
                        className={clsx(
                          "w-3 h-3 text-green-400 absolute inset-0 z-[var(--z-sticky)]",
                          clipboard.copied ? "block" : "hidden",
                        )}
                        aria-hidden={!clipboard.copied}
                      />
                    </div>
                    {currentPR.headRef || "?"}
                  </button>
                  <span className="select-none">→</span>
                  <span className="font-mono">{currentPR.baseRef || "?"}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-neutral-950">
            <Suspense fallback={null}>
              <WorkflowRunsSection
                allRuns={workflowData.allRuns}
                isLoading={workflowData.isLoading}
                isExpanded={checksExpanded}
                onToggle={handleToggleChecks}
              />
            </Suspense>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full">
                  <div className="text-neutral-500 dark:text-neutral-400 text-sm select-none py-4">
                    Loading diffs...
                  </div>
                </div>
              }
            >
              {currentPR?.repoFullName &&
                currentPR.baseRef &&
                currentPR.headRef ? (
                <RunDiffSection
                  repoFullName={currentPR.repoFullName}
                  ref1={normalizeGitRef(currentPR.baseRef)}
                  ref2={normalizeGitRef(currentPR.headRef)}
                  onControlsChange={handleDiffControlsChange}
                  classNames={gitDiffViewerClassNames}
                />
              ) : (
                <div className="px-6 text-sm text-neutral-600 dark:text-neutral-300">
                  Missing repo or branches to show diff.
                </div>
              )}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PullRequestDetailView;
