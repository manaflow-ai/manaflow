"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { SearchableSelect, type SelectOptionObject } from "./ui/searchable-select";
import { ConfigureWorkspace, type ConfigureWorkspaceRef } from "./ConfigureWorkspace";
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

function SaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

// Flyout content wrapper with save button in header
function ConfigureFlyout({ repoId, repoName }: { repoId: Id<"repos">; repoName: string }) {
  const configRef = useRef<ConfigureWorkspaceRef>(null);
  const [saveState, setSaveState] = useState({ hasChanges: false, saving: false, saved: false });

  // Poll the ref for state changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (configRef.current) {
        setSaveState({
          hasChanges: configRef.current.hasChanges,
          saving: configRef.current.saving,
          saved: configRef.current.saved,
        });
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const handleSave = useCallback(() => {
    configRef.current?.save();
  }, []);

  return (
    <div className="w-[520px] max-h-[500px] flex flex-col bg-card border border-border rounded-lg shadow-xl">
      {/* Fixed header with save button */}
      <div className="shrink-0 px-4 py-3 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-foreground">
              Configure workspace for{" "}
              <span className="text-muted-foreground">{repoName}</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Set up scripts and environment variables.
            </p>
          </div>
          {/* Save button - always visible, disabled when no changes */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState.saving || !saveState.hasChanges}
            className="flex items-center gap-1.5 px-2 py-1 rounded transition-colors text-blue-400 hover:bg-accent disabled:text-muted-foreground disabled:hover:bg-transparent disabled:cursor-not-allowed text-sm"
            title={saveState.hasChanges ? "Save changes" : "No changes to save"}
          >
            {saveState.saving ? (
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SaveIcon className="h-3.5 w-3.5" />
            )}
            <span>{saveState.saving ? "Saving..." : saveState.hasChanges ? "Save" : "Saved"}</span>
          </button>
        </div>
      </div>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4">
        <ConfigureWorkspace ref={configRef} repoId={repoId} />
      </div>
    </div>
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

  // Map repo fullName to repo data for quick lookup
  const reposByName = useMemo(() => {
    if (!repos) return new Map();
    return new Map(repos.map((r) => [r.fullName, r]));
  }, [repos]);

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
      icon: <GitHubIcon className="h-4 w-4 text-muted-foreground" />,
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

  // Footer with "Add repos from GitHub" button
  const footer = installNewUrl ? (
    <div className="p-1">
      <button
        type="button"
        onClick={handleInstallApp}
        className="w-full px-2 h-8 flex items-center gap-2 text-[13.5px] text-foreground rounded-md hover:bg-accent transition-colors"
      >
        <PlusIcon className="w-4 h-4 text-muted-foreground" />
        <span className="select-none">Add repos from GitHub</span>
      </button>
    </div>
  ) : null;

  // Render ConfigureWorkspace flyout for a repo
  const renderOptionFlyout = useCallback(
    (repoFullName: string) => {
      const repo = reposByName.get(repoFullName);
      if (!repo) return null;

      return (
        <ConfigureFlyout
          repoId={repo._id as Id<"repos">}
          repoName={repoFullName}
        />
      );
    },
    [reposByName]
  );

  return (
    <SearchableSelect
      options={repoOptions}
      value={selectedRepo ? [selectedRepo] : []}
      onChange={handleChange}
      placeholder="Select project"
      singleSelect={true}
      className={className}
      loading={repos === undefined}
      showSearch
      searchPlaceholder="Search for a GitHub repo..."
      footer={footer}
      sectionLabel="Repositories"
      closeOnSelect={false}
      renderOptionFlyout={renderOptionFlyout}
    />
  );
}

export default RepoPickerDropdown;
