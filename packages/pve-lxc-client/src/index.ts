/**
 * Proxmox VE LXC Client
 *
 * A client for managing LXC containers on Proxmox VE that mirrors
 * the MorphCloudClient interface for seamless provider switching.
 * Supports canonical snapshot IDs (snapshot_*) with legacy formats for compatibility.
 */

import { Agent, fetch as undiciFetch } from "undici";
import crypto from "node:crypto";

/**
 * Configuration for PveLxcClient.
 * Environment-agnostic: all config is injected via constructor.
 */
export interface PveLxcClientConfig {
  apiUrl: string;
  apiToken: string;
  node?: string;
  publicDomain?: string;
  verifyTls?: boolean;
  /** Resolve a snapshot ID to a template VMID. If not provided, templateVmid must be specified in StartContainerOptions. */
  snapshotResolver?: (snapshotId: string) => Promise<{ templateVmid: number }> | { templateVmid: number };
}

/**
 * Result of command execution
 */
export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/**
 * HTTP service exposed by the container
 */
export interface HttpService {
  name: string;
  port: number;
  url: string;
}

/**
 * Container networking configuration
 */
export interface ContainerNetworking {
  httpServices: HttpService[];
  /** Container hostname / instance ID (e.g., "pvelxc-abc123") */
  hostname?: string;
  /** Fully qualified domain name (e.g., "cmux-200.lan") */
  fqdn?: string;
}

/**
 * Container instance metadata
 */
export interface ContainerMetadata {
  app?: string;
  teamId?: string;
  userId?: string;
  environmentId?: string;
  [key: string]: string | undefined;
}

/**
 * Container status
 */
export type ContainerStatus = "running" | "stopped" | "paused" | "unknown";

/**
 * PVE LXC Container Instance
 */
export class PveLxcInstance {
  public readonly id: string;
  public readonly vmid: number;
  public status: ContainerStatus;
  public metadata: ContainerMetadata;
  public networking: ContainerNetworking;

  private client: PveLxcClient;

  constructor(
    client: PveLxcClient,
    instanceId: string,
    vmid: number,
    status: ContainerStatus,
    metadata: ContainerMetadata,
    networking: ContainerNetworking,
    node: string
  ) {
    this.client = client;
    this.vmid = vmid;
    this.id = instanceId;
    this.status = status;
    this.metadata = metadata;
    this.networking = networking;
    // Note: node parameter available but not stored - client.getNode() is used for operations
    void node;
  }

  /**
   * Execute a command inside the container via HTTP exec (cmux-execd).
   */
  async exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult> {
    return this.client.execInContainer(this.vmid, command, {
      timeoutMs: options?.timeoutMs,
      instanceId: this.id,
      hostname: this.networking.hostname,
    });
  }

  /**
   * Start the container
   */
  async start(): Promise<void> {
    await this.client.startContainer(this.vmid);
    this.status = "running";
  }

  /**
   * Stop the container
   */
  async stop(): Promise<void> {
    await this.client.stopContainer(this.vmid);
    this.status = "stopped";
  }

  /**
   * Shutdown the container gracefully.
   */
  async shutdown(): Promise<void> {
    await this.client.shutdownContainer(this.vmid, { timeoutSeconds: 60 });
    this.status = "stopped";
  }

  /**
   * Pause the container (LXC doesn't support hibernate, use stop instead)
   * Note: Unlike Morph VMs, LXC containers don't preserve RAM state on stop.
   */
  async pause(): Promise<void> {
    await this.client.stopContainer(this.vmid);
    this.status = "stopped";
  }

  /**
   * Resume the container (restart after stop)
   */
  async resume(): Promise<void> {
    await this.client.startContainer(this.vmid);
    this.status = "running";
  }

  /**
   * Expose an HTTP service (uses public domain when available, falls back to FQDN)
   */
  async exposeHttpService(name: string, port: number): Promise<void> {
    const hostname = this.networking.hostname;
    if (!hostname) {
      throw new Error("Container hostname not available");
    }
    const publicUrl = this.client.getPublicServiceUrl(port, hostname);
    const fqdn = this.networking.fqdn;
    const url = publicUrl ?? (fqdn ? `http://${fqdn}:${port}` : `http://${hostname}:${port}`);
    const existingService = this.networking.httpServices.find(
      (s) => s.name === name
    );
    if (existingService) {
      existingService.port = port;
      existingService.url = url;
    } else {
      this.networking.httpServices.push({ name, port, url });
    }
  }

  /**
   * Hide an HTTP service
   */
  async hideHttpService(name: string): Promise<void> {
    this.networking.httpServices = this.networking.httpServices.filter(
      (s) => s.name !== name
    );
  }

  /**
   * Delete the container (stop first if running, then destroy).
   */
  async delete(): Promise<void> {
    try {
      await this.client.stopContainer(this.vmid);
    } catch (err) {
      // Expected: container may already be stopped
      console.warn(`[PveLxcInstance.delete] Stop failed for ${this.vmid} (may be already stopped):`, err);
    }
    await this.client.deleteContainer(this.vmid);
  }

  /**
   * Set wake-on behavior (no-op for PVE, compatibility with Morph)
   */
  async setWakeOn(_http: boolean, _ssh: boolean): Promise<void> {
    // PVE LXC doesn't have wake-on functionality like Morph
    // This is a no-op for compatibility
  }
}

/**
 * Options for starting a container
 */
export interface StartContainerOptions {
  snapshotId: string;
  templateVmid?: number;
  instanceId?: string;
  ttlSeconds?: number;
  ttlAction?: "pause" | "stop";
  metadata?: ContainerMetadata;
}

/**
 * PVE API response types
 */
interface PveApiResponse<T> {
  data: T;
}

interface PveTaskStatus {
  status: string;
  exitstatus?: string;
}

interface PveContainerStatus {
  status: string;
  vmid: number;
  name?: string;
  cpus?: number;
  maxmem?: number;
  maxdisk?: number;
  template?: number;
}

