import { OpenEditorSplitButton } from "@/components/OpenEditorSplitButton";
import { Dropdown } from "@/components/ui/dropdown";
import { MergeButton, type MergeMethod } from "@/components/ui/merge-button";
import { useSidebarOptional } from "@/contexts/sidebar/SidebarContext";
import { useSocketSuspense } from "@/contexts/socket/use-socket";
import { isElectron } from "@/lib/electron";
import { cn } from "@/lib/utils";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import type { Doc, Id } from "@cmux/convex/dataModel";
import type { TaskRunWithChildren } from "@/types/task";
import { Skeleton } from "@heroui/react";
import { useClipboard } from "@mantine/hooks";
import { ErrorBoundary } from "@sentry/react";
import {
  useMutation,
  useQueries,
  useQueryClient,
  type DefaultError,
} from "@tanstack/react-query";
import {
  postApiIntegrationsGithubPrsMergeMutation,
  postApiIntegrationsGithubPrsOpenMutation,
} from "@cmux/www-openapi-client/react-query";
import type {
  Options,
  PostApiIntegrationsGithubPrsMergeData,
  PostApiIntegrationsGithubPrsMergeResponse,
  PostApiIntegrationsGithubPrsOpenData,
  PostApiIntegrationsGithubPrsOpenResponse,
} from "@cmux/www-openapi-client";
import { useNavigate, useLocation } from "@tanstack/react-router";
import clsx from "clsx";
import {
  Check,
  ChevronDown,
  Copy,
  Crown,
  ExternalLink,
  FolderKanban,
  FolderOpen,
  GitBranch,
  GitMerge,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { toast } from "sonner";
import CmuxLogoMark from "./logo/cmux-logo-mark";
import {
  SocketMutationError,
  type MergeBranchResponse,
  type PullRequestActionResponse,
  type ToastFeedbackContext,
  getErrorDescription,
} from "./task-detail-header.mutations";
import type {
  SocketMutationErrorInstance,
} from "./task-detail-header.mutations";

interface TaskDetailHeaderProps {
  task?: Doc<"tasks"> | null;
  taskRuns?: TaskRunWithChildren[] | null;
  selectedRun?: TaskRunWithChildren | null;
  totalAdditions?: number;
  totalDeletions?: number;
  taskRunId: Id<"taskRuns">;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onExpandAllChecks?: () => void;
  onCollapseAllChecks?: () => void;
  onPanelSettings?: () => void;
  onOpenLocalWorkspace?: () => void;
  onToggleAutoSync?: () => void;
  autoSyncEnabled?: boolean;
  teamSlugOrId: string;
  /** Linked local workspace for cloud tasks - use its worktreePath for "Open with VS Code" */
  linkedLocalWorkspace?: {
    task?: { worktreePath?: string | null } | null;
    taskRun?: { worktreePath?: string | null } | null;
  } | null;
}

const ENABLE_MERGE_BUTTON = false;

type RepoDiffTarget = {
  repoFullName: string;
  baseRef?: string;
  headRef?: string;
};

function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeGithubOwner(owner: unknown): string | null {
  if (typeof owner !== "string") {
    return null;
  }
  const trimmedOwner = owner.trim();
  if (!trimmedOwner) {
    return null;
  }
  if (!/^[A-Za-z0-9-]{1,39}$/.test(trimmedOwner)) {
    return null;
  }
  if (trimmedOwner.startsWith("-") || trimmedOwner.endsWith("-")) {
    return null;
  }
  return trimmedOwner;
}

function openHttpsUrlInNewTab(url: string | null | undefined): boolean {
  if (!url || !isValidHttpsUrl(url)) {
    return false;
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

function AdditionsAndDeletions({
  repos,
  defaultBaseRef,
  defaultHeadRef,
}: {
  repos: RepoDiffTarget[];
  defaultBaseRef?: string;
  defaultHeadRef?: string;
}) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const repoConfigs = useMemo(() => {
    const normalizedDefaults = {
      base: normalizeGitRef(defaultBaseRef),
      head: normalizeGitRef(defaultHeadRef),
    };

    const map = new Map<
      string,
      { repoFullName: string; baseRef?: string; headRef?: string }
    >();
    for (const repo of repos) {
      const repoFullName = repo.repoFullName?.trim();
      if (!repoFullName) {
        continue;
      }
      const normalizedBaseRef =
        normalizeGitRef(repo.baseRef) || normalizedDefaults.base;
      const normalizedHeadRef =
        normalizeGitRef(repo.headRef) || normalizedDefaults.head;
      map.set(repoFullName, {
        repoFullName,
        baseRef: normalizedBaseRef || undefined,
        headRef: normalizedHeadRef || undefined,
      });
    }

    return Array.from(map.values());
  }, [repos, defaultBaseRef, defaultHeadRef]);

  const queries = useQueries({
    queries: repoConfigs.map((config) => {
      const headRef = config.headRef ?? "";
      const options = gitDiffQueryOptions({
        repoFullName: config.repoFullName,
        baseRef: config.baseRef,
        headRef,
      });
      return {
        ...options,
        enabled: options.enabled,
      };
    }),
  });

  const hasMissingHeadRef = repoConfigs.some((config) => !config.headRef);

  const isLoading =
    repoConfigs.length === 0 ||
    hasMissingHeadRef ||
    queries.some((query) => query.isPending || query.isFetching);

  const firstError = queries.find((query, index) => {
    if (!repoConfigs[index]?.headRef) {
      return false;
    }
    return Boolean(query.error);
  });

  // useCallback must be called before any early returns to comply with React's rules of hooks
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    const toastId = toast.loading("Refreshing git diff...");
    try {
      // Fetch fresh data with forceRefresh to bypass SWR cache window
      await Promise.all(
        repoConfigs.map((config) =>
          queryClient.fetchQuery(
            gitDiffQueryOptions({
              repoFullName: config.repoFullName,
              baseRef: config.baseRef,
              headRef: config.headRef ?? "",
              forceRefresh: true,
            })
          )
        )
      );
      // Also invalidate other git-diff queries to ensure consistency
      await queryClient.invalidateQueries({ queryKey: ["git-diff"] });
      toast.success("Git diff refreshed", { id: toastId });
    } catch (error) {
      console.error("[AdditionsAndDeletions] Failed to refresh git diff:", error);
      toast.error("Failed to refresh git diff", { id: toastId });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, repoConfigs]);

  if (!isLoading && firstError?.error) {
    return (
      <div className="flex items-center gap-2 text-[11px] ml-2 shrink-0">
        <span className="text-neutral-500 dark:text-neutral-400 font-medium select-none">
          Error loading diffs
        </span>
      </div>
    );
  }

  const totals =
    !isLoading && queries.length > 0
      ? queries.reduce(
        (acc, query, index) => {
          if (!repoConfigs[index]?.headRef) {
            return acc;
          }
          for (const diff of query.data ?? []) {
            acc.add += diff.additions ?? 0;
            acc.del += diff.deletions ?? 0;
          }
          return acc;
        },
        { add: 0, del: 0 },
      )
      : undefined;

  return (
    <div className="flex items-center gap-2 text-[11px] ml-2 shrink-0">
      <Skeleton className="rounded min-w-[20px] h-[14px]" isLoaded={!isLoading}>
        {totals && (
          <span className="text-green-600 dark:text-green-400 font-medium select-none">
            +{totals.add}
          </span>
        )}
      </Skeleton>
      <Skeleton className="rounded min-w-[20px] h-[14px]" isLoaded={!isLoading}>
        {totals && (
          <span className="text-red-600 dark:text-red-400 font-medium select-none">
            -{totals.del}
          </span>
        )}
      </Skeleton>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isLoading || isRefreshing}
        className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white select-none disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Refresh git diff"
        title="Refresh git diff"
        style={isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
      >
        <RefreshCw
          className={cn(
            "w-3.5 h-3.5",
            isRefreshing && "animate-spin"
          )}
        />
      </button>
    </div>
  );
}

function TaskDetailHeaderContent({
  task,
  taskRuns,
  selectedRun,
  taskRunId,
  onExpandAll,
  onCollapseAll,
  onExpandAllChecks,
  onCollapseAllChecks,
  onPanelSettings,
  onOpenLocalWorkspace,
  onToggleAutoSync,
  autoSyncEnabled = true,
  teamSlugOrId,
  linkedLocalWorkspace,
}: TaskDetailHeaderProps) {
  const sidebar = useSidebarOptional();
  const navigate = useNavigate();
  const location = useLocation();
  const clipboard = useClipboard({ timeout: 2000 });
  const prIsOpen = selectedRun?.pullRequestState === "open";
  const prIsMerged = selectedRun?.pullRequestState === "merged";
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const handleAgentOpenChange = useCallback((open: boolean) => {
    setAgentMenuOpen(open);
  }, []);
  const taskTitle = task?.pullRequestTitle || task?.text;
  const githubProjectOwner = useMemo(
    () => normalizeGithubOwner(task?.githubProjectOwner),
    [task?.githubProjectOwner],
  );
  const githubProjectUrl = useMemo(() => {
    if (!githubProjectOwner) {
      return null;
    }
    const pathPrefix =
      task?.githubProjectOwnerType === "organization" ? "orgs" : "users";
    const candidateUrl = `https://github.com/${pathPrefix}/${githubProjectOwner}/projects`;
    return isValidHttpsUrl(candidateUrl) ? candidateUrl : null;
  }, [githubProjectOwner, task?.githubProjectOwnerType]);
  const handleCopyBranch = () => {
    if (selectedRun?.newBranch) {
      clipboard.copy(selectedRun.newBranch);
    }
  };
  // Compute worktreePath for "Open with VS Code" button
  // IMPORTANT: Cloud task paths like /root/workspace are NOT accessible locally
  // Only return a path for:
  // 1. Linked local workspaces (preferred - opens local worktree for cloud task)
  // 2. Local workspace tasks (isLocalWorkspace=true, path is on local filesystem)
  const worktreePath = useMemo(() => {
    // Priority 1: If there's a linked local workspace, use its path
    // This allows opening local worktree when viewing a cloud task
    if (linkedLocalWorkspace) {
      return (
        linkedLocalWorkspace.taskRun?.worktreePath ||
        linkedLocalWorkspace.task?.worktreePath ||
        null
      );
    }
    // Priority 2: For local workspace tasks, the path is on local filesystem
    if (task?.isLocalWorkspace) {
      return selectedRun?.worktreePath || task?.worktreePath || null;
    }
    // For cloud tasks without linked local workspace, return null
    // The /root/workspace path is inside the cloud sandbox, not accessible locally
    return null;
  }, [
    linkedLocalWorkspace,
    task?.isLocalWorkspace,
    selectedRun?.worktreePath,
    task?.worktreePath,
  ]);

  // Find parent run if this is a child run (for comparing against parent's branch)
  const parentRun = useMemo(() => {
    if (!selectedRun?.parentRunId || !taskRuns) return null;
    return taskRuns.find((run) => run._id === selectedRun.parentRunId) ?? null;
  }, [selectedRun?.parentRunId, taskRuns]);

  // Determine base ref for diff comparison with priority:
  // 1. Parent run's branch (for child runs)
  // 2. Starting commit SHA (for new tasks in custom environments)
  // 3. Task's base branch (explicit user choice)
  const normalizedBaseBranch = useMemo(() => {
    // Priority 1: Parent run's branch (for child runs)
    if (parentRun?.newBranch) {
      return normalizeGitRef(parentRun.newBranch);
    }
    // Priority 2: Starting commit SHA (for new tasks in custom environments)
    if (selectedRun?.startingCommitSha) {
      return selectedRun.startingCommitSha; // Direct SHA, no normalization needed
    }
    // Priority 3: Task's base branch (explicit user choice)
    const candidate = task?.baseBranch;
    if (candidate && candidate.trim()) {
      return normalizeGitRef(candidate);
    }
    return undefined;
  }, [parentRun?.newBranch, selectedRun?.startingCommitSha, task?.baseBranch]);
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
    const projectName = task?.projectFullName?.trim();
    // Skip environment-based project names (format: env:<environmentId>)
    if (projectName && !projectName.startsWith("env:")) {
      names.add(projectName);
    }
    for (const repo of environmentRepos) {
      const trimmed = repo?.trim();
      // Skip environment references in selectedRepos as well
      if (trimmed && !trimmed.startsWith("env:")) {
        names.add(trimmed);
      }
    }
    // Add discovered repos from sandbox (for custom environments)
    for (const repo of selectedRun?.discoveredRepos ?? []) {
      const trimmed = repo?.trim();
      if (trimmed && !trimmed.startsWith("env:")) {
        names.add(trimmed);
      }
    }
    return Array.from(names);
  }, [task?.projectFullName, environmentRepos, selectedRun?.discoveredRepos]);

  const repoDiffTargets = useMemo<RepoDiffTarget[]>(() => {
    const baseRef = normalizedBaseBranch || undefined;
    const headRef = normalizedHeadBranch || undefined;
    return repoFullNames.map((repoFullName) => ({
      repoFullName,
      baseRef,
      headRef,
    }));
  }, [repoFullNames, normalizedBaseBranch, normalizedHeadBranch]);

  const dragStyle = isElectron
    ? ({ WebkitAppRegion: "drag" } as CSSProperties)
    : undefined;
  const showElectronSidebarToggleNoDragHole =
    isElectron && Boolean(sidebar?.isHidden) && Boolean(teamSlugOrId);

  const hasExpandActions = Boolean(onExpandAll || onExpandAllChecks);
  const hasCollapseActions = Boolean(onCollapseAll || onCollapseAllChecks);
  const showActionsDropdown = hasExpandActions || hasCollapseActions;

  const handleExpandAllClick = useCallback(() => {
    onExpandAll?.();
    onExpandAllChecks?.();
  }, [onExpandAll, onExpandAllChecks]);

  const handleCollapseAllClick = useCallback(() => {
    onCollapseAll?.();
    onCollapseAllChecks?.();
  }, [onCollapseAll, onCollapseAllChecks]);

  return (
    <div
      className="relative bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white px-3.5 sticky top-0 z-[var(--z-sticky)] py-2 border-b border-neutral-200/80 dark:border-neutral-800/70"
      style={dragStyle}
    >
      {showElectronSidebarToggleNoDragHole ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-3 flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <div className="w-[80px]" />
          <div className="flex items-center gap-1.5 invisible">
            <CmuxLogoMark height={20} />
            <span className="text-xs font-semibold tracking-wide whitespace-nowrap">
              cmux-next
            </span>
          </div>
          <div className="ml-2 flex items-center gap-1">
            <div className="w-[25px] h-[25px]" />
            <div className="w-[25px] h-[25px]" />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1">
        {/* Title row */}
        <div className="col-start-1 row-start-1 flex items-center gap-2 relative min-w-0">
          <h1 className="text-sm font-bold truncate min-w-0" title={taskTitle}>
            {taskTitle || "Loading..."}
          </h1>
          {/* Hide git diff stats for cloud/local workspaces */}
          {!task?.isCloudWorkspace && !task?.isLocalWorkspace && (
            <Suspense
              fallback={
                <div className="flex items-center gap-2 text-[11px] ml-2 shrink-0">
                  <Skeleton className="rounded min-w-[20px] h-[14px] fade-out" />
                  <Skeleton className="rounded min-w-[20px] h-[14px] fade-out" />
                </div>
              }
            >
              <AdditionsAndDeletions
                repos={repoDiffTargets}
                defaultBaseRef={normalizedBaseBranch || undefined}
                defaultHeadRef={normalizedHeadBranch || undefined}
              />
            </Suspense>
          )}
        </div>

        <div
          className="col-start-3 row-start-1 row-span-2 self-center flex items-center gap-2 shrink-0"
          style={
            isElectron
              ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
              : undefined
          }
        >
          {/* Removed Latest/Landed toggle; using smart diff */}
          <Suspense
            fallback={
              <div className="flex items-center gap-2">
                <button
                  className="flex items-center gap-1.5 px-3 py-1 bg-neutral-200 dark:bg-neutral-800 text-neutral-200 dark:text-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded font-medium text-xs select-none whitespace-nowrap cursor-wait"
                  disabled
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  Merge
                </button>
                <button
                  className="flex items-center gap-1.5 px-3 py-1 bg-neutral-200 dark:bg-neutral-800 text-neutral-200 dark:text-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded font-medium text-xs select-none whitespace-nowrap cursor-wait"
                  disabled
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open draft PR
                </button>
              </div>
            }
          >
            <SocketActions
              selectedRun={selectedRun ?? null}
              taskRunId={taskRunId}
              prIsOpen={prIsOpen}
              prIsMerged={prIsMerged}
              repoDiffTargets={repoDiffTargets}
              teamSlugOrId={teamSlugOrId}
            />
          </Suspense>

          <OpenEditorSplitButton worktreePath={worktreePath} />

          {onOpenLocalWorkspace && (
            <button
              onClick={onOpenLocalWorkspace}
              className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white select-none"
              aria-label="Open local workspace"
              title="Open local workspace from this branch"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )}

          {onToggleAutoSync && (
            <button
              onClick={onToggleAutoSync}
              className={clsx(
                "p-1 select-none transition-colors",
                autoSyncEnabled
                  ? "text-green-500 hover:text-green-600 dark:text-green-400 dark:hover:text-green-300"
                  : "text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
              )}
              aria-label={autoSyncEnabled ? "Auto-sync enabled (click to disable)" : "Auto-sync disabled (click to enable)"}
              title={autoSyncEnabled ? "Auto-sync ON - Click to disable" : "Auto-sync OFF - Click to enable"}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          {onPanelSettings && (
            <button
              onClick={onPanelSettings}
              className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white select-none"
              aria-label="Panel settings"
              title="Configure panel layout"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}

          {showActionsDropdown && (
            <Dropdown.Root>
              <Dropdown.Trigger
                className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white select-none"
                aria-label="More actions"
              >
                <span aria-hidden>⋯</span>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Positioner sideOffset={5}>
                  <Dropdown.Popup>
                    <Dropdown.Arrow />
                    {hasExpandActions && (
                      <Dropdown.Item onClick={handleExpandAllClick}>
                        Expand all
                      </Dropdown.Item>
                    )}
                    {hasCollapseActions && (
                      <Dropdown.Item onClick={handleCollapseAllClick}>
                        Collapse all
                      </Dropdown.Item>
                    )}
                  </Dropdown.Popup>
                </Dropdown.Positioner>
              </Dropdown.Portal>
            </Dropdown.Root>
          )}

          <button className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white select-none hidden">
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white select-none hidden">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Branch row (second line, spans first two columns) */}
        <div
          className="col-start-1 row-start-2 col-span-2 flex items-center gap-2 text-xs text-neutral-400 min-w-0"
          style={
            isElectron
              ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
              : undefined
          }
        >
          <button
            onClick={handleCopyBranch}
            className="flex items-center gap-1 hover:text-neutral-700 dark:hover:text-white transition-colors group"
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
            {selectedRun?.newBranch ? (
              <span className="font-mono text-neutral-600 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-white text-[11px] truncate min-w-0 max-w-full select-none">
                {selectedRun.newBranch}
              </span>
            ) : (
              <span className="font-mono text-neutral-500 text-[11px]">
                No branch
              </span>
            )}
          </button>

          <span className="text-neutral-500 dark:text-neutral-600 select-none">
            in
          </span>

          {task?.projectFullName && (
            <span className="font-mono text-neutral-600 dark:text-neutral-300 truncate min-w-0 max-w-[40%] whitespace-nowrap select-none text-[11px]">
              {task.projectFullName}
            </span>
          )}

          {githubProjectOwner && githubProjectUrl && (
            <a
              href={githubProjectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50 transition-colors select-none shrink-0"
              title={`GitHub Project: ${githubProjectOwner}`}
            >
              <FolderKanban className="w-3 h-3" />
              {githubProjectOwner}
            </a>
          )}

          {taskRuns && taskRuns.length > 0 && selectedRun && (
            <>
              <span className="text-neutral-500 dark:text-neutral-600 select-none">
                by
              </span>
              <Dropdown.Root
                open={agentMenuOpen}
                onOpenChange={handleAgentOpenChange}
              >
                <Dropdown.Trigger className="flex items-center gap-1 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors text-[11px] select-none">
                  <span className="truncate">
                    {selectedRun.agentName || "Unknown agent"}
                  </span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Dropdown.Trigger>

                <Dropdown.Portal>
                  <Dropdown.Positioner
                    sideOffset={5}
                    className="!z-[var(--z-global-blocking)]"
                  >
                    <Dropdown.Popup className="min-w-[200px]">
                      <Dropdown.Arrow />
                      {taskRuns?.map((run) => {
                        const trimmedAgentName = run.agentName?.trim();
                        const summary = run.summary?.trim();
                        const agentName =
                          trimmedAgentName && trimmedAgentName.length > 0
                            ? trimmedAgentName
                            : summary && summary.length > 0
                              ? summary
                              : "unknown agent";
                        const isSelected = run._id === selectedRun._id;
                        return (
                          <Dropdown.CheckboxItem
                            key={run._id}
                            checked={isSelected}
                            onCheckedChange={() => {
                              if (!task?._id) {
                                console.error(
                                  "[TaskDetailHeader] No task ID",
                                );
                                return;
                              }
                              if (!isSelected) {
                                // Check if we're currently on the git diff viewer
                                const isOnDiffPage = location.pathname.endsWith("/diff");

                                if (isOnDiffPage) {
                                  // Navigate to the selected agent's git diff viewer
                                  navigate({
                                    to: "/$teamSlugOrId/task/$taskId/run/$runId/diff",
                                    params: {
                                      teamSlugOrId,
                                      taskId: task._id,
                                      runId: run._id,
                                    },
                                  });
                                } else {
                                  // Navigate to the task index page with the runId search param
                                  navigate({
                                    to: "/$teamSlugOrId/task/$taskId",
                                    params: {
                                      teamSlugOrId,
                                      taskId: task._id,
                                    },
                                    search: { runId: run._id },
                                  });
                                }
                              }
                              // Close dropdown after selection
                              setAgentMenuOpen(false);
                            }}
                            // Also close when selecting the same option
                            onClick={() => setAgentMenuOpen(false)}
                          >
                            <Dropdown.CheckboxItemIndicator>
                              <Check className="w-3 h-3" />
                            </Dropdown.CheckboxItemIndicator>
                            <span className="col-start-2 flex items-center gap-1.5">
                              {agentName}
                              {run.isCrowned && (
                                <Crown className="w-3 h-3 text-yellow-500 absolute right-4" />
                              )}
                            </span>
                          </Dropdown.CheckboxItem>
                        );
                      })}
                    </Dropdown.Popup>
                  </Dropdown.Positioner>
                </Dropdown.Portal>
              </Dropdown.Root>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskDetailHeaderErrorFallback() {
  return (
    <div className="relative bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white px-3.5 sticky top-0 z-[var(--z-sticky)] py-2 border-b border-neutral-200/80 dark:border-neutral-800/70">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Header failed to render.
      </p>
    </div>
  );
}

export function TaskDetailHeader(props: TaskDetailHeaderProps) {
  return (
    <ErrorBoundary fallback={<TaskDetailHeaderErrorFallback />}>
      <TaskDetailHeaderContent {...props} />
    </ErrorBoundary>
  );
}

function SocketActions({
  selectedRun,
  taskRunId,
  prIsOpen,
  prIsMerged,
  repoDiffTargets,
  teamSlugOrId,
}: {
  selectedRun: TaskRunWithChildren | null;
  taskRunId: Id<"taskRuns">;
  prIsOpen: boolean;
  prIsMerged: boolean;
  repoDiffTargets: RepoDiffTarget[];
  teamSlugOrId: string;
}) {
  const { socket } = useSocketSuspense();
  const navigate = useNavigate();
  const pullRequests = useMemo(
    () => selectedRun?.pullRequests ?? [],
    [selectedRun?.pullRequests],
  );

  const repoFullNames = useMemo(() => {
    const names = new Set<string>();
    for (const target of repoDiffTargets) {
      const trimmed = target.repoFullName?.trim();
      // Skip environment-based project names (format: env:<environmentId>)
      if (trimmed && !trimmed.startsWith("env:")) {
        names.add(trimmed);
      }
    }
    for (const pr of pullRequests) {
      const trimmed = pr.repoFullName?.trim();
      // Skip environment references in pull requests as well
      if (trimmed && !trimmed.startsWith("env:")) {
        names.add(trimmed);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [repoDiffTargets, pullRequests]);

  const pullRequestMap = useMemo(
    () => new Map(pullRequests.map((pr) => [pr.repoFullName, pr] as const)),
    [pullRequests],
  );

  const diffQueries = useQueries({
    queries: repoDiffTargets.map((target) => ({
      ...gitDiffQueryOptions({
        repoFullName: target.repoFullName,
        baseRef: target.baseRef,
        headRef: target.headRef ?? "",
      }),
      enabled:
        Boolean(target.repoFullName?.trim()) && Boolean(target.headRef?.trim()),
    })),
  });

  const hasChanges =
    repoDiffTargets.length === 0
      ? false
      : diffQueries.some((query, index) => {
        if (!repoDiffTargets[index]?.headRef) {
          return false;
        }
        return (query.data ?? []).length > 0;
      });

  const navigateToPrs = (
    prs: Array<{
      url?: string | null;
      repoFullName?: string;
      number?: number;
    }>,
  ) => {
    prs.forEach((pr) => {
      // Open GitHub URL directly in new tab if available
      if (openHttpsUrlInNewTab(pr.url)) {
        return;
      }
      if (pr.repoFullName && pr.number) {
        // Fallback to internal viewer if URL not available
        const [owner = "", repo = ""] = pr.repoFullName.split("/", 2);
        navigate({
          to: "/$teamSlugOrId/prs-only/$owner/$repo/$number",
          params: {
            teamSlugOrId,
            owner,
            repo,
            number: String(pr.number),
          },
        });
      }
    });
  };

  const summarizeResults = (
    results: Array<{ repoFullName: string; error?: string | undefined }>,
  ) => {
    const total = results.length;
    const successCount = results.filter((result) => !result.error).length;
    if (total === 0) {
      return "No repositories updated";
    }
    if (successCount === total) {
      return `${total} ${total === 1 ? "repository" : "repositories"} updated`;
    }
    return `${successCount}/${total} repositories updated`;
  };

  const hasMultipleRepos = repoFullNames.length > 1;
  const viewLabel = hasMultipleRepos ? "View PRs" : "View PR";
  const openingLabel = hasMultipleRepos ? "Opening PRs..." : "Opening PR...";
  const openedLabel = hasMultipleRepos ? "PRs updated" : "PR updated";
  const openingDraftLabel = hasMultipleRepos
    ? "Creating draft PRs..."
    : "Creating draft PR...";
  const openedDraftLabel = hasMultipleRepos
    ? "Draft PRs updated"
    : "Draft PR updated";
  const openErrorLabel = hasMultipleRepos
    ? "Failed to open PRs"
    : "Failed to open PR";
  const draftErrorLabel = hasMultipleRepos
    ? "Failed to create draft PRs"
    : "Failed to create draft PR";
  const mergeLoadingLabel = (method: MergeMethod) =>
    hasMultipleRepos
      ? `Merging PRs (${method})...`
      : `Merging PR (${method})...`;
  const mergedLabel = hasMultipleRepos ? "PRs merged" : "PR merged";
  const mergeErrorLabel = hasMultipleRepos
    ? "Failed to merge PRs"
    : "Failed to merge PR";
  const mergeBranchErrorLabel = "Failed to merge branch";

  const openPrMutation = useMutation<
    PostApiIntegrationsGithubPrsOpenResponse,
    DefaultError,
    Options<PostApiIntegrationsGithubPrsOpenData>,
    ToastFeedbackContext
  >({
    ...postApiIntegrationsGithubPrsOpenMutation(),
    onMutate: () => {
      const toastId = toast.loading(openingLabel);
      return { toastId } satisfies ToastFeedbackContext;
    },
    onSuccess: (response, _variables, context) => {
      const actionable = response.results.filter(
        (result) =>
          !result.error &&
          Boolean(result.repoFullName?.trim()) &&
          Boolean(result.number),
      );

      // Get the PR URL(s) for copying
      const prUrls = actionable
        .map((result) => result.url)
        .filter((url): url is string => Boolean(url));

      toast.success(openedLabel, {
        id: context?.toastId,
        description: summarizeResults(response.results),
        action:
          actionable.length > 0
            ? {
              label: actionable.length === 1 ? "View PR" : "View PRs",
              onClick: () => navigateToPrs(actionable),
            }
            : undefined,
        cancel:
          prUrls.length > 0
            ? {
              label: "Copy URL",
              onClick: () => {
                const urlText = prUrls.join("\n");
                navigator.clipboard
                  .writeText(urlText)
                  .then(() => {
                    toast.success("URL copied to clipboard");
                  })
                  .catch(() => {
                    toast.error("Failed to copy URL");
                  });
              },
            }
            : undefined,
      });
    },
    onError: (error, _variables, context) => {
      toast.error(openErrorLabel, {
        id: context?.toastId,
        description:
          getErrorDescription(error) ??
          (error instanceof Error ? error.message : undefined),
      });
    },
  });

  const handleOpenPRs = () => {
    openPrMutation.mutate({
      body: {
        teamSlugOrId,
        taskRunId,
      },
    });
  };

  const createDraftPrMutation = useMutation<
    PullRequestActionResponse,
    SocketMutationErrorInstance | Error,
    void,
    ToastFeedbackContext
  >({
    mutationFn: () => {
      if (!socket) {
        throw new Error("Socket unavailable");
      }
      return new Promise<PullRequestActionResponse>((resolve, reject) => {
        socket.emit("github-create-draft-pr", { taskRunId }, (resp) => {
          if (resp.success) {
            resolve(resp);
          } else {
            reject(new SocketMutationError(resp.error ?? draftErrorLabel, resp));
          }
        });
      });
    },
    onMutate: () => {
      const toastId = toast.loading(openingDraftLabel);
      return { toastId };
    },
    onSuccess: (response, _variables, context) => {
      const actionable = response.results.filter(
        (result) => result.url && !result.error,
      );
      if (actionable.length > 0) {
        navigateToPrs(actionable);
      }
      toast.success(openedDraftLabel, {
        id: context?.toastId,
        description: summarizeResults(response.results),
        action:
          actionable.length > 0
            ? {
              label: actionable.length === 1 ? "View draft" : "View drafts",
              onClick: () => navigateToPrs(actionable),
            }
            : undefined,
      });
    },
    onError: (error, _variables, context) => {
      toast.error(draftErrorLabel, {
        id: context?.toastId,
        description: getErrorDescription(error),
      });
    },
  });

  const mergePrMutation = useMutation<
    PostApiIntegrationsGithubPrsMergeResponse,
    DefaultError,
    Options<PostApiIntegrationsGithubPrsMergeData>,
    ToastFeedbackContext
  >({
    ...postApiIntegrationsGithubPrsMergeMutation(),
    onMutate: (variables) => {
      const method = variables.body?.method ?? "merge";
      const toastId = toast.loading(mergeLoadingLabel(method));
      return { toastId } satisfies ToastFeedbackContext;
    },
    onSuccess: (response, _variables, context) => {
      toast.success(mergedLabel, {
        id: context?.toastId,
        description: summarizeResults(response.results),
      });
    },
    onError: (error, _variables, context) => {
      toast.error(mergeErrorLabel, {
        id: context?.toastId,
        description:
          getErrorDescription(error) ??
          (error instanceof Error ? error.message : undefined),
      });
    },
  });

  const mergeBranchMutation = useMutation<
    MergeBranchResponse,
    SocketMutationErrorInstance | Error,
    void,
    ToastFeedbackContext
  >({
    mutationFn: () => {
      if (!socket) {
        throw new Error("Socket unavailable");
      }
      return new Promise<MergeBranchResponse>((resolve, reject) => {
        socket.emit("github-merge-branch", { taskRunId }, (resp) => {
          if (resp.success) {
            resolve(resp);
          } else {
            reject(
              new SocketMutationError(
                resp.error ?? mergeBranchErrorLabel,
                resp,
              ),
            );
          }
        });
      });
    },
    onMutate: () => {
      const toastId = toast.loading("Merging branch...");
      return { toastId };
    },
    onSuccess: (response, _variables, context) => {
      toast.success("Branch merged", {
        id: context?.toastId,
        description: response.commitSha,
      });
    },
    onError: (error, _variables, context) => {
      toast.error(mergeBranchErrorLabel, {
        id: context?.toastId,
        description: getErrorDescription(error),
      });
    },
  });

  const handleOpenDraftPRs = () => {
    createDraftPrMutation.mutate();
  };

  const handleViewPRs = () => {
    const existing: Array<{
      url?: string | null;
      repoFullName?: string;
      number?: number;
    }> = pullRequests
      .filter(
        (pr) =>
          Boolean(pr.url) || (Boolean(pr.repoFullName) && Boolean(pr.number)),
      )
      .map((pr) => ({
        url: pr.url,
        repoFullName: pr.repoFullName,
        number: pr.number,
      }));

    const aggregatedUrl = selectedRun?.pullRequestUrl?.trim();
    if (
      aggregatedUrl &&
      aggregatedUrl !== "pending" &&
      !existing.some((pr) => (pr.url ?? "").trim() === aggregatedUrl)
    ) {
      existing.push({ url: aggregatedUrl });
    }

    const aggregatedNumber = selectedRun?.pullRequestNumber;
    if (aggregatedNumber && repoFullNames.length === 1) {
      const repoFullName = repoFullNames[0];
      if (
        repoFullName &&
        !existing.some(
          (pr) => pr.repoFullName === repoFullName && pr.number === aggregatedNumber,
        )
      ) {
        existing.push({ repoFullName, number: aggregatedNumber });
      }
    }
    if (existing.length > 0) {
      navigateToPrs(existing);
      return;
    }
    handleOpenDraftPRs();
  };

  const handleMerge = (method: MergeMethod) => {
    mergePrMutation.mutate({
      body: {
        teamSlugOrId,
        taskRunId,
        method,
      },
    });
  };

  const handleMergeBranch = () => {
    mergeBranchMutation.mutate();
  };

  const isOpeningPr = openPrMutation.isPending;
  const isCreatingPr = createDraftPrMutation.isPending;
  const isMerging =
    mergePrMutation.isPending || mergeBranchMutation.isPending;

  const hasAnyRemotePr =
    pullRequests.some(
      (pr) =>
        Boolean(pr.url) || (Boolean(pr.repoFullName) && Boolean(pr.number)),
    ) ||
    (Boolean(selectedRun?.pullRequestUrl?.trim()) &&
      selectedRun?.pullRequestUrl?.trim() !== "pending") ||
    (Boolean(selectedRun?.pullRequestNumber) && repoFullNames.length === 1);

  const renderRepoDropdown = () => (
    <Dropdown.Root>
      <Dropdown.Trigger
        aria-label={`${viewLabel} by repository`}
        className={cn(
          "flex items-center justify-center px-2 py-1 h-[26px]",
          "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white",
          "border border-neutral-300 dark:border-neutral-700",
          "rounded-r hover:bg-neutral-300 dark:hover:bg-neutral-700",
          "disabled:opacity-60 disabled:cursor-not-allowed",
        )}
        disabled={repoFullNames.every(
          (repoName) => {
            const pr = pullRequestMap.get(repoName);
            return !(pr?.url || (pr?.repoFullName && pr?.number));
          },
        )}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Positioner sideOffset={5}>
          <Dropdown.Popup className="min-w-[200px]">
            <Dropdown.Arrow />
            {repoFullNames.map((repoName) => {
              const pr = pullRequestMap.get(repoName);
              const hasPrTarget = Boolean(
                pr?.url || (pr?.repoFullName && pr?.number),
              );
              return (
                <Dropdown.Item
                  key={repoName}
                  disabled={!hasPrTarget}
                  onClick={() => {
                    // Open GitHub URL directly in new tab if available
                    if (openHttpsUrlInNewTab(pr?.url)) {
                      return;
                    }
                    if (pr?.repoFullName && pr?.number) {
                      // Fallback to internal viewer if URL not available
                      const [owner = "", repo = ""] =
                        pr.repoFullName.split("/", 2);
                      navigate({
                        to: "/$teamSlugOrId/prs-only/$owner/$repo/$number",
                        params: {
                          teamSlugOrId,
                          owner,
                          repo,
                          number: String(pr.number),
                        },
                      });
                    }
                  }}
                >
                  <span className="truncate">{repoName}</span>
                </Dropdown.Item>
              );
            })}
          </Dropdown.Popup>
        </Dropdown.Positioner>
      </Dropdown.Portal>
    </Dropdown.Root>
  );

  return (
    <>
      {prIsMerged ? (
        <div
          className="flex items-center gap-1.5 px-3 py-1 bg-[#8250df] text-white rounded font-medium text-xs select-none whitespace-nowrap border border-[#6e40cc] dark:bg-[#8250df] dark:border-[#6e40cc] cursor-not-allowed"
          title="Pull request has been merged"
        >
          <GitMerge className="w-3.5 h-3.5" />
          Merged
        </div>
      ) : (
        <MergeButton
          onMerge={prIsOpen ? handleMerge : () => {
            void handleOpenPRs();
          }}
          isOpen={prIsOpen}
          disabled={
            isOpeningPr ||
            isCreatingPr ||
            isMerging ||
            (!prIsOpen && !hasChanges)
          }
          prCount={repoFullNames.length}
        />
      )}
      {!prIsOpen && !prIsMerged && ENABLE_MERGE_BUTTON && (
        <button
          onClick={handleMergeBranch}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#8250df] text-white rounded hover:bg-[#8250df]/90 dark:bg-[#8250df] dark:hover:bg-[#8250df]/90 border border-[#6e40cc] dark:border-[#6e40cc] font-medium text-xs select-none disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          disabled={isOpeningPr || isCreatingPr || isMerging || !hasChanges}
        >
          <GitMerge className="w-3.5 h-3.5" />
          Merge
        </button>
      )}
      {hasAnyRemotePr ? (
        hasMultipleRepos ? (
          <div className="flex items-stretch">
            <button
              onClick={handleViewPRs}
              className="flex items-center gap-1.5 px-3 py-1 h-[26px] bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white border border-neutral-300 dark:border-neutral-700 border-r-0 rounded-l hover:bg-neutral-300 dark:hover:bg-neutral-700 font-medium text-xs select-none disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              disabled={isOpeningPr || isCreatingPr || isMerging}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {viewLabel}
            </button>
            {renderRepoDropdown()}
          </div>
        ) : (
          <button
            onClick={handleViewPRs}
            className="flex items-center gap-1.5 px-3 py-1 bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700 font-medium text-xs select-none disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
            disabled={isOpeningPr || isCreatingPr || isMerging}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {viewLabel}
          </button>
        )
      ) : (
        <button
          onClick={handleOpenDraftPRs}
          className="flex items-center gap-1.5 px-3 py-1 bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700 font-medium text-xs select-none disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          disabled={isCreatingPr || isOpeningPr || isMerging || !hasChanges}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {isCreatingPr
            ? openingDraftLabel
            : hasMultipleRepos
              ? "Open draft PRs"
              : "Open draft PR"}
        </button>
      )}
    </>
  );
}
