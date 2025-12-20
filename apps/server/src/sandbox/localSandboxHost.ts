import Docker from "dockerode";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDockerSocketCandidates } from "@cmux/shared/providers/common/check-docker";
import { dockerLogger } from "../utils/fileLogger";
import { LocalSandboxClient } from "./localSandboxClient";

const DEFAULT_SANDBOX_PORT = 46831;
const DEFAULT_IMAGE_NAME = "cmux-worker:0.0.1";
const DEFAULT_CONTAINER_NAME = "cmux-sandbox-host";
const DEFAULT_DATA_DIR = "/var/lib/cmux/sandboxes";
const DEFAULT_LOG_DIR = "/var/log/cmux";

type HostConfigWithCgroupns =
  Docker.ContainerCreateOptions["HostConfig"] & {
    CgroupnsMode?: "host" | "private";
  };

export class LocalSandboxHost {
  private static instance: LocalSandboxHost | null = null;
  private static dockerInstance: Docker | null = null;
  private static ensurePromise: Promise<void> | null = null;

  private container: Docker.Container | null = null;
  private baseUrl: string | null = null;
  private workspaceRoot: string | null = null;

  static async getInstance(workspaceRoot: string): Promise<LocalSandboxHost> {
    const normalizedRoot = path.resolve(workspaceRoot);
    if (LocalSandboxHost.ensurePromise) {
      await LocalSandboxHost.ensurePromise;
    }
    if (!LocalSandboxHost.instance) {
      LocalSandboxHost.instance = new LocalSandboxHost();
    }
    const ensurePromise = LocalSandboxHost.instance
      .ensureRunning(normalizedRoot)
      .finally(() => {
        if (LocalSandboxHost.ensurePromise === ensurePromise) {
          LocalSandboxHost.ensurePromise = null;
        }
      });
    LocalSandboxHost.ensurePromise = ensurePromise;
    await ensurePromise;
    return LocalSandboxHost.instance;
  }

