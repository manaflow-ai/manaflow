/**
 * Snapshot builder abstraction for multi-provider support.
 *
 * This module defines the interface for building snapshots across different
 * sandbox providers, handling the fundamental difference between:
 *
 * - Runtime snapshots (Morph/Freestyle): Capture RAM state of running VM
 * - Image snapshots (Daytona/E2B/Blaxel): Build Docker images from Dockerfiles
 */

import type { BuildCommand } from "../build-commands";
import type { ProviderName } from "../utils";

/**
 * Snapshot strategy - how the provider creates reusable snapshots.
 */
export type SnapshotStrategy = "runtime" | "dockerfile";

/**
 * Capabilities of a snapshot provider.
 */
export interface SnapshotCapabilities {
  /** How this provider creates snapshots */
  strategy: SnapshotStrategy;
  /** Can capture running processes (only runtime providers) */
  capturesProcesses: boolean;
  /** Needs boot script to start services (only dockerfile providers) */
  needsBootScript: boolean;
}

/**
 * Provider capabilities mapping.
 */
export const PROVIDER_CAPABILITIES: Record<ProviderName, SnapshotCapabilities> = {
  morph: {
    strategy: "runtime",
    capturesProcesses: true,
    needsBootScript: false,
  },
  freestyle: {
    strategy: "runtime",
    capturesProcesses: true,
    needsBootScript: false,
  },
  daytona: {
    strategy: "dockerfile",
    capturesProcesses: false,
    needsBootScript: true,
  },
  e2b: {
    strategy: "dockerfile",
    capturesProcesses: false,
    needsBootScript: true,
  },
  blaxel: {
    strategy: "dockerfile",
    capturesProcesses: false,
    needsBootScript: true,
  },
};

/**
 * Result of a snapshot build operation.
 */
export interface SnapshotBuildResult {
  /** The snapshot/template ID */
  snapshotId: string;
  /** The strategy used to create the snapshot */
  strategy: SnapshotStrategy;
  /** The provider name */
  provider: ProviderName;
  /** For dockerfile strategy: the generated Dockerfile content */
  dockerfile?: string;
}

/**
 * Build context provided to snapshot builders.
 */
export interface BuildContext {
  /** Build commands to execute */
  commands: BuildCommand[];
  /** Snapshot name/label */
  name: string;
  /** Boot script content (for dockerfile strategy) */
  bootScript?: string;
  /** Path to cmux-acp-server binary to include (optional) */
  acpServerBinaryPath?: string;
  /** Path to cmux-pty binary to include (optional) */
  ptyServerBinaryPath?: string;
  /** Logging function */
  log: (message: string) => void;
}

/**
 * Interface for snapshot builders.
 *
 * Each provider implements this interface to build snapshots
 * from a common set of build commands.
 */
export interface SnapshotBuilder {
  /** Provider name */
  readonly provider: ProviderName;

  /**
   * Build a snapshot from the given build commands.
   *
   * @param ctx Build context with commands and configuration
   * @returns The snapshot ID and metadata
   */
  build(ctx: BuildContext): Promise<SnapshotBuildResult>;
}

// Re-export builders (lazy imports to avoid loading unused SDKs)
export async function createDaytonaBuilder(): Promise<SnapshotBuilder> {
  const { DaytonaBuilder } = await import("./daytona");
  return new DaytonaBuilder();
}

export async function createE2BBuilder(): Promise<SnapshotBuilder> {
  const { E2BBuilder } = await import("./e2b");
  return new E2BBuilder();
}

export async function createBlaxelBuilder(): Promise<SnapshotBuilder> {
  const { BlaxelBuilder } = await import("./blaxel");
  return new BlaxelBuilder();
}

/**
 * Get a snapshot builder for the given provider.
 *
 * @param provider The provider name
 * @returns A snapshot builder instance
 * @throws Error if provider doesn't support dockerfile strategy
 */
export async function getBuilder(provider: ProviderName): Promise<SnapshotBuilder> {
  const capabilities = PROVIDER_CAPABILITIES[provider];

  if (capabilities.strategy !== "dockerfile") {
    throw new Error(
      `Provider '${provider}' uses '${capabilities.strategy}' strategy and doesn't need a builder. ` +
        "Use runtime provisioning instead."
    );
  }

  switch (provider) {
    case "daytona":
      return createDaytonaBuilder();
    case "e2b":
      return createE2BBuilder();
    case "blaxel":
      return createBlaxelBuilder();
    default:
      throw new Error(`No builder available for provider: ${provider}`);
  }
}

/**
 * Check if a provider uses dockerfile strategy.
 */
export function isDockerfileProvider(provider: ProviderName): boolean {
  return PROVIDER_CAPABILITIES[provider].strategy === "dockerfile";
}

/**
 * Check if a provider uses runtime strategy.
 */
export function isRuntimeProvider(provider: ProviderName): boolean {
  return PROVIDER_CAPABILITIES[provider].strategy === "runtime";
}
