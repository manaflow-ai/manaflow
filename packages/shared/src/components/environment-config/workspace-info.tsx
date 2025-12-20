"use client";

import clsx from "clsx";

export interface WorkspaceInfoProps {
  /**
   * Selected repository names (e.g., "owner/repo").
   */
  selectedRepos: string[];
  /**
   * Whether multiple repos are supported (repos in subdirectories).
   */
  reposInSubdirectories: boolean;
  /**
   * Base path for workspace inside sandbox.
   */
  workspaceBasePath: string;
  /**
   * Whether to show compact layout.
   */
  compact?: boolean;
  /**
   * Class name for the container.
   */
  className?: string;
}

export function WorkspaceInfo({
  selectedRepos,
  reposInSubdirectories,
  workspaceBasePath,
  compact = false,
  className,
}: WorkspaceInfoProps) {
  const textSize = compact ? "text-[11px]" : "text-xs";

  if (selectedRepos.length === 0) {
    return null;
  }

  const repoStructure = reposInSubdirectories
    ? selectedRepos.map((repo) => {
        const repoName = repo.split("/").pop() ?? repo;
        return `${workspaceBasePath}/${repoName}`;
      })
    : [`${workspaceBasePath} (repo root)`];

  return (
    <div className={clsx("text-neutral-500 dark:text-neutral-400", textSize, className)}>
      {reposInSubdirectories ? (
        <p>
          Your workspace at{" "}
          <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
            {workspaceBasePath}
          </code>{" "}
          contains {selectedRepos.length === 1 ? "your repository" : "your repositories"}:
        </p>
      ) : (
        <p>
          Workspace root{" "}
          <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
            {workspaceBasePath}
          </code>{" "}
          maps directly to your repository root.
        </p>
      )}
      {reposInSubdirectories && selectedRepos.length > 0 && (
        <ul className={clsx("mt-1", compact ? "ml-3" : "ml-4")}>
          {repoStructure.map((path, idx) => (
            <li key={idx} className="list-disc">
              <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
                {path}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
