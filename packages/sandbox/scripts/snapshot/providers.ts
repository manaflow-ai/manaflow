/**
 * Provider adapters for snapshot creation.
 *
 * Each provider implements a common interface for VM management and snapshotting.
 * Providers expose the VM SDK methods: exec(), snapshot(), fs.writeTextFile()
 */

import { freestyle, type Vm as FreestyleVmType } from "freestyle-sandboxes";
import { MorphCloudClient, type Instance as MorphInstance } from "morphcloud";
import { Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk";
import { Sandbox as E2BSandbox } from "e2b";
import { SandboxInstance } from "@blaxel/core";
import { printHeader } from "./utils";

/**
 * VM handle interface - provides access to VM operations.
 */
export interface VmHandle {
  /** The VM ID */
  vmId: string;
  /** Execute a command on the VM */
  exec(command: string): Promise<string>;
  /** Create a snapshot of the VM */
  snapshot(name?: string): Promise<{ snapshotId: string }>;
  /** File system operations */
  fs: {
    /** Write a text file to the VM */
    writeTextFile(path: string, content: string): Promise<void>;
    /** Read a text file from the VM */
    readTextFile(path: string): Promise<string>;
  };
  /** Sync files from local to remote (directory sync) */
  syncFiles?(localPath: string, remotePath: string): Promise<void>;
  /** Upload a single file via SSH */
  uploadFile?(localPath: string, remotePath: string): Promise<void>;
  /** Expose an HTTP service on a port, returns the public URL */
  exposeHttp?(name: string, port: number): Promise<{ url: string }>;
}

/**
 * Common interface for snapshot providers.
 */
export interface SnapshotProvider {
  name: string;
  /** Create a new VM and return a handle to it */
  createVm(baseSnapshotId?: string): Promise<{ vmId: string; vm: VmHandle }>;
  /** Delete a VM by ID */
  deleteVm(vmId: string): Promise<void>;
}

// =============================================================================
// Freestyle Provider
// =============================================================================

/**
 * Wrapper around freestyle Vm that provides a consistent interface.
 */
class FreestyleVmHandle implements VmHandle {
  readonly vmId: string;
  private vm: FreestyleVmType;

  constructor(vmId: string, vm: FreestyleVmType) {
    this.vmId = vmId;
    this.vm = vm;
  }

  async exec(command: string): Promise<string> {
    const result = await this.vm.exec(command);
    // exec returns { stdout, stderr, statusCode }
    const output = result.stdout ?? "";
    if (typeof result.statusCode === "number" && result.statusCode !== 0) {
      const stderr = result.stderr ?? "";
      const combined = [output, stderr].filter((value) => value.trim().length > 0).join("\n");
      throw new Error(
        `Command failed with exit code ${result.statusCode}: ${combined || "no output"}`
      );
    }
    if (result.stderr) {
      return output + (output ? "\n" : "") + result.stderr;
    }
    return output;
  }

  async snapshot(name?: string): Promise<{ snapshotId: string }> {
    // Use the freestyle.fetch helper to call the snapshot endpoint
    const response = await freestyle.fetch(`/v1/vms/${this.vmId}/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create snapshot: ${response.status} - ${text}`);
    }

    const data = (await response.json()) as { snapshotId: string };
    return { snapshotId: data.snapshotId };
  }

  get fs() {
    return {
      writeTextFile: async (path: string, content: string): Promise<void> => {
        await this.vm.fs.writeTextFile(path, content);
      },
      readTextFile: async (path: string): Promise<string> => {
        return this.vm.fs.readTextFile(path);
      },
    };
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // Read the file and upload via base64 encoding
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(localPath);
    const base64Content = content.toString("base64");

    // Write the file using exec with base64 decoding
    // Split into chunks if needed to avoid command line length limits
    const chunkSize = 100000; // ~100KB chunks

    if (base64Content.length <= chunkSize) {
      await this.vm.exec(`echo '${base64Content}' | base64 -d > ${remotePath}`);
    } else {
      // For large files, write in chunks
      await this.vm.exec(`rm -f ${remotePath}`);
      for (let i = 0; i < base64Content.length; i += chunkSize) {
        const chunk = base64Content.slice(i, i + chunkSize);
        await this.vm.exec(`echo '${chunk}' | base64 -d >> ${remotePath}`);
      }
    }
  }
}

