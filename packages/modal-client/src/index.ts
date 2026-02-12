import { ModalClient as ModalSdkClient } from "modal";
import type { Sandbox, Image } from "modal";

/**
 * GPU types available in Modal.
 * Format: "GPU_TYPE" or "GPU_TYPE:COUNT" for multi-GPU.
 * Examples: "T4", "A10G", "A100", "A100-80GB", "H100", "H100:2"
 */
export type ModalGpuConfig = string;

/**
 * Well-known GPU types for convenience.
 */
export const MODAL_GPU_TYPES = [
  "T4",
  "L4",
  "A10G",
  "L40S",
  "A100",
  "A100-80GB",
  "H100",
  "H200",
  "B200",
] as const;

export type ModalGpuType = (typeof MODAL_GPU_TYPES)[number];

/**
 * Configuration for creating a Modal client
 */
export interface ModalClientConfig {
  tokenId?: string;
  tokenSecret?: string;
}

/**
 * Result of executing a command in a Modal sandbox
 */
export interface ModalExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

/**
 * HTTP service exposed by a Modal sandbox via tunnel
 */
export interface ModalHttpService {
  name: string;
  port: number;
  url: string;
}

/**
 * Networking information for a Modal sandbox
 */
export interface ModalNetworking {
  httpServices: ModalHttpService[];
}

/**
 * Metadata stored with a Modal sandbox
 */
export type ModalMetadata = Record<string, string>;

/**
 * Options for creating a Modal sandbox
 */
export interface ModalSandboxCreateOptions {
  /** Modal App name to create sandbox under */
  appName?: string;
  /** Container image (e.g., "ubuntu:22.04"). Defaults to ubuntu:22.04 */
  image?: string;
  /** Snapshot image ID to use instead of a registry image */
  snapshotImageId?: string;
  /** GPU configuration (e.g., "T4", "A100", "H100:2") */
  gpu?: ModalGpuConfig;
  /** CPU core count (fractional values allowed) */
  cpu?: number;
  /** Memory in MiB */
  memoryMiB?: number;
  /** Sandbox timeout in seconds (default 3600) */
  timeoutSeconds?: number;
  /** Environment variables */
  envs?: Record<string, string>;
  /** Metadata tags */
  metadata?: ModalMetadata;
  /** Ports to expose via encrypted tunnels */
  encryptedPorts?: number[];
  /** Working directory */
  workdir?: string;
  /** Cloud provider region */
  region?: string;
}

function assignPortName(portNum: number): string {
  if (portNum === 8888) return "jupyter";
  if (portNum === 39377) return "worker";
  if (portNum === 39378) return "vscode";
  if (portNum === 39380) return "vnc";
  return `port-${portNum}`;
}

async function fetchTunnelServices(
  sandbox: Sandbox,
): Promise<ModalHttpService[]> {
  const httpServices: ModalHttpService[] = [];
  const tunnels = await sandbox.tunnels();
  for (const [port, info] of Object.entries(tunnels)) {
    const portNum = Number(port);
    httpServices.push({
      name: assignPortName(portNum),
      port: portNum,
      url: info.url,
    });
  }
  return httpServices;
}

/**
 * Modal Sandbox instance wrapper that provides a similar interface to E2BInstance
 */
export class ModalInstance {
  private sandbox: Sandbox;
  private _id: string;
  private _metadata: ModalMetadata;
  private _httpServices: ModalHttpService[];
  private _status: "running" | "paused" | "stopped";
  private _gpu: ModalGpuConfig | undefined;

  constructor(
    sandbox: Sandbox,
    metadata: ModalMetadata = {},
    httpServices: ModalHttpService[] = [],
    gpu?: ModalGpuConfig,
  ) {
    this.sandbox = sandbox;
    this._id = sandbox.sandboxId;
    this._metadata = metadata;
    this._httpServices = httpServices;
    this._status = "running";
    this._gpu = gpu;
  }

  get id(): string {
    return this._id;
  }

  get metadata(): ModalMetadata {
    return this._metadata;
  }

  get status(): "running" | "paused" | "stopped" {
    return this._status;
  }

  get gpu(): ModalGpuConfig | undefined {
    return this._gpu;
  }

  get networking(): ModalNetworking {
    return {
      httpServices: this._httpServices,
    };
  }

  /**
   * Execute a command in the sandbox.
   * Handles non-zero exit codes gracefully (doesn't throw).
   */
  async exec(command: string): Promise<ModalExecResult> {
    try {
      const process = await this.sandbox.exec(["bash", "-c", command]);
      const stdout = await process.stdout.readText();
      const stderr = await process.stderr.readText();
      const exitCode = await process.wait();

      return {
        stdout,
        stderr,
        exit_code: exitCode ?? 0,
      };
    } catch (err: unknown) {
      console.error("[ModalInstance.exec] Error:", err);
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    }
  }

  /**
   * Get tunnel URLs for exposed ports
   */
  async refreshTunnels(): Promise<ModalHttpService[]> {
    try {
      this._httpServices = await fetchTunnelServices(this.sandbox);
      return this._httpServices;
    } catch (err) {
      console.error("[ModalInstance.refreshTunnels] Error:", err);
      return this._httpServices;
    }
  }

  /**
   * Snapshot the sandbox filesystem. Returns the image ID.
   */
  async snapshotFilesystem(timeoutMs?: number): Promise<string> {
    const image = await this.sandbox.snapshotFilesystem(timeoutMs);
    return image.imageId;
  }

