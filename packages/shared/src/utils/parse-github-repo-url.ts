/**
 * @deprecated Use `parseRepoUrl` from `@cmux/shared/git-providers` for multi-provider support.
 *
 * Parses a GitHub repository URL and extracts repository information.
 * Supports multiple formats:
 * - Simple: owner/repo
 * - HTTPS: https://github.com/owner/repo or https://github.com/owner/repo.git
 * - SSH: git@github.com:owner/repo.git
 *
 * @param input - The GitHub repository URL or identifier
 * @returns Parsed repository information or null if invalid
 */
export function parseGithubRepoUrl(input: string): {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  gitUrl: string;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  // Try matching against different patterns
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/)?$/i
  );
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/i
  );

  const match = simpleMatch || httpsMatch || sshMatch;
  if (!match) {
    return null;
  }

  const [, owner, repo] = match;
  if (!owner || !repo) {
    return null;
  }

  const cleanRepo = repo.replace(/\.git$/, "");
  return {
    owner,
    repo: cleanRepo,
    fullName: `${owner}/${cleanRepo}`,
    url: `https://github.com/${owner}/${cleanRepo}`,
    gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
  };
}

// Re-export types and utilities from git-providers for convenience
export type { ParsedRepo, GitProviderId } from "../git-providers/types.js";
export { providerRegistry } from "../git-providers/registry.js";

import { providerRegistry } from "../git-providers/registry.js";
import type { ParsedRepo } from "../git-providers/types.js";

/**
 * Parse a repository URL from any supported provider (GitHub, GitLab, Bitbucket).
 * Auto-detects the provider from the URL format.
 *
 * @param input - Repository URL or identifier
 * @returns Parsed repository with provider info, or null if invalid
 *
 * @example
 * ```typescript
 * parseRepoUrl("https://github.com/owner/repo")
 * // => { provider: "github", owner: "owner", name: "repo", ... }
 *
 * parseRepoUrl("https://gitlab.com/group/project")
 * // => { provider: "gitlab", owner: "group", name: "project", ... }
 * ```
 */
export function parseRepoUrl(input: string): ParsedRepo | null {
  return providerRegistry.parseRepoUrl(input);
}