export class FreestyleProvider implements SnapshotProvider {
  name = "freestyle";

  async createVm(baseSnapshotId?: string): Promise<{ vmId: string; vm: VmHandle }> {
    const options: Parameters<typeof freestyle.vms.create>[0] = {
      idleTimeoutSeconds: 7200, // 2 hours for provisioning
      persistence: { type: "ephemeral" as const },
      ...(baseSnapshotId ? { snapshotId: baseSnapshotId } : {}),
    };

    const { vm, vmId } = await freestyle.vms.create(options);
    return { vmId, vm: new FreestyleVmHandle(vmId, vm) };
  }

  async deleteVm(vmId: string): Promise<void> {
    try {
      await freestyle.vms.delete({ vmId });
    } catch (error) {
      console.error(`Failed to delete VM ${vmId}:`, error);
    }
  }
}

// =============================================================================
// Morph Provider (using morphcloud SDK)
// =============================================================================

/**
 * Morph VM handle that wraps the morphcloud SDK Instance.
 */
class MorphVmHandle implements VmHandle {
  readonly vmId: string;
  private instance: MorphInstance;

  constructor(instance: MorphInstance) {
    this.vmId = instance.id;
    this.instance = instance;
  }

  async exec(command: string): Promise<string> {
    // Use streaming exec with 15 minute timeout for provisioning commands
    // Streaming mode keeps the connection alive for long-running commands
    // Note: morphcloud SDK expects timeout in seconds, not milliseconds
    let stdout = "";
    let stderr = "";
    const result = await this.instance.exec(command, {
      timeout: 900,
      onStdout: (chunk: string) => {
        stdout += chunk;
      },
      onStderr: (chunk: string) => {
        stderr += chunk;
      },
    });
    // Streaming mode may not populate result.stdout/stderr
    const output = stdout || result.stdout || "";
    const exitCode = result.exit_code;
    if (typeof exitCode === "number" && exitCode !== 0) {
      const stderrOutput = stderr || result.stderr || "";
      const combined = [output, stderrOutput].filter((value) => value.trim().length > 0).join("\n");
      throw new Error(
        `Command failed with exit code ${exitCode}: ${combined || "no output"}`
      );
    }
    if (stderr || result.stderr) {
      return output + (output ? "\n" : "") + (stderr || result.stderr);
    }
    return output;
  }

  async snapshot(name?: string): Promise<{ snapshotId: string }> {
    const snapshot = await this.instance.snapshot({
      digest: name,
    });
    return { snapshotId: snapshot.id };
  }

  get fs() {
    return {
      writeTextFile: async (path: string, content: string): Promise<void> => {
        // Use base64 encoding to handle special characters
        const base64Content = Buffer.from(content).toString("base64");
        await this.exec(`echo '${base64Content}' | base64 -d > ${path}`);
      },
      readTextFile: async (path: string): Promise<string> => {
        return this.exec(`cat ${path}`);
      },
    };
  }

