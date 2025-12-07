"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback, useMemo, useEffect } from "react";

// GitHub icon component
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

interface RepositoryPickerProps {
  onReposSelected?: (repos: string[]) => void;
  showHeader?: boolean;
  headerTitle?: string;
  headerDescription?: string;
  className?: string;
}

export function RepositoryPicker({
  onReposSelected,
  showHeader = true,
  headerTitle = "Select Repositories",
  headerDescription = "Choose repositories from your GitHub account.",
  className = "",
}: RepositoryPickerProps) {
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [selectedConnectionLogin, setSelectedConnectionLogin] = useState<
    string | null
  >(null);
  const [isConnectionDropdownOpen, setIsConnectionDropdownOpen] =
    useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const connections = useQuery(api.github_app.listProviderConnections);
  const repos = useQuery(api.github.getAllRepos);
  const mintState = useMutation(api.github_app.mintInstallState);

  // Filter active connections
  const activeConnections = useMemo(
    () => (connections || []).filter((c) => c.isActive !== false),
    [connections]
  );

  // Get current selected login (first connection if none selected)
  // This uses lazy initialization for the state to avoid needing a useEffect
  const currentLogin = useMemo(() => {
    if (selectedConnectionLogin) return selectedConnectionLogin;
    if (activeConnections.length > 0) {
      return activeConnections[0]?.accountLogin ?? null;
    }
    return null;
  }, [selectedConnectionLogin, activeConnections]);

  // Filter repos by current connection and search query
  const filteredRepos = useMemo(() => {
    if (!repos) return [];

    let filtered = repos;

    // Filter by connection login
    if (currentLogin) {
      filtered = filtered.filter((r) => r.org === currentLogin);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.fullName.toLowerCase().includes(query) ||
          r.name.toLowerCase().includes(query)
      );
    }

    // Sort by last pushed date
    return filtered.sort((a, b) => {
      const aTime = a.lastPushedAt ?? 0;
      const bTime = b.lastPushedAt ?? 0;
      return bTime - aTime;
    });
  }, [repos, currentLogin, searchQuery]);

  // Get GitHub App slug from env (would need to be passed as prop or from context)
  const githubAppSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const installNewUrl = githubAppSlug
    ? `https://github.com/apps/${githubAppSlug}/installations/new`
    : null;

  const toggleRepo = useCallback((fullName: string) => {
    setSelectedRepos((prev) => {
      const newSelection = prev.includes(fullName)
        ? prev.filter((r) => r !== fullName)
        : [...prev, fullName];
      return newSelection;
    });
  }, []);

  const removeRepo = useCallback((fullName: string) => {
    setSelectedRepos((prev) => prev.filter((r) => r !== fullName));
  }, []);

  // Handle install new GitHub App
  const handleInstallApp = useCallback(async () => {
    if (!installNewUrl) {
      alert("GitHub App not configured");
      return;
    }

    try {
      const returnUrl = window.location.href;
      const { state } = await mintState({ returnUrl });
      const sep = installNewUrl.includes("?") ? "&" : "?";
      const url = `${installNewUrl}${sep}state=${encodeURIComponent(state)}`;

      // Open in a centered popup
      const width = 980;
      const height = 780;
      const left = Math.max(0, (window.outerWidth - width) / 2 + window.screenX);
      const top = Math.max(0, (window.outerHeight - height) / 2 + window.screenY);
      const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

      window.open(url, "github-install", features);
    } catch (err) {
      console.error("Failed to start GitHub install:", err);
      alert("Failed to start installation. Please try again.");
    }
  }, [installNewUrl, mintState]);

  // Notify parent of selection changes
  useEffect(() => {
    onReposSelected?.(selectedRepos);
  }, [selectedRepos, onReposSelected]);

  // Format time ago (memoized with current time)
  const [now] = useState(() => Date.now());
  const formatTimeAgo = useCallback(
    (timestamp?: number): string => {
      if (!timestamp) return "";
      const diff = now - timestamp;
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
    },
    [now]
  );

  const selectedSet = useMemo(() => new Set(selectedRepos), [selectedRepos]);

  return (
    <div className={className}>
      {showHeader && (
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">{headerTitle}</h2>
          <p className="text-sm text-gray-400">{headerDescription}</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Connection Selector */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Connection
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsConnectionDropdownOpen(!isConnectionDropdownOpen)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-white hover:bg-gray-800 transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                {currentLogin ? (
                  <>
                    <GitHubIcon className="h-4 w-4" />
                    <span>{currentLogin}</span>
                  </>
                ) : (
                  <span className="text-gray-500">Select connection</span>
                )}
              </div>
              <svg
                className={`h-4 w-4 text-gray-500 transition-transform ${isConnectionDropdownOpen ? "rotate-180" : ""}`}
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
            </button>

            {isConnectionDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 shadow-lg">
                <div className="py-1">
                  {connections === undefined ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      Loading...
                    </div>
                  ) : activeConnections.length > 0 ? (
                    <>
                      {activeConnections.map((c) => {
                        const name =
                          c.accountLogin || `installation-${c.installationId}`;
                        const isSelected = currentLogin === c.accountLogin;
                        return (
                          <button
                            key={`${c.accountLogin}:${c.installationId}`}
                            type="button"
                            onClick={() => {
                              setSelectedConnectionLogin(c.accountLogin ?? null);
                              setIsConnectionDropdownOpen(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2">
                              <GitHubIcon className="h-4 w-4" />
                              <span>{name}</span>
                            </div>
                            {isSelected && (
                              <svg
                                className="h-4 w-4 text-blue-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                      <div className="border-t border-gray-700 my-1" />
                    </>
                  ) : null}

                  {installNewUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsConnectionDropdownOpen(false);
                        handleInstallApp();
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-800 flex items-center gap-2"
                    >
                      <GitHubIcon className="h-4 w-4" />
                      <span>Install GitHub App</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Repository List */}
        {activeConnections.length > 0 ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Repositories
            </label>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search repositories..."
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Repo List */}
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900">
              {repos === undefined ? (
                <div className="p-4 text-center text-gray-500">Loading...</div>
              ) : filteredRepos.length > 0 ? (
                <div className="divide-y divide-gray-800">
                  {filteredRepos.map((repo) => {
                    const isSelected = selectedSet.has(repo.fullName);
                    return (
                      <button
                        key={repo.fullName}
                        type="button"
                        onClick={() => toggleRepo(repo.fullName)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-800 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div
                            className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? "border-blue-500 bg-blue-500"
                                : "border-gray-600"
                            }`}
                          >
                            {isSelected && (
                              <svg
                                className="h-3 w-3 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </div>
                          <GitHubIcon className="h-4 w-4 text-gray-400 shrink-0" />
                          <span className="text-sm text-white truncate">
                            {repo.fullName}
                          </span>
                          {repo.visibility === "private" && (
                            <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                              private
                            </span>
                          )}
                        </div>
                        {repo.lastPushedAt && (
                          <span className="text-xs text-gray-500 ml-2 shrink-0">
                            {formatTimeAgo(repo.lastPushedAt)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500">
                  {searchQuery
                    ? "No repositories match your search."
                    : "No repositories found."}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/50 p-4 text-center">
            <p className="text-sm text-gray-400 mb-3">
              Connect your GitHub account to see repositories.
            </p>
            {installNewUrl && (
              <button
                type="button"
                onClick={handleInstallApp}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
              >
                <GitHubIcon className="h-4 w-4" />
                Install GitHub App
              </button>
            )}
          </div>
        )}

        {/* Selected Repos */}
        {selectedRepos.length > 0 && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Selected ({selectedRepos.length})
            </label>
            <div className="flex flex-wrap gap-2">
              {selectedRepos.map((fullName) => (
                <span
                  key={fullName}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                >
                  <GitHubIcon className="h-3 w-3" />
                  {fullName}
                  <button
                    type="button"
                    onClick={() => removeRepo(fullName)}
                    className="ml-1 rounded-full hover:bg-gray-700 p-0.5"
                    aria-label={`Remove ${fullName}`}
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RepositoryPicker;
