"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ExternalLink,
  Github,
  Link2,
  Loader2,
  Pencil,
  Search,
  Server,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import CmuxLogo from "@/components/logo/cmux-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip-base";
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
import { LucideIcon } from "lucide-react";
import { useOAuthPopup } from "@/hooks/use-oauth-popup";

type ProviderConnection = {
  id: string;
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
  popupComplete?: boolean;
};

const ADD_INSTALLATION_VALUE = "__add_github_account__";

type FeatureCardProps = {
  icon: LucideIcon;
  iconBgColor: string;
  iconColor: string;
  title: string;
  description: string;
};

function GrainOverlay({ opacity = 0.08 }: { opacity?: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 mix-blend-overlay"
      style={{
        opacity,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
      }}
    />
  );
}

function FeatureCard({
  icon: _Icon,
  iconBgColor: _iconBgColor,
  iconColor: _iconColor,
  title,
  description,
}: FeatureCardProps) {
  return (
    <div className="relative flex items-start rounded-lg border border-white/5 bg-white/[0.01] backdrop-blur-sm p-4 overflow-hidden">
      <GrainOverlay />
      <div className="relative">
        <h4 className="text-sm font-medium text-white pb-1">{title}</h4>
        <p className="text-[13px] text-neutral-300/90 leading-tight">
          {description}
        </p>
      </div>
    </div>
  );
}

type SectionProps = {
  title: string;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  inlineHeader?: boolean;
};

function Section({
  title,
  headerContent,
  children,
  className,
  inlineHeader,
}: SectionProps) {
  return (
    <div className={`flex flex-col h-full ${className ?? ""}`}>
      <div
        className={`flex flex-col sm:flex-row sm:items-center ${inlineHeader ? "gap-2" : "justify-between gap-2"} h-auto sm:h-[34px] shrink-0 ${inlineHeader ? "pb-2" : "pb-3"}`}
      >
        <h2 className="text-base font-medium text-white">{title}</h2>
        {headerContent}
      </div>
      <div className="flex flex-col flex-1 min-h-0">{children}</div>
    </div>
  );
}

/**
 * Shown in popup after GitHub App installation completes.
 * Sends message to opener and auto-closes after delay.
 */
function PopupCompleteView() {
  const [canClose, setCanClose] = useState(true);

  useEffect(() => {
    if (window.opener) {
      try {
        window.opener.postMessage(
          { type: "github_app_installed" },
          window.location.origin
        );
      } catch (error) {
        console.error("[PopupComplete] Failed to post message", error);
      }

      const timer = setTimeout(() => {
        try {
          window.close();
        } catch (error) {
          console.error("[PopupComplete] Failed to close popup", error);
          setCanClose(false);
        }
      }, 1500);

      return () => clearTimeout(timer);
    } else {
      window.location.href = "/preview";
    }
  }, []);

  return (
    <div className="min-h-dvh text-white flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 grid place-items-center">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 ring-8 ring-emerald-500/5 grid place-items-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold">Installation Complete</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {canClose
            ? "Closing this window..."
            : "You can close this window and return to the previous page."}
        </p>
        {!canClose && (
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-medium text-black transition-colors hover:bg-neutral-200"
          >
            Close Window
          </button>
        )}
      </div>
    </div>
  );
}

/** Opens a centered popup window */
function openCenteredPopup(
  url: string,
  name: string,
  width: number,
  height: number
) {
  const screenLeft = window.screenLeft ?? window.screenX;
  const screenTop = window.screenTop ?? window.screenY;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  const left = screenLeft + (screenWidth - width) / 2;
  const top = screenTop + (screenHeight - height) / 2;

  const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  return window.open(url, name, features);
}

// Create a stable QueryClient instance for the preview dashboard
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function PreviewDashboard(props: PreviewDashboardProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <PreviewDashboardInner {...props} />
    </QueryClientProvider>
  );
}

