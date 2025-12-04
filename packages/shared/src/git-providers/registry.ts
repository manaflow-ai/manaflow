/**
 * Git Provider Registry
 *
 * Central registry for managing git provider implementations.
 * Uses a singleton pattern to ensure consistent provider access across the application.
 *
 * ## Usage
 *
 * ```typescript
 * import { providerRegistry } from "@cmux/shared/git-providers";
 *
 * // Get a specific provider
 * const github = providerRegistry.get("github");
 *
 * // Parse a URL and auto-detect provider
 * const parsed = providerRegistry.parseRepoUrl("https://github.com/owner/repo");
 * // parsed.provider === "github"
 *
 * // List all registered providers
 * const providers = providerRegistry.all();
 * ```
 */

import type { GitProvider, GitProviderId, ParsedRepo } from "./types.js";

/**
 * Registry for git provider implementations.
 *
 * Providers are registered at startup and can be retrieved by ID or
 * auto-detected from repository URLs.
 */
class GitProviderRegistry {
  private providers = new Map<GitProviderId, GitProvider>();

  /**
   * Register a provider implementation.
   *
   * @param provider - Provider instance to register
   * @throws Error if a provider with the same ID is already registered
   */
  register(provider: GitProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(
        `Provider "${provider.id}" is already registered. ` +
          `Use replace() to update an existing provider.`
      );
    }
    this.providers.set(provider.id, provider);
  }

  /**
   * Replace an existing provider registration.
   * Useful for testing or swapping implementations.
   *
   * @param provider - Provider instance to register
   */
  replace(provider: GitProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Get a provider by ID.
   *
   * @param id - Provider identifier
   * @returns Provider instance
   * @throws Error if provider is not registered
   */
  get(id: GitProviderId): GitProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(
        `Provider "${id}" is not registered. ` +
          `Available providers: ${Array.from(this.providers.keys()).join(", ")}`
      );
    }
    return provider;
  }

  /**
   * Get a provider by ID if registered, or undefined if not.
   *
   * @param id - Provider identifier
   * @returns Provider instance or undefined
   */
  tryGet(id: GitProviderId): GitProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Check if a provider is registered.
   *
   * @param id - Provider identifier
   * @returns True if provider is registered
   */
  has(id: GitProviderId): boolean {
    return this.providers.has(id);
  }

  /**
   * Get all registered providers.
   *
   * @returns Array of all registered providers
   */
  all(): GitProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all registered provider IDs.
   *
   * @returns Array of provider IDs
   */
  ids(): GitProviderId[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Parse a repository URL and auto-detect the provider.
   *
   * Tries each registered provider in order until one successfully parses the URL.
   * Provider order: github, gitlab, bitbucket (by convention)
   *
   * @param input - Repository URL or identifier
   * @returns Parsed repository with provider, or null if no provider matched
   */
  parseRepoUrl(input: string): ParsedRepo | null {
    // Try providers in a deterministic order
    const providerOrder: GitProviderId[] = ["github", "gitlab", "bitbucket"];

    for (const id of providerOrder) {
      const provider = this.providers.get(id);
      if (provider) {
        const parsed = provider.parseRepoUrl(input);
        if (parsed) {
          return parsed;
        }
      }
    }

    // Try any remaining providers not in the preferred order
    for (const [id, provider] of this.providers) {
      if (!providerOrder.includes(id)) {
        const parsed = provider.parseRepoUrl(input);
        if (parsed) {
          return parsed;
        }
      }
    }

    return null;
  }

  /**
   * Detect which provider a URL belongs to without fully parsing it.
   *
   * @param input - Repository URL or identifier
   * @returns Provider ID if detected, or null
   */
  detectProvider(input: string): GitProviderId | null {
    const parsed = this.parseRepoUrl(input);
    return parsed?.provider ?? null;
  }

  /**
   * Get a provider by domain name.
   *
   * @param domain - Domain to match (e.g., "github.com")
   * @returns Provider instance or undefined
   */
  getByDomain(domain: string): GitProvider | undefined {
    const normalized = domain.toLowerCase();
    for (const provider of this.providers.values()) {
      if (provider.domain.toLowerCase() === normalized) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * Clear all registered providers.
   * Primarily for testing purposes.
   */
  clear(): void {
    this.providers.clear();
  }
}

/**
 * Singleton provider registry instance.
 *
 * Import and use this instance throughout the application:
 *
 * ```typescript
 * import { providerRegistry } from "@cmux/shared/git-providers";
 * ```
 */
export const providerRegistry = new GitProviderRegistry();

/**
 * Re-export the registry class for testing/extension purposes.
 */
export { GitProviderRegistry };
