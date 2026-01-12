/**
 * Sandbox provider factory.
 *
 * Use `getSandboxProvider()` to get a provider instance.
 */

export * from "./types";
export { MorphSandboxProvider } from "./morph";

import { env } from "../convex-env";
import { MorphSandboxProvider } from "./morph";
import type { SandboxProvider, SandboxProviderName } from "./types";

/**
 * Get a sandbox provider by name.
 *
 * @param name - Provider name (morph, freestyle, daytona)
 * @returns Provider instance
 * @throws Error if provider is not supported or not configured
 */
export function getSandboxProvider(name: SandboxProviderName): SandboxProvider {
  switch (name) {
    case "morph": {
      const apiKey = env.MORPH_API_KEY;
      if (!apiKey) {
        throw new Error("MORPH_API_KEY not configured");
      }
      return new MorphSandboxProvider(apiKey);
    }
    case "freestyle":
      // TODO: Implement FreestyleSandboxProvider
      throw new Error("Freestyle provider not yet implemented");
    case "daytona":
      // TODO: Implement DaytonaSandboxProvider
      throw new Error("Daytona provider not yet implemented");
    default:
      throw new Error(`Unknown sandbox provider: ${name}`);
  }
}

/**
 * Get the default sandbox provider.
 *
 * Currently defaults to Morph if configured.
 */
export function getDefaultSandboxProvider(): SandboxProvider {
  // Try providers in order of preference
  if (env.MORPH_API_KEY) {
    return new MorphSandboxProvider(env.MORPH_API_KEY);
  }

  throw new Error("No sandbox provider configured");
}