  async syncFiles(localPath: string, remotePath: string): Promise<void> {
    // Use morphcloud SDK's sync method for efficient file transfer
    // Remote path format: instance_id:/path
    // respectGitignore excludes target/, node_modules/, .git/, etc.
    const remotePathWithInstance = `${this.vmId}:${remotePath}`;
    await this.instance.sync(localPath, remotePathWithInstance, {
      respectGitignore: true,
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // Use SSH to upload a single file
    const ssh = await this.instance.ssh();
    try {
      await ssh.putFile(localPath, remotePath);
    } finally {
      ssh.dispose();
    }
  }

  async exposeHttp(name: string, port: number): Promise<{ url: string }> {
    const service = await this.instance.exposeHttpService(name, port);
    return { url: service.url };
  }
}

export class MorphProvider implements SnapshotProvider {
  name = "morph";
  private client: MorphCloudClient;

  constructor() {
    const apiKey = process.env.MORPH_API_KEY;
    if (!apiKey) {
      throw new Error("MORPH_API_KEY environment variable not set");
    }
    this.client = new MorphCloudClient({ apiKey });
  }

  async createVm(baseSnapshotId?: string): Promise<{ vmId: string; vm: VmHandle }> {
    let snapshotId = baseSnapshotId;

    // If no base snapshot provided, create one from the minimal image
    if (!snapshotId) {
      console.log("Creating base snapshot from morphvm-minimal image...");
      const baseSnapshot = await this.client.snapshots.create({
        imageId: "morphvm-minimal",
        vcpus: 4,
        memory: 16384, // 16GB
        diskSize: 49152, // 48GB
      });
      snapshotId = baseSnapshot.id;
      console.log(`Created base snapshot: ${snapshotId}`);
    }

    const instance = await this.client.instances.start({
      snapshotId,
      ttlSeconds: 7200, // 2 hours
      ttlAction: "stop",
    });

    // Wait for instance to be ready
    await instance.waitUntilReady();

    return {
      vmId: instance.id,
      vm: new MorphVmHandle(instance),
    };
  }

  async deleteVm(vmId: string): Promise<void> {
    try {
      await this.client.instances.stop({ instanceId: vmId });
    } catch (error) {
      console.error(`Failed to stop VM ${vmId}:`, error);
    }
  }
}

// =============================================================================
// Daytona Provider
// =============================================================================

/**
 * Daytona sandbox handle that wraps the Daytona SDK Sandbox.
 *
 * Note: Daytona snapshots work differently from Morph/Freestyle - they're based on
 * Docker images rather than RAM state. We create a snapshot by building a new
 * Docker image from the provisioned sandbox state.
 */
class DaytonaVmHandle implements VmHandle {
  readonly vmId: string;
  private sandbox: DaytonaSandbox;
  private client: Daytona;

  constructor(sandbox: DaytonaSandbox, client: Daytona) {
    this.vmId = sandbox.id;
    this.sandbox = sandbox;
    this.client = client;
  }

  async exec(command: string): Promise<string> {
    // Use 15 minute timeout for provisioning commands
    const response = await this.sandbox.process.executeCommand(command, undefined, undefined, 900);

    if (response.exitCode !== 0) {
      throw new Error(
        `Command failed with exit code ${response.exitCode}: ${response.result || "no output"}`
      );
    }

    return response.result || "";
  }

  async snapshot(name?: string): Promise<{ snapshotId: string }> {
    // Daytona doesn't support creating snapshots from running sandboxes the same way
    // Morph does (RAM state capture). Instead, we need to:
    // 1. Stop the sandbox
    // 2. Archive it to create a restorable state
    //
    // However, for our use case, we'll use Daytona's snapshot.create API
    // to build a new snapshot from an Image definition that includes our provisioning.
    //
    // For now, we'll just return the sandbox ID as the "snapshot" since Daytona
    // sandboxes can be archived and restored.
    //
    // TODO: Implement proper snapshot creation using Daytona's Image builder
    // to create a reusable snapshot from the provisioned state.

    console.log("Creating Daytona snapshot...");

    // For Daytona, we'll archive the sandbox as the "snapshot"
    // First stop the sandbox
    await this.sandbox.stop(120);

    // Archive it for persistence
    await this.sandbox.archive();

    // Return the sandbox name as the snapshot ID
    // Users can create new sandboxes from this archived state
    const snapshotId = name || this.sandbox.name || this.sandbox.id;
    console.log(`Daytona sandbox archived as: ${snapshotId}`);

    return { snapshotId };
  }

  get fs() {
    return {
      writeTextFile: async (path: string, content: string): Promise<void> => {
        // Upload the file content using Daytona's fs API
        await this.sandbox.fs.uploadFile(Buffer.from(content, "utf-8"), path);
      },
      readTextFile: async (path: string): Promise<string> => {
        const buffer = await this.sandbox.fs.downloadFile(path);
        return buffer.toString("utf-8");
      },
    };
  }

  async syncFiles(localPath: string, remotePath: string): Promise<void> {
    // Daytona doesn't have a built-in rsync-like sync.
    // We'll need to use tarball upload similar to the fallback in snapshot.ts
    // For now, throw an error to indicate this isn't supported natively
    throw new Error("Daytona syncFiles not implemented - use tarball upload fallback");
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // Use Daytona's fs API to upload the file
    await this.sandbox.fs.uploadFile(localPath, remotePath);
  }

  async exposeHttp(name: string, port: number): Promise<{ url: string }> {
    // Get preview URL for the port
    const previewLink = await this.sandbox.getPreviewLink(port);
    return { url: previewLink.url };
  }
}

export class DaytonaProvider implements SnapshotProvider {
  name = "daytona";
  private client: Daytona;

  constructor() {
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) {
      throw new Error("DAYTONA_API_KEY environment variable not set");
    }
    this.client = new Daytona({
      apiKey,
      target: process.env.DAYTONA_TARGET || "us",
    });
  }

  async createVm(baseSnapshotId?: string): Promise<{ vmId: string; vm: VmHandle }> {
    console.log("Creating Daytona sandbox...");

    // Create sandbox from snapshot or base image
    // Note: Daytona's default sandbox is Python-based, but for provisioning
    // we need a full Linux environment. When creating from scratch (no snapshot),
    // we use a Debian image with necessary tools pre-installed.
    if (baseSnapshotId) {
      // Create from existing snapshot
      const sandbox = await this.client.create(
        {
          snapshot: baseSnapshotId,
          autoStopInterval: 0, // Disable auto-stop during provisioning
          autoDeleteInterval: -1, // Disable auto-delete
          envVars: {
            DEBIAN_FRONTEND: "noninteractive",
          },
        },
        {
          timeout: 300, // 5 minute timeout for sandbox creation
        }
      );

      console.log(`Created Daytona sandbox from snapshot: ${sandbox.id}`);
      return {
        vmId: sandbox.id,
        vm: new DaytonaVmHandle(sandbox, this.client),
      };
    }

    // Create from base image (Debian with systemd)
    // Note: For full VM-like provisioning with systemd, Docker, etc., we need
    // a compatible base image. Daytona's sandbox model is more container-focused,
    // so some tasks (like systemd services) may need adaptation.
    const sandbox = await this.client.create(
      {
        image: "debian:bookworm",
        autoStopInterval: 0, // Disable auto-stop during provisioning
        autoDeleteInterval: -1, // Disable auto-delete
        envVars: {
          DEBIAN_FRONTEND: "noninteractive",
        },
        resources: {
          cpu: 4,
          memory: 16, // 16 GiB
          disk: 48,   // 48 GiB
        },
      },
      {
        timeout: 300, // 5 minute timeout for sandbox creation
        onSnapshotCreateLogs: (chunk) => console.log(`[build] ${chunk}`),
      }
    );

    console.log(`Created Daytona sandbox from debian:bookworm: ${sandbox.id}`);

    return {
      vmId: sandbox.id,
      vm: new DaytonaVmHandle(sandbox, this.client),
    };
  }

  async deleteVm(vmId: string): Promise<void> {
    try {
      const sandbox = await this.client.get(vmId);
      await this.client.delete(sandbox, 120);
    } catch (error) {
      console.error(`Failed to delete Daytona sandbox ${vmId}:`, error);
    }
  }
}

// =============================================================================
// E2B Provider
// =============================================================================

/**
 * E2B sandbox handle that wraps the E2B SDK Sandbox.
 *
 * Note: E2B sandboxes are lightweight VMs (~150ms startup).
 * They don't support RAM snapshots but can use custom templates.
 */
class E2BVmHandle implements VmHandle {
  readonly vmId: string;
  private sandbox: E2BSandbox;

