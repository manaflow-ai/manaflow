import { api } from "@cmux/convex/api";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSandboxTcpProxy } from "../sandbox/localTcpProxy";
import type { TcpProxyHandle } from "../sandbox/localTcpProxy";
import {
  LocalSandboxClient,
  type SandboxEnvVar,
} from "../sandbox/localSandboxClient";
import { LocalSandboxHost } from "../sandbox/localSandboxHost";
import { getConvex } from "../utils/convexClient";
import { cleanupGitCredentials } from "../utils/dockerGitSetup";
import { dockerLogger } from "../utils/fileLogger";
import { getGitHubOAuthToken } from "../utils/getGitHubToken";
import { getAuthToken, runWithAuthToken } from "../utils/requestContext";
import {
  VSCodeInstance,
  type VSCodeInstanceConfig,
  type VSCodeInstanceInfo,
} from "./VSCodeInstance";

type SandboxPorts = {
  vscode?: string;
  worker?: string;
  extension?: string;
  proxy?: string;
  vnc?: string;
};

const SANDBOX_PORTS = {
  vscode: 39378,
  worker: 39377,
  proxy: 39379,
  vnc: 39380,
  cdp: 39381,
};

export class BubblewrapVSCodeInstance extends VSCodeInstance {
  private sandboxId: string | null = null;
  private sandboxName: string;
  private sandboxClient: LocalSandboxClient | null = null;
  private sandboxBaseUrl: string | null = null;
  private proxyHandles: TcpProxyHandle[] = [];
  private ports: SandboxPorts | null = null;
  private authToken: string | undefined;

  constructor(config: VSCodeInstanceConfig) {
    super(config);
    this.sandboxName = `cmux-${this.taskRunId}`;
  }

  async start(): Promise<VSCodeInstanceInfo> {
    dockerLogger.info(
      `[BubblewrapVSCodeInstance] Starting sandbox for ${this.sandboxName}`
    );

    const workspacePath = this.config.workspacePath;
    if (!workspacePath) {
      throw new Error("workspacePath is required for bubblewrap sandboxes");
    }

    const workspaceRoot =
      this.config.workspaceRoot ?? path.dirname(workspacePath);
    const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
    const normalizedWorkspacePath = path.resolve(workspacePath);

    this.authToken = getAuthToken();

    const host = await LocalSandboxHost.getInstance(normalizedWorkspaceRoot);
    this.sandboxBaseUrl = host.getBaseUrl();
    this.sandboxClient = new LocalSandboxClient(this.sandboxBaseUrl);

    const envVars = this.buildSandboxEnv(
      normalizedWorkspaceRoot,
      normalizedWorkspacePath
    );
    const summary = await this.sandboxClient.createSandbox({
      name: this.sandboxName,
      workspace: normalizedWorkspaceRoot,
      env: envVars,
      readOnlyPaths: ["/app", "/builtins"],
    });

    this.sandboxId = summary.id;

    const startResult = await this.sandboxClient.execSandbox(summary.id, {
      command: ["/usr/local/lib/cmux/cmux-start-sandbox-services"],
    });

    if (startResult.exitCode !== 0) {
      dockerLogger.warn(
        `[BubblewrapVSCodeInstance] Sandbox services exited with code ${startResult.exitCode}`,
        startResult.stderr
      );
    }

    void this.bootstrapSandboxEnvironment().catch((error) => {
      console.error(
        "[BubblewrapVSCodeInstance] Sandbox bootstrap failed",
        error
      );
      dockerLogger.warn(
        `[BubblewrapVSCodeInstance] Sandbox bootstrap failed`,
        error
      );
    });

    const vscodeProxy = await this.createProxy("vscode", SANDBOX_PORTS.vscode);
    const workerProxy = await this.createProxy("worker", SANDBOX_PORTS.worker);
    const proxyProxy = await this.createProxy("proxy", SANDBOX_PORTS.proxy);
    const vncProxy = await this.createProxy("vnc", SANDBOX_PORTS.vnc);
    await this.createProxy("cdp", SANDBOX_PORTS.cdp);

    this.ports = {
      vscode: String(vscodeProxy.port),
      worker: String(workerProxy.port),
      proxy: String(proxyProxy.port),
      vnc: String(vncProxy.port),
    };

    try {
      await getConvex().mutation(api.taskRuns.updateVSCodePorts, {
        teamSlugOrId: this.teamSlugOrId,
        id: this.taskRunId,
        ports: {
          vscode: this.ports.vscode || "",
          worker: this.ports.worker || "",
          proxy: this.ports.proxy,
          vnc: this.ports.vnc,
        },
      });
    } catch (error) {
      console.error(
        "[BubblewrapVSCodeInstance] Failed to update VSCode ports in Convex:",
        error
      );
      dockerLogger.error(
        "[BubblewrapVSCodeInstance] Failed to update VSCode ports in Convex:",
        error
      );
    }

    await this.waitForWorkerReady(workerProxy.port);

    const baseUrl = `http://localhost:${vscodeProxy.port}`;
    const workspaceUrl = this.getWorkspaceUrl(baseUrl);
    const workerUrl = `http://localhost:${workerProxy.port}`;

    try {
      await this.connectToWorker(workerUrl);
      await this.configureGitInWorker();
    } catch (error) {
      console.error(
        "[BubblewrapVSCodeInstance] Failed to connect to worker",
        error
      );
      dockerLogger.error(
        `[BubblewrapVSCodeInstance] Failed to connect to worker`,
        error
      );
    }

    return {
      url: baseUrl,
      workspaceUrl,
      instanceId: this.instanceId,
      taskRunId: this.taskRunId,
      provider: "sandbox",
    };
  }