/**
 * PVE container network interface configuration
 */
interface PveContainerConfig {
  net0?: string; // Format: name=eth0,bridge=vmbr0,ip=10.100.0.X/24,gw=10.100.0.1
  hostname?: string;
  [key: string]: string | number | undefined;
}

/**
 * PVE DNS configuration response
 */
interface PveDnsConfig {
  search?: string;
  dns1?: string;
  dns2?: string;
  dns3?: string;
}

/**
 * Proxmox VE LXC Client
 */
export class PveLxcClient {
  private apiUrl: string;
  private apiToken: string;
  private node: string | null;
  /** Domain suffix for FQDNs, auto-detected from PVE DNS config (e.g., ".lan") */
  private domainSuffix: string | null = null;
  /** Whether we've attempted to fetch the domain suffix */
  private domainSuffixFetched: boolean = false;
  /** Public domain for external access via Cloudflare Tunnel (e.g., "example.com") */
  private publicDomain: string | null;
  /** HTTPS agent for PVE API requests (handles self-signed certs) */
  private httpsAgent: Agent;
  /** Optional snapshot resolver for resolving snapshot IDs to template VMIDs */
  private snapshotResolver?: (snapshotId: string) => Promise<{ templateVmid: number }> | { templateVmid: number };

  // In-memory store for HTTP service URLs (computed from VMID, not persisted)
  // Note: Instance metadata (teamId, userId, etc.) is now tracked in Convex
  // via sandboxInstanceActivity table, not stored here.
  private instanceServices: Map<number, HttpService[]> = new Map();
  private instanceHostnames: Map<number, string> = new Map();

  constructor(config: PveLxcClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.node = config.node || null; // Will be auto-detected if not provided
    this.publicDomain = config.publicDomain || null;
    this.snapshotResolver = config.snapshotResolver;
    // PVE often uses self-signed certificates, so we need a custom agent
    // We use undici's fetch directly to ensure the dispatcher option works
    this.httpsAgent = new Agent({
      connect: {
        rejectUnauthorized: config.verifyTls ?? false,
      },
    });
  }

  private generateInstanceId(): string {
    const suffix = crypto.randomUUID().split("-")[0];
    return `pvelxc-${suffix}`.toLowerCase();
  }

  private generateSnapshotId(): string {
    const suffix = crypto.randomUUID().split("-")[0];
    return `snapshot_${suffix}`.toLowerCase();
  }

  private normalizeHostId(value: string): string {
    return value.trim().toLowerCase().replace(/_/g, "-");
  }

  /**
   * Get the domain suffix, auto-detecting from PVE DNS config if not already fetched.
   * Returns null if no search domain is configured.
   */
  private async getDomainSuffix(): Promise<string | null> {
    if (this.domainSuffixFetched) {
      return this.domainSuffix;
    }

    try {
      const node = await this.getNode();
      const dnsConfig = await this.apiRequest<PveDnsConfig>(
        "GET",
        `/api2/json/nodes/${node}/dns`
      );

      if (dnsConfig?.search) {
        // PVE returns "lan" or "example.com", we need ".lan" or ".example.com"
        this.domainSuffix = `.${dnsConfig.search}`;
        console.log(`[PveLxcClient] Auto-detected domain suffix: ${this.domainSuffix}`);
      } else {
        console.log("[PveLxcClient] No DNS search domain configured, using IP addresses");
        this.domainSuffix = null;
      }
    } catch (error) {
      console.error("[PveLxcClient] Failed to fetch DNS config:", error);
      this.domainSuffix = null;
    }

    this.domainSuffixFetched = true;
    return this.domainSuffix;
  }

  /**
   * Get the FQDN for a hostname.
   */
  private getFqdnSync(hostname: string, domainSuffix: string | null): string | undefined {
    if (domainSuffix) {
      return `${hostname}${domainSuffix}`;
    }
    return undefined;
  }

  /**
   * Build a public URL for a service via Cloudflare Tunnel.
   * Pattern (instanceId-based): https://port-{port}-{instanceId}.{publicDomain}
   * Returns null if publicDomain is not configured.
   */
  private buildPublicServiceUrl(port: number, hostId: string): string | null {
    if (!this.publicDomain) {
      return null;
    }
    const normalizedHostId = this.normalizeHostId(hostId);
    return `https://port-${port}-${normalizedHostId}.${this.publicDomain}`;
  }

  getPublicServiceUrl(port: number, hostId: string): string | null {
    return this.buildPublicServiceUrl(port, hostId);
  }

  /**
   * Get the IP address of a container from its network configuration.
   * Parses the net0 config field (format: name=eth0,ip=10.100.0.X/24,gw=...)
   * Returns null if IP cannot be determined.
   */
  private async getContainerIp(vmid: number): Promise<string | null> {
    try {
      const node = await this.getNode();
      const config = await this.apiRequest<PveContainerConfig>(
        "GET",
        `/api2/json/nodes/${node}/lxc/${vmid}/config`
      );

      // Parse net0 configuration to extract IP
      // Format: name=eth0,bridge=vmbr0,ip=10.100.0.123/24,gw=10.100.0.1
      const net0 = config.net0;
      if (!net0) return null;

      const ipMatch = net0.match(/ip=([0-9.]+)/);
      if (ipMatch?.[1]) {
        return ipMatch[1];
      }

      return null;
    } catch (error) {
      console.error(`[PveLxcClient] Failed to get IP for container ${vmid}:`, error);
      return null;
    }
  }

  private async getContainerHostname(vmid: number): Promise<string | null> {
    const cached = this.instanceHostnames.get(vmid);
    if (cached) {
      return cached;
    }
    try {
      const node = await this.getNode();
      const config = await this.apiRequest<PveContainerConfig>(
        "GET",
        `/api2/json/nodes/${node}/lxc/${vmid}/config`
      );
      const hostname = typeof config.hostname === "string" ? config.hostname : null;
      if (hostname) {
        this.instanceHostnames.set(vmid, hostname);
      }
      return hostname;
    } catch (err) {
      console.warn(`[PveLxcClient.getContainerHostname] Failed to get hostname for ${vmid}:`, err);
      return null;
    }
  }