  constructor(sandbox: E2BSandbox) {
    this.vmId = sandbox.sandboxId;
    this.sandbox = sandbox;
  }

  async exec(command: string): Promise<string> {
    // Use 15 minute timeout for provisioning commands
    const result = await this.sandbox.commands.run(command, {
      timeoutMs: 900_000,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout || "no output"}`
      );
    }

    return result.stdout || "";
  }

  async snapshot(_name?: string): Promise<{ snapshotId: string }> {
    // E2B doesn't support creating snapshots from running sandboxes.
    // Users should create custom templates via the E2B dashboard or CLI.
    // For now, return the sandbox ID as a reference.
    console.log("E2B does not support runtime snapshots - use custom templates instead");
    console.log(`Sandbox ID: ${this.vmId}`);
    return { snapshotId: this.vmId };
  }

  get fs() {
    return {
      writeTextFile: async (path: string, content: string): Promise<void> => {
        await this.sandbox.files.write(path, content);
      },
      readTextFile: async (path: string): Promise<string> => {
        return await this.sandbox.files.read(path);
      },
    };
  }

  async syncFiles(_localPath: string, _remotePath: string): Promise<void> {
    // E2B doesn't have a built-in directory sync
    throw new Error("E2B syncFiles not implemented - use tarball upload fallback");
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // Read local file and upload via E2B files API
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(localPath);
    await this.sandbox.files.write(remotePath, content);
  }

  async exposeHttp(_name: string, port: number): Promise<{ url: string }> {
    // Get the public URL for the port
    const host = this.sandbox.getHost(port);
    return { url: `https://${host}` };
  }
}

export class E2BProvider implements SnapshotProvider {
  name = "e2b";

