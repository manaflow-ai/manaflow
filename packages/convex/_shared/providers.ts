/**
 * Shared provider types and validators for multi-provider git support.
 */
import { v } from "convex/values";

/**
 * Git provider types.
 */
export const GIT_PROVIDERS = ["github", "gitlab", "bitbucket"] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];

/**
 * Provider connection types.
 */
export const PROVIDER_CONNECTION_TYPES = [
  "github_app",
  "gitlab_oauth",
  "bitbucket_oauth",
] as const;
export type ProviderConnectionType = (typeof PROVIDER_CONNECTION_TYPES)[number];

/**
 * Account/owner types across providers.
 */
export const OWNER_TYPES = ["User", "Organization", "Group", "Team"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

/**
 * Convex validators for use in mutation/query args.
 */
export const gitProviderValidator = v.union(
  v.literal("github"),
  v.literal("gitlab"),
  v.literal("bitbucket")
);

export const providerConnectionTypeValidator = v.union(
  v.literal("github_app"),
  v.literal("gitlab_oauth"),
  v.literal("bitbucket_oauth")
);

export const ownerTypeValidator = v.union(
  v.literal("User"),
  v.literal("Organization"),
  v.literal("Group"),
  v.literal("Team")
);

/**
 * Parse a string to a GitProvider type.
 * Returns undefined if the string is not a valid provider.
 */
export function parseGitProvider(value: string | undefined): GitProvider | undefined {
  if (!value) return undefined;
  if (GIT_PROVIDERS.includes(value as GitProvider)) {
    return value as GitProvider;
  }
  return undefined;
}

/**
 * Assert a string is a valid GitProvider.
 * Defaults to "github" if invalid or undefined.
 */
export function asGitProvider(value: string | undefined): GitProvider {
  return parseGitProvider(value) ?? "github";
}

/**
 * Parse a string to an OwnerType.
 * Returns undefined if the string is not a valid owner type.
 */
export function parseOwnerType(value: string | undefined): OwnerType | undefined {
  if (!value) return undefined;
  if (OWNER_TYPES.includes(value as OwnerType)) {
    return value as OwnerType;
  }
  return undefined;
}