  async stop(): Promise<void> {
    dockerLogger.info(
      `[BubblewrapVSCodeInstance] Stopping sandbox ${this.sandboxName}`
    );

    for (const handle of this.proxyHandles) {
      try {
        await handle.close();
      } catch (error) {
        console.error(
          "[BubblewrapVSCodeInstance] Failed to close sandbox proxy",
          error
        );
        dockerLogger.warn(
          "[BubblewrapVSCodeInstance] Failed to close sandbox proxy",
          error
        );
      }
    }
    this.proxyHandles = [];

    if (this.sandboxId && this.sandboxClient) {
      try {
        await this.sandboxClient.deleteSandbox(this.sandboxId);
      } catch (error) {
        console.error(
          `[BubblewrapVSCodeInstance] Failed to delete sandbox ${this.sandboxId}`,
          error
        );
        dockerLogger.warn(
          `[BubblewrapVSCodeInstance] Failed to delete sandbox ${this.sandboxId}`,
          error
        );
      }
    }

    try {
      await runWithAuthToken(this.authToken, async () =>
        getConvex().mutation(api.taskRuns.updateVSCodeStatus, {
          teamSlugOrId: this.teamSlugOrId,
          id: this.taskRunId,
          status: "stopped",
          stoppedAt: Date.now(),
        })
      );
    } catch (error) {
      console.error(
        "[BubblewrapVSCodeInstance] Failed to update VSCode status in Convex:",
        error
      );
      dockerLogger.error(
        "[BubblewrapVSCodeInstance] Failed to update VSCode status in Convex:",
        error
      );
    }

    await cleanupGitCredentials(this.instanceId);
    await this.baseStop();
  }

  async getStatus(): Promise<{ running: boolean; info?: VSCodeInstanceInfo }> {
    if (!this.sandboxId || !this.sandboxClient) {
      return { running: false };
    }

    try {
      const summary = await this.sandboxClient.getSandbox(this.sandboxId);
      if (!summary) {
        return { running: false };
      }

      const running = summary.status === "Running";
      if (running && this.ports?.vscode) {
        const baseUrl = `http://localhost:${this.ports.vscode}`;
        return {
          running: true,
          info: {
            url: baseUrl,
            workspaceUrl: this.getWorkspaceUrl(baseUrl),
            instanceId: this.instanceId,
            taskRunId: this.taskRunId,
            provider: "sandbox",
          },
        };
      }

      return { running };
    } catch (error) {
      console.error(
        "[BubblewrapVSCodeInstance] Failed to fetch sandbox status",
        error
      );
      return { running: false };
    }
  }

