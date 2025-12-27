import { env } from "@/client-env";
import { GitHubIcon } from "@/components/icons/github";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@cmux/convex/api";
import { DEFAULT_MORPH_SNAPSHOT_ID, type MorphSnapshotId } from "@cmux/shared";
import { isElectron } from "@/lib/electron";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, X } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RepositoryAdvancedOptions } from "./RepositoryAdvancedOptions";

function formatTimeAgo(input?: string | number): string {
  if (!input) return "";
  const ts = typeof input === "number" ? input : Date.parse(input);
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}

interface ConnectionContext {
  selectedLogin: string | null;
  installationId: number | null;
  hasConnections: boolean;
}

interface RepositoryConnectionsSectionProps {
  teamSlugOrId: string;
  selectedLogin: string | null;
  onSelectedLoginChange: (login: string | null) => void;
  onContextChange: (context: ConnectionContext) => void;
  onConnectionsInvalidated: () => void;
  onInstallHandlerReady: (handler: (() => void) | null) => void;
}

interface RepositoryListSectionProps {
  teamSlugOrId: string;
  installationId: number | null;
  selectedRepos: readonly string[];
  onToggleRepo: (repo: string) => void;
  onAddRepo: (repo: string) => void;
  hasConnections: boolean;
  onInstallGitHubApp: () => void;
}

export interface RepositoryPickerProps {
  teamSlugOrId: string;
  instanceId?: string;
  initialSelectedRepos?: string[];
  initialSnapshotId?: MorphSnapshotId;
  showHeader?: boolean;
  showContinueButton?: boolean;
  showManualConfigOption?: boolean;
  continueButtonText?: string;
  manualConfigButtonText?: string;
  headerTitle?: string;
  headerDescription?: string;
  className?: string;
  onStartConfigure?: (payload: {
    selectedRepos: string[];
    instanceId?: string;
    snapshotId?: MorphSnapshotId;
  }) => void;
  topAccessory?: ReactNode;
  /**
   * Auto-continue to configure step when repos are selected.
   * If a number, it's the delay in ms before auto-continuing.
   * If true, uses default delay of 800ms.
   * If false or undefined, no auto-continue.
   */
  autoContinue?: boolean | number;
}

