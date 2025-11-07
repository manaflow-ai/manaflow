import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github";
import {
  ArrowRight,
  Check,
  Loader2,
  Search,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { api } from "@cmux/convex/api";
import { useQuery, useMutation } from "convex/react";
import { useQuery as useRQ } from "@tanstack/react-query";
import { getApiIntegrationsGithubReposOptions } from "@cmux/www-openapi-client/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { GithubRepo } from "@cmux/www-openapi-client";
import { toast } from "sonner";

interface RepositorySyncStepProps {
  teamSlugOrId: string;
  onNext: () => void;
  onSkip: () => void;
  onReposSelected: (repos: string[]) => void;
  selectedRepos: string[];
  hasGitHubConnection: boolean;
}

export function RepositorySyncStep({
  teamSlugOrId,
  onNext,
  onSkip,
  onReposSelected,
  selectedRepos,
  hasGitHubConnection,
}: RepositorySyncStepProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedConnection, setSelectedConnection] = useState<number | null>(
    null
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const debouncedSearch = useDebouncedValue(searchTerm, 300);

  const connections = useQuery(api.github.listProviderConnections, {
    teamSlugOrId,
  });

  const bulkInsertRepos = useMutation(api.github.bulkInsertRepos);

  // Auto-select first connection
  useEffect(() => {
    if (connections && connections.length > 0 && selectedConnection === null) {
      setSelectedConnection(connections[0].installationId);
    }
  }, [connections, selectedConnection]);

  const reposQuery = useRQ(
    getApiIntegrationsGithubReposOptions({
      query: {
        team: teamSlugOrId,
        installationId: selectedConnection ?? undefined,
        search: debouncedSearch || undefined,
        page: 1,
      },
    })
  );

  const repos = React.useMemo(
    () => reposQuery.data?.repos ?? [],
    [reposQuery.data?.repos]
  );

  const handleToggleRepo = useCallback(
    (repoFullName: string) => {
      if (selectedRepos.includes(repoFullName)) {
        onReposSelected(selectedRepos.filter((r) => r !== repoFullName));
      } else {
        onReposSelected([...selectedRepos, repoFullName]);
      }
    },
    [selectedRepos, onReposSelected]
  );

  const handleContinue = useCallback(async () => {
    if (selectedRepos.length === 0) {
      onNext();
      return;
    }

    setIsSyncing(true);
    try {
      // Get full repo objects for selected repos
      const reposToSync = repos.filter((repo: GithubRepo) =>
        selectedRepos.includes(repo.full_name)
      );

      // Bulk insert the selected repos
      await bulkInsertRepos({
        teamSlugOrId,
        repos: reposToSync.map((repo: GithubRepo) => {
          const [org] = repo.full_name.split("/");
          return {
            fullName: repo.full_name,
            org: org,
            name: repo.name,
            gitRemote: `https://github.com/${repo.full_name}.git`,
            provider: "github",
            visibility: repo.private ? "private" : "public",
          };
        }),
      });

      toast.success(`Synced ${selectedRepos.length} ${selectedRepos.length === 1 ? "repository" : "repositories"}`);
      onNext();
    } catch (error) {
      console.error("Error syncing repos:", error);
      toast.error("Failed to sync repositories");
    } finally {
      setIsSyncing(false);
    }
  }, [selectedRepos, repos, teamSlugOrId, bulkInsertRepos, onNext]);

  if (!hasGitHubConnection) {
    return (
      <div className="flex flex-col">
        <div className="mb-4">
          <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
            Add Repositories
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Connect GitHub first to sync repositories.
          </p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onSkip} size="sm">
            Skip
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Add Repositories
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Select repositories to work with. You can add more later.
        </p>
      </div>

      {connections && connections.length > 1 && (
        <div className="mb-3">
          <div className="flex flex-wrap gap-2">
            {connections.map((conn) => (
              <button
                key={conn.installationId}
                onClick={() => setSelectedConnection(conn.installationId)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all ${
                  selectedConnection === conn.installationId
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                <GitHubIcon className="h-4 w-4" />
                {conn.accountLogin}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search repositories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>
      </div>

      <div className="mb-4 max-h-80 overflow-y-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50">
        {reposQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : repos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {searchTerm ? "No repositories found" : "No repositories available"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {repos.map((repo: GithubRepo) => (
              <button
                key={repo.full_name}
                onClick={() => handleToggleRepo(repo.full_name)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded border-2 transition-all ${
                    selectedRepos.includes(repo.full_name)
                      ? "border-primary bg-primary"
                      : "border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900"
                  }`}
                >
                  {selectedRepos.includes(repo.full_name) && (
                    <Check className="h-3 w-3 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {repo.full_name}
                  </span>
                  {repo.private && (
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
                      Private
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedRepos.length > 0 && (
        <div className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
          {selectedRepos.length} selected
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onSkip} size="sm" disabled={isSyncing}>
          Skip
        </Button>
        <Button onClick={handleContinue} size="sm" className="gap-1.5" disabled={isSyncing}>
          {isSyncing ? "Syncing..." : "Continue"}
          {!isSyncing && <ArrowRight className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
