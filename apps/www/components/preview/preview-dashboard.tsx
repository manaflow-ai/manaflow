"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ExternalLink,
  Github,
  Link2,
  Loader2,
  Pencil,
  Search,
  Server,
  Shield,
  Star,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ProviderConnection = {
  installationId: number;
  accountLogin: string | null;
  accountType: string | null;
  isActive: boolean;
};

type RepoSearchResult = {
  name: string;
  full_name: string;
  private: boolean;
  updated_at?: string | null;
  pushed_at?: string | null;
};

type PreviewConfigStatus = "active" | "paused" | "disabled";

type PreviewConfigListItem = {
  id: string;
  repoFullName: string;
  environmentId: string | null;
  repoInstallationId: number | null;
  repoDefaultBranch: string | null;
  status: PreviewConfigStatus;
  lastRunAt: number | null;
  teamSlugOrId: string;
  teamName: string;
};

type TeamOption = {
  slugOrId: string;
  displayName: string;
};

type PreviewDashboardProps = {
  selectedTeamSlugOrId: string;
  teamOptions: TeamOption[];
  providerConnectionsByTeam: Record<string, ProviderConnection[]>;
  isAuthenticated: boolean;
  previewConfigs: PreviewConfigListItem[];
};

const ADD_INSTALLATION_VALUE = "__add_github_account__";

