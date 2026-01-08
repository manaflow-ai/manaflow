"use client";

import { useCallback, useState } from "react";
import {
  ChevronDown,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Image as ImageIcon,
  AlertCircle,
  CheckCircle2,
  Clock,
  Code,
  Globe,
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getApiPreviewTestJobs,
  postApiPreviewTestJobs,
  postApiPreviewTestJobsByPreviewRunIdDispatch,
  postApiPreviewTestJobsByPreviewRunIdRetry,
  deleteApiPreviewTestJobsByPreviewRunId,
  getApiPreviewTestCheckAccess,
  getApiPreviewConfigs,
} from "@cmux/www-openapi-client";

type TeamOption = {
  slugOrId: string;
  slug: string | null;
  displayName: string;
};

type ScreenshotImage = {
  storageId: string;
  mimeType: string;
  fileName?: string | null;
  description?: string | null;
  url?: string | null;
};

type ScreenshotSet = {
  _id: string;
  status: "completed" | "failed" | "skipped";
  hasUiChanges?: boolean | null;
  capturedAt: number;
  error?: string | null;
  images: ScreenshotImage[];
};

type TestJob = {
  _id: string;
  prNumber: number;
  prUrl: string;
  prTitle?: string | null;
  repoFullName: string;
  headSha: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  stateReason?: string | null;
  taskRunId?: string | null;
  createdAt: number;
  updatedAt: number;
  dispatchedAt?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  configRepoFullName?: string | null;
  screenshotSet?: ScreenshotSet | null;
  taskId?: string | null;
};

type AccessCheckResult = {
  hasAccess: boolean;
  hasConfig: boolean;
  hasActiveInstallation: boolean;
  repoFullName: string | null;
  errorCode: "invalid_url" | "no_config" | "no_installation" | "installation_inactive" | null;
  errorMessage: string | null;
  suggestedAction: string | null;
};

type PreviewConfig = {
  id: string;
  repoFullName: string;
  repoInstallationId?: number | null;
  status: "active" | "paused" | "disabled";
  environmentId?: string | null;
  updatedAt: number;
};

type PreviewTestDashboardProps = {
  selectedTeamSlugOrId: string;
  teamOptions: TeamOption[];
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchInterval: 10000, // Poll every 10 seconds for status updates
    },
  },
});

