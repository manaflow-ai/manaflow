import clsx from "clsx";
import type { ReactNode } from "react";

interface WorkspaceInfoProps {
  /** Selected repositories */
  repos: string[];
  /** Whether in preview.new mode (repo root = workspace root) */
  previewNewMode?: boolean;
  /** CSS class name */
  className?: string;
}

/**
 * Displays information about workspace structure
 * Shows different info depending on whether we're in:
 * - preview.new mode: single repo, repo root = /root/workspace
 * - cmux mode: multiple repos, each at /root/workspace/{repo-name}
 */
export function WorkspaceInfo({
  repos,
  previewNewMode = false,
  className,
}: WorkspaceInfoProps) {
  if (previewNewMode) {
    // Single repo mode - repo root maps directly to workspace
    return (
      <p className={clsx("text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed", className)}>
        Your workspace root at{" "}
        <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
          /root/workspace
        </code>{" "}
        maps directly to your repo root.
      </p>
    );
  }

  // Multi-repo mode - each repo gets its own subdirectory
  if (repos.length === 0) {
    return (
      <p className={clsx("text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed", className)}>
        Workspace root is{" "}
        <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
          /root/workspace
        </code>
        . Selected repos will be cloned as subdirectories.
      </p>
    );
  }

  if (repos.length === 1) {
    const repoName = repos[0]?.split("/").pop() ?? repos[0];
    return (
      <p className={clsx("text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed", className)}>
        Your repo will be at{" "}
        <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
          /root/workspace/{repoName}
        </code>
      </p>
    );
  }

  return (
    <div className={clsx("text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed", className)}>
      <p className="mb-1">
        Repos are cloned under{" "}
        <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
          /root/workspace/
        </code>
        :
      </p>
      <ul className="list-disc list-inside space-y-0.5 pl-1">
        {repos.map((repo) => {
          const repoName = repo.split("/").pop() ?? repo;
          return (
            <li key={repo}>
              <code className="text-[10px] text-neutral-600 dark:text-neutral-300">
                {repoName}/
              </code>
              <span className="text-neutral-400"> ← {repo}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default WorkspaceInfo;