export function PreviewDashboard({
  selectedTeamSlugOrId,
  teamOptions,
  providerConnectionsByTeam,
  isAuthenticated,
  previewConfigs,
}: PreviewDashboardProps) {
  const [selectedTeamSlugOrIdState, setSelectedTeamSlugOrIdState] = useState(
    () => selectedTeamSlugOrId || teamOptions[0]?.slugOrId || "",
  );
  const [isInstallingApp, setIsInstallingApp] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Repository selection state
  const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [repos, setRepos] = useState<RepoSearchResult[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [navigatingRepo, setNavigatingRepo] = useState<string | null>(null);
  const [configs, setConfigs] = useState<PreviewConfigListItem[]>(previewConfigs);
  const [updatingConfigId, setUpdatingConfigId] = useState<string | null>(null);
  const [openingConfigId, setOpeningConfigId] = useState<string | null>(null);

  // Public URL input state
  const [repoUrlInput, setRepoUrlInput] = useState("");

  const currentProviderConnections = useMemo(
    () => providerConnectionsByTeam[selectedTeamSlugOrIdState] ?? [],
    [providerConnectionsByTeam, selectedTeamSlugOrIdState]
  );
  const activeConnections = useMemo(
    () => currentProviderConnections.filter((connection) => connection.isActive),
    [currentProviderConnections]
  );
  const previousTeamRef = useRef(selectedTeamSlugOrIdState);
  const hasGithubAppInstallation = activeConnections.length > 0;
  const canSearchRepos =
    isAuthenticated &&
    Boolean(selectedTeamSlugOrIdState) &&
    hasGithubAppInstallation;

  useEffect(() => {
    setConfigs(previewConfigs);
  }, [previewConfigs]);

  // Parse GitHub URL to extract owner/repo
  const parseGithubUrl = useCallback((input: string): string | null => {
    const trimmed = input.trim();
    // Try to parse as URL
    try {
      const url = new URL(trimmed);
      if (url.hostname === "github.com" || url.hostname === "www.github.com") {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 2) {
          return `${parts[0]}/${parts[1]}`;
        }
      }
    } catch {
      // Not a valid URL, check if it's owner/repo format
      const ownerRepoMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
      if (ownerRepoMatch) {
        return trimmed;
      }
    }
    return null;
  }, []);

  const handleOpenConfig = useCallback((config: PreviewConfigListItem) => {
    setOpeningConfigId(config.id);
    const params = new URLSearchParams({
      repo: config.repoFullName,
      team: config.teamSlugOrId,
    });
    if (config.repoInstallationId !== null) {
      params.set("installationId", String(config.repoInstallationId));
    }
    if (config.environmentId) {
      params.set("environmentId", config.environmentId);
    }
    window.location.href = `/preview/configure?${params.toString()}`;
  }, []);

  const handleDeleteConfig = useCallback(
    async (config: PreviewConfigListItem) => {
      setUpdatingConfigId(config.id);
      setConfigError(null);
      try {
        const params = new URLSearchParams({ teamSlugOrId: config.teamSlugOrId });
        const response = await fetch(`/api/preview/configs/${config.id}?${params.toString()}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        setConfigs((previous) => previous.filter((item) => item.id !== config.id));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete preview configuration";
        console.error("[PreviewDashboard] Failed to delete preview configuration", error);
        setConfigError(message);
      } finally {
        setUpdatingConfigId(null);
      }
    },
    []
  );

  const handleTeamChange = useCallback(
    (nextTeam: string) => {
      setSelectedTeamSlugOrIdState(nextTeam);
      setSelectedInstallationId(null);
      setRepoSearch("");
      setErrorMessage(null);
    },
    []
  );

  const handleStartPreview = useCallback(async () => {
    if (!selectedTeamSlugOrIdState) {
      setErrorMessage("Select a team before continuing.");
      return;
    }

    const repoName = parseGithubUrl(repoUrlInput);
    if (!repoName) {
      setErrorMessage("Please enter a valid GitHub URL or owner/repo");
      return;
    }
    const params = new URLSearchParams({ repo: repoName });
    params.set("team", selectedTeamSlugOrIdState);
    const configurePath = `/preview/configure?${params.toString()}`;

    if (!isAuthenticated) {
      setErrorMessage(null);
      setNavigatingRepo("__url_input__");
      window.location.href = `/handler/sign-in?after_auth_return_to=${encodeURIComponent(configurePath)}`;
      return;
    }

    if (!hasGithubAppInstallation) {
      setErrorMessage(null);
      setIsInstallingApp(true);
      setNavigatingRepo("__url_input__");

      try {
        try {
          sessionStorage.setItem("pr_review_return_url", configurePath);
        } catch (storageError) {
          console.warn("[PreviewDashboard] Failed to persist return URL", storageError);
        }

        const response = await fetch("/api/integrations/github/install-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamSlugOrId: selectedTeamSlugOrIdState,
            returnUrl: new URL(configurePath, window.location.origin).toString(),
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = (await response.json()) as { state: string };
        const githubAppSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
        if (!githubAppSlug) {
          throw new Error("GitHub App slug is not configured");
        }

        const url = new URL(`https://github.com/apps/${githubAppSlug}/installations/new`);
        url.searchParams.set("state", payload.state);
        window.location.href = url.toString();
        return;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to start GitHub App install";
        console.error("[PreviewDashboard] Failed to start GitHub App install", error);
        setErrorMessage(message);
        setIsInstallingApp(false);
        setNavigatingRepo(null);
        return;
      }
    }

    setErrorMessage(null);
    setNavigatingRepo("__url_input__");
    window.location.href = configurePath;
  }, [
    repoUrlInput,
    parseGithubUrl,
    selectedTeamSlugOrIdState,
    hasGithubAppInstallation,
    isAuthenticated,
  ]);

  // Auto-select first connection for the team, but keep user choice if still valid
  useEffect(() => {
    const fallbackInstallationId = activeConnections[0]?.installationId ?? null;
    const teamChanged = previousTeamRef.current !== selectedTeamSlugOrIdState;
    const hasSelectedConnection = activeConnections.some(
      (connection) => connection.installationId === selectedInstallationId
    );

    if (activeConnections.length === 0) {
      if (selectedInstallationId !== null) {
        setSelectedInstallationId(null);
      }
    } else if (teamChanged || !hasSelectedConnection) {
      if (selectedInstallationId !== fallbackInstallationId) {
        setSelectedInstallationId(fallbackInstallationId);
      }
    }

    previousTeamRef.current = selectedTeamSlugOrIdState;
  }, [activeConnections, selectedInstallationId, selectedTeamSlugOrIdState]);

  const handleInstallGithubApp = async () => {
    if (!selectedTeamSlugOrIdState) {
      setErrorMessage("Select a team first");
      return;
    }
    setIsInstallingApp(true);
    setErrorMessage(null);
    try {
      const currentUrl = window.location.href;
      try {
        sessionStorage.setItem("pr_review_return_url", currentUrl);
      } catch (storageError) {
        console.warn("[PreviewDashboard] Failed to persist return URL", storageError);
      }

      const response = await fetch("/api/integrations/github/install-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId: selectedTeamSlugOrIdState,
          returnUrl: currentUrl,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as { installUrl: string };
      window.location.href = payload.installUrl;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start GitHub App install";
      console.error("[PreviewDashboard] Failed to start GitHub App install", error);
      setErrorMessage(message);
      setIsInstallingApp(false);
    }
  };

  const fetchRepos = useCallback(
    async (searchTerm: string, signal?: AbortSignal) => {
      if (!canSearchRepos || selectedInstallationId === null) {
        setRepos([]);
        return;
      }
      setIsLoadingRepos(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams({
          team: selectedTeamSlugOrIdState,
          installationId: String(selectedInstallationId),
        });
        const trimmed = searchTerm.trim();
        if (trimmed) {
          params.set("search", trimmed);
        }
        const response = await fetch(`/api/integrations/github/repos?${params.toString()}`, {
          signal,
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as { repos: RepoSearchResult[] };
        setRepos(trimmed ? payload.repos : payload.repos.slice(0, 5));
        setIsLoadingRepos(false);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Request was cancelled, don't update any state
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load repositories";
        console.error("[PreviewDashboard] Failed to load repositories", err);
        setErrorMessage(message);
        setIsLoadingRepos(false);
      }
    },
    [canSearchRepos, selectedInstallationId, selectedTeamSlugOrIdState]
  );


  // Debounced search effect with abort controller
  useEffect(() => {
    if (!canSearchRepos || selectedInstallationId === null) {
      setRepos([]);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      void fetchRepos(repoSearch, abortController.signal);
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [repoSearch, canSearchRepos, selectedInstallationId, fetchRepos]);

  const handleContinue = useCallback((repoName: string) => {
    if (!repoName.trim()) return;
    setNavigatingRepo(repoName);
    const params = new URLSearchParams({
      repo: repoName,
      installationId: String(selectedInstallationId ?? ""),
      team: selectedTeamSlugOrIdState,
    });
    window.location.href = `/preview/configure?${params.toString()}`;
  }, [selectedInstallationId, selectedTeamSlugOrIdState]);

  useEffect(() => {
    if (selectedInstallationId !== null) {
      const abortController = new AbortController();
      void fetchRepos("", abortController.signal);
      return () => {
        abortController.abort();
      };
    } else {
      setRepos([]);
    }
  }, [selectedInstallationId, fetchRepos]);

  useEffect(() => {
    if (!selectedTeamSlugOrIdState && teamOptions[0]) {
      setSelectedTeamSlugOrIdState(teamOptions[0].slugOrId);
    }
  }, [selectedTeamSlugOrIdState, teamOptions]);

  // Repo selection box - only this part, not configured repos
  const repoSelectionBox = !isAuthenticated ? (
    <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-white/5 bg-white/[0.02]">
      <User className="h-6 w-6 text-neutral-500 mb-3" />
      <h3 className="text-base font-medium text-white mb-1.5">Sign in to continue</h3>
      <p className="text-sm text-neutral-500 mb-5 max-w-xs text-center">
        Sign in to import your repositories and capture pull requests.
      </p>
      <Button asChild className="bg-white text-black hover:bg-neutral-200">
        <Link href="/handler/sign-in?after_auth_return_to=/preview">
          Sign In
        </Link>
      </Button>
    </div>
  ) : !hasGithubAppInstallation ? (
    <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-white/5 bg-white/[0.02]">
      <Github className="h-6 w-6 text-neutral-500 mb-3" />
      <h3 className="text-base font-medium text-white mb-1.5">Connect to GitHub</h3>
      <p className="text-sm text-neutral-500 mb-5 max-w-xs text-center">
        Install the preview.new GitHub App to connect your repositories.
      </p>
      <Button
        onClick={handleInstallGithubApp}
        disabled={isInstallingApp}
        className="inline-flex items-center gap-2 bg-white text-black hover:bg-neutral-200"
      >
        {isInstallingApp ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Shield className="h-4 w-4" />
        )}
        Install GitHub App
      </Button>
      {errorMessage && (
        <p className="mt-4 text-sm text-red-400">{errorMessage}</p>
      )}
    </div>
  ) : (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-white/10">
      <div className="flex border-b border-white/10 shrink-0">
        <div className="relative border-r border-white/10">
          <Github className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          <select
            value={selectedInstallationId ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === ADD_INSTALLATION_VALUE) {
                void handleInstallGithubApp();
                return;
              }
              // Clear repos and show loading state immediately when switching accounts
              setRepos([]);
              setIsLoadingRepos(true);
              setSelectedInstallationId(Number(value));
            }}
            className="h-10 appearance-none bg-transparent py-2 pl-11 pr-8 text-sm text-white focus:outline-none"
          >
            {activeConnections.map((conn) => (
              <option key={conn.installationId} value={conn.installationId}>
                {conn.accountLogin || `ID: ${conn.installationId}`}
              </option>
            ))}
            <option value={ADD_INSTALLATION_VALUE}>Add account</option>
          </select>
          <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
            <svg className="h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <input
            type="text"
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            placeholder="Search..."
            disabled={!canSearchRepos}
            className="h-10 w-full bg-transparent py-2 pl-11 pr-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      <div
        className="flex-1 divide-y divide-white/5"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.2) transparent",
        }}
      >
        {!canSearchRepos ? (
          <div className="flex items-center justify-center h-full text-sm text-neutral-500">
            Select a team and install the GitHub App to search.
          </div>
        ) : isLoadingRepos ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          </div>
        ) : repos.length > 0 ? (
          repos.slice(0, 5).map((repo) => (
            <div
              key={repo.full_name}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Github className="h-4 w-4 text-neutral-400 shrink-0" />
                <span className="text-sm text-white">{repo.full_name}</span>
              </div>
              <Button
                onClick={() => handleContinue(repo.full_name)}
                disabled={navigatingRepo !== null || !selectedInstallationId}
                size="sm"
                className="h-6 px-3 text-xs bg-white text-black hover:bg-neutral-200 min-w-[55px]"
              >
                {navigatingRepo === repo.full_name ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Import"
                )}
              </Button>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-sm text-neutral-500">
            <p>No repositories found</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      {/* Header */}
      <div className="mb-10">
        <Link
          href="https://cmux.dev"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 transition hover:text-white mb-5"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to cmux</span>
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight text-white mb-2">
          Screenshot previews for your PRs
        </h1>
        <p className="text-base text-neutral-400 max-w-2xl">
          preview.new sets up a GitHub agent that takes screenshot previews of your dev server so you
          can visually verify your pull requests.
        </p>
      </div>

      {/* Quick Setup Input */}
      <div id="setup-preview" className="mb-10">
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <div className="relative flex-1 flex items-center">
            <Link2 className="absolute left-4 h-5 w-5 text-neutral-500" />
            <input
              type="text"
              value={repoUrlInput}
              onChange={(e) => setRepoUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleStartPreview()}
              placeholder="Enter a Git repository URL to setup screenshot previews..."
              className="w-full h-10 bg-transparent pl-11 pr-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none"
            />
          </div>
          <Button
            onClick={() => void handleStartPreview()}
            disabled={!repoUrlInput.trim() || navigatingRepo !== null || !selectedTeamSlugOrIdState}
            className="h-10 px-4 rounded-none bg-white text-black hover:bg-neutral-200 text-sm font-medium"
          >
            {navigatingRepo === "__url_input__" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Continue"
            )}
          </Button>
        </div>
        {!isAuthenticated && (
          <p className="text-xs text-neutral-500 mt-2">
            Sign in to connect private repos.
          </p>
        )}
        {errorMessage && (
          <p className="text-xs text-red-400 mt-2">{errorMessage}</p>
        )}
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Left Column Header */}
        <div className="flex items-center justify-between min-h-[34px]">
          <h2 className="text-base font-medium text-white">Choose a repository</h2>
          {isAuthenticated && teamOptions.length > 0 && (
            <div className="flex items-center gap-2.5">
              <label className="text-sm text-neutral-500">Team</label>
              <div className="relative">
                <select
                  value={selectedTeamSlugOrIdState}
                  onChange={(e) => handleTeamChange(e.target.value)}
                  className="appearance-none rounded-md border border-white/10 bg-white/5 pl-3 pr-8 py-1.5 text-sm text-white focus:border-white/20 focus:outline-none"
                >
                  {teamOptions.map((team) => (
                    <option key={team.slugOrId} value={team.slugOrId}>
                      {team.displayName}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-2">
                  <svg className="h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column Header */}
        <div className="flex items-center justify-between min-h-[34px]">
          <h2 className="text-base font-medium text-white">What is preview.new?</h2>
        </div>

        {/* Left: Repo selection box */}
        <div className="flex flex-col">
          {repoSelectionBox}
        </div>

        {/* Right: Feature cards */}
        <div className="space-y-3">
          <div className="flex items-start gap-4 rounded-lg border border-white/5 bg-white/5 p-4">
            <div className="shrink-0 rounded p-2 bg-sky-500/10 text-sky-400">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white mb-1">Screenshot agent</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                An agent boots your dev server and captures screenshots of your UI on every PR.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-lg border border-white/5 bg-white/5 p-4">
            <div className="shrink-0 rounded p-2 bg-emerald-500/10 text-emerald-400">
              <Github className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white mb-1">GitHub comments</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Screenshots are posted directly to your PR as comments for easy review.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-lg border border-white/5 bg-white/5 p-4">
            <div className="shrink-0 rounded p-2 bg-purple-500/10 text-purple-400">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white mb-1">Isolated VMs</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Each PR runs in a dedicated VM with your exact dev environment.
              </p>
            </div>
          </div>
        </div>

        {/* Left: Configured repositories */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-medium text-white">Configured repositories</h2>
            {configError && <span className="text-sm text-red-400">{configError}</span>}
          </div>
          {configs.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No preview configs yet.{" "}
              {isAuthenticated && hasGithubAppInstallation
                ? "Choose a repository above to create one."
                : "Connect GitHub and import a repository to get started."}
            </p>
          ) : (
            <TooltipProvider delayDuration={100}>
              <div className="space-y-1.5">
                {configs.map((config) => (
                  <div
                    key={config.id}
                    className="flex items-center justify-between px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Github className="h-4 w-4 text-neutral-500 shrink-0" />
                      <span className="text-sm text-white truncate">{config.repoFullName}</span>
                      <span className="text-xs text-neutral-600">{config.teamName}</span>
                      <span
                        className={clsx(
                          "text-xs px-2 py-0.5 rounded",
                          config.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : config.status === "paused"
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-neutral-500/10 text-neutral-400"
                        )}
                      >
                        {config.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => handleOpenConfig(config)}
                            disabled={openingConfigId === config.id}
                            className="p-1.5 text-neutral-500 disabled:opacity-50"
                          >
                            {openingConfigId === config.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Pencil className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Edit configuration
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConfig(config)}
                            disabled={updatingConfigId === config.id}
                            className="p-1.5 text-red-400 disabled:opacity-50"
                          >
                            {updatingConfigId === config.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Delete configuration
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            </TooltipProvider>
          )}
        </div>

        {/* Right: From creators section */}
        <div>
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-base font-medium text-white">From the creators of</h2>
            <div className="inline-flex items-center gap-1.5 text-white">
              <span className="text-blue-400">&gt;</span>
              <Link href="https://cmux.dev" className="text-md font-medium text-white hover:underline">
                cmux.dev
              </Link>
            </div>
          </div>
          <p className="text-sm text-neutral-500 mb-2">
            Want UI screenshots for your code reviews? Check out cmux - an open-source Claude Code/Codex manager with visual diffs!
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="https://github.com/manaflow-ai/cmux"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white"
            >
              <Star className="h-3.5 w-3.5" />
              Star on GitHub
            </Link>
            <Link
              href="https://cmux.dev"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Explore cmux
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