  /**
   * Build a service URL using the best available method:
   * 1. Public URL via Cloudflare Tunnel (if configured)
   * 2. FQDN (if DNS search domain is configured)
   * 3. Container IP address (fallback for local dev)
   *
   * Returns null if no URL can be built.
   */
  private async buildServiceUrl(
    port: number,
    vmid: number,
    hostname: string,
    domainSuffix: string | null,
    publicHostId: string
  ): Promise<string | null> {
    // 1. Try public URL (Cloudflare Tunnel)
    const publicUrl = this.buildPublicServiceUrl(port, publicHostId);
    if (publicUrl) {
      return publicUrl;
    }

    // 2. Try FQDN
    if (domainSuffix) {
      return `http://${hostname}${domainSuffix}:${port}`;
    }

    // 3. Fallback to container IP
    const ip = await this.getContainerIp(vmid);
    if (ip) {
      console.log(`[PveLxcClient] Using IP fallback for container ${vmid}: ${ip}`);
      return `http://${ip}:${port}`;
    }

    return null;
  }

  /**
   * Get the target node (auto-detect if not set)
   */
  private async getNode(): Promise<string> {
    if (this.node) {
      return this.node;
    }
    // Auto-detect by querying /nodes endpoint
    const result = await this.apiRequest<Array<{ node: string }>>(
      "GET",
      "/api2/json/nodes"
    );
    if (!result || result.length === 0) {
      throw new Error("No nodes found in PVE cluster");
    }
    this.node = result[0].node;
    console.log(`[PveLxcClient] Auto-detected node: ${this.node}`);
    return this.node;
  }