  constructor() {
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      throw new Error("E2B_API_KEY environment variable not set");
    }
    // E2B SDK uses E2B_API_KEY env var automatically
  }

  async createVm(baseSnapshotId?: string): Promise<{ vmId: string; vm: VmHandle }> {
    console.log("Creating E2B sandbox...");

    // Create sandbox from template or default
    // baseSnapshotId can be a custom template ID
    const sandbox = await E2BSandbox.create(baseSnapshotId || "base", {
      timeoutMs: 3600_000, // 1 hour timeout
    });

    console.log(`Created E2B sandbox: ${sandbox.sandboxId}`);

    return {
      vmId: sandbox.sandboxId,
      vm: new E2BVmHandle(sandbox),
    };
  }

  async deleteVm(vmId: string): Promise<void> {
    try {
      const sandbox = await E2BSandbox.connect(vmId);
      await sandbox.kill();
    } catch (error) {
      console.error(`Failed to delete E2B sandbox ${vmId}:`, error);
    }
  }
}

// =============================================================================
// Blaxel Provider
// =============================================================================

/**
 * Blaxel sandbox handle that wraps the Blaxel SDK SandboxInstance.
 *
 * Note: Blaxel sandboxes are container-based with snapshotEnabled option.
 * They support RAM-based snapshots similar to Morph when snapshotEnabled is true.
 */
class BlaxelVmHandle implements VmHandle {
  readonly vmId: string;
  private sandbox: SandboxInstance;

  constructor(sandbox: SandboxInstance) {
    this.vmId = sandbox.metadata?.name || "";
    this.sandbox = sandbox;
  }