function PreviewTestDashboardInner({
  selectedTeamSlugOrId,
  teamOptions,
}: PreviewTestDashboardProps) {
  const [prUrls, setPrUrls] = useState("");
  const [selectedTeam, setSelectedTeam] = useState(selectedTeamSlugOrId);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [accessWarning, setAccessWarning] = useState<AccessCheckResult | null>(null);
  const [jobPendingDelete, setJobPendingDelete] = useState<TestJob | null>(null);
  const qc = useQueryClient();

  // Get the team slug for URL construction (prefer slug over ID)
  const selectedTeamSlug = (() => {
    const team = teamOptions.find((t) => t.slugOrId === selectedTeam);
    return team?.slug ?? selectedTeam;
  })();

  // Client app base URL for workspace/browser links
  // In development, the client app runs on port 5173
  // In production, workspace/browser are on www.cmux.sh (not preview.new)
  const clientBaseUrl = typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:5173"
    : "https://www.cmux.sh";

  // Fetch preview configs for this team
  const { data: configsData, isLoading: isLoadingConfigs } = useQuery({
    queryKey: ["preview-configs", selectedTeam],
    queryFn: async () => {
      const response = await getApiPreviewConfigs({
        query: { teamSlugOrId: selectedTeam },
      });
      if (response.error) {
        throw new Error("Failed to fetch preview configs");
      }
      return response.data;
    },
    enabled: Boolean(selectedTeam),
    refetchInterval: false, // Don't need frequent updates for configs
  });

  const configs = (configsData?.configs ?? []) as PreviewConfig[];

  // Fetch test jobs
  const { data: jobsData, isLoading: isLoadingJobs } = useQuery({
    queryKey: ["preview-test-jobs", selectedTeam],
    queryFn: async () => {
      const response = await getApiPreviewTestJobs({
        query: { teamSlugOrId: selectedTeam },
      });
      if (response.error) {
        throw new Error("Failed to fetch test jobs");
      }
      return response.data;
    },
    enabled: Boolean(selectedTeam),
  });

  const jobs = (jobsData?.jobs ?? []) as TestJob[];

  // Create test job mutation
  const createJobMutation = useMutation({
    mutationFn: async (prUrl: string) => {
      const response = await postApiPreviewTestJobs({
        body: {
          teamSlugOrId: selectedTeam,
          prUrl,
        },
      });
      if (response.error) {
        throw new Error(
          (response.error as { error?: string }).error ?? "Failed to create test job"
        );
      }
      return response.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preview-test-jobs", selectedTeam] });
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  // Dispatch test job mutation
  const dispatchJobMutation = useMutation({
    mutationFn: async (previewRunId: string) => {
      const response = await postApiPreviewTestJobsByPreviewRunIdDispatch({
        path: { previewRunId },
        query: { teamSlugOrId: selectedTeam },
      });
      if (response.error) {
        throw new Error("Failed to dispatch test job");
      }
      return response.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preview-test-jobs", selectedTeam] });
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  // Delete test job mutation
  const deleteJobMutation = useMutation({
    mutationFn: async (previewRunId: string) => {
      const response = await deleteApiPreviewTestJobsByPreviewRunId({
        path: { previewRunId },
        query: { teamSlugOrId: selectedTeam },
      });
      if (response.error) {
        throw new Error("Failed to delete test job");
      }
      return response.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preview-test-jobs", selectedTeam] });
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  // Retry test job mutation
  const retryJobMutation = useMutation({
    mutationFn: async (previewRunId: string) => {
      const response = await postApiPreviewTestJobsByPreviewRunIdRetry({
        path: { previewRunId },
        query: { teamSlugOrId: selectedTeam },
      });
      if (response.error) {
        throw new Error("Failed to retry test job");
      }
      return response.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preview-test-jobs", selectedTeam] });
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  const handleCreateJobs = useCallback(async () => {
    setError(null);
    setAccessWarning(null);

    // Support single URL or multiple URLs separated by spaces/newlines/commas
    const urls = prUrls
      .split(/[\s,]+/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0 && url.startsWith("http"));

    if (urls.length === 0) {
      setError("Please enter a valid PR URL");
      return;
    }

    // Check access for each URL before creating jobs
    for (const url of urls) {
      try {
        const accessCheck = await getApiPreviewTestCheckAccess({
          query: { teamSlugOrId: selectedTeam, prUrl: url },
        });

        if (accessCheck.error || !accessCheck.data?.hasAccess) {
          const result = accessCheck.data as AccessCheckResult | undefined;
          if (result) {
            setAccessWarning(result);
          } else {
            setError("Failed to validate repository access");
          }
          return; // Stop on first access issue
        }
      } catch (err) {
        console.error("Access check failed:", err);
        // Continue anyway - the server will catch the error
      }
    }

    // All access checks passed, create jobs
    for (const url of urls) {
      await createJobMutation.mutateAsync(url);
    }
    setPrUrls("");
  }, [prUrls, createJobMutation, selectedTeam]);

  const handleDispatchJob = useCallback(
    async (previewRunId: string) => {
      setError(null);
      await dispatchJobMutation.mutateAsync(previewRunId);
    },
    [dispatchJobMutation]
  );

  const handleDeleteJob = useCallback(
    async (previewRunId: string) => {
      setError(null);
      await deleteJobMutation.mutateAsync(previewRunId);
    },
    [deleteJobMutation]
  );

  const handleRetryJob = useCallback(
    async (previewRunId: string) => {
      setError(null);
      await retryJobMutation.mutateAsync(previewRunId);
    },
    [retryJobMutation]
  );

  const handleDispatchAll = useCallback(async () => {
    setError(null);
    const pendingJobs = jobs.filter((job) => job.status === "pending");
    for (const job of pendingJobs) {
      await dispatchJobMutation.mutateAsync(job._id);
    }
  }, [jobs, dispatchJobMutation]);

  const toggleJobExpanded = useCallback((jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }, []);

  const handleJobClick = useCallback(
    (job: TestJob) => {
      // Always just toggle expanded state - use dedicated icon links for navigation
      toggleJobExpanded(job._id);
    },
    [toggleJobExpanded]
  );

  const getStatusIcon = (status: TestJob["status"]) => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-neutral-400" />;
      case "running":
        return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-red-400" />;
      case "skipped":
        return <X className="h-4 w-4 text-neutral-500" />;
    }
  };

  const getStatusText = (status: TestJob["status"]) => {
    switch (status) {
      case "pending":
        return "Pending";
      case "running":
        return "Running";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "skipped":
        return "Skipped";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Preview.new Eval Board</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Evaluate preview jobs without GitHub integration. Screenshots and
            captions will be generated but no comments will be posted.
          </p>
        </div>
        <Link href="/preview">
          <Button variant="outline" size="sm">
            Back to Preview
          </Button>
        </Link>
      </div>

      {/* Team selector */}
      {teamOptions.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-400">Team:</label>
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {teamOptions.map((team) => (
              <option key={team.slugOrId} value={team.slugOrId}>
                {team.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Configured Repos Section */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-neutral-300">
            Configured Repositories
          </h2>
          <Link
            href="/preview"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Manage in Preview Settings
          </Link>
        </div>
        {isLoadingConfigs ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading configurations...
          </div>
        ) : configs.length === 0 ? (
          <div className="text-sm text-neutral-500">
            <p>No preview configurations found for this team.</p>
            <p className="mt-1">
              <Link href="/preview" className="text-blue-400 hover:text-blue-300">
                Add a preview configuration
              </Link>{" "}
              to test PRs from a repository.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {configs.map((config) => (
              <div
                key={config.id}
                className="flex items-center justify-between rounded-md bg-neutral-800/50 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-neutral-200">
                    {config.repoFullName}
                  </span>
                  {config.repoInstallationId ? (
                    <span className="rounded bg-green-900/50 px-1.5 py-0.5 text-xs text-green-400">
                      GitHub Connected
                    </span>
                  ) : (
                    <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-400">
                      No GitHub App
                    </span>
                  )}
                  {config.status && config.status !== "active" && (
                    <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400">
                      {config.status}
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-500">
                  Updated {new Date(config.updatedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PR URL input */}
      <div className="flex items-center gap-3">
          <input
            type="text"
            value={prUrls}
            onChange={(e) => setPrUrls(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && prUrls.trim()) {
                e.preventDefault();
                handleCreateJobs();
              }
            }}
            placeholder="https://github.com/owner/repo/pull/123"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button
            onClick={handleCreateJobs}
            disabled={createJobMutation.isPending || !prUrls.trim()}
            className="gap-2 shrink-0"
          >
            {createJobMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Access warning display */}
      {accessWarning && !accessWarning.hasAccess && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-300">
                {accessWarning.errorMessage}
              </p>
              {accessWarning.suggestedAction && (
                <p className="mt-1 text-amber-400/80">
                  {accessWarning.suggestedAction}
                </p>
              )}
              {accessWarning.errorCode === "no_installation" ||
              accessWarning.errorCode === "installation_inactive" ? (
                <Link
                  href={`/${selectedTeamSlug}/settings`}
                  className="mt-2 inline-block text-amber-300 underline hover:text-amber-200"
                >
                  Go to Team Settings
                </Link>
              ) : null}
            </div>
            <button
              onClick={() => setAccessWarning(null)}
              className="text-amber-400 hover:text-amber-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Jobs list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            Test Jobs ({jobs.length})
          </h2>
          {jobs.some((job) => job.status === "pending") && (
            <Button
              onClick={handleDispatchAll}
              disabled={dispatchJobMutation.isPending}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {dispatchJobMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start All Pending
            </Button>
          )}
        </div>

        {isLoadingJobs ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 py-12 text-center">
            <ImageIcon className="mx-auto h-12 w-12 text-neutral-600" />
            <p className="mt-4 text-neutral-400">No test jobs yet</p>
            <p className="mt-1 text-sm text-neutral-500">
              Add PR URLs above to create test jobs
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job._id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden"
              >
                {/* Job header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-800/50"
                  onClick={() => handleJobClick(job)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleJobExpanded(job._id);
                    }}
                    className="rounded p-0.5 hover:bg-neutral-700"
                  >
                    <ChevronDown
                      className={clsx(
                        "h-4 w-4 text-neutral-500 transition-transform",
                        !expandedJobs.has(job._id) && "-rotate-90"
                      )}
                    />
                  </button>
                  {getStatusIcon(job.status)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">
                        {job.repoFullName}
                      </span>
                      <span className="text-neutral-400">#{job.prNumber}</span>
                    </div>
                    {job.prTitle && (
                      <p className="truncate text-sm text-neutral-500">
                        {job.prTitle}
                      </p>
                    )}
                  </div>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      job.status === "pending" &&
                        "bg-neutral-700 text-neutral-300",
                      job.status === "running" && "bg-blue-900 text-blue-300",
                      job.status === "completed" &&
                        "bg-green-900 text-green-300",
                      job.status === "failed" && "bg-red-900 text-red-300",
                      job.status === "skipped" &&
                        "bg-neutral-700 text-neutral-400"
                    )}
                  >
                    {getStatusText(job.status)}
                  </span>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {job.status === "pending" && (
                      <Button
                        onClick={() => handleDispatchJob(job._id)}
                        disabled={dispatchJobMutation.isPending}
                        size="sm"
                        className="gap-1"
                      >
                        <Play className="h-3 w-3" />
                        Start
                      </Button>
                    )}
                    {job.status === "failed" && (
                      <Button
                        onClick={() => handleRetryJob(job._id)}
                        disabled={retryJobMutation.isPending}
                        size="sm"
                        variant="outline"
                        className="gap-1"
                      >
                        {retryJobMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        Retry
                      </Button>
                    )}
                    <button
                      onClick={() => setJobPendingDelete(job)}
                      disabled={deleteJobMutation.isPending}
                      className="rounded p-1.5 text-neutral-400 hover:bg-red-900/50 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {expandedJobs.has(job._id) && (
                  <div className="border-t border-neutral-800 px-4 py-4">
                    {/* Metadata */}
                    <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-neutral-500">Created:</span>{" "}
                        <span className="text-neutral-300">
                          {new Date(job.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {job.dispatchedAt && (
                        <div>
                          <span className="text-neutral-500">Dispatched:</span>{" "}
                          <span className="text-neutral-300">
                            {new Date(job.dispatchedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {job.completedAt && (
                        <div>
                          <span className="text-neutral-500">Completed:</span>{" "}
                          <span className="text-neutral-300">
                            {new Date(job.completedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-neutral-500">Head SHA:</span>{" "}
                        <span className="font-mono text-neutral-300">
                          {job.headSha.substring(0, 8)}
                        </span>
                      </div>
                    </div>

                    {/* Workspace and Browser links */}
                    {job.taskId && job.taskRunId && (
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <a
                          href={`${clientBaseUrl}/${selectedTeamSlug}/task/${job.taskId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700 hover:text-white"
                        >
                          <Code className="h-4 w-4" />
                          Workspace
                        </a>
                        <a
                          href={`${clientBaseUrl}/${selectedTeamSlug}/task/${job.taskId}/run/${job.taskRunId}/browser`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700 hover:text-white"
                        >
                          <Globe className="h-4 w-4" />
                          Browser
                        </a>
                      </div>
                    )}

                    {/* Screenshots */}
                    {job.screenshotSet ? (
                      job.screenshotSet.hasUiChanges === false ? (
                        <div className="flex items-center gap-2 rounded-md bg-neutral-800/50 px-3 py-2 text-sm text-neutral-400">
                          <CheckCircle2 className="h-4 w-4 text-neutral-500" />
                          No UI changes detected - skipped screenshot workflow
                        </div>
                      ) : (
                        <div>
                          <h4 className="mb-3 text-sm font-medium text-white">
                            Screenshots ({job.screenshotSet.images.length})
                          </h4>
                          {job.screenshotSet.error && (
                            <div className="mb-3 rounded-md bg-red-900/20 px-3 py-2 text-sm text-red-300">
                              Error: {job.screenshotSet.error}
                            </div>
                          )}
                          {job.screenshotSet.images.length > 0 ? (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              {job.screenshotSet.images.map((image, index) => (
                                <div
                                  key={image.storageId}
                                  className="overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800"
                                >
                                  {image.url ? (
                                    <a
                                      href={image.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <img
                                        src={image.url}
                                        alt={
                                          image.description ??
                                          `Screenshot ${index + 1}`
                                        }
                                        className="aspect-video w-full object-cover hover:opacity-90"
                                      />
                                    </a>
                                  ) : (
                                    <div className="flex aspect-video items-center justify-center bg-neutral-900">
                                      <ImageIcon className="h-8 w-8 text-neutral-600" />
                                    </div>
                                  )}
                                  {image.description && (
                                    <div className="px-3 py-2">
                                      <p className="text-sm text-neutral-300">
                                        {image.description}
                                      </p>
                                      {image.fileName && (
                                        <p className="mt-1 text-xs text-neutral-500">
                                          {image.fileName}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-neutral-500">
                              No screenshots captured
                            </p>
                          )}
                        </div>
                      )
                    ) : job.status === "running" ? (
                      <div className="flex items-center gap-2 text-sm text-neutral-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Capturing screenshots...
                      </div>
                    ) : job.status === "pending" ? (
                      <p className="text-sm text-neutral-500">
                        Start the job to capture screenshots
                      </p>
                    ) : (
                      <p className="text-sm text-neutral-500">
                        No screenshots available
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={jobPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setJobPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-500/10 p-2 text-red-400">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <AlertDialogTitle>Delete test job?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete the test job for{" "}
                  <span className="text-white">
                    {jobPendingDelete?.repoFullName} #{jobPendingDelete?.prNumber}
                  </span>
                  ? This action cannot be undone.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button
                disabled={deleteJobMutation.isPending}
                variant="secondary"
              >
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => {
                  if (jobPendingDelete) {
                    handleDeleteJob(jobPendingDelete._id).then(() => {
                      setJobPendingDelete(null);
                    });
                  }
                }}
                disabled={deleteJobMutation.isPending}
                variant="destructive"
              >
                {deleteJobMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Delete"
                )}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function PreviewTestDashboard(props: PreviewTestDashboardProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <PreviewTestDashboardInner {...props} />
    </QueryClientProvider>
  );
}
