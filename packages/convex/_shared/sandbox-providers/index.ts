/**
 * Sandbox provider factory.
 *
 * Use `getSandboxProvider()` to get a provider instance.
 */

export * from "./types";
export { MorphSandboxProvider } from "./morph";
export { FreestyleSandboxProvider } from "./freestyle";
export { DaytonaSandboxProvider } from "./daytona";
export { E2BSandboxProvider } from "./e2b";
export { BlaxelSandboxProvider } from "./blaxel";

import { env } from "../convex-env";
import { BlaxelSandboxProvider } from "./blaxel";
import { DaytonaSandboxProvider } from "./daytona";
import { E2BSandboxProvider } from "./e2b";
import { FreestyleSandboxProvider } from "./freestyle";
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
    case "freestyle": {
      const apiKey = env.FREESTYLE_API_KEY;
      if (!apiKey) {
        throw new Error("FREESTYLE_API_KEY not configured");
      }
      return new FreestyleSandboxProvider(apiKey);
    }
    case "daytona": {
      const apiKey = env.DAYTONA_API_KEY;
      if (!apiKey) {
        throw new Error("DAYTONA_API_KEY not configured");
      }
      return new DaytonaSandboxProvider(apiKey, {
        target: env.DAYTONA_TARGET,
      });
    }
    case "e2b": {
      const apiKey = env.E2B_API_KEY;
      if (!apiKey) {
        throw new Error("E2B_API_KEY not configured");
      }
      return new E2BSandboxProvider(apiKey);
    }
    case "blaxel": {
      const apiKey = env.BLAXEL_API_KEY;
      if (!apiKey) {
        throw new Error("BLAXEL_API_KEY not configured");
      }
      return new BlaxelSandboxProvider(apiKey, {
        workspace: env.BLAXEL_WORKSPACE,
      });
    }
    default:
      throw new Error(`Unknown sandbox provider: ${name}`);
  }
}

/**
 * Get the default sandbox provider.
 *
 * Defaults to Morph, falls back to Freestyle.
 */
export function getDefaultSandboxProvider(): SandboxProvider {
  // Try providers in order of preference
  if (env.MORPH_API_KEY) {
    return new MorphSandboxProvider(env.MORPH_API_KEY);
  }
  if (env.FREESTYLE_API_KEY) {
    return new FreestyleSandboxProvider(env.FREESTYLE_API_KEY);
  }

  throw new Error("No sandbox provider configured");
}
