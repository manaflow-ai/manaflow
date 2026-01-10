/**
 * Docker Connector for cmux-local
 *
 * Uses Docker as the runtime and state store.
 * All task metadata is stored in Docker labels.
 */

import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { type Task, type DockerContainer, BASE_PORT, getTaskPort } from "./types.js";

/**
 * Execute a command and return stdout
 */
async function exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    child.on("error", (err) => {
      resolve({ stdout, stderr: err.message, code: 1 });
    });
  });
}

/**
 * Find a free port starting from the given base
 */
async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const result = await exec(`lsof -i :${port} 2>/dev/null | grep LISTEN`);
    if (!result.stdout.trim()) {
      return port;
    }
  }
  throw new Error(`No free port found in range ${start}-${start + 100}`);
}

/**
 * Escape a string for use in shell commands
 */
function escapeShell(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

export class DockerConnector {
  private imageName = "cmux-local-worker";

  /**
   * Check if Docker is available
   */
  async checkDocker(): Promise<boolean> {
    const result = await exec("docker info 2>/dev/null");
    return result.code === 0;
  }

  /**
   * Build or ensure the worker image exists
   */
  async ensureImage(): Promise<void> {
    // Check if image exists
    const result = await exec(`docker images -q ${this.imageName}`);
    if (result.stdout.trim()) {
      return; // Image exists
    }

    // Build a simple image with Claude Code
    // For now, use a base image - user needs Claude Code installed
    console.log("Building cmux-local-worker image...");

    const dockerfile = `
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \\
    curl \\
    git \\
    tmux \\
    ttyd \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
    && apt-get install -y nodejs

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /workspace

# Default command: start ttyd with tmux
CMD ["ttyd", "-p", "7681", "tmux", "new-session", "-A", "-s", "main"]
`;

    const buildResult = await exec(`echo '${dockerfile}' | docker build -t ${this.imageName} -`);
    if (buildResult.code !== 0) {
      throw new Error(`Failed to build image: ${buildResult.stderr}`);
    }
  }

  /**
   * List all cmux tasks (Docker containers with cmux.task label)
   */
  async listTasks(): Promise<Task[]> {
    const result = await exec(
      `docker ps -a --filter "label=cmux.task=true" --format '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Label "cmux.repo"}}\\t{{.Label "cmux.prompt"}}\\t{{.Label "cmux.port"}}\\t{{.Label "cmux.number"}}\\t{{.Label "cmux.startedAt"}}'`
    );

    if (!result.stdout.trim()) {
      return [];
    }

    const tasks: Task[] = [];

    for (const line of result.stdout.trim().split("\n")) {
      const [containerId, name, status, repo, prompt, port, number, startedAt] = line.split("\t");

      if (!containerId || !name) continue;

      const isRunning = status?.toLowerCase().includes("up");

      tasks.push({
        id: name.replace("cmux-", ""),
        number: parseInt(number || "0", 10),
        containerId,
        repoPath: repo || "",
        repoName: repo?.split("/").pop() || "unknown",
        prompt: prompt || "",
        terminalPort: parseInt(port || "0", 10),
        status: isRunning ? "running" : "done",
        startedAt: startedAt ? new Date(startedAt) : new Date(),
        questions: [],
      });
    }

    // Sort by number
    return tasks.sort((a, b) => a.number - b.number);
  }

  /**
   * Get the next available task number
   */
  async getNextTaskNumber(): Promise<number> {
    const tasks = await this.listTasks();
    if (tasks.length === 0) return 1;
    return Math.max(...tasks.map((t) => t.number)) + 1;
  }

  /**
   * Start a new task
   */
  async startTask(repoPath: string, prompt: string): Promise<Task> {
    await this.ensureImage();

    const taskId = nanoid(8);
    const taskNumber = await this.getNextTaskNumber();
    const terminalPort = await findFreePort(getTaskPort(taskNumber));
    const containerName = `cmux-${taskId}`;
    const startedAt = new Date().toISOString();

    // Resolve absolute path
    const absolutePath = repoPath.startsWith("/")
      ? repoPath
      : `${process.cwd()}/${repoPath}`.replace(/\/\.\//g, "/").replace(/\/+/g, "/");

    const repoName = absolutePath.split("/").pop() || "workspace";

    // Escape prompt for shell
    const escapedPrompt = escapeShell(prompt);

    // Start container with tmux + Claude Code
    const dockerCmd = `docker run -d \\
      --name ${containerName} \\
      --label cmux.task=true \\
      --label cmux.repo="${absolutePath}" \\
      --label cmux.prompt="${escapedPrompt}" \\
      --label cmux.port=${terminalPort} \\
      --label cmux.number=${taskNumber} \\
      --label cmux.startedAt="${startedAt}" \\
      -v "${absolutePath}":/workspace \\
      -p ${terminalPort}:7681 \\
      -w /workspace \\
      -e ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY || ""}" \\
      ${this.imageName} \\
      bash -c "ttyd -p 7681 tmux new-session -s main 'claude \\"${escapedPrompt}\\"'"
    `;

    const result = await exec(dockerCmd);

    if (result.code !== 0) {
      throw new Error(`Failed to start container: ${result.stderr}`);
    }

    return {
      id: taskId,
      number: taskNumber,
      containerId: result.stdout.trim().slice(0, 12),
      repoPath: absolutePath,
      repoName,
      prompt,
      terminalPort,
      status: "starting",
      startedAt: new Date(startedAt),
      questions: [],
    };
  }

  /**
   * Stop a task
   */
  async stopTask(taskId: string): Promise<void> {
    const result = await exec(`docker stop cmux-${taskId} && docker rm cmux-${taskId}`);
    if (result.code !== 0) {
      throw new Error(`Failed to stop task: ${result.stderr}`);
    }
  }

  /**
   * Stop all tasks
   */
  async stopAllTasks(): Promise<void> {
    const tasks = await this.listTasks();
    for (const task of tasks) {
      try {
        await this.stopTask(task.id);
      } catch (error) {
        console.error(`Failed to stop task ${task.id}:`, error);
      }
    }
  }

  /**
   * Read tmux output from a task
   */
  async readOutput(taskId: string, lines: number = 500): Promise<string> {
    const result = await exec(
      `docker exec cmux-${taskId} tmux capture-pane -t main -p -S -${lines} 2>/dev/null`
    );
    return result.stdout;
  }

  /**
   * Inject a message into the Claude Code session
   */
  async injectMessage(taskId: string, message: string): Promise<boolean> {
    const escapedMessage = escapeShell(message);
    const result = await exec(
      `docker exec cmux-${taskId} tmux send-keys -t main "${escapedMessage}" Enter`
    );
    return result.code === 0;
  }

  /**
   * Execute a command in a task container
   */
  async exec(taskId: string, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return exec(`docker exec cmux-${taskId} bash -c "${escapeShell(command)}"`);
  }

  /**
   * Open terminal URL in browser
   */
  async openTerminal(taskId: string): Promise<void> {
    const tasks = await this.listTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const url = `http://localhost:${task.terminalPort}`;

    // Cross-platform open
    const openCmd =
      process.platform === "darwin"
        ? `open "${url}"`
        : process.platform === "win32"
          ? `start "${url}"`
          : `xdg-open "${url}"`;

    await exec(openCmd);
  }
}