  static async getRunningBaseUrl(): Promise<string | null> {
    const docker = LocalSandboxHost.getDocker();
    const containerName = LocalSandboxHost.getContainerName();
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });
    if (containers.length === 0) {
      return null;
    }
    const container = docker.getContainer(containers[0].Id);
    const info = await container.inspect();
    if (!info.State.Running) {
      return null;
    }
    return LocalSandboxHost.getBaseUrlFromInspect(info);
  }

  static async stopContainer(): Promise<void> {
    const docker = LocalSandboxHost.getDocker();
    const containerName = LocalSandboxHost.getContainerName();
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });
    if (containers.length === 0) {
      return;
    }
    const container = docker.getContainer(containers[0].Id);
    try {
      await container.stop();
      dockerLogger.info(
        `[LocalSandboxHost] Stopped host container ${containerName}`
      );
    } catch (error) {
      console.error(
        `[LocalSandboxHost] Failed to stop host container ${containerName}`,
        error
      );
      dockerLogger.warn(
        `[LocalSandboxHost] Failed to stop host container ${containerName}`,
        error
      );
    }
  }

  getBaseUrl(): string {
    if (!this.baseUrl) {
      throw new Error("Sandbox host base URL not initialized");
    }
    return this.baseUrl;
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  private async ensureRunning(workspaceRoot: string): Promise<void> {
    const normalizedRoot = path.resolve(workspaceRoot);
    if (!fs.existsSync(normalizedRoot)) {
      await fs.promises.mkdir(normalizedRoot, { recursive: true });
    }

    const containerName = LocalSandboxHost.getContainerName();
    const docker = LocalSandboxHost.getDocker();
    const existing = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });

    if (existing.length > 0) {
      this.container = docker.getContainer(existing[0].Id);
      const info = await this.container.inspect();
      if (info.State.Running) {
        if (!LocalSandboxHost.hasWorkspaceMount(info, normalizedRoot)) {
          dockerLogger.warn(
            `[LocalSandboxHost] Workspace root mismatch; recreating host container for ${normalizedRoot}`
          );
          await this.removeContainer();
        } else {
          this.baseUrl = LocalSandboxHost.getBaseUrlFromInspect(info);
          if (!this.baseUrl) {
            throw new Error(
              "Sandbox host container is running but port mapping is missing"
            );
          }
          this.workspaceRoot = normalizedRoot;
          await this.waitForHealthy();
          return;
        }
      } else {
        if (!LocalSandboxHost.hasWorkspaceMount(info, normalizedRoot)) {
          await this.removeContainer();
        } else {
          await this.container.start();
          const startedInfo = await this.container.inspect();
          this.baseUrl = LocalSandboxHost.getBaseUrlFromInspect(startedInfo);
          if (!this.baseUrl) {
            throw new Error(
              "Sandbox host container started but port mapping is missing"
            );
          }
          this.workspaceRoot = normalizedRoot;
          await this.waitForHealthy();
          return;
        }
      }
    }

    await this.createContainer(normalizedRoot);
    if (!this.container) {
      throw new Error("Sandbox host container failed to initialize");
    }
    const info = await this.container.inspect();
    this.baseUrl = LocalSandboxHost.getBaseUrlFromInspect(info);
    if (!this.baseUrl) {
      throw new Error("Sandbox host container port mapping is missing");
    }
    this.workspaceRoot = normalizedRoot;
    await this.waitForHealthy();
  }

  private async createContainer(workspaceRoot: string): Promise<void> {
    const docker = LocalSandboxHost.getDocker();
    const imageName =
      process.env.WORKER_IMAGE_NAME?.trim() || DEFAULT_IMAGE_NAME;
    await LocalSandboxHost.ensureImageExists(docker, imageName);

    const sandboxPort = LocalSandboxHost.getSandboxPort();
    const sandboxLogDir =
      process.env.CMUX_SANDBOX_LOG_DIR || DEFAULT_LOG_DIR;
    const sandboxDataDir =
      process.env.CMUX_SANDBOX_DATA_DIR || DEFAULT_DATA_DIR;

    const binds = [
      "/sys/fs/cgroup:/sys/fs/cgroup:rw",
      `${workspaceRoot}:${workspaceRoot}:rw`,
      "cmux-sandbox-dind:/var/lib/docker",
      "cmux-sandbox-data:/var/lib/cmux/sandboxes",
    ];

    const dockerMode = (process.env.CMUX_DOCKER_MODE || "dind").toLowerCase();
    const dockerSocketRaw =
      process.env.CMUX_DOCKER_SOCKET || "/var/run/docker.sock";
    const dockerSocketPath = dockerSocketRaw.startsWith("unix://")
      ? dockerSocketRaw.slice("unix://".length)
      : dockerSocketRaw;

    if (dockerMode === "dood" && fs.existsSync(dockerSocketPath)) {
      binds.push(`${dockerSocketPath}:${dockerSocketPath}`);
    }

    const envVars: string[] = [
      `CMUX_DOCKER_MODE=${dockerMode}`,
      `CMUX_DOCKER_SOCKET=${dockerSocketRaw}`,
      `CMUX_SANDBOX_PORT=${sandboxPort}`,
      `CMUX_SANDBOX_LOG_DIR=${sandboxLogDir}`,
    ];

    const sshAgentSock = process.env.SSH_AUTH_SOCK;
    if (sshAgentSock && fs.existsSync(sshAgentSock)) {
      binds.push(`${sshAgentSock}:/ssh-agent.sock`);
      envVars.push("SSH_AUTH_SOCK=/ssh-agent.sock");
    }

    const hostConfig: HostConfigWithCgroupns = {
      AutoRemove: true,
      Privileged: true,
      CgroupnsMode: "host",
      Binds: binds,
      PortBindings: {
        [`${sandboxPort}/tcp`]: [
          { HostPort: "0", HostIp: "127.0.0.1" },
        ],
      },
      Tmpfs: {
        "/run": "rw,mode=755",
        "/run/lock": "rw,mode=755",
      },
    };

    const createOptions: Docker.ContainerCreateOptions = {
      name: LocalSandboxHost.getContainerName(),
      Image: imageName,
      Env: envVars,
      HostConfig: hostConfig,
      ExposedPorts: {
        [`${sandboxPort}/tcp`]: {},
      },
      Entrypoint: ["/usr/local/bin/bootstrap-dind.sh"],
      Cmd: [
        "/usr/local/bin/cmux-sandboxd",
        "--bind",
        "0.0.0.0",
        "--port",
        `${sandboxPort}`,
        "--data-dir",
        sandboxDataDir,
        "--log-dir",
        sandboxLogDir,
      ],
    };

    dockerLogger.info(
      `[LocalSandboxHost] Creating host container ${createOptions.name}`
    );
    this.container = await docker.createContainer(createOptions);
    await this.container.start();
  }

  private async removeContainer(): Promise<void> {
    if (!this.container) {
      return;
    }
    try {
      await this.container.stop();
    } catch (error) {
      console.error("[LocalSandboxHost] Failed to stop host container", error);
      dockerLogger.warn(
        "[LocalSandboxHost] Failed to stop host container",
        error
      );
    }
    try {
      await this.container.remove();
    } catch (error) {
      console.error("[LocalSandboxHost] Failed to remove host container", error);
      dockerLogger.warn(
        "[LocalSandboxHost] Failed to remove host container",
        error
      );
    }
    this.container = null;
  }

  private async waitForHealthy(): Promise<void> {
    if (!this.baseUrl) {
      throw new Error("Sandbox host base URL not available");
    }
    const client = new LocalSandboxClient(this.baseUrl);
    await client.waitForHealthy();
  }

  private static getContainerName(): string {
    return (
      process.env.CMUX_LOCAL_SANDBOX_CONTAINER?.trim() ||
      DEFAULT_CONTAINER_NAME
    );
  }

  private static getDocker(): Docker {
    if (!LocalSandboxHost.dockerInstance) {
      const socketPath = LocalSandboxHost.getDockerSocketPath();
      LocalSandboxHost.dockerInstance = socketPath
        ? new Docker({ socketPath })
        : new Docker();
    }
    return LocalSandboxHost.dockerInstance;
  }

  private static getDockerSocketPath(): string | null {
    const { remoteHost, candidates } = getDockerSocketCandidates();
    if (remoteHost) {
      return null;
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0] ?? null;
  }

  private static hasWorkspaceMount(
    info: Docker.ContainerInspectInfo,
    workspaceRoot: string
  ): boolean {
    const mount = info.Mounts.find(
      (entry) =>
        entry.Destination === workspaceRoot && entry.Source === workspaceRoot
    );
    return Boolean(mount);
  }

  private static getBaseUrlFromInspect(
    info: Docker.ContainerInspectInfo
  ): string | null {
    const ports = info.NetworkSettings.Ports;
    const sandboxPort = LocalSandboxHost.getSandboxPort();
    const bindings = ports?.[`${sandboxPort}/tcp`];
    const hostPort = bindings?.[0]?.HostPort;
    if (!hostPort) {
      return null;
    }
    const hostIp = bindings?.[0]?.HostIp;
    const resolvedHost =
      hostIp && hostIp !== "0.0.0.0" ? hostIp : "127.0.0.1";
    return `http://${resolvedHost}:${hostPort}`;
  }

  private static getSandboxPort(): number {
    const raw = process.env.CMUX_SANDBOX_PORT;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_SANDBOX_PORT;
    }
    return parsed;
  }

  private static async ensureImageExists(
    docker: Docker,
    imageName: string
  ): Promise<void> {
    try {
      await docker.getImage(imageName).inspect();
      dockerLogger.info(`[LocalSandboxHost] Image ${imageName} found locally`);
    } catch (error) {
      console.error(
        `[LocalSandboxHost] Failed to inspect image ${imageName}`,
        error
      );
      dockerLogger.info(
        `[LocalSandboxHost] Image ${imageName} not found locally, pulling...`
      );
      const stream = await docker.pull(imageName);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(
          stream,
          (err: Error | null, res: unknown[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(res);
            }
          },
          (event: { status: string; progress: string }) => {
            if (event.status) {
              dockerLogger.info(
                `[LocalSandboxHost] Pull progress: ${event.status} ${event.progress || ""}`
              );
            }
          }
        );
      });
      dockerLogger.info(`[LocalSandboxHost] Pulled image ${imageName}`);
    }
  }
}