  async exec(command: string): Promise<string> {
    // Use 15 minute timeout for provisioning commands
    const result = await this.sandbox.process.exec({
      command,
      waitForCompletion: true,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed with exit code ${result.exitCode}: ${result.stderr || result.logs || "no output"}`
      );
    }

    return result.stdout || result.logs || "";
  }

  async snapshot(_name?: string): Promise<{ snapshotId: string }> {
    // Blaxel supports snapshots when snapshotEnabled is true at creation time
    // However, the SDK doesn't expose a direct snapshot() method.
    // For now, we'll return the sandbox name as reference.
    console.log("Blaxel snapshots require snapshotEnabled=true at creation time");
    console.log(`Sandbox name: ${this.vmId}`);
    return { snapshotId: this.vmId };
  }

  get fs() {
    return {
      writeTextFile: async (path: string, content: string): Promise<void> => {
        await this.sandbox.fs.write(path, content);
      },
      readTextFile: async (path: string): Promise<string> => {
        return await this.sandbox.fs.read(path);
      },
    };
  }

  async syncFiles(_localPath: string, _remotePath: string): Promise<void> {
    // Blaxel doesn't have a built-in directory sync
    throw new Error("Blaxel syncFiles not implemented - use tarball upload fallback");
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // Read local file and upload via Blaxel fs API
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(localPath);
    await this.sandbox.fs.writeBinary(remotePath, content);
  }

  async exposeHttp(_name: string, port: number): Promise<{ url: string }> {
    // Create a preview for the port
    const preview = await this.sandbox.previews.create({
      metadata: { name: `port-${port}` },
      spec: { port, public: true },
    });
    return { url: preview.spec?.url || "" };
  }
}

export class BlaxelProvider implements SnapshotProvider {
  name = "blaxel";

  constructor() {
    const apiKey = process.env.BLAXEL_API_KEY || process.env.BL_API_KEY;
    if (!apiKey) {
      throw new Error("BLAXEL_API_KEY or BL_API_KEY environment variable not set");
    }
    // Set it for the SDK to pick up
    process.env.BL_API_KEY = apiKey;
  }

  async createVm(_baseSnapshotId?: string): Promise<{ vmId: string; vm: VmHandle }> {
    console.log("Creating Blaxel sandbox...");

    // Generate a unique name
    const name = `cmux-snapshot-${Date.now()}`;

    // Create sandbox with provisioning-friendly settings
    const sandbox = await SandboxInstance.create({
      name,
      image: "blaxel/base-image:latest",
      memory: 8192, // 8GB RAM
      envs: [
        { name: "DEBIAN_FRONTEND", value: "noninteractive" },
      ],
      ttl: "2h", // 2 hour TTL for provisioning
      snapshotEnabled: true, // Enable snapshots
    });

    console.log(`Created Blaxel sandbox: ${sandbox.metadata?.name}`);

    return {
      vmId: sandbox.metadata?.name || "",
      vm: new BlaxelVmHandle(sandbox),
    };
  }

  async deleteVm(vmId: string): Promise<void> {
    try {
      await SandboxInstance.delete(vmId);
    } catch (error) {
      console.error(`Failed to delete Blaxel sandbox ${vmId}:`, error);
    }
  }
}

// =============================================================================
// Provider Factory
// =============================================================================

export function getProvider(name: string): SnapshotProvider {
  switch (name) {
    case "freestyle":
      return new FreestyleProvider();
    case "morph":
      return new MorphProvider();
    case "daytona":
      return new DaytonaProvider();
    case "e2b":
      return new E2BProvider();
    case "blaxel":
      return new BlaxelProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

// =============================================================================
// Snapshot Creation Workflow
// =============================================================================

export async function createProvisionedSnapshot(
  provider: SnapshotProvider,
  preset: string,
  baseSnapshotId?: string,
  runProvisioning?: (vm: VmHandle) => Promise<void>
): Promise<{ snapshotId: string }> {
  printHeader(`Creating ${provider.name} snapshot for preset: ${preset}`);

  // 1. Create VM
  console.log("Creating VM...");
  const { vmId, vm } = await provider.createVm(baseSnapshotId);
  console.log(`Created VM: ${vmId}`);

  try {
    // 2. Wait a bit for VM to be ready
    console.log("Waiting for VM to be ready...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 3. Run provisioning if provided
    if (runProvisioning) {
      await runProvisioning(vm);
    }

    // 4. Create snapshot
    console.log("\nCreating snapshot...");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotName = `cmux-acp-${preset}-${timestamp}`;
    const { snapshotId } = await vm.snapshot(snapshotName);
    console.log(`Snapshot created: ${snapshotId}`);

    return { snapshotId };
  } finally {
    // 5. Clean up
    console.log("Cleaning up VM...");
    await provider.deleteVm(vmId);
  }
}
