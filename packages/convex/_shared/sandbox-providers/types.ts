/**
 * Sandbox provider abstraction for ACP.
 *
 * Supports multiple sandbox providers (Morph, Freestyle, Daytona, E2B, Blaxel) with a unified interface.
 */

export type SandboxProviderName = "morph" | "freestyle" | "daytona" | "e2b" | "blaxel";

export interface SandboxSpawnOptions {
  /** Team ID for ownership */
  teamId: string;
  /** Provider-specific snapshot/image ID */
  snapshotId?: string;
  /** Time-to-live in seconds before auto-shutdown */
  ttlSeconds: number;
  /** TTL action (e.g., "pause", "stop") */
  ttlAction?: string;
  /** Metadata for tracking */
  metadata: Record<string, unknown>;
}

export interface SandboxInstance {
  /** Provider-specific instance ID */
  instanceId: string;
  /** URL where the ACP server is reachable (once ready) */
  sandboxUrl?: string;
  /** Which provider created this instance */
  provider: SandboxProviderName;
}

export type SandboxStatus =
  | "starting"
  | "running"
  | "paused"
  | "stopping"
  | "stopped"
  | "error";

export interface SandboxStatusInfo {
  status: SandboxStatus;
  sandboxUrl?: string;
  error?: string;
}

/**
 * Sandbox provider interface.
 *
 * Each provider implements this interface to spawn and manage sandboxes.
 */
export interface SandboxProvider {
  /** Provider name */
  readonly name: SandboxProviderName;

  /**
   * Spawn a new sandbox instance.
   */
  spawn(options: SandboxSpawnOptions): Promise<SandboxInstance>;

  /**
   * Stop a sandbox instance.
   */
  stop(instanceId: string): Promise<void>;

  /**
   * Pause a sandbox instance (if supported).
   */
  pause?(instanceId: string): Promise<void>;

  /**
   * Resume a paused sandbox instance (if supported).
   */
  resume?(instanceId: string): Promise<void>;

  /**
   * Get the current status of a sandbox instance.
   */
  getStatus(instanceId: string): Promise<SandboxStatusInfo>;
}