  /**
   * Make an API request to PVE
   */
  private async apiRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${this.apiToken}`,
    };

    let requestBody: string | undefined;
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      requestBody = new URLSearchParams(
        Object.entries(body).map(([k, v]) => [k, String(v)])
      ).toString();
    }

    // Use undici's fetch directly to ensure dispatcher option works
    // (Next.js patches global fetch which ignores dispatcher)
    const response = await undiciFetch(url, {
      method,
      headers,
      body: requestBody,
      dispatcher: this.httpsAgent,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PVE API error ${response.status}: ${text}`);
    }

    const json = (await response.json()) as PveApiResponse<T>;
    return json.data;
  }

  /**
   * Wait for a PVE task to complete
   */
  private async waitForTask(
    upid: string,
    timeoutMs: number = 300000
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 2000;
    const node = await this.getNode();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.apiRequest<PveTaskStatus>(
        "GET",
        `/api2/json/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`
      );

      if (status.status === "stopped") {
        if (status.exitstatus !== "OK") {
          throw new Error(`Task failed: ${status.exitstatus}`);
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error("Task timeout");
  }

  /**
   * Normalize a UPID returned by PVE. Handles encoded strings and object responses.
   */
  private normalizeUpid(rawUpid: unknown): string | null {
    let candidate: string | null = null;

    if (typeof rawUpid === "string") {
      candidate = rawUpid;
    } else if (
      rawUpid &&
      typeof rawUpid === "object" &&
      "upid" in (rawUpid as Record<string, unknown>)
    ) {
      const value = (rawUpid as Record<string, unknown>).upid;
      if (typeof value === "string") {
        candidate = value;
      }
    }

    if (!candidate) {
      return null;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    // Some PVE endpoints may return URL-encoded UPIDs
    return trimmed.includes("%3A") ? decodeURIComponent(trimmed) : trimmed;
  }

  /**
   * Wait for a task if a valid UPID is returned. If no UPID is provided,
   * optionally poll a fallback condition to confirm completion.
   */
  private async waitForTaskNormalized(
    rawUpid: unknown,
    context: string,
    fallbackCheck?: () => Promise<boolean>,
    options?: { timeoutMs?: number }
  ): Promise<void> {
    const upid = this.normalizeUpid(rawUpid);

    if (upid) {
      await this.waitForTask(upid, options?.timeoutMs);
      return;
    }

    if (fallbackCheck) {
      const timeoutMs = options?.timeoutMs ?? 300000;
      const pollInterval = 2000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        try {
          if (await fallbackCheck()) {
            console.warn(
              `[PveLxcClient] ${context} completed without UPID (verified via fallback poll)`
            );
            return;
          }
        } catch (error) {
          console.error(
            `[PveLxcClient] Fallback check failed for ${context}:`,
            error
          );
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      throw new Error(
        `Task ${context} did not return a UPID and did not complete within ${timeoutMs}ms`
      );
    }

    console.warn(
      `[PveLxcClient] No task UPID returned for ${context}, assuming synchronous completion`
    );
  }

  /**
   * Execute a command inside an LXC container via HTTP exec daemon.
   * This uses the cmux-execd service running in the container on port 39375.
   * Supports both internal (hostname/IP) and public (Cloudflare Tunnel) URLs.
   * Returns null if HTTP exec is not available.
   */
  private async httpExec(
    host: string,
    command: string,
    timeoutMs?: number
  ): Promise<ExecResult | null> {
    // Support both full URLs (http/https) and bare hosts
    let execUrl: string;
    if (host.startsWith("http://") || host.startsWith("https://")) {
      const url = new URL(host);
      url.pathname = url.pathname && url.pathname !== "/" ? url.pathname : "/exec";
      execUrl = url.toString();
    } else {
      execUrl = `http://${host}:39375/exec`;
    }
    // Set HOME and XDG_RUNTIME_DIR explicitly since cmux-execd may not have them set.
    // HOME is required by many tools (gh, git).
    // XDG_RUNTIME_DIR is required by cmux-envd to locate its socket at /run/user/0/cmux-envd/envd.sock,
    // ensuring envctl load and envctl export (in shell hooks) use the same socket path.
    // The command is passed directly to the execd service which runs it via bash -c.
    const effectiveTimeoutMs = timeoutMs ?? 300000;

    const body = JSON.stringify({
      command: `export HOME=/root XDG_RUNTIME_DIR=/run/user/0; ${command}`,
      timeout_ms: effectiveTimeoutMs,
    });

    try {
      const response = await undiciFetch(execUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(effectiveTimeoutMs + 30000),
      });

      if (!response.ok) {
        return null;
      }

      // Parse streaming JSON lines response
      const text = await response.text();
      const lines = text.trim().split("\n").filter(Boolean);

      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as {
            type: string;
            data?: string;
            code?: number;
            message?: string;
          };

          switch (event.type) {
            case "stdout":
              if (event.data) stdout += event.data + "\n";
              break;
            case "stderr":
              if (event.data) stderr += event.data + "\n";
              break;
            case "exit":
              exitCode = event.code ?? 0;
              break;
            case "error":
              stderr += (event.message ?? "Unknown error") + "\n";
              break;
          }
        } catch (err) {
          // Skip malformed JSON lines but log for debugging
          console.warn(`[PveLxcClient.httpExec] Skipping malformed line: ${line}`, err);
        }
      }

      return {
        exit_code: exitCode,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      };
    } catch (error) {
      console.error(
        `[PveLxcClient] HTTP exec failed for ${host}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Execute a command inside an LXC container via HTTP exec (cmux-execd).
   * Requires cmux-execd to be running in the container on port 39375.
   * Uses public exec URL (Cloudflare Tunnel), FQDN, or hostname to reach the container.
   * Includes retry logic for container startup timing.
   */
  async execInContainer(
    vmid: number,
    command: string,
    options?: {
      execHost?: string;
      timeoutMs?: number;
      retries?: number;
      hostname?: string;
      instanceId?: string;
    }
  ): Promise<ExecResult> {
    const fallbackHostname = `cmux-${vmid}`;
    const resolvedHostname =
      options?.hostname ??
      (await this.getContainerHostname(vmid)) ??
      fallbackHostname;
    const hostId = options?.instanceId ?? resolvedHostname;
    const hostname = resolvedHostname;
    const domainSuffix = await this.getDomainSuffix();
    const maxRetries = options?.retries ?? 5;
    const baseDelayMs = 2000;

    const hosts = new Set<string>();
    if (options?.execHost) {
      hosts.add(options.execHost);
    }

    // Prefer public (Caddy/Cloudflare) URL first, then FQDN, then IP fallback
    const publicExecUrl = this.buildPublicServiceUrl(39375, hostId);
    if (publicExecUrl) {
      hosts.add(publicExecUrl);
    }

    const fqdn = this.getFqdnSync(hostname, domainSuffix);
    if (fqdn) {
      hosts.add(`http://${fqdn}:39375`);
    }

    const ip = await this.getContainerIp(vmid);
    if (ip) {
      hosts.add(`http://${ip}:39375`);
    }

    if (!hosts.size) {
      throw new Error(
        `Cannot execute command in container ${vmid}: no reachable exec host candidates`
      );
    }

    for (const host of hosts) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const httpResult = await this.httpExec(host, command, options?.timeoutMs);

        if (httpResult) {
          // Log command execution (truncate long commands for readability)
          const truncatedCmd = command.length > 100 ? `${command.slice(0, 100)}...` : command;
          console.log(
            `[PveLxcClient] Exec completed (exit=${httpResult.exit_code}): ${truncatedCmd}`
          );
          if (attempt > 1) {
            console.log(
              `[PveLxcClient] HTTP exec succeeded on attempt ${attempt} for ${host}`
            );
          }
          return httpResult;
        }

        if (attempt < maxRetries) {
          const delayMs = baseDelayMs * attempt;
          console.log(
            `[PveLxcClient] HTTP exec attempt ${attempt}/${maxRetries} failed for ${host}, retrying in ${delayMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      console.warn(
        `[PveLxcClient] HTTP exec failed for ${host} after ${maxRetries} attempts, trying next candidate...`
      );
    }

    throw new Error(
      `HTTP exec failed for container ${vmid} via candidates: ${Array.from(hosts).join(
        ", "
      )}. Ensure cmux-execd is running and network is reachable.`
    );
  }

  /**
   * Get the next available VMID (checks both QEMU VMs and LXC containers)
   */
  private async findNextVmid(): Promise<number> {
    const node = await this.getNode();

    // Get LXC containers
    const containers = await this.apiRequest<PveContainerStatus[]>(
      "GET",
      `/api2/json/nodes/${node}/lxc`
    );

    // Get QEMU VMs as well to avoid VMID collisions
    const vms = await this.apiRequest<Array<{ vmid: number }>>(
      "GET",
      `/api2/json/nodes/${node}/qemu`
    );

    const usedVmids = new Set([
      ...containers.map((c) => c.vmid),
      ...vms.map((v) => v.vmid),
    ]);

    // Start from 200 to avoid collision with typical template VMIDs (100-199)
    let vmid = 200;
    while (usedVmids.has(vmid)) {
      vmid++;
    }
    return vmid;
  }

  /**
   * Get the next available template VMID (default range: 9000+).
   * Falls back to the general VMID allocator if the template range is exhausted.
   */
  private async findNextTemplateVmid(): Promise<number> {
    const node = await this.getNode();
    const containers = await this.apiRequest<PveContainerStatus[]>(
      "GET",
      `/api2/json/nodes/${node}/lxc`
    );
    const vms = await this.apiRequest<Array<{ vmid: number }>>(
      "GET",
      `/api2/json/nodes/${node}/qemu`
    );

    const usedVmids = new Set([
      ...containers.map((c) => c.vmid),
      ...vms.map((v) => v.vmid),
    ]);

    let vmid = 9000;
    while (usedVmids.has(vmid)) {
      vmid++;
    }

    if (vmid >= 10000) {
      return this.findNextVmid();
    }

    return vmid;
  }

  private async findVmidByHostname(hostname: string): Promise<number | null> {
    const node = await this.getNode();
    const containers = await this.apiRequest<PveContainerStatus[]>(
      "GET",
      `/api2/json/nodes/${node}/lxc`
    );
    const normalized = this.normalizeHostId(hostname);
    const match = containers.find(
      (container) => this.normalizeHostId(container.name ?? "") === normalized
    );
    return match?.vmid ?? null;
  }

  private async resolveVmidForInstanceId(instanceId: string): Promise<number> {
    const hostname = this.normalizeHostId(instanceId);
    const vmid = await this.findVmidByHostname(hostname);
    if (!vmid) {
      throw new Error(`Unable to resolve VMID for instance ${instanceId}`);
    }
    return vmid;
  }

  /**
   * Resolve a snapshot ID to a template VMID.
   * Uses the snapshotResolver provided in constructor config.
   * If no resolver is configured, throws an error directing callers
   * to provide templateVmid directly in StartContainerOptions.
   */
  private async parseSnapshotId(snapshotId: string): Promise<{
    templateVmid: number;
  }> {
    if (!this.snapshotResolver) {
      throw new Error(
        `Cannot resolve snapshot ID "${snapshotId}": no snapshotResolver configured. ` +
        `Either provide snapshotResolver in PveLxcClientConfig or specify templateVmid directly in StartContainerOptions.`
      );
    }
    return this.snapshotResolver(snapshotId);
  }

  /**
   * Convert an existing container into a reusable template.
   * Returns the template VMID and canonical snapshot ID.
   *
   * Workflow:
   * 1. Shutdown source container (e.g., VMID 201)
   * 2. Convert source container to template (in-place)
   * 3. Linked clone from source template to new template VMID (9000+)
   * 4. Convert linked clone to template
   * 5. Delete source template (best effort cleanup)
   *
   * Rollback strategy:
   * - If step 2 fails: Source is still a container, just restart it
   * - If step 3/4 fails AND linked clone exists:
   *   - Delete source template (201)
   *   - Clone from linked clone (9000) back to source VMID (201)
   *   - Delete linked clone (9000)
   *   - Start restored container (201)
   *
   * This uses linked clone for efficiency (fast, copy-on-write).
   */
  async createTemplateFromContainer(sourceInstanceId: string): Promise<{
    templateVmid: number;
    snapshotId: string;
  }> {
    const sourceVmid = await this.resolveVmidForInstanceId(sourceInstanceId);
    const targetNode = await this.getNode();
    const sourceHostname =
      (await this.getContainerHostname(sourceVmid)) ??
      this.normalizeHostId(sourceInstanceId);

    // Track state for rollback
    let sourceConvertedToTemplate = false;
    let linkedCloneVmid: number | null = null;
    let linkedCloneCreated = false;

    // Step 1: Ensure source container is stopped
    console.log(
      `[PveLxcClient] Stopping source container ${sourceVmid} for template creation`
    );
    await this.ensureContainerStopped(sourceVmid);

    try {
      // Step 2: Convert source container to template (in-place)
      console.log(
        `[PveLxcClient] Converting container ${sourceVmid} to template`
      );
      const convertUpid = await this.apiRequest<string>(
        "POST",
        `/api2/json/nodes/${targetNode}/lxc/${sourceVmid}/template`
      );
      await this.waitForTaskNormalized(
        convertUpid,
        `convert container ${sourceVmid} to template`,
        async () => {
          const config = await this.apiRequest<PveContainerConfig>(
            "GET",
            `/api2/json/nodes/${targetNode}/lxc/${sourceVmid}/config`
          );
          return config.template === 1;
        }
      );
      sourceConvertedToTemplate = true;

      // Step 3: Linked clone from source template to new template VMID (9000+)
      linkedCloneVmid = await this.findNextTemplateVmid();
      const templateHostname = this.normalizeHostId(
        `cmux-template-${crypto.randomUUID().split("-")[0]}`
      );

      console.log(
        `[PveLxcClient] Linked cloning from template ${sourceVmid} to ${linkedCloneVmid}`
      );
      await this.linkedCloneFromTemplate(
        sourceVmid,
        linkedCloneVmid,
        templateHostname
      );
      linkedCloneCreated = true;

      // Step 4: Convert the linked clone to a template
      console.log(
        `[PveLxcClient] Converting linked clone ${linkedCloneVmid} to template`
      );
      const templateUpid = await this.apiRequest<string>(
        "POST",
        `/api2/json/nodes/${targetNode}/lxc/${linkedCloneVmid}/template`
      );
      await this.waitForTaskNormalized(
        templateUpid,
        `convert container ${linkedCloneVmid} to template`,
        async () => {
          const config = await this.apiRequest<PveContainerConfig>(
            "GET",
            `/api2/json/nodes/${targetNode}/lxc/${linkedCloneVmid}/config`
          );
          return config.template === 1;
        }
      );

      // Step 5: Delete the source template (no longer needed after linked clone)
      console.log(
        `[PveLxcClient] Deleting source template ${sourceVmid} (linked clone ${linkedCloneVmid} is now the template)`
      );
      try {
        await this.deleteContainer(sourceVmid);
      } catch (deleteError) {
        // Non-fatal: the new template is created, source just couldn't be cleaned up
        console.warn(
          `[PveLxcClient] Failed to delete source template ${sourceVmid} (non-fatal):`,
          deleteError instanceof Error ? deleteError.message : deleteError
        );
      }

      const snapshotId = this.generateSnapshotId();
      console.log(
        `[PveLxcClient] Template created: VMID=${linkedCloneVmid}, snapshotId=${snapshotId}`
      );
      return { templateVmid: linkedCloneVmid, snapshotId };
    } catch (error) {
      console.error(
        `[PveLxcClient] Template creation failed, attempting rollback:`,
        error instanceof Error ? error.message : error
      );

      await this.rollbackTemplateCreation({
        sourceVmid,
        sourceHostname,
        sourceConvertedToTemplate,
        linkedCloneVmid,
        linkedCloneCreated,
        targetNode,
      });

      throw error;
    }
  }

  /**
   * Rollback helper for createTemplateFromContainer.
   * Attempts to restore the source container to a usable state after a failure.
   */
  private async rollbackTemplateCreation(state: {
    sourceVmid: number;
    sourceHostname: string;
    sourceConvertedToTemplate: boolean;
    linkedCloneVmid: number | null;
    linkedCloneCreated: boolean;
    targetNode: string;
  }): Promise<void> {
    const {
      sourceVmid,
      sourceHostname,
      sourceConvertedToTemplate,
      linkedCloneVmid,
      linkedCloneCreated,
    } = state;

    // Case 1: Source is still a container (step 2 failed) - just restart it
    if (!sourceConvertedToTemplate) {
      console.log(
        `[PveLxcClient] Rollback: Source ${sourceVmid} is still a container, restarting...`
      );
      try {
        await this.startContainer(sourceVmid);
        console.log(
          `[PveLxcClient] Rollback successful: restarted container ${sourceVmid}`
        );
      } catch (restartError) {
        console.error(
          `[PveLxcClient] Rollback failed to restart container ${sourceVmid}:`,
          restartError instanceof Error ? restartError.message : restartError
        );
      }
      return;
    }

    // Case 2: Source is template, linked clone exists - restore from linked clone
    if (sourceConvertedToTemplate && linkedCloneCreated && linkedCloneVmid) {
      console.log(
        `[PveLxcClient] Rollback: Restoring container ${sourceVmid} from linked clone ${linkedCloneVmid}`
      );

      try {
        // Step A: Delete the source template to free up the VMID
        console.log(
          `[PveLxcClient] Rollback: Deleting source template ${sourceVmid}`
        );
        await this.deleteContainer(sourceVmid);

        // Step B: Clone from linkedCloneVmid back to sourceVmid
        // The linked clone might be a container or template depending on where we failed
        console.log(
          `[PveLxcClient] Rollback: Cloning from ${linkedCloneVmid} to ${sourceVmid}`
        );
        await this.cloneContainerFromSource(
          linkedCloneVmid,
          sourceVmid,
          sourceHostname
        );

        // Step C: Start the restored container
        console.log(
          `[PveLxcClient] Rollback: Starting restored container ${sourceVmid}`
        );
        await this.startContainer(sourceVmid);

        // Step D: Clean up the linked clone
        console.log(
          `[PveLxcClient] Rollback: Cleaning up linked clone ${linkedCloneVmid}`
        );
        await this.deleteContainer(linkedCloneVmid);

        console.log(
          `[PveLxcClient] Rollback successful: container ${sourceVmid} restored and running`
        );
      } catch (rollbackError) {
        console.error(
          `[PveLxcClient] Rollback failed:`,
          rollbackError instanceof Error
            ? rollbackError.message
            : rollbackError
        );
        console.error(
          `[PveLxcClient] Manual intervention may be required. State: ` +
            `sourceVmid=${sourceVmid} (template), linkedCloneVmid=${linkedCloneVmid}`
        );
      }
      return;
    }

    // Case 3: Source is template, no linked clone - cannot restore automatically
    if (sourceConvertedToTemplate && !linkedCloneCreated) {
      console.error(
        `[PveLxcClient] Rollback impossible: Source ${sourceVmid} is now a template ` +
          `with no backup. Manual intervention required.`
      );

      // Clean up any partial linked clone if VMID was allocated but clone failed
      if (linkedCloneVmid) {
        try {
          await this.deleteContainer(linkedCloneVmid);
          console.log(
            `[PveLxcClient] Cleaned up partial linked clone ${linkedCloneVmid}`
          );
        } catch (cleanupErr) {
          // Expected: container might not exist yet
          console.warn(`[PveLxcClient] Cleanup of linked clone ${linkedCloneVmid} failed (may not exist):`, cleanupErr);
        }
      }
    }
  }

  /**
   * Clone a container from a template using linked-clone (fast, copy-on-write).
   * Requires the source to be a template (template=1 in PVE config).
   */
  private async linkedCloneFromTemplate(
    templateVmid: number,
    newVmid: number,
    hostname: string
  ): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${templateVmid}/clone`,
      {
        newid: newVmid,
        hostname,
        full: 0, // Linked clone (fast, copy-on-write)
      }
    );

    await this.waitForTaskNormalized(
      upid,
      `linked clone ${templateVmid} -> ${newVmid}`
    );
  }

  /**
   * Clone a container from a non-template source (full clone).
   */
  private async cloneContainerFromSource(
    sourceVmid: number,
    newVmid: number,
    hostname: string
  ): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${sourceVmid}/clone`,
      {
        newid: newVmid,
        hostname,
        full: 1, // Full clone (source does not need to be a template)
      }
    );

    await this.waitForTaskNormalized(upid, `clone ${sourceVmid} -> ${newVmid}`);
  }

  /**
   * Start a container
   */
  async startContainer(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/start`
    );
    await this.waitForTaskNormalized(upid, `start container ${vmid}`);
  }

  /**
   * Stop a container
   */
  async stopContainer(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/stop`
    );
    await this.waitForTaskNormalized(upid, `stop container ${vmid}`);
  }

  /**
   * Shutdown a container gracefully.
   */
  async shutdownContainer(
    vmid: number,
    options?: { timeoutSeconds?: number }
  ): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/shutdown`,
      options?.timeoutSeconds ? { timeout: options.timeoutSeconds } : undefined
    );
    await this.waitForTaskNormalized(
      upid,
      `shutdown container ${vmid}`,
      async () => (await this.getContainerStatus(vmid)) !== "running"
    );
  }

  private async ensureContainerStopped(vmid: number): Promise<void> {
    const status = await this.getContainerStatus(vmid);
    if (status === "stopped") {
      return;
    }

    if (status === "running") {
      try {
        await this.shutdownContainer(vmid, { timeoutSeconds: 60 });
      } catch (error) {
        console.error(
          `[PveLxcClient] Graceful shutdown failed for ${vmid}, falling back to stop:`,
          error
        );
      }
    }

    const finalStatus = await this.getContainerStatus(vmid);
    if (finalStatus !== "stopped") {
      await this.stopContainer(vmid);
    }
  }

  // Note: CRIU-based suspend/resume methods removed - experimental PVE feature
  // with many limitations (FUSE incompatibility, I/O deadlocks, etc.)
  // Use stopContainer/startContainer instead for production use.
  // See: https://pve.proxmox.com/wiki/Linux_Container

  /**
   * Delete a container
   */
  async deleteContainer(vmid: number): Promise<void> {
    // Stop first if running
    try {
      await this.stopContainer(vmid);
    } catch (err) {
      // Expected: container may already be stopped
      console.warn(`[PveLxcClient.deleteContainer] Stop failed for ${vmid} (may be already stopped):`, err);
    }

    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "DELETE",
      `/api2/json/nodes/${node}/lxc/${vmid}`
    );
    await this.waitForTaskNormalized(upid, `delete container ${vmid}`);

    // Clean up in-memory service URLs
    // Note: Convex sandboxInstanceActivity is updated separately via recordStopInternal
    this.instanceServices.delete(vmid);
    this.instanceHostnames.delete(vmid);
  }

  /**
   * Get container status
   */
  private async getContainerStatus(
    vmid: number
  ): Promise<ContainerStatus> {
    try {
      const node = await this.getNode();
      const status = await this.apiRequest<PveContainerStatus>(
        "GET",
        `/api2/json/nodes/${node}/lxc/${vmid}/status/current`
      );

      switch (status.status) {
        case "running":
          return "running";
        case "stopped":
          return "stopped";
        case "paused":
          return "paused";
        default:
          return "unknown";
      }
    } catch (err) {
      console.warn(`[PveLxcClient.getContainerStatus] Failed to get status for ${vmid}:`, err);
      return "unknown";
    }
  }

  /**
   * Instances namespace (mirrors MorphCloudClient.instances)
   */
  instances = {
    /**
     * Start a new container from a template using linked-clone (fast, copy-on-write).
     * Includes rollback logic: if clone succeeds but start fails, the container is deleted.
     * Retries with a new VMID on "already exists" collision (race condition handling).
     */
    start: async (options: StartContainerOptions): Promise<PveLxcInstance> => {
      const resolvedTemplateVmid =
        options.templateVmid ??
        (await this.parseSnapshotId(options.snapshotId)).templateVmid;
      const instanceId = this.normalizeHostId(
        options.instanceId ?? this.generateInstanceId()
      );
      const hostname = instanceId;

      // Auto-detect domain suffix from PVE DNS config
      const domainSuffix = await this.getDomainSuffix();
      const fqdn = this.getFqdnSync(hostname, domainSuffix);

      // Note: Metadata (teamId, userId, etc.) is tracked in Convex sandboxInstanceActivity
      // table via sandboxes.route.ts calling recordCreate mutation
      const metadata = options.metadata || {};

      // Retry clone on VMID collision (race condition when multiple concurrent requests
      // query findNextVmid at the same time before any clone completes)
      const maxRetries = 5;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const newVmid = await this.findNextVmid();

        console.log(
          `[PveLxcClient] Linked-cloning from template ${resolvedTemplateVmid} to ${newVmid} (attempt ${attempt}/${maxRetries})`
        );

        try {
          // Linked-clone from template (fast, copy-on-write)
          await this.linkedCloneFromTemplate(resolvedTemplateVmid, newVmid, hostname);
        } catch (cloneError) {
          const errorMsg = cloneError instanceof Error ? cloneError.message : String(cloneError);
          // Check for VMID collision error - retry with a new VMID
          if (errorMsg.includes("already exists")) {
            console.warn(
              `[PveLxcClient] VMID ${newVmid} collision detected, retrying with new VMID (attempt ${attempt}/${maxRetries})`
            );
            lastError = cloneError instanceof Error ? cloneError : new Error(errorMsg);
            // Small delay before retry to let other operations complete
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
            continue;
          }
          throw cloneError;
        }

        // Clone succeeded - start the container with rollback on failure
        try {
          await this.startContainer(newVmid);
        } catch (startError) {
          // Clone succeeded but start failed - rollback by deleting the container
          console.error(
            `[PveLxcClient] Failed to start container ${newVmid}, rolling back clone:`,
            startError instanceof Error ? startError.message : startError
          );
          try {
            await this.deleteContainer(newVmid);
            console.log(`[PveLxcClient] Rollback complete: container ${newVmid} deleted`);
          } catch (deleteError) {
            console.error(
              `[PveLxcClient] Failed to rollback (delete) container ${newVmid}:`,
              deleteError instanceof Error ? deleteError.message : deleteError
            );
          }
          throw startError;
        }

        // Wait for container to be fully running
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Initialize services with standard cmux ports
        // URL resolution order: public URL (Cloudflare Tunnel) > FQDN > container IP
        const services: HttpService[] = [];
        const vscodeUrl = await this.buildServiceUrl(
          39378,
          newVmid,
          hostname,
          domainSuffix,
          hostname
        );
        const workerUrl = await this.buildServiceUrl(
          39377,
          newVmid,
          hostname,
          domainSuffix,
          hostname
        );
        const vncUrl = await this.buildServiceUrl(
          39380,
          newVmid,
          hostname,
          domainSuffix,
          hostname
        );
        const xtermUrl = await this.buildServiceUrl(
          39383,
          newVmid,
          hostname,
          domainSuffix,
          hostname
        );

        if (vscodeUrl && workerUrl && vncUrl && xtermUrl) {
          services.push(
            { name: "vscode", port: 39378, url: vscodeUrl },
            { name: "worker", port: 39377, url: workerUrl },
            { name: "vnc", port: 39380, url: vncUrl },
            { name: "xterm", port: 39383, url: xtermUrl }
          );
        } else {
          throw new Error(
            `Cannot build service URLs for container ${newVmid}: no public domain, DNS search domain, or container IP available`
          );
        }
        this.instanceServices.set(newVmid, services);
        this.instanceHostnames.set(newVmid, hostname);

        const node = await this.getNode();
        const instance = new PveLxcInstance(
          this,
          instanceId,
          newVmid,
          "running",
          metadata,
          { httpServices: services, hostname, fqdn },
          node
        );

        console.log(
          `[PveLxcClient] Container ${newVmid} started (hostname=${hostname}, fqdn=${fqdn || "none"})`
        );

        return instance;
      }

      // All retries exhausted
      throw lastError ?? new Error(`Failed to clone container after ${maxRetries} attempts due to VMID collisions`);
    },

    /**
     * Get an existing container instance
     */
    get: async (options: {
      instanceId: string;
      vmid?: number;
      hostname?: string;
    }): Promise<PveLxcInstance> => {
      const vmid =
        options.vmid ?? (await this.resolveVmidForInstanceId(options.instanceId));
      const resolvedHostname =
        options.hostname ??
        (await this.getContainerHostname(vmid)) ??
        this.normalizeHostId(options.instanceId);
      const hostname = resolvedHostname;

      // Auto-detect domain suffix from PVE DNS config
      const domainSuffix = await this.getDomainSuffix();
      const fqdn = this.getFqdnSync(hostname, domainSuffix);

      const node = await this.getNode();
      const status = await this.getContainerStatus(vmid);
      // Note: Metadata is stored in Convex sandboxInstanceActivity, not in-memory
      // Return empty metadata here; callers can query Convex for full details
      const metadata: ContainerMetadata = {};
      let services = this.instanceServices.get(vmid);

      // Rebuild service URLs if not cached (common on fresh client instances)
      if (!services || services.length === 0) {
        const vscodeUrl = await this.buildServiceUrl(
          39378,
          vmid,
          hostname,
          domainSuffix,
          hostname
        );
        const workerUrl = await this.buildServiceUrl(
          39377,
          vmid,
          hostname,
          domainSuffix,
          hostname
        );
        const vncUrl = await this.buildServiceUrl(
          39380,
          vmid,
          hostname,
          domainSuffix,
          hostname
        );
        const xtermUrl = await this.buildServiceUrl(
          39383,
          vmid,
          hostname,
          domainSuffix,
          hostname
        );

        services = [];
        if (vscodeUrl && workerUrl && vncUrl && xtermUrl) {
          services.push(
            { name: "vscode", port: 39378, url: vscodeUrl },
            { name: "worker", port: 39377, url: workerUrl },
            { name: "vnc", port: 39380, url: vncUrl },
            { name: "xterm", port: 39383, url: xtermUrl }
          );
          this.instanceServices.set(vmid, services);
        }
      }
      this.instanceHostnames.set(vmid, hostname);

      return new PveLxcInstance(
        this,
        options.instanceId,
        vmid,
        status,
        metadata,
        { httpServices: services || [], hostname, fqdn },
        node
      );
    },

    /**
     * List all cmux containers.
     * Filters by hostname prefix "cmux-" to identify cmux-managed containers.
     * Note: Detailed metadata is stored in Convex sandboxInstanceActivity table.
     */
    list: async (): Promise<PveLxcInstance[]> => {
      const node = await this.getNode();
      const containers = await this.apiRequest<PveContainerStatus[]>(
        "GET",
        `/api2/json/nodes/${node}/lxc`
      );

      // Auto-detect domain suffix from PVE DNS config
      const domainSuffix = await this.getDomainSuffix();

      const instances: PveLxcInstance[] = [];
      for (const container of containers) {
        // Filter by hostname prefix to identify cmux-managed containers
        // This is more reliable than checking in-memory metadata
        const containerHostname = container.name || "";
        if (
          containerHostname.startsWith("cmux-") ||
          containerHostname.startsWith("pvelxc-")
        ) {
          const hostname = containerHostname;
          const fqdn = this.getFqdnSync(hostname, domainSuffix);
          const status = await this.getContainerStatus(container.vmid);
          const services = this.instanceServices.get(container.vmid) || [];
          // Metadata is in Convex, return empty here
          const metadata: ContainerMetadata = {};
          this.instanceHostnames.set(container.vmid, hostname);

          instances.push(
            new PveLxcInstance(
              this,
              hostname,
              container.vmid,
              status,
              metadata,
              { httpServices: services, hostname, fqdn },
              node
            )
          );
        }
      }

      return instances;
    },
  };

  /**
   * List orphaned templates with VMID < 9000.
   * These are intermediate templates created during custom environment saving
   * that were not properly cleaned up.
   */
  async listOrphanedTemplates(): Promise<Array<{ vmid: number; hostname: string }>> {
    const node = await this.getNode();
    const containers = await this.apiRequest<PveContainerStatus[]>(
      "GET",
      `/api2/json/nodes/${node}/lxc`
    );

    const orphans: Array<{ vmid: number; hostname: string }> = [];
    for (const container of containers) {
      const hostname = container.name || "";
      // Orphaned templates:
      // - Have cmux-* or pvelxc-* prefix (cmux-managed)
      // - Are templates (template === 1)
      // - Have VMID < 9000 (not in protected template range)
      // - Exclude base templates (VMID 100-199)
      if (
        (hostname.startsWith("cmux-") || hostname.startsWith("pvelxc-")) &&
        container.template === 1 &&
        container.vmid >= 200 &&
        container.vmid < 9000
      ) {
        orphans.push({ vmid: container.vmid, hostname });
      }
    }

    return orphans;
  }

  /**
   * Delete a template by VMID.
   */
  async deleteTemplate(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "DELETE",
      `/api2/json/nodes/${node}/lxc/${vmid}`
    );
    await this.waitForTaskNormalized(upid, `delete template ${vmid}`);

    // Clean up in-memory service URLs
    this.instanceServices.delete(vmid);
    this.instanceHostnames.delete(vmid);
  }
}