  /**
   * Stop (terminate) the sandbox
   */
  async stop(): Promise<void> {
    await this.sandbox.terminate();
    this._status = "stopped";
  }

  /**
   * Pause the sandbox (no-op for Modal; sandbox stays running)
   */
  async pause(): Promise<void> {
    this._status = "paused";
  }

  /**
   * Resume the sandbox (no-op for Modal)
   */
  async resume(): Promise<void> {
    this._status = "running";
  }

  /**
   * Check if sandbox is still running
   */
  async isRunning(): Promise<boolean> {
    const exitCode = await this.sandbox.poll();
    return exitCode === null;
  }

  /**
   * Set wake-on for the sandbox (no-op for Modal)
   */
  async setWakeOn(_http: boolean, _ssh: boolean): Promise<void> {
    // Modal doesn't have wake-on functionality
  }

  /**
   * Write a file to the sandbox
   */
  async writeFile(path: string, content: string): Promise<void> {
    const f = await this.sandbox.open(path, "w");
    await f.write(new TextEncoder().encode(content));
    await f.close();
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(path: string): Promise<string> {
    const f = await this.sandbox.open(path, "r");
    const bytes = await f.read();
    await f.close();
    return new TextDecoder().decode(bytes);
  }

  /**
   * Set metadata tags on the sandbox
   */
  async setTags(tags: ModalMetadata): Promise<void> {
    await this.sandbox.setTags(tags);
    Object.assign(this._metadata, tags);
  }

  /**
   * Get the underlying Modal Sandbox instance
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }
}

/**
 * Modal Client that provides a similar interface to E2BClient
 */
export class ModalClient {
  private client: ModalSdkClient;

  constructor(config: ModalClientConfig = {}) {
    const tokenId = config.tokenId || process.env.MODAL_TOKEN_ID || "";
    const tokenSecret =
      config.tokenSecret || process.env.MODAL_TOKEN_SECRET || "";

    if (!tokenId || !tokenSecret) {
      throw new Error(
        "Modal token ID and secret are required (MODAL_TOKEN_ID, MODAL_TOKEN_SECRET)",
      );
    }

    this.client = new ModalSdkClient({
      tokenId,
      tokenSecret,
    });
  }

  /**
   * Instances namespace for managing Modal sandboxes
   */
  instances = {
    /**
     * Start a new sandbox.
     * If snapshotImageId is provided, uses that pre-built image.
     * Otherwise falls back to a registry image.
     */
    start: async (
      options: ModalSandboxCreateOptions = {},
    ): Promise<ModalInstance> => {
      const appName = options.appName || "cmux-devbox";
      const app = await this.client.apps.fromName(appName, {
        createIfMissing: true,
      });

      let image: Image;
      if (options.snapshotImageId) {
        image = await this.client.images.fromId(options.snapshotImageId);
      } else {
        image = this.client.images.fromRegistry(
          options.image || "ubuntu:22.04",
        );
      }

      const encryptedPorts = options.encryptedPorts || [
        8888, 39377, 39378, 39380,
      ];

      const sandbox = await this.client.sandboxes.create(app, image, {
        gpu: options.gpu,
        cpu: options.cpu,
        memoryMiB: options.memoryMiB,
        timeoutMs: (options.timeoutSeconds ?? 3600) * 1000,
        env: options.envs,
        encryptedPorts,
        workdir: options.workdir,
      });

      // Fetch tunnel URLs for exposed ports
      let httpServices: ModalHttpService[] = [];
      try {
        httpServices = await fetchTunnelServices(sandbox);
      } catch (err) {
        console.error("[ModalClient.start] Error fetching tunnels:", err);
      }

      return new ModalInstance(
        sandbox,
        options.metadata || {},
        httpServices,
        options.gpu,
      );
    },

    /**
     * Get an existing sandbox by ID
     */
    get: async (options: { instanceId: string }): Promise<ModalInstance> => {
      const sandbox = await this.client.sandboxes.fromId(options.instanceId);

      // Fetch tunnel URLs
      let httpServices: ModalHttpService[] = [];
      try {
        httpServices = await fetchTunnelServices(sandbox);
      } catch (err) {
        console.error("[ModalClient.get] Error fetching tunnels:", err);
      }

      return new ModalInstance(sandbox, {}, httpServices);
    },

    /**
     * List all sandboxes for the current environment
     */
    list: async (): Promise<
      Array<{ sandboxId: string; startedAt: Date }>
    > => {
      const sandboxes: Array<{ sandboxId: string; startedAt: Date }> = [];
      for await (const sb of this.client.sandboxes.list()) {
        sandboxes.push({
          sandboxId: sb.sandboxId,
          startedAt: new Date(),
        });
      }
      return sandboxes;
    },

    /**
     * Terminate a sandbox by ID
     */
    kill: async (sandboxId: string): Promise<void> => {
      const sandbox = await this.client.sandboxes.fromId(sandboxId);
      await sandbox.terminate();
    },
  };

  /**
   * Close the client connection
   */
  close(): void {
    this.client.close();
  }
}

/**
 * Create a Modal client
 */
export const createModalClient = (
  config: ModalClientConfig = {},
): ModalClient => {
  return new ModalClient(config);
};

export type { Sandbox, Image } from "modal";
