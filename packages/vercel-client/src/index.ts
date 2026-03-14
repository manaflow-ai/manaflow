import { Sandbox } from "@vercel/sandbox";

/**
 * Configuration for creating a Vercel Sandbox client.
 */
export interface VercelClientConfig {
  /** Vercel access token or OIDC token. */
  token?: string;
  /** Vercel project ID. */
  projectId?: string;
  /** Vercel team ID. */
  teamId?: string;
}

/**
 * Result of executing a command in a Vercel Sandbox.
 */
export interface VercelExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

/**
 * HTTP service exposed by a Vercel Sandbox.
 */
export interface VercelHttpService {
  name: string;
  port: number;
  url: string;
}

/**
 * Networking information for a Vercel Sandbox.
 */
export interface VercelNetworking {
  httpServices: VercelHttpService[];
}

/**
 * Metadata stored with a Vercel Sandbox.
 */
export type VercelMetadata = Record<string, string>;

/**
 * Vercel Sandbox instance wrapper that provides a similar interface to E2BInstance.
 */
export class VercelInstance {
  private sandbox: Sandbox;
  private _id: string;
  private _metadata: VercelMetadata;
  private _httpServices: VercelHttpService[];
  private _status: "running" | "paused" | "stopped";

  constructor(
    sandbox: Sandbox,
    metadata: VercelMetadata = {},
    httpServices: VercelHttpService[] = [],
  ) {
    this.sandbox = sandbox;
    this._id = sandbox.sandboxId;
    this._metadata = metadata;
    this._httpServices = httpServices;
    this._status = "running";
  }

  get id(): string {
    return this._id;
  }

  get metadata(): VercelMetadata {
    return this._metadata;
  }

  get status(): "running" | "paused" | "stopped" {
    return this._status;
  }

  get networking(): VercelNetworking {
    return {
      httpServices: this._httpServices,
    };
  }

  /**
   * Execute a command in the sandbox.
   * Handles non-zero exit codes gracefully (doesn't throw).
   */
  async exec(command: string): Promise<VercelExecResult> {
    try {
      const result = await this.sandbox.runCommand("bash", ["-c", command]);
      const stdout = await result.stdout();
      const stderr = await result.stderr();
      return {
        stdout,
        stderr,
        exit_code: result.exitCode,
      };
    } catch (err: unknown) {
      console.error("[VercelInstance.exec] Error:", err);
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    }
  }

  /**
   * Get the public URL for a specific port.
   */
  getDomain(port: number): string {
    return this.sandbox.domain(port);
  }

  /**
   * Extend sandbox timeout.
   */
  async extendTimeout(durationMs: number): Promise<void> {
    await this.sandbox.extendTimeout(durationMs);
  }

  /**
   * Get remaining timeout in milliseconds.
   */
  getTimeout(): number {
    return this.sandbox.timeout;
  }

  /**
   * Stop the sandbox.
   */
  async stop(): Promise<void> {
    await this.sandbox.stop();
    this._status = "stopped";
  }

  /**
   * Check sandbox status.
   */
  getStatus(): string {
    return this.sandbox.status;
  }

  /**
   * Write files to the sandbox.
   */
  async writeFiles(
    files: Array<{ path: string; content: Buffer }>,
  ): Promise<void> {
    await this.sandbox.writeFiles(files);
  }

  /**
   * Read a file from the sandbox.
   */
  async readFile(path: string): Promise<Buffer | null> {
    return await this.sandbox.readFileToBuffer({ path });
  }

  /**
   * Create a directory in the sandbox.
   */
  async mkDir(path: string): Promise<void> {
    await this.sandbox.mkDir(path);
  }

  /**
   * Get the underlying Vercel Sandbox instance.
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }
}

/**
 * Vercel Sandbox Client that provides a similar interface to E2BClient.
 */
export class VercelClient {
  private token: string;
  private projectId: string;
  private teamId: string;

  constructor(config: VercelClientConfig = {}) {
    this.token =
      config.token || process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_OIDC_TOKEN || "";
    this.projectId = config.projectId || process.env.VERCEL_PROJECT_ID || "";
    this.teamId = config.teamId || process.env.VERCEL_TEAM_ID || "";

    if (!this.token) {
      throw new Error(
        "Vercel token is required (set VERCEL_ACCESS_TOKEN or VERCEL_OIDC_TOKEN)",
      );
    }
    if (!this.projectId) {
      throw new Error("Vercel project ID is required (set VERCEL_PROJECT_ID)");
    }
    if (!this.teamId) {
      throw new Error("Vercel team ID is required (set VERCEL_TEAM_ID)");
    }
  }

  private getCredentials() {
    return {
      token: this.token,
      projectId: this.projectId,
      teamId: this.teamId,
    };
  }

  /**
   * Instances namespace for managing Vercel Sandboxes.
   */
  instances = {
    /**
     * Start a new sandbox.
     */
    start: async (options: {
      runtime?: string;
      timeout?: number;
      vcpus?: number;
      ports?: number[];
      source?: {
        type: "git";
        url: string;
        depth?: number;
        revision?: string;
      };
      metadata?: VercelMetadata;
    }): Promise<VercelInstance> => {
      const createParams: Record<string, unknown> = {
        ...this.getCredentials(),
        runtime: options.runtime ?? "node24",
        timeout: options.timeout ?? 300_000, // 5 minutes default
      };

      if (options.vcpus) {
        createParams.resources = { vcpus: options.vcpus };
      }

      if (options.ports) {
        createParams.ports = options.ports;
      }

      if (options.source) {
        createParams.source = options.source;
      }

      const sandbox = await Sandbox.create(
        createParams as Parameters<typeof Sandbox.create>[0],
      );

      // Build HTTP services from exposed ports
      const httpServices: VercelHttpService[] = (options.ports ?? []).map(
        (port) => ({
          name: `port-${port}`,
          port,
          url: sandbox.domain(port),
        }),
      );

      return new VercelInstance(sandbox, options.metadata ?? {}, httpServices);
    },

    /**
     * Get an existing sandbox by ID.
     */
    get: async (options: { instanceId: string }): Promise<VercelInstance> => {
      const sandbox = await Sandbox.get({
        sandboxId: options.instanceId,
        ...this.getCredentials(),
      });

      return new VercelInstance(sandbox);
    },

    /**
     * List all sandboxes.
     */
    list: async (): Promise<
      Array<{ sandboxId: string; status: string; createdAt: Date }>
    > => {
      const result = await Sandbox.list(this.getCredentials());
      return result.json.sandboxes.map(
        (s: { sandboxId: string; status: string; createdAt: string }) => ({
          sandboxId: s.sandboxId,
          status: s.status,
          createdAt: new Date(s.createdAt),
        }),
      );
    },

    /**
     * Stop a sandbox by ID.
     */
    stop: async (sandboxId: string): Promise<void> => {
      const sandbox = await Sandbox.get({
        sandboxId,
        ...this.getCredentials(),
      });
      await sandbox.stop();
    },
  };
}

/**
 * Create a Vercel Sandbox client.
 */
export const createVercelClient = (
  config: VercelClientConfig = {},
): VercelClient => {
  return new VercelClient(config);
};

// Re-export types
export type { Sandbox } from "@vercel/sandbox";
