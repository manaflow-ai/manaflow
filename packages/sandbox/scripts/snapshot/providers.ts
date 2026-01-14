/**
 * Provider adapters for snapshot creation.
 *
 * Each provider implements a common interface for VM management and snapshotting.
 * Providers expose the VM SDK methods: exec(), snapshot(), fs.writeTextFile()
 */

import { freestyle, type Vm as FreestyleVmType } from "freestyle-sandboxes";
import { MorphCloudClient, type Instance as MorphInstance } from "morphcloud";
import { NodeSSH } from "node-ssh";
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
// Provider Factory
// =============================================================================

export function getProvider(name: string): SnapshotProvider {
  switch (name) {
    case "freestyle":
      return new FreestyleProvider();
    case "morph":
      return new MorphProvider();
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
