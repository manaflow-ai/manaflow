import { Sandbox } from "e2b";

export const DEFAULT_E2B_BASE_URL = "https://api.e2b.dev";

/**
 * Default template ID for cmux devbox (with VSCode, VNC, Chrome CDP, Docker)
 */
export const CMUX_DEVBOX_TEMPLATE_ID = "pou9b3m5z92g2hafjxrl";

/**
 * Configuration for creating an E2B client
 */
export interface E2BClientConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Result of executing a command in an E2B sandbox
 */
export interface E2BExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

/**
 * HTTP service exposed by an E2B sandbox
 */
export interface E2BHttpService {
  name: string;
  port: number;
  url: string;
}

/**
 * Networking information for an E2B sandbox
 */
export interface E2BNetworking {
  httpServices: E2BHttpService[];
}

/**
 * Metadata stored with an E2B sandbox
 */
export type E2BMetadata = Record<string, string>;

/**
 * E2B Sandbox instance wrapper that provides a similar interface to MorphInstance
 */
export class E2BInstance {
  private sandbox: Sandbox;
  private _id: string;
  private _metadata: E2BMetadata;
  private _httpServices: E2BHttpService[];
  private _status: "running" | "paused" | "stopped";

  constructor(
    sandbox: Sandbox,
    metadata: E2BMetadata = {},
    httpServices: E2BHttpService[] = []
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

  get metadata(): E2BMetadata {
    return this._metadata;
  }

  get status(): "running" | "paused" | "stopped" {
    return this._status;
  }

  get networking(): E2BNetworking {
    return {
      httpServices: this._httpServices,
    };
  }

  /**
   * Execute a command in the sandbox
   * Handles non-zero exit codes gracefully (doesn't throw)
   */
  async exec(command: string): Promise<E2BExecResult> {
    try {
      const result = await this.sandbox.commands.run(command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
      };
    } catch (err: unknown) {
      // E2B SDK throws CommandExitError for non-zero exit codes
      // Extract the result from the error if available
      if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err && 'exitCode' in err) {
        const cmdErr = err as { stdout: string; stderr: string; exitCode: number };
        return {
          stdout: cmdErr.stdout || '',
          stderr: cmdErr.stderr || '',
          exit_code: cmdErr.exitCode,
        };
      }
      // For other errors, return empty result with exit code 1
      console.error('[E2BInstance.exec] Error:', err);
      return {
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    }
  }

  /**
   * Get the host URL for a specific port
   */
  getHost(port: number): string {
    return this.sandbox.getHost(port);
  }

  /**
   * Expose an HTTP service on a port
   */
  async exposeHttpService(name: string, port: number): Promise<void> {
    const url = `https://${this.getHost(port)}`;
    this._httpServices.push({ name, port, url });
  }

  /**
   * Hide/remove an exposed HTTP service
   */
  async hideHttpService(name: string): Promise<void> {
    this._httpServices = this._httpServices.filter((s) => s.name !== name);
  }

  /**
   * Set sandbox timeout
   */
  async setTimeout(timeoutMs: number): Promise<void> {
    await this.sandbox.setTimeout(timeoutMs);
  }

  /**
   * Stop the sandbox (kill it)
   */
  async stop(): Promise<void> {
    await this.sandbox.kill();
    this._status = "stopped";
  }

  /**
   * Pause the sandbox
   * Note: E2B doesn't have native pause, so we just keep it running with extended timeout
   */
  async pause(): Promise<void> {
    // E2B doesn't have pause functionality, but we can extend timeout
    // and mark as paused for our tracking
    this._status = "paused";
  }

  /**
   * Resume the sandbox
   */
  async resume(): Promise<void> {
    this._status = "running";
  }

  /**
   * Check if sandbox is running
   */
  async isRunning(): Promise<boolean> {
    return this.sandbox.isRunning();
  }

  /**
   * Set wake-on for the sandbox (no-op for E2B)
   */
  async setWakeOn(_http: boolean, _ssh: boolean): Promise<void> {
    // E2B doesn't have wake-on functionality
  }

  /**
   * Write a file to the sandbox
   */
  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.files.write(path, content);
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(path: string): Promise<string> {
    return await this.sandbox.files.read(path);
  }

  /**
   * Get the underlying E2B Sandbox instance
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }
}

/**
 * E2B Client that provides a similar interface to MorphCloudClient
 */
export class E2BClient {
  private apiKey: string;

  constructor(config: E2BClientConfig = {}) {
    this.apiKey = config.apiKey || process.env.E2B_API_KEY || "";

    if (!this.apiKey) {
      throw new Error("E2B API key is required");
    }
  }

  /**
   * Instances namespace for managing E2B sandboxes
   */
  instances = {
    /**
     * Start a new sandbox from a template
     */
    start: async (options: {
      templateId?: string;
      ttlSeconds?: number;
      ttlAction?: "pause" | "stop";
      metadata?: E2BMetadata;
      envs?: Record<string, string>;
    }): Promise<E2BInstance> => {
      const timeoutMs = (options.ttlSeconds || 3600) * 1000;

      const sandbox = await Sandbox.create(options.templateId || CMUX_DEVBOX_TEMPLATE_ID, {
        apiKey: this.apiKey,
        timeoutMs,
        metadata: options.metadata,
        envs: options.envs,
      });

      // Set up default HTTP services for VSCode, worker, and VNC ports
      const httpServices: E2BHttpService[] = [
        {
          name: "vscode",
          port: 39378,
          url: `https://${sandbox.getHost(39378)}`,
        },
        {
          name: "worker",
          port: 39377,
          url: `https://${sandbox.getHost(39377)}`,
        },
        {
          name: "vnc",
          port: 39380,
          url: `https://${sandbox.getHost(39380)}`,
        },
      ];

      return new E2BInstance(sandbox, options.metadata || {}, httpServices);
    },

    /**
     * Get an existing sandbox by ID
     */
    get: async (options: { instanceId: string }): Promise<E2BInstance> => {
      const sandbox = await Sandbox.connect(options.instanceId, {
        apiKey: this.apiKey,
      });

      // Rebuild HTTP services from the connected sandbox
      const httpServices: E2BHttpService[] = [
        {
          name: "vscode",
          port: 39378,
          url: `https://${sandbox.getHost(39378)}`,
        },
        {
          name: "worker",
          port: 39377,
          url: `https://${sandbox.getHost(39377)}`,
        },
        {
          name: "vnc",
          port: 39380,
          url: `https://${sandbox.getHost(39380)}`,
        },
      ];

      return new E2BInstance(sandbox, {}, httpServices);
    },

    /**
     * List all running sandboxes
     */
    list: async (): Promise<Array<{ sandboxId: string; templateId: string; startedAt: Date }>> => {
      const sandboxes = await Sandbox.list({ apiKey: this.apiKey });
      return sandboxes.map((s) => ({
        sandboxId: s.sandboxId,
        templateId: s.templateId,
        startedAt: s.startedAt,
      }));
    },

    /**
     * Kill a sandbox by ID
     */
    kill: async (sandboxId: string): Promise<void> => {
      await Sandbox.kill(sandboxId, { apiKey: this.apiKey });
    },
  };
}

/**
 * Create an E2B client
 */
export const createE2BClient = (config: E2BClientConfig = {}): E2BClient => {
  return new E2BClient(config);
};

// Re-export types
export type { Sandbox } from "e2b";
