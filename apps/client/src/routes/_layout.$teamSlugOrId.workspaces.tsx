import { GitHubIcon } from "@/components/icons/github";
import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { FloatingPane } from "@/components/floating-pane";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useCreateWorkspace } from "@/hooks/useCreateWorkspace";
import { isFakeConvexId } from "@/lib/fakeConvexId";
import { api } from "@cmux/convex/api";
import { type Doc, type Id } from "@cmux/convex/dataModel";
import { deriveRepoBaseName } from "@cmux/shared";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { useQueries, useQuery } from "convex/react";
import {
  ArrowLeft,
  Cloud,
  Laptop,
  Loader2,
  Plus,
  Search,
  Server,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";

const workspaceSearchSchema = z.object({
  mode: z.enum(["local", "cloud"]).optional(),
});

export const Route = createFileRoute("/_layout/$teamSlugOrId/workspaces")({
  component: WorkspacesRoute,
  validateSearch: workspaceSearchSchema,
  loader: async ({ params }) => {
    const { teamSlugOrId } = params;
    void convexQueryClient.queryClient.ensureQueryData(
      convexQuery(api.tasks.get, { teamSlugOrId })
    );
  },
});

interface RepoOption {
  fullName: string;
  repoBaseName: string;
  keywords: string[];
}

interface EnvironmentOption {
  _id: Id<"environments">;
  name: string;
  description?: string;
  selectedRepos?: string[];
}

function WorkspacesRoute() {
  const { teamSlugOrId } = Route.useParams();
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const tasks = useQuery(api.tasks.get, { teamSlugOrId });
  const { expandTaskIds } = useExpandTasks();
  const [searchQuery, setSearchQuery] = useState("");

  const {
    createLocalWorkspace,
    createCloudWorkspaceFromEnvironment,
    createCloudWorkspaceFromRepo,
    isCreating,
    isWebMode,
    environments,
  } = useCreateWorkspace({ teamSlugOrId });

  const reposByOrg = useQuery(api.github.getReposByOrg, { teamSlugOrId });

  const repoOptions = useMemo<RepoOption[]>(() => {
    const repoGroups = reposByOrg ?? {};
    const uniqueRepos = new Map<string, Doc<"repos">>();

    for (const repos of Object.values(repoGroups)) {
      for (const repo of repos ?? []) {
        const existing = uniqueRepos.get(repo.fullName);
        if (!existing) {
          uniqueRepos.set(repo.fullName, repo);
          continue;
        }
        const existingActivity =
          existing.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        const candidateActivity = repo.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        if (candidateActivity > existingActivity) {
          uniqueRepos.set(repo.fullName, repo);
        }
      }
    }

    return Array.from(uniqueRepos.values())
      .sort((a, b) => {
        const aPushedAt = a.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        const bPushedAt = b.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        if (aPushedAt !== bPushedAt) {
          return bPushedAt - aPushedAt;
        }
        return a.fullName.localeCompare(b.fullName);
      })
      .map((repo) => {
        const repoBaseName =
          deriveRepoBaseName({
            projectFullName: repo.fullName,
            repoUrl: repo.gitRemote,
          }) ?? repo.name;
        const [owner, name] = repo.fullName.split("/");
        return {
          fullName: repo.fullName,
          repoBaseName,
          keywords: [
            repo.fullName,
            repo.name,
            repo.org,
            repo.ownerLogin,
            owner,
            name,
          ].filter((k): k is string => Boolean(k)),
        };
      });
  }, [reposByOrg]);

  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return repoOptions;
    const query = searchQuery.toLowerCase();
    return repoOptions.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(query) ||
        repo.repoBaseName.toLowerCase().includes(query) ||
        repo.keywords.some((k) => k.toLowerCase().includes(query))
    );
  }, [repoOptions, searchQuery]);

  const filteredEnvironments = useMemo(() => {
    if (!environments) return [];
    if (!searchQuery.trim()) return environments;
    const query = searchQuery.toLowerCase();
    return environments.filter(
      (env) =>
        env.name.toLowerCase().includes(query) ||
        env.description?.toLowerCase().includes(query)
    );
  }, [environments, searchQuery]);

  const orderedTasks = useMemo(() => {
    if (!tasks) return [] as NonNullable<typeof tasks>;
    return [...tasks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [tasks]);

  const taskRunQueries = useMemo(() => {
    return orderedTasks
      .filter((task) => !isFakeConvexId(task._id))
      .reduce(
        (acc, task) => ({
          ...acc,
          [task._id]: {
            query: api.taskRuns.getByTask,
            args: { teamSlugOrId, taskId: task._id },
          },
        }),
        {} as Record<
          Id<"tasks">,
          {
            query: typeof api.taskRuns.getByTask;
            args:
              | ((d: { params: { teamSlugOrId: string } }) => {
                  teamSlugOrId: string;
                  taskId: Id<"tasks">;
                })
              | { teamSlugOrId: string; taskId: Id<"tasks"> };
          }
        >
      );
  }, [orderedTasks, teamSlugOrId]);

  const taskRunResults = useQueries(
    taskRunQueries as Parameters<typeof useQueries>[0]
  );

  const tasksWithRuns = useMemo(
    () =>
      orderedTasks.map((task) => ({
        ...task,
        runs: taskRunResults?.[task._id] ?? [],
      })),
    [orderedTasks, taskRunResults]
  );

  const handleModeSelect = useCallback(
    (selectedMode: "local" | "cloud") => {
      void navigate({
        to: "/$teamSlugOrId/workspaces",
        params: { teamSlugOrId },
        search: { mode: selectedMode },
      });
    },
    [navigate, teamSlugOrId]
  );

  const handleBack = useCallback(() => {
    setSearchQuery("");
    void navigate({
      to: "/$teamSlugOrId/workspaces",
      params: { teamSlugOrId },
      search: { mode: undefined },
    });
  }, [navigate, teamSlugOrId]);

  const handleSelectRepo = useCallback(
    (repo: RepoOption) => {
      if (mode === "local") {
        void createLocalWorkspace(repo.fullName);
      } else {
        void createCloudWorkspaceFromRepo(repo.fullName);
      }
      handleBack();
    },
    [createCloudWorkspaceFromRepo, createLocalWorkspace, handleBack, mode]
  );

  const handleSelectEnvironment = useCallback(
    (env: EnvironmentOption) => {
      void createCloudWorkspaceFromEnvironment(env._id);
      handleBack();
    },
    [createCloudWorkspaceFromEnvironment, handleBack]
  );

  const isLoading = reposByOrg === undefined;

  // Show selection flow when mode is set
  if (mode) {
    return (
      <FloatingPane>
        <div className="grow h-full flex flex-col">
          {/* Header */}
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
              </button>
              <div className="flex-1">
                <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 select-none">
                  {mode === "local" ? "New Local Workspace" : "New Cloud Workspace"}
                </h1>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Select a repository{mode === "cloud" ? " or environment" : ""}
                </p>
              </div>
              {isCreating && (
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
              )}
            </div>
          </div>

          {/* Search */}
          <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                placeholder={mode === "cloud" ? "Search repositories and environments..." : "Search repositories..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600 placeholder:text-neutral-400"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
              </div>
            ) : (
              <div className="py-2">
                {/* Environments section (cloud only) */}
                {mode === "cloud" && filteredEnvironments.length > 0 && (
                  <div className="px-4 mb-4">
                    <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
                      Environments
                    </h3>
                    <div className="space-y-1">
                      {filteredEnvironments.map((env) => (
                        <button
                          key={env._id}
                          type="button"
                          onClick={() => handleSelectEnvironment(env)}
                          disabled={isCreating}
                          className={clsx(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                            "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/30">
                            <Server className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                              {env.name}
                            </p>
                            {env.description && (
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                {env.description}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Repositories section */}
                <div className="px-4">
                  <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
                    Repositories
                  </h3>
                  {filteredRepos.length === 0 ? (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4 text-center">
                      {searchQuery ? "No repositories match your search" : "No repositories available"}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {filteredRepos.map((repo) => (
                        <button
                          key={repo.fullName}
                          type="button"
                          onClick={() => handleSelectRepo(repo)}
                          disabled={isCreating}
                          className={clsx(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                            "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-neutral-100 dark:bg-neutral-800">
                            <GitHubIcon className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                              {repo.repoBaseName}
                            </p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                              {repo.fullName}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </FloatingPane>
    );
  }

  // Default view: workspaces list with new workspace options
  return (
    <FloatingPane>
      <div className="grow h-full flex flex-col">
        <div className="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 select-none">
              Workspaces
            </h1>
          </div>
        </div>

        {/* New Workspace Options */}
        <div className="px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex gap-2">
            {!isWebMode && (
              <button
                type="button"
                onClick={() => handleModeSelect("local")}
                className={clsx(
                  "flex-1 flex items-center gap-3 px-4 py-3 rounded-lg border transition-all",
                  "border-neutral-200 dark:border-neutral-700",
                  "hover:border-neutral-300 dark:hover:border-neutral-600",
                  "hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
                  "group cursor-pointer"
                )}
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 group-hover:bg-neutral-200 dark:group-hover:bg-neutral-700 transition-colors">
                  <Laptop className="w-4.5 h-4.5 text-neutral-600 dark:text-neutral-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Local Workspace
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Run on your machine
                  </p>
                </div>
                <Plus className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors" />
              </button>
            )}
            <button
              type="button"
              onClick={() => handleModeSelect("cloud")}
              className={clsx(
                "flex-1 flex items-center gap-3 px-4 py-3 rounded-lg border transition-all",
                "border-neutral-200 dark:border-neutral-700",
                "hover:border-neutral-300 dark:hover:border-neutral-600",
                "hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
                "group cursor-pointer"
              )}
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                <Cloud className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Cloud Workspace
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Run in the cloud
                </p>
              </div>
              <Plus className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors" />
            </button>
          </div>
        </div>

        {/* Workspaces List */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {tasks === undefined ? (
            <TaskTreeSkeleton count={10} />
          ) : tasksWithRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-3">
                <Server className="w-5 h-5 text-neutral-400" />
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">
                No workspaces yet
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                Create a workspace to get started
              </p>
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              {tasksWithRuns.map((task) => (
                <TaskTree
                  key={task._id}
                  task={task}
                  defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                  teamSlugOrId={teamSlugOrId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </FloatingPane>
  );
}