  getName(): string {
    return this.sandboxId
      ? `sandbox-${this.sandboxId}`
      : `sandbox-${this.taskRunId}`;
  }

  getPorts(): SandboxPorts | null {
    return this.ports;
  }

  private async waitForWorkerReady(workerPort: number): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 500;

    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        const response = await fetch(
          `http://localhost:${workerPort}/socket.io/?EIO=4&transport=polling`
        );
        if (response.ok) {
          return;
        }
      } catch (error) {
        console.error(
          "[BubblewrapVSCodeInstance] Worker readiness check failed",
          error
        );
      }

      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    dockerLogger.warn(
      "[BubblewrapVSCodeInstance] Worker may not be fully ready, continuing..."
    );
  }

  private async createProxy(
    label: string,
    targetPort: number
  ): Promise<TcpProxyHandle> {
    if (!this.sandboxBaseUrl || !this.sandboxId) {
      throw new Error("Sandbox base URL not initialized");
    }
    const handle = await createSandboxTcpProxy({
      baseUrl: this.sandboxBaseUrl,
      sandboxId: this.sandboxId,
      targetPort,
      label,
    });
    this.proxyHandles.push(handle);
    return handle;
  }

  private buildSandboxEnv(
    workspaceRoot: string,
    workspacePath: string
  ): SandboxEnvVar[] {
    const envVars: SandboxEnvVar[] = [
      { key: "NODE_ENV", value: "production" },
      { key: "NODE_PATH", value: "/builtins/build/node_modules" },
      { key: "WORKER_PORT", value: String(SANDBOX_PORTS.worker) },
      { key: "WORKER_ID", value: `worker-${this.taskRunId}` },
      { key: "HOME", value: "/root" },
      { key: "CMUX_WORKSPACE_MOUNT", value: "/workspace" },
      { key: "CMUX_WORKSPACE_HOST_PATH", value: workspaceRoot },
      { key: "CMUX_WORKSPACE_PATH", value: workspacePath },
    ];

    if (this.config.theme) {
      envVars.push({ key: "VSCODE_THEME", value: this.config.theme });
    }

    const forwarded = [
      "CMUX_TASK_RUN_JWT_SECRET",
      "NEXT_PUBLIC_CONVEX_URL",
      "CONVEX_URL",
      "CONVEX_SITE_URL",
      "CONVEX_CLOUD_URL",
      "NEXT_PUBLIC_WWW_ORIGIN",
      "AMP_URL",
      "AMP_UPSTREAM_URL",
      "AMP_PROXY_PORT",
    ];

    for (const key of forwarded) {
      const value = process.env[key];
      if (value) {
        envVars.push({ key, value });
      }
    }

    return envVars;
  }

  private async bootstrapSandboxEnvironment(): Promise<void> {
    await this.bootstrapGitHubAuth();
    await this.bootstrapDevcontainerIfPresent();
  }

  private async bootstrapGitHubAuth(): Promise<void> {
    if (!this.sandboxId || !this.sandboxClient) {
      return;
    }

    const githubToken = await getGitHubOAuthToken();
    if (!githubToken) {
      return;
    }

    const execResult = await this.sandboxClient.execSandbox(this.sandboxId, {
      command: [
        "/bin/sh",
        "-lc",
        'printf "%s" "$CMUX_GH_TOKEN" | gh auth login --with-token',
      ],
      env: [{ key: "CMUX_GH_TOKEN", value: githubToken }],
    });

    if (execResult.exitCode !== 0) {
      dockerLogger.warn(
        `[BubblewrapVSCodeInstance] GitHub auth failed: ${execResult.stderr}`
      );
    }
  }

  private async bootstrapDevcontainerIfPresent(): Promise<void> {
    if (!this.sandboxId || !this.sandboxClient) {
      return;
    }

    const workspaceHostPath = this.config.workspacePath;
    if (!workspaceHostPath) {
      return;
    }

    const devcontainerFile = path.join(
      workspaceHostPath,
      ".devcontainer",
      "devcontainer.json"
    );

    if (!fs.existsSync(devcontainerFile)) {
      return;
    }

    const bootstrapCmd = [
      "/bin/bash",
      "-lc",
      [
        "set -euo pipefail",
        "mkdir -p /root/workspace/.cmux",
        "if [ -f /root/workspace/.devcontainer/devcontainer.json ]; then",
        "  (cd /root/workspace && nohup bunx @devcontainers/cli up --workspace-folder . >> /root/workspace/.cmux/devcontainer.log 2>&1 &)",
        "  echo 'devcontainer up triggered in background' >> /root/workspace/.cmux/devcontainer.log",
        "else",
        "  echo 'devcontainer.json not found in sandbox' >> /root/workspace/.cmux/devcontainer.log",
        "fi",
      ].join(" && "),
    ];

    const execResult = await this.sandboxClient.execSandbox(this.sandboxId, {
      command: bootstrapCmd,
    });

    if (execResult.exitCode !== 0) {
      dockerLogger.warn(
        `[BubblewrapVSCodeInstance] Devcontainer bootstrap failed: ${execResult.stderr}`
      );
    }
  }

  private async configureGitInWorker(): Promise<void> {
    const workerSocket = this.getWorkerSocket();
    if (!workerSocket) {
      dockerLogger.warn("No worker socket available for git configuration");
      return;
    }

    try {
      const githubToken = await getGitHubOAuthToken();

      const homeDir = os.homedir();
      const sshDir = path.join(homeDir, ".ssh");
      let sshKeys:
        | { privateKey?: string; publicKey?: string; knownHosts?: string }
        | undefined = undefined;

      const readKey = async (
        filePath: string,
        label: string
      ): Promise<string | undefined> => {
        if (!fs.existsSync(filePath)) {
          return undefined;
        }
        try {
          const contents = await fs.promises.readFile(filePath);
          return contents.toString("base64");
        } catch (error) {
          console.error(
            `[BubblewrapVSCodeInstance] Failed to read ${label}`,
            error
          );
          return undefined;
        }
      };

      if (fs.existsSync(sshDir)) {
        const privateKeyPath = path.join(sshDir, "id_rsa");
        const publicKeyPath = path.join(sshDir, "id_rsa.pub");
        const knownHostsPath = path.join(sshDir, "known_hosts");

        const [privateKey, publicKey, knownHosts] = await Promise.all([
          readKey(privateKeyPath, "SSH private key"),
          readKey(publicKeyPath, "SSH public key"),
          readKey(knownHostsPath, "SSH known_hosts"),
        ]);

        if (privateKey || publicKey || knownHosts) {
          sshKeys = {
            privateKey: privateKey || undefined,
            publicKey: publicKey || undefined,
            knownHosts: knownHosts || undefined,
          };
        }
      }

      const gitConfig: Record<string, string> = {};
      const userName = this.getGitConfigValue("user.name");
      const userEmail = this.getGitConfigValue("user.email");

      if (userName) gitConfig["user.name"] = userName;
      if (userEmail) gitConfig["user.email"] = userEmail;

      workerSocket.emit("worker:configure-git", {
        githubToken: githubToken || undefined,
        gitConfig: Object.keys(gitConfig).length > 0 ? gitConfig : undefined,
        sshKeys,
      });

      dockerLogger.info("Git configuration sent to worker");
    } catch (error) {
      console.error(
        "Failed to configure git in worker:",
        error
      );
      dockerLogger.error("Failed to configure git in worker:", error);
    }
  }

  private getGitConfigValue(key: string): string | undefined {
    try {
      const value = execSync(`git config --global ${key}`)
        .toString()
        .trim();
      return value || undefined;
    } catch (error) {
      console.error(
        `[BubblewrapVSCodeInstance] Failed to read git config ${key}`,
        error
      );
      return undefined;
    }
  }
}
