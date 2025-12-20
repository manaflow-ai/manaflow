import clsx from "clsx";
import type { ReactNode } from "react";

interface RepoTagsProps {
  /** Selected repository full names */
  repos: string[];
  /** Callback when a repo is removed (optional - if not provided, no remove buttons) */
  onRemoveRepo?: (repo: string) => void;
  /** Whether to show workspace paths */
  showWorkspacePaths?: boolean;
  /** Whether in preview.new mode (single repo, repo = workspace root) */
  previewNewMode?: boolean;
  /** GitHub icon component */
  GitHubIcon?: ReactNode;
  /** CSS class name */
  className?: string;
}

function getWorkspacePath(repo: string, previewNewMode: boolean): string {
  if (previewNewMode) {
    return "/root/workspace";
  }
  const repoName = repo.split("/").pop() ?? repo;
  return `/root/workspace/${repoName}`;
}

export function RepoTags({
  repos,
  onRemoveRepo,
  showWorkspacePaths = false,
  previewNewMode = false,
  GitHubIcon,
  className,
}: RepoTagsProps) {
  if (repos.length === 0) {
    return null;
  }

  return (
    <div className={clsx("flex flex-wrap gap-2", className)}>
      {repos.map((fullName) => (
        <span
          key={fullName}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 px-2 py-1 text-xs"
        >
          {onRemoveRepo && (
            <button
              type="button"
              aria-label={`Remove ${fullName}`}
              onClick={() => onRemoveRepo(fullName)}
              className="-ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              <span className="text-xs">×</span>
            </button>
          )}
          {GitHubIcon ?? (
            <svg
              className="h-3 w-3 shrink-0 text-neutral-700 dark:text-neutral-300"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
          )}
          <span className="truncate">{fullName}</span>
          {showWorkspacePaths && (
            <span className="text-neutral-400 text-[10px] ml-1">
              ({getWorkspacePath(fullName, previewNewMode)})
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export default RepoTags;
