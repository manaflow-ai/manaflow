import { parseGithubRepoUrl } from "@cmux/shared/utils/parse-github-repo-url";

const INVALID_BRANCH_PATTERN = /[\s~^:?*\[\]\\]/;
const INVALID_URL_PATTERN = /[\s"'`\\<>|;]/;

export function normalizeGitHubRepoUrl(input: string): {
  repoUrl: string;
  repoFullName: string;
} | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = stripUrlCredentials(trimmed);
  const parsed = parseGithubRepoUrl(normalized);
  if (!parsed) return null;
  return { repoUrl: parsed.gitUrl, repoFullName: parsed.fullName };
}

export function assertValidBranchName(
  value: string | undefined,
  label = "branch"
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${label}: cannot be empty`);
  }
  if (trimmed.startsWith("-")) {
    throw new Error(`Invalid ${label}: must not start with '-'`);
  }
  if (INVALID_BRANCH_PATTERN.test(trimmed)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`);
  }
  if (
    trimmed.includes("..") ||
    trimmed.includes("@{") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("//") ||
    trimmed.endsWith(".lock")
  ) {
    throw new Error(`Invalid ${label}: contains disallowed sequences`);
  }
  return trimmed;
}

export function assertSafeRepoUrl(value: string, label = "repoUrl"): string {
  if (INVALID_URL_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${label}: cannot be empty`);
  }
  return trimmed;
}

export function assertSafeWorkspaceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Invalid workspace name: cannot be empty");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error("Invalid workspace name: contains unsafe characters");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Invalid workspace name");
  }
  return trimmed;
}

function stripUrlCredentials(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    return url.toString();
  } catch {
    return value;
  }
}
