"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCallback, useMemo, useEffect, useState } from "react";
import { SearchableSelect, type SelectOptionObject } from "./ui/searchable-select";
import { ConfigureWorkspace } from "./ConfigureWorkspace";
import type { Id } from "@/convex/_generated/dataModel";

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

// Settings icon component
function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

interface RepoPickerDropdownProps {
  selectedRepo: string | null;
  onRepoSelect: (repo: string | null) => void;
  className?: string;
}

export function RepoPickerDropdown({
  selectedRepo,
  onRepoSelect,
  className = "",
}: RepoPickerDropdownProps) {
  const repos = useQuery(api.github.getAllRepos);
  const mintState = useMutation(api.github_app.mintInstallState);
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  // Find the selected repo's ID
  const selectedRepoData = useMemo(() => {
    if (!repos || !selectedRepo) return null;
    return repos.find((r) => r.fullName === selectedRepo);
  }, [repos, selectedRepo]);

  // Get GitHub App slug from env
  const githubAppSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const installNewUrl = githubAppSlug
    ? `https://github.com/apps/${githubAppSlug}/installations/new`
    : null;

  // Convert repos to SelectOption format
  const repoOptions: SelectOptionObject[] = useMemo(() => {
    if (!repos) return [];

    // Sort by last pushed date
    const sorted = [...repos].sort((a, b) => {
      const aTime = a.lastPushedAt ?? 0;
      const bTime = b.lastPushedAt ?? 0;
      return bTime - aTime;
    });

    return sorted.map((repo) => ({
      label: repo.fullName,
      value: repo.fullName,
      icon: <GitHubIcon className="h-4 w-4 text-neutral-400" />,
    }));
  }, [repos]);

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

  // Listen for popup completion message from GitHub App installation
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Verify origin matches our app
      const expectedOrigin =
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      if (event.origin !== expectedOrigin) return;

      if (event.data?.type === "github-app-installed" && event.data?.success) {
        // The Convex queries will auto-update when the server-side data changes
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleChange = useCallback(
    (values: string[]) => {
      onRepoSelect(values[0] ?? null);
    },
    [onRepoSelect]
  );

  // Footer with "Add repos from GitHub" button and settings
  const footer = (
    <div className="p-1 space-y-1">
      {/* Configure workspace button - only show when a repo is selected */}
      {selectedRepoData && (
        <button
          type="button"
          onClick={() => setShowConfigPanel(true)}
          onMouseEnter={() => setShowConfigPanel(true)}
          className="w-full px-2 h-8 flex items-center gap-2 text-[13.5px] text-neutral-200 rounded-md hover:bg-neutral-800 transition-colors"
        >
          <SettingsIcon className="w-4 h-4 text-neutral-400" />
          <span className="select-none">Configure workspace</span>
        </button>
      )}
      {installNewUrl && (
        <button
          type="button"
          onClick={handleInstallApp}
          className="w-full px-2 h-8 flex items-center gap-2 text-[13.5px] text-neutral-200 rounded-md hover:bg-neutral-800 transition-colors"
        >
          <GitHubIcon className="w-4 h-4 text-neutral-400" />
          <span className="select-none">Add repos from GitHub</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="relative flex items-start gap-2">
      <SearchableSelect
        options={repoOptions}
        value={selectedRepo ? [selectedRepo] : []}
        onChange={handleChange}
        placeholder="Select project"
        singleSelect={true}
        className={className}
        loading={repos === undefined}
        showSearch
        searchPlaceholder="Search or paste a repo link..."
        footer={footer}
        sectionLabel="Repositories"
        closeOnSelect={false}
      />

      {/* Configure Workspace Side Panel */}
      {showConfigPanel && selectedRepoData && (
        <div
          className="fixed right-0 top-0 h-screen w-[400px] bg-neutral-950 border-l border-neutral-800 shadow-2xl z-50 overflow-y-auto"
          onMouseLeave={() => setShowConfigPanel(false)}
        >
          <div className="sticky top-0 bg-neutral-950 border-b border-neutral-800 p-4 flex justify-between items-center">
            <h2 className="text-sm font-medium text-neutral-200">Configure Workspace</h2>
            <button
              type="button"
              onClick={() => setShowConfigPanel(false)}
              className="text-neutral-500 hover:text-neutral-200 transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="p-4">
            <ConfigureWorkspace repoId={selectedRepoData._id as Id<"repos">} />
          </div>
        </div>
      )}
    </div>
  );
}

export default RepoPickerDropdown;