export function RepositoryPicker({
  teamSlugOrId,
  instanceId,
  initialSelectedRepos = [],
  initialSnapshotId,
  showHeader = true,
  showContinueButton = true,
  showManualConfigOption = true,
  continueButtonText = "Continue",
  manualConfigButtonText = "Configure manually",
  headerTitle = "Select Repositories",
  headerDescription = "Choose repositories to include in your environment.",
  className = "",
  onStartConfigure,
  topAccessory,
  autoContinue,
}: RepositoryPickerProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const [selectedRepos, setSelectedRepos] = useState<string[]>(() =>
    Array.from(new Set(initialSelectedRepos))
  );
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<MorphSnapshotId>(
    initialSnapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID
  );
  const [selectedConnectionLogin, setSelectedConnectionLogin] = useState<
    string | null
  >(null);
  const [connectionContext, setConnectionContext] = useState<ConnectionContext>(
    {
      selectedLogin: null,
      installationId: null,
      hasConnections: false,
    }
  );


  useEffect(() => {
    if (initialSnapshotId) {
      setSelectedSnapshotId(initialSnapshotId);
    } else {
      setSelectedSnapshotId(DEFAULT_MORPH_SNAPSHOT_ID);
    }
  }, [initialSnapshotId]);

  const handleConnectionsInvalidated = useCallback((): void => {
    const qc = router.options.context?.queryClient;
    if (qc) {
      qc.invalidateQueries();
    }
    window.focus?.();
  }, [router]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as unknown;
      if (
        data &&
        typeof data === "object" &&
        (data as { type?: string }).type === "cmux/github-install-complete"
      ) {
        handleConnectionsInvalidated();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleConnectionsInvalidated]);

  const resolveInstanceId = useCallback(
    (routeInstanceId?: string, provisionedInstanceId?: string) => {
      if (routeInstanceId) return routeInstanceId;
      if (instanceId) return instanceId;
      return provisionedInstanceId;
    },
    [instanceId]
  );

  // Helper to check if repos are the same (order-independent)
  const haveSameRepos = useCallback(
    (a: readonly string[], b: readonly string[]): boolean => {
      if (a.length !== b.length) return false;
      const setA = new Set(a);
      return b.every((repo) => setA.has(repo));
    },
    []
  );

  const goToConfigure = useCallback(
    async (
      repos: string[],
      options?: { clearInstanceId?: boolean }
    ): Promise<string | undefined> => {
      let resolvedInstanceId: string | undefined;
      const navigateToConfigure = async (navOptions?: { replace?: boolean }) => {
        await navigate({
          to: "/$teamSlugOrId/environments/new",
          params: { teamSlugOrId },
          search: (prev) => {
            // If clearInstanceId is set, don't include instanceId - we need a new VM
            resolvedInstanceId = options?.clearInstanceId
              ? undefined
              : resolveInstanceId(prev.instanceId, undefined);
            return {
              step: "configure",
              selectedRepos: repos,
              instanceId: resolvedInstanceId,
              connectionLogin: prev.connectionLogin,
              repoSearch: prev.repoSearch,
              snapshotId: selectedSnapshotId,
            };
          },
          ...navOptions,
        });
      };

      await navigateToConfigure();
      return resolvedInstanceId;
    },
    [
      navigate,
      resolveInstanceId,
      selectedSnapshotId,
      teamSlugOrId,
    ]
  );

  const handleContinue = useCallback(
    (repos: string[]): void => {
      // Check if repos or snapshot changed - if so, we need a new VM
      const reposChanged = !haveSameRepos(initialSelectedRepos, repos);
      const snapshotChanged = initialSnapshotId !== selectedSnapshotId;
      const needsNewInstance = reposChanged || snapshotChanged;

      // Navigate immediately - provisioning will happen on the configure page
      void goToConfigure(repos, { clearInstanceId: needsNewInstance });
      onStartConfigure?.({
        selectedRepos: repos,
        instanceId: needsNewInstance ? undefined : instanceId,
        snapshotId: selectedSnapshotId,
      });
    },
    [
      goToConfigure,
      haveSameRepos,
      initialSelectedRepos,
      initialSnapshotId,
      instanceId,
      onStartConfigure,
      selectedSnapshotId,
    ]
  );

  const updateSnapshotSelection = useCallback(
    (nextSnapshotId: MorphSnapshotId) => {
      const shouldResetInstanceId = nextSnapshotId !== selectedSnapshotId;
      setSelectedSnapshotId(nextSnapshotId);
      void navigate({
        to: "/$teamSlugOrId/environments/new",
        params: { teamSlugOrId },
        search: (prev) => ({
          step: prev.step ?? "select",
          selectedRepos: prev.selectedRepos ?? [],
          instanceId: shouldResetInstanceId ? undefined : prev.instanceId,
          connectionLogin: prev.connectionLogin,
          repoSearch: prev.repoSearch,
          snapshotId: nextSnapshotId,
        }),
        replace: true,
      });
    },
    [navigate, selectedSnapshotId, teamSlugOrId]
  );

  const toggleRepo = useCallback((repo: string) => {
    setSelectedRepos((prev) => {
      if (prev.includes(repo)) {
        return prev.filter((item) => item !== repo);
      }
      return [...prev, repo];
    });
  }, []);

  const addRepo = useCallback((repo: string) => {
    setSelectedRepos((prev) => {
      if (prev.includes(repo)) {
        return prev;
      }
      return [...prev, repo];
    });
  }, []);

  const removeRepo = useCallback((repo: string) => {
    setSelectedRepos((prev) => prev.filter((item) => item !== repo));
  }, []);

  // GitHub app install handler - lifted from RepositoryConnectionsSection for use in RepositoryListSection
  const [installGitHubAppHandler, setInstallGitHubAppHandler] = useState<
    (() => void) | null
  >(null);

  const setConnectionContextSafe = useCallback((ctx: ConnectionContext) => {
    setConnectionContext((prev) => {
      if (
        prev.selectedLogin === ctx.selectedLogin &&
        prev.installationId === ctx.installationId &&
        prev.hasConnections === ctx.hasConnections
      ) {
        return prev;
      }
      return ctx;
    });
  }, []);

  // Auto-continue to configure step when repos are selected
  const autoContinueTriggeredRef = useRef(false);
  useEffect(() => {
    // Skip if auto-continue is disabled
    if (!autoContinue) {
      return;
    }

    // Skip if no repos selected
    if (selectedRepos.length === 0) {
      autoContinueTriggeredRef.current = false;
      return;
    }

    // Skip if already triggered
    if (autoContinueTriggeredRef.current) {
      return;
    }

    const delay = typeof autoContinue === "number" ? autoContinue : 800;
    const timeoutId = window.setTimeout(() => {
      autoContinueTriggeredRef.current = true;
      handleContinue(selectedRepos);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoContinue, selectedRepos, handleContinue]);

  return (
    <div className={className}>
      {topAccessory ? <div className="mb-4">{topAccessory}</div> : null}
      {showHeader && (
        <>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {headerTitle}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {headerDescription}
          </p>
        </>
      )}

      <div className="space-y-6 mt-6">
        {/* Hidden - provides context and install handler without visible UI */}
        <RepositoryConnectionsSection
          teamSlugOrId={teamSlugOrId}
          selectedLogin={selectedConnectionLogin}
          onSelectedLoginChange={setSelectedConnectionLogin}
          onContextChange={setConnectionContextSafe}
          onConnectionsInvalidated={handleConnectionsInvalidated}
          onInstallHandlerReady={setInstallGitHubAppHandler}
        />

        <RepositoryListSection
          teamSlugOrId={teamSlugOrId}
          installationId={connectionContext.installationId}
          selectedRepos={selectedRepos}
          onToggleRepo={toggleRepo}
          onAddRepo={addRepo}
          hasConnections={connectionContext.hasConnections}
          onInstallGitHubApp={installGitHubAppHandler ?? (() => {})}
        />

        {selectedRepos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedRepos.map((fullName) => (
              <span
                key={fullName}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 px-2 py-1 text-xs"
              >
                <button
                  type="button"
                  aria-label={`Remove ${fullName}`}
                  onClick={() => removeRepo(fullName)}
                  className="-ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  <X className="h-3 w-3" />
                </button>
                <GitHubIcon className="h-3 w-3 shrink-0 text-neutral-700 dark:text-neutral-300" />
                {fullName}
              </span>
            ))}
          </div>
        ) : null}

        <RepositoryAdvancedOptions
          selectedSnapshotId={selectedSnapshotId}
          onSnapshotChange={updateSnapshotSelection}
        />

        {showContinueButton && (
          <>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleContinue(selectedRepos)}
                className="inline-flex items-center gap-2 rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {continueButtonText}
              </button>
              {showManualConfigOption && (
                <button
                  type="button"
                  onClick={() => handleContinue([])}
                  className="inline-flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  {manualConfigButtonText}
                </button>
              )}
            </div>
            {showManualConfigOption && (
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                You can also manually configure an environment from a bare VM.
                We'll capture your changes as a reusable base snapshot.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RepositoryConnectionsSection({
  teamSlugOrId,
  selectedLogin,
  onSelectedLoginChange,
  onContextChange,
  onConnectionsInvalidated,
  onInstallHandlerReady,
}: RepositoryConnectionsSectionProps) {
  const connections = useQuery(api.github.listProviderConnections, {
    teamSlugOrId,
  });
  const mintState = useMutation(api.github_app.mintInstallState);

  const activeConnections = useMemo(
    () => (connections || []).filter((c) => c.isActive !== false),
    [connections]
  );

  const currentLogin = useMemo(() => {
    if (selectedLogin) return selectedLogin;
    if (activeConnections.length > 0) {
      return activeConnections[0]?.accountLogin ?? null;
    }
    return null;
  }, [selectedLogin, activeConnections]);

  useEffect(() => {
    if (!selectedLogin && currentLogin) {
      onSelectedLoginChange(currentLogin);
    }
  }, [currentLogin, onSelectedLoginChange, selectedLogin]);

  const selectedInstallationId = useMemo(() => {
    const match = activeConnections.find(
      (c) => c.accountLogin === currentLogin
    );
    return (
      match?.installationId ?? activeConnections[0]?.installationId ?? null
    );
  }, [activeConnections, currentLogin]);

  const installNewUrl = env.NEXT_PUBLIC_GITHUB_APP_SLUG
    ? `https://github.com/apps/${env.NEXT_PUBLIC_GITHUB_APP_SLUG}/installations/new`
    : null;

  useEffect(() => {
    onContextChange({
      selectedLogin: currentLogin,
      installationId: selectedInstallationId,
      hasConnections: activeConnections.length > 0,
    });
  }, [
    activeConnections.length,
    currentLogin,
    onContextChange,
    selectedInstallationId,
  ]);

  const watchPopupClosed = useCallback(
    (win: Window | null, onClose: () => void) => {
      if (!win) return;
      const timer = window.setInterval(() => {
        try {
          if (win.closed) {
            window.clearInterval(timer);
            onClose();
          }
        } catch (_error) {
          void 0;
        }
      }, 600);
    },
    []
  );

  const openCenteredPopup = useCallback(
    (
      url: string,
      opts?: { name?: string; width?: number; height?: number },
      onClose?: () => void
    ): Window | null => {
      if (isElectron) {
        window.open(url, "_blank", "noopener,noreferrer");
        return null;
      }
      const name = opts?.name ?? "cmux-popup";
      const width = Math.floor(opts?.width ?? 980);
      const height = Math.floor(opts?.height ?? 780);
      const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
      const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
      const outerWidth = window.outerWidth || window.innerWidth || width;
      const outerHeight = window.outerHeight || window.innerHeight || height;
      const left = Math.max(0, dualScreenLeft + (outerWidth - width) / 2);
      const top = Math.max(0, dualScreenTop + (outerHeight - height) / 2);
      const features = [
        `width=${width}`,
        `height=${height}`,
        `left=${Math.floor(left)}`,
        `top=${Math.floor(top)}`,
        "resizable=yes",
        "scrollbars=yes",
        "toolbar=no",
        "location=no",
        "status=no",
        "menubar=no",
      ].join(",");

      const win = window.open("about:blank", name, features);
      if (win) {
        try {
          (win as Window & { opener: null | Window }).opener = null;
        } catch (_error) {
          void 0;
        }
        try {
          win.location.href = url;
        } catch (_error) {
          window.open(url, "_blank");
        }
        win.focus?.();
        if (onClose) watchPopupClosed(win, onClose);
        return win;
      } else {
        window.open(url, "_blank");
        return null;
      }
    },
    [watchPopupClosed]
  );

  const handlePopupClosedRefetch = useCallback(() => {
    onConnectionsInvalidated();
  }, [onConnectionsInvalidated]);

  const handleInstallApp = useCallback(async () => {
    if (!installNewUrl) return;
    try {
      const { state } = await mintState({ teamSlugOrId });
      const sep = installNewUrl.includes("?") ? "&" : "?";
      const url = `${installNewUrl}${sep}state=${encodeURIComponent(state)}`;
      openCenteredPopup(
        url,
        { name: "github-install" },
        handlePopupClosedRefetch
      );
    } catch (err) {
      console.error("Failed to start GitHub install:", err);
      alert("Failed to start installation. Please try again.");
    }
  }, [
    handlePopupClosedRefetch,
    installNewUrl,
    mintState,
    openCenteredPopup,
    teamSlugOrId,
  ]);

  // Expose the install handler to parent component
  // Note: We use the functional update form (() => handler) because onInstallHandlerReady
  // is a setState function. If we pass a function directly, React will CALL it thinking
  // it's a state updater. Wrapping in () => handler ensures the handler itself is stored.
  useEffect(() => {
    if (installNewUrl) {
      const handler = () => {
        void handleInstallApp();
      };
      onInstallHandlerReady(() => handler);
    } else {
      onInstallHandlerReady(() => null);
    }
  }, [handleInstallApp, installNewUrl, onInstallHandlerReady]);

  // This component now only provides data/context without rendering any UI
  return null;
}

// Helper to parse GitHub repo URL or owner/repo format
function parseGitHubRepo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Handle owner/repo format directly
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return trimmed;
  }

  // Handle GitHub URLs
  try {
    const url = new URL(trimmed);
    if (url.hostname === "github.com" || url.hostname === "www.github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        // Remove .git suffix if present
        const repoName = parts[1].replace(/\.git$/, "");
        return `${parts[0]}/${repoName}`;
      }
    }
  } catch {
    // Not a valid URL, ignore
  }

  return null;
}