function PreviewDashboardInner({
  selectedTeamSlugOrId,
  teamOptions,
  providerConnectionsByTeam,
  isAuthenticated,
  previewConfigs,
  popupComplete,
}: PreviewDashboardProps) {
  const [selectedTeamSlugOrIdState, setSelectedTeamSlugOrIdState] = useState(
    () => selectedTeamSlugOrId || teamOptions[0]?.slugOrId || ""
  );
  const [isInstallingApp, setIsInstallingApp] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Repository selection state
  const [selectedInstallationId, setSelectedInstallationId] = useState<
    number | null
  >(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState("");
  const [navigatingRepo, setNavigatingRepo] = useState<string | null>(null);
  const [configs, setConfigs] =
    useState<PreviewConfigListItem[]>(previewConfigs);
  const [updatingConfigId, setUpdatingConfigId] = useState<string | null>(null);
  const [openingConfigId, setOpeningConfigId] = useState<string | null>(null);
  const [configPendingDelete, setConfigPendingDelete] =
    useState<PreviewConfigListItem | null>(null);

  // OAuth sign-in with popup
  const { signInWithPopup, signingInProvider } = useOAuthPopup();

  // Public URL input state
  const [repoUrlInput, setRepoUrlInput] = useState("");

  const currentProviderConnections = useMemo(
    () => providerConnectionsByTeam[selectedTeamSlugOrIdState] ?? [],
    [providerConnectionsByTeam, selectedTeamSlugOrIdState]
  );
  const activeConnections = useMemo(
    () =>
      currentProviderConnections.filter((connection) => connection.isActive),
    [currentProviderConnections]
  );
  const previousTeamRef = useRef(selectedTeamSlugOrIdState);
  const hasGithubAppInstallation = activeConnections.length > 0;
  const canSearchRepos =
    isAuthenticated &&
    Boolean(selectedTeamSlugOrIdState) &&
    hasGithubAppInstallation;

  // Debounce search input
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedRepoSearch(repoSearch.trim());
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [repoSearch]);

  // Fetch repos using TanStack Query
  const reposQuery = useQuery({
    queryKey: [
      "github-repos",
      selectedTeamSlugOrIdState,
      selectedInstallationId,
      debouncedRepoSearch,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        team: selectedTeamSlugOrIdState,
        installationId: String(selectedInstallationId),
      });
      if (debouncedRepoSearch) {
        params.set("search", debouncedRepoSearch);
      }
      const response = await fetch(
        `/api/integrations/github/repos?${params.toString()}`,
        { signal }
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json() as Promise<{ repos: RepoSearchResult[] }>;
    },
    enabled: canSearchRepos && selectedInstallationId !== null,
    staleTime: 30_000,
  });

  const repos: RepoSearchResult[] = useMemo(() => {
    if (!reposQuery.data?.repos) return [];
    // When no search, limit to 5 results
    return debouncedRepoSearch ? reposQuery.data.repos : reposQuery.data.repos.slice(0, 5);
  }, [reposQuery.data?.repos, debouncedRepoSearch]);

  const isLoadingRepos = reposQuery.isLoading || reposQuery.isFetching;

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
      const ownerRepoMatch = trimmed.match(
        /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/
      );
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

  const handleRequestDelete = useCallback((config: PreviewConfigListItem) => {
    setConfigError(null);
    setConfigPendingDelete(config);
  }, []);

  const handleDeleteConfig = useCallback(async () => {
    if (!configPendingDelete) return;
    setUpdatingConfigId(configPendingDelete.id);
    setConfigError(null);
    try {
      const params = new URLSearchParams({
        teamSlugOrId: configPendingDelete.teamSlugOrId,
      });
      const response = await fetch(
        `/api/preview/configs/${configPendingDelete.id}?${params.toString()}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        }
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setConfigs((previous) =>
        previous.filter((item) => item.id !== configPendingDelete.id)
      );
      setConfigPendingDelete(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete preview configuration";
      console.error(
        "[PreviewDashboard] Failed to delete preview configuration",
        error
      );
      setConfigError(message);
    } finally {
      setUpdatingConfigId(null);
    }
  }, [configPendingDelete]);

  const handleCancelDelete = useCallback(() => {
    setConfigPendingDelete(null);
  }, []);

  const handleTeamChange = useCallback((nextTeam: string) => {
    setSelectedTeamSlugOrIdState(nextTeam);
    setSelectedInstallationId(null);
    setRepoSearch("");
    setErrorMessage(null);
  }, []);

  const handleStartPreview = useCallback(async () => {
    const repoName = parseGithubUrl(repoUrlInput);
    if (!repoName) {
      setErrorMessage("Please enter a valid GitHub URL or owner/repo");
      return;
    }

    // For unauthenticated users, redirect to sign-in without requiring team selection
    if (!isAuthenticated) {
      const params = new URLSearchParams({ repo: repoName });
      // Include team if available, otherwise the configure page will handle it after sign-in
      if (selectedTeamSlugOrIdState) {
        params.set("team", selectedTeamSlugOrIdState);
      }
      const configurePath = `/preview/configure?${params.toString()}`;
      setErrorMessage(null);
      setNavigatingRepo("__url_input__");
      window.location.href = `/handler/sign-in?after_auth_return_to=${encodeURIComponent(configurePath)}`;
      return;
    }

    if (!selectedTeamSlugOrIdState) {
      setErrorMessage("Select a team before continuing.");
      return;
    }

    const params = new URLSearchParams({ repo: repoName });
    params.set("team", selectedTeamSlugOrIdState);
    const configurePath = `/preview/configure?${params.toString()}`;

    if (!hasGithubAppInstallation) {
      setErrorMessage(null);
      setIsInstallingApp(true);
      setNavigatingRepo("__url_input__");

      try {
        const response = await fetch("/api/integrations/github/install-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamSlugOrId: selectedTeamSlugOrIdState,
            returnUrl: new URL(
              configurePath,
              window.location.origin
            ).toString(),
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

        const url = new URL(
          `https://github.com/apps/${githubAppSlug}/installations/new`
        );
        url.searchParams.set("state", payload.state);
        window.location.href = url.toString();
        return;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to start GitHub App install";
        console.error(
          "[PreviewDashboard] Failed to start GitHub App install",
          error
        );
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

  // Popup ref and listener for GitHub App installation
  const installPopupRef = useRef<Window | null>(null);

  // Listen for GitHub App installation completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "github_app_installed") {
        setIsInstallingApp(false);
        // Reload to get the new installation
        window.location.reload();
      }
    };

    const handleFocus = () => {
      // Check if popup was closed when we regain focus
      if (installPopupRef.current && isInstallingApp) {
        setTimeout(() => {
          try {
            if (installPopupRef.current?.closed) {
              setIsInstallingApp(false);
              installPopupRef.current = null;
            }
          } catch {
            // Ignore cross-origin errors
          }
        }, 500);
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isInstallingApp]);

  const handleInstallGithubApp = async () => {
    if (!selectedTeamSlugOrIdState) {
      setErrorMessage("Select a team first");
      return;
    }

    setIsInstallingApp(true);
    setErrorMessage(null);
    try {
      // Use popup_complete query param as returnUrl so it can signal the parent window and close
      const popupCompleteUrl = new URL(
        "/preview?popup_complete=true",
        window.location.origin
      ).toString();

      const response = await fetch("/api/integrations/github/install-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId: selectedTeamSlugOrIdState,
          returnUrl: popupCompleteUrl,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as { installUrl: string };

      // Open centered popup for GitHub App installation
      const popup = openCenteredPopup(
        payload.installUrl,
        "github-app-install",
        1000,
        700
      );

      if (!popup) {
        // Popup was blocked - fall back to redirect
        console.warn(
          "[PreviewDashboard] Popup blocked, falling back to redirect"
        );
        window.location.href = payload.installUrl;
        return;
      }

      installPopupRef.current = popup;
      popup.focus();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start GitHub App install";
      console.error(
        "[PreviewDashboard] Failed to start GitHub App install",
        error
      );
      setErrorMessage(message);
      setIsInstallingApp(false);
    }
  };

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
    if (!selectedTeamSlugOrIdState && teamOptions[0]) {
      setSelectedTeamSlugOrIdState(teamOptions[0].slugOrId);
    }
  }, [selectedTeamSlugOrIdState, teamOptions]);

  // Repo selection box - only this part, not configured repos
  const repoSelectionBox = !isAuthenticated ? (
    <div className="relative flex flex-1 flex-col items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] backdrop-blur-sm px-4 py-10 overflow-hidden">
      <GrainOverlay opacity={0.02} />
      <p className="text-sm text-neutral-300/85 pb-6 max-w-xs text-center">
        Select a Git provider to import a Git Repository
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button
          onClick={() => signInWithPopup("github")}
          disabled={signingInProvider !== null}
          className="w-full h-10 bg-[#24292f] text-white hover:bg-[#32383f] inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {signingInProvider === "github" ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <svg
              className="h-[18px] w-[18px] shrink-0"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
          )}
          Continue with GitHub
        </Button>
        <Button
          onClick={() => signInWithPopup("gitlab")}
          disabled={signingInProvider !== null}
          className="w-full h-10 bg-[#fc6d26] text-white hover:bg-[#ff8245] inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {signingInProvider === "gitlab" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg
              className="h-4 w-4 shrink-0"
              viewBox="90 90 200 175"
              fill="currentColor"
            >
              <path d="M282.83,170.73l-.27-.69-26.14-68.22a6.81,6.81,0,0,0-2.69-3.24,7,7,0,0,0-8,.43,7,7,0,0,0-2.32,3.52l-17.65,54H154.29l-17.65-54A6.86,6.86,0,0,0,134.32,99a7,7,0,0,0-8-.43,6.87,6.87,0,0,0-2.69,3.24L97.44,170l-.26.69a48.54,48.54,0,0,0,16.1,56.1l.09.07.24.17,39.82,29.82,19.7,14.91,12,9.06a8.07,8.07,0,0,0,9.76,0l12-9.06,19.7-14.91,40.06-30,.1-.08A48.56,48.56,0,0,0,282.83,170.73Z" />
            </svg>
          )}
          Continue with GitLab
        </Button>
        <Button
          onClick={() => signInWithPopup("bitbucket")}
          disabled={signingInProvider !== null}
          className="w-full h-10 bg-[#0052cc] text-white hover:bg-[#006cf2] inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {signingInProvider === "bitbucket" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg className="h-4 w-4 shrink-0" viewBox="-2 -2 65 59">
              <defs>
                <linearGradient
                  id="bitbucket-grad"
                  x1="104.953%"
                  x2="46.569%"
                  y1="21.921%"
                  y2="75.234%"
                >
                  <stop
                    offset="7%"
                    stopColor="currentColor"
                    stopOpacity="0.4"
                  />
                  <stop offset="100%" stopColor="currentColor" />
                </linearGradient>
              </defs>
              <path
                d="M59.696 18.86h-18.77l-3.15 18.39h-13L9.426 55.47a2.71 2.71 0 001.75.66h40.74a2 2 0 002-1.68l5.78-35.59z"
                fill="url(#bitbucket-grad)"
                fillRule="nonzero"
                transform="translate(-.026 .82)"
              />
              <path
                d="M2 .82a2 2 0 00-2 2.32l8.49 51.54a2.7 2.7 0 00.91 1.61 2.71 2.71 0 001.75.66l15.76-18.88H24.7l-3.47-18.39h38.44l2.7-16.53a2 2 0 00-2-2.32L2 .82z"
                fill="currentColor"
                fillRule="nonzero"
              />
            </svg>
          )}
          Continue with Bitbucket
        </Button>
      </div>
    </div>
  ) : !hasGithubAppInstallation ? (
    <div className="relative flex flex-1 flex-col items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] backdrop-blur-sm overflow-hidden py-16 sm:py-10">
      <GrainOverlay opacity={0.02} />
      <h3 className="text-base font-medium text-white pb-5">
        No connected repositories
      </h3>
      <Button
        onClick={handleInstallGithubApp}
        disabled={isInstallingApp}
        className="inline-flex items-center gap-2 bg-white text-black hover:bg-neutral-200"
      >
        {isInstallingApp ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
          </svg>
        )}
        Add repositories
      </Button>
      {errorMessage && (
        <p className="pt-4 text-sm text-red-400">{errorMessage}</p>
      )}
    </div>
  ) : (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-white/10">
      <div className="flex border-b border-white/10 shrink-0">
        <div className="relative border-r border-white/10">
          {isInstallingApp ? (
            <Loader2 className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-white" />
          ) : (
            <svg
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4"
              viewBox="0 0 24 24"
              fill="white"
            >
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
          )}
          <select
            value={selectedInstallationId ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === ADD_INSTALLATION_VALUE) {
                void handleInstallGithubApp();
                return;
              }
              setSelectedInstallationId(Number(value));
            }}
            disabled={isInstallingApp}
            className="h-10 appearance-none bg-transparent py-2 pl-11 pr-8 text-sm text-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {activeConnections.map((conn) => (
              <option key={conn.id} value={conn.installationId}>
                {conn.accountLogin || `ID: ${conn.installationId}`}
              </option>
            ))}
            <option value={ADD_INSTALLATION_VALUE}>Add account</option>
          </select>
          <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
            <svg
              className="h-4 w-4 text-neutral-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
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
          <div className="flex items-center justify-center h-full min-h-[225px]">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          </div>
        ) : repos.length > 0 ? (
          repos.slice(0, 5).map((repo) => (
            <div
              key={repo.full_name}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <svg
                  className="h-4 w-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="white"
                >
                  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
                <span className="text-sm text-white truncate">
                  {repo.full_name}
                </span>
              </div>
              <Button
                onClick={() => handleContinue(repo.full_name)}
                disabled={navigatingRepo !== null || !selectedInstallationId}
                size="sm"
                className="h-6 px-3 text-xs bg-white text-black hover:bg-neutral-200 min-w-[55px] cursor-pointer"
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

  // Render popup complete UI if in popup mode
  if (popupComplete) {
    return <PopupCompleteView />;
  }

  return (
    <div className="w-full max-w-5xl px-6 py-10 font-sans">
      {/* Header */}
      <div className="pb-10">
        <Link
          href="https://cmux.dev"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 transition hover:text-white pb-5"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to cmux</span>
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight text-white pb-2">
          Screenshot previews for GitHub PRs
        </h1>
        <p className="text-lg text-neutral-300/85 max-w-2xl">
          Code review agent that takes screenshots of code diffs involving UI
          changes
        </p>
      </div>

      {/* Quick Setup Input */}
      <div id="setup-preview" className="pb-10">
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <div className="relative flex-1 flex items-center bg-white/5 backdrop-blur-sm">
            <Link2 className="absolute left-4 h-5 w-5 text-neutral-500 z-10" />
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
            disabled={
              !repoUrlInput.trim() ||
              navigatingRepo !== null ||
              (isAuthenticated && !selectedTeamSlugOrIdState)
            }
            className="h-10 px-4 rounded-none bg-white/90 backdrop-blur-sm text-black hover:bg-white text-sm font-medium"
          >
            {navigatingRepo === "__url_input__" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Continue"
            )}
          </Button>
        </div>
        {errorMessage && (
          <p className="text-xs text-red-400 pt-2">{errorMessage}</p>
        )}
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Left Column: Choose a repository */}
        <Section
          title="Choose a repository"
          headerContent={
            isAuthenticated && teamOptions.length > 0 ? (
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
                    <svg
                      className="h-4 w-4 text-neutral-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            ) : undefined
          }
        >
          {repoSelectionBox}
        </Section>

        {/* Right Column: What is preview.new? */}
        <Section title="What is preview.new?">
          <div className="space-y-3">
            <FeatureCard
              icon={Camera}
              iconBgColor="bg-sky-500/10"
              iconColor="text-sky-400"
              title="Computer use agent"
              description="An agent boots your dev server and captures screenshots of your UI on every PR."
            />
            <FeatureCard
              icon={Github}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-400"
              title="GitHub comments"
              description="Screenshots are posted directly to your PR as comments for easy review."
            />
            <FeatureCard
              icon={Server}
              iconBgColor="bg-purple-500/10"
              iconColor="text-purple-400"
              title="Isolated dev servers"
              description="Each PR runs in a dedicated VM with your exact dev environment."
            />
          </div>
        </Section>

        {/* Configured repositories and From creators */}
        <div className="pt-4 lg:col-span-2 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* Left: Configured repositories */}
          <Section
            title="Configured repositories"
            headerContent={
              configError ? (
                <span className="text-sm text-red-400">{configError}</span>
              ) : undefined
            }
          >
            {configs.length === 0 ? (
              <p className="text-sm text-neutral-400">
                No preview configs yet.{" "}
                {isAuthenticated && hasGithubAppInstallation
                  ? "Choose a repository above to create one."
                  : "Connect GitHub and import a repository to get started."}
              </p>
            ) : (
              <TooltipProvider>
                <div className="space-y-1.5">
                  {configs.map((config) => (
                    <div
                      key={config.id}
                      className="flex items-center justify-between pl-0 pr-3 py-1"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <svg
                          className="h-4 w-4 shrink-0"
                          viewBox="0 0 24 24"
                          fill="white"
                        >
                          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                        </svg>
                        <span className="text-sm text-white truncate">
                          {config.repoFullName}
                        </span>
                        <div className="flex items-center gap-2.5 translate-y-[0.5px]">
                          <span className="text-xs text-neutral-600">
                            {config.teamName}
                          </span>
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
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild delayDuration={0}>
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
                          <TooltipTrigger asChild delayDuration={0}>
                            <button
                              type="button"
                              onClick={() => handleRequestDelete(config)}
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
          </Section>

          {/* Right: From creators section */}
          <Section
            title="From the creators of"
            inlineHeader={true}
            headerContent={
              <Link
                href="https://cmux.dev"
                className="inline-flex items-center hover:opacity-80 transition-opacity"
                style={{ transform: "translate(-2.5px, -0.5px)" }}
              >
                <CmuxLogo
                  height="2em"
                  wordmarkText="cmux.dev"
                  wordmarkFill="#fff"
                />
              </Link>
            }
          >
            <p className="text-sm text-neutral-400 pb-2">
              Want UI screenshots for your code reviews? Check out cmux - an
              open-source Claude Code/Codex manager with visual diffs!
            </p>
            <div className="flex items-center gap-3 pt-2">
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
          </Section>
        </div>
      </div>

      <AlertDialog
        open={configPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && updatingConfigId !== configPendingDelete?.id) {
            handleCancelDelete();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="rounded-full bg-red-500/10 p-2 text-red-400">
              <Trash2 className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <AlertDialogTitle>Delete configuration?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove{" "}
                <span className="text-white">
                  {configPendingDelete?.repoFullName}
                </span>{" "}
                from preview.new? This stops screenshot previews for this
                repository.
              </AlertDialogDescription>
            </div>
          </AlertDialogHeader>
          {configError && (
            <p className="pt-3 text-sm text-red-400">{configError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button
                disabled={updatingConfigId === configPendingDelete?.id}
                variant="secondary"
              >
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => void handleDeleteConfig()}
                disabled={updatingConfigId === configPendingDelete?.id}
                variant="destructive"
              >
                {updatingConfigId === configPendingDelete?.id ? (
                  <Loader2 className="pr-2 h-4 w-4 animate-spin" />
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