function RepositoryListSection({
  teamSlugOrId,
  installationId: _installationId,
  selectedRepos,
  onToggleRepo,
  onAddRepo,
  hasConnections,
  onInstallGitHubApp,
}: RepositoryListSectionProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  // Use Convex to fetch synced repos (same as dashboard) for consistent experience
  const allReposQuery = useQuery(api.github.getAllRepos, { teamSlugOrId });

  const filteredRepos = useMemo(() => {
    const repos = allReposQuery ?? [];
    const q = deferredSearch.trim().toLowerCase();
    // Map to the expected format and add timestamp for sorting
    const withTs = repos.map((r) => ({
      name: r.name,
      full_name: r.fullName,
      private: r.visibility === "private",
      updated_at: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
      pushed_at: r.lastPushedAt ? new Date(r.lastPushedAt).toISOString() : null,
      _ts: r.lastPushedAt ?? r.lastSyncedAt ?? 0,
    }));
    let list = withTs.sort((a, b) => b._ts - a._ts);
    if (q) {
      list = list.filter(
        (r) =>
          r.full_name.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [deferredSearch, allReposQuery]);

  const showReposLoading = allReposQuery === undefined && hasConnections;
  const showSpinner = false; // No need for spinner with Convex reactive queries
  const selectedSet = useMemo(() => new Set(selectedRepos), [selectedRepos]);

  // Handle Enter key to add repo from URL/owner-repo format
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && search.trim()) {
        e.preventDefault();
        const parsed = parseGitHubRepo(search);
        if (parsed) {
          onAddRepo(parsed);
          setSearch("");
        }
      }
    },
    [search, onAddRepo]
  );

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
        Repositories
      </label>
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search repositories or paste a GitHub URL..."
          aria-busy={showSpinner}
          className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 pr-8 h-9 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
        />
        {showSpinner ? (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 animate-spin" />
        ) : null}
      </div>

      <div className="mt-2 rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        {/* Repository list */}
        <div className="max-h-[180px] overflow-y-auto">
          {showReposLoading ? (
            <div className="divide-y divide-neutral-200 dark:divide-neutral-900">
              {[...Array(4)].map((_, index) => (
                <div
                  key={index}
                  className="px-3 h-9 flex items-center justify-between bg-white dark:bg-neutral-950"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Skeleton className="h-4 w-4 rounded-sm" />
                    <Skeleton className="h-4 w-56 rounded" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3 w-16 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredRepos.length > 0 ? (
            <div className="divide-y divide-neutral-200 dark:divide-neutral-900">
              {filteredRepos.map((repo) => {
                const isSelected = selectedSet.has(repo.full_name);
                const last = repo.pushed_at ?? repo.updated_at ?? null;
                const when = last ? formatTimeAgo(last) : "";
                return (
                  <div
                    key={repo.full_name}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onToggleRepo(repo.full_name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onToggleRepo(repo.full_name);
                      }
                    }}
                    tabIndex={0}
                    className="px-3 h-9 flex items-center justify-between bg-white dark:bg-neutral-950 cursor-default select-none outline-none"
                  >
                    <div className="text-sm flex items-center gap-2 min-w-0 flex-1">
                      <div
                        className={`mr-1 h-4 w-4 rounded-sm border grid place-items-center shrink-0 ${
                          isSelected
                            ? "border-neutral-700 bg-neutral-800"
                            : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950"
                        }`}
                      >
                        <Check
                          className={`w-3 h-3 text-white transition-opacity ${
                            isSelected ? "opacity-100" : "opacity-0"
                          }`}
                        />
                      </div>
                      <GitHubIcon className="h-4 w-4 shrink-0 text-neutral-700 dark:text-neutral-200" />
                      <span className="truncate">{repo.full_name}</span>
                    </div>
                    {when ? (
                      <span className="ml-3 text-[10px] text-neutral-500 dark:text-neutral-500">
                        {when}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-6 text-sm text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-950 text-center">
              {search ? (
                <span>No repositories match your search.</span>
              ) : hasConnections ? (
                <span>No repositories found.</span>
              ) : (
                <span>No GitHub connection yet.</span>
              )}
            </div>
          )}
        </div>

        {/* Connect GitHub account link */}
        <button
          type="button"
          onClick={onInstallGitHubApp}
          className="w-full px-3 py-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 transition-colors"
        >
          <GitHubIcon className="h-3.5 w-3.5" />
          <span>Connect another GitHub account</span>
        </button>
      </div>
    </div>
  );
}
