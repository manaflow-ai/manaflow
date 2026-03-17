#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { access, readFile, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunCommandOptions = {
  throwOnError?: boolean;
};

type MaintenanceResult = {
  exitCode: number;
  error: string | null;
};

type DevResult = {
  error: string | null;
};

// cmux-pty API types
type PtySessionInfo = {
  id: string;
  name: string;
  index: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  created_at: number;
  alive: boolean;
  pid: number;
};

// cmux-pty server configuration
const PTY_SERVER_URL = process.env.PTY_SERVER_URL || "http://localhost:39383";

// Track which backend we're using
let useCmuxPty = false;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// =============================================================================
// cmux-pty API helpers
// =============================================================================

async function checkPtyServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${PTY_SERVER_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function createPtySession(options: {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  name?: string;
  metadata?: {
    location?: "editor" | "panel";
    type?: "agent" | "dev" | "maintenance" | "shell";
    managed?: boolean;
  };
}): Promise<PtySessionInfo> {
  const response = await fetch(`${PTY_SERVER_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shell: options.shell || "/bin/zsh",
      cwd: options.cwd || "/root/workspace",
      cols: options.cols || 80,
      rows: options.rows || 24,
      env: options.env,
      name: options.name,
      metadata: options.metadata,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create PTY session: ${error}`);
  }

  return response.json();
}

async function sendPtyInput(sessionId: string, data: string): Promise<void> {
  const response = await fetch(`${PTY_SERVER_URL}/sessions/${sessionId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send input to PTY session: ${error}`);
  }
}

async function checkPtySessionAlive(
  sessionId: string,
  retries = 3,
  retryDelayMs = 500,
): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(`${PTY_SERVER_URL}/sessions`);
      if (!response.ok) {
        if (attempt < retries - 1) {
          await delay(retryDelayMs);
          continue;
        }
        return false;
      }
      const result = (await response.json()) as { sessions: PtySessionInfo[] };
      const session = result.sessions.find((s) => s.id === sessionId);
      if (session) {
        return session.alive;
      }
      // Session not found - retry in case of timing issue
      if (attempt < retries - 1) {
        await delay(retryDelayMs);
        continue;
      }
      return false;
    } catch {
      if (attempt < retries - 1) {
        await delay(retryDelayMs);
        continue;
      }
      return false;
    }
  }
  return false;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function runCommand(
  command: string,
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const { throwOnError = true } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0 && throwOnError) {
        const error = new Error(`Command failed (${exitCode}): ${command}`);
        (error as Error & { exitCode?: number; stdout?: string; stderr?: string }).exitCode =
          exitCode;
        (error as Error & { exitCode?: number; stdout?: string; stderr?: string }).stdout =
          stdout;
        (error as Error & { exitCode?: number; stdout?: string; stderr?: string }).stderr =
          stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr, exitCode });
    });
  });
}

const WHITESPACE_REGEX = /\s/;

function sanitizeEnvValue(name: string, value: string): string {
  if (value.trim().length === 0) {
    throw new Error(`Env var ${name} is empty or whitespace`);
  }

  if (WHITESPACE_REGEX.test(value)) {
    throw new Error(`Env var ${name} must not contain whitespace characters`);
  }

  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Missing env var ${name}`);
  }
  return sanitizeEnvValue(name, value);
}

function envBoolean(name: string): boolean {
  const value = process.env[name];
  if (!value) {
    return false;
  }
  const sanitizedValue = sanitizeEnvValue(name, value);
  return sanitizedValue === "1" || sanitizedValue.toLowerCase() === "true";
}

const config = {
  workspaceRoot: requireEnv("CMUX_ORCH_WORKSPACE_ROOT"),
  runtimeDir: requireEnv("CMUX_ORCH_RUNTIME_DIR"),
  maintenanceScriptPath: requireEnv("CMUX_ORCH_MAINTENANCE_SCRIPT_PATH"),
  devScriptPath: requireEnv("CMUX_ORCH_DEV_SCRIPT_PATH"),
  maintenanceWindowName: requireEnv("CMUX_ORCH_MAINTENANCE_WINDOW_NAME"),
  devWindowName: requireEnv("CMUX_ORCH_DEV_WINDOW_NAME"),
  maintenanceExitCodePath: requireEnv("CMUX_ORCH_MAINTENANCE_EXIT_CODE_PATH"),
  maintenanceErrorLogPath: requireEnv("CMUX_ORCH_MAINTENANCE_ERROR_LOG_PATH"),
  devExitCodePath: requireEnv("CMUX_ORCH_DEV_EXIT_CODE_PATH"),
  devErrorLogPath: requireEnv("CMUX_ORCH_DEV_ERROR_LOG_PATH"),
  hasMaintenanceScript: envBoolean("CMUX_ORCH_HAS_MAINTENANCE_SCRIPT"),
  hasDevScript: envBoolean("CMUX_ORCH_HAS_DEV_SCRIPT"),
  convexUrl: requireEnv("CMUX_ORCH_CONVEX_URL"),
  taskRunJwt: requireEnv("CMUX_ORCH_TASK_RUN_JWT"),
  isCloudWorkspace: envBoolean("CMUX_ORCH_IS_CLOUD_WORKSPACE"),
};

async function detectBackend(): Promise<"cmux-pty" | "tmux"> {
  // Check if cmux-pty server is available
  console.log("[ORCHESTRATOR] Checking if cmux-pty server is available...");
  const ptyAvailable = await checkPtyServerHealth();

  if (ptyAvailable) {
    console.log("[ORCHESTRATOR] cmux-pty server is available, using cmux-pty backend");
    return "cmux-pty";
  }

  console.log("[ORCHESTRATOR] cmux-pty server not available, using tmux backend");
  return "tmux";
}

async function ensureTmuxSession(): Promise<void> {
  // Check if session already exists
  const checkResult = await runCommand("tmux has-session -t cmux 2>/dev/null", {
    throwOnError: false,
  });

  if (checkResult.exitCode === 0) {
    console.log("[ORCHESTRATOR] tmux session 'cmux' already exists");
    return;
  }

  // Only create the session for cloud workspaces (no agent)
  // For tasks with agents, the agent spawner creates the session
  if (!config.isCloudWorkspace) {
    console.log("[ORCHESTRATOR] Not a cloud workspace, waiting for agent to create tmux session...");

    // Wait for the agent to create the session
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await runCommand("tmux has-session -t cmux 2>/dev/null", {
        throwOnError: false,
      });
      if (result.exitCode === 0) {
        console.log("[ORCHESTRATOR] tmux session 'cmux' created by agent");
        return;
      }
      await delay(1000);
    }

    throw new Error("Timed out waiting for agent to create tmux session 'cmux'");
  }

  console.log("[ORCHESTRATOR] Cloud workspace detected, creating tmux session...");

  // Create a new tmux session
  await runCommand(
    "tmux new-session -d -s cmux -c /root/workspace -n main",
    { throwOnError: true }
  );

  console.log("[ORCHESTRATOR] tmux session 'cmux' created successfully");

  // Wait a moment for the session to be fully initialized
  await delay(500);

  // Verify the session exists
  const verifyResult = await runCommand("tmux has-session -t cmux 2>/dev/null", {
    throwOnError: false,
  });

  if (verifyResult.exitCode !== 0) {
    throw new Error("Failed to create tmux session 'cmux'");
  }
}

// Track PTY session IDs for cmux-pty backend
let maintenancePtyId: string | null = null;
let devPtyId: string | null = null;

async function createWindows(): Promise<void> {
  if (useCmuxPty) {
    // cmux-pty backend: create PTY sessions for each script
    if (config.hasMaintenanceScript) {
      console.log(`[ORCHESTRATOR] Creating PTY session for ${config.maintenanceWindowName}...`);
      const session = await createPtySession({
        name: config.maintenanceWindowName,
        cwd: config.workspaceRoot,
        shell: "/bin/zsh",
        metadata: { location: "panel", type: "maintenance", managed: true },
      });
      maintenancePtyId = session.id;
      console.log(`[ORCHESTRATOR] ${config.maintenanceWindowName} PTY created: ${session.id}`);
    }

    if (config.hasDevScript) {
      console.log(`[ORCHESTRATOR] Creating PTY session for ${config.devWindowName}...`);
      const session = await createPtySession({
        name: config.devWindowName,
        cwd: config.workspaceRoot,
        shell: "/bin/zsh",
        metadata: { location: "panel", type: "dev", managed: true },
      });
      devPtyId = session.id;
      console.log(`[ORCHESTRATOR] ${config.devWindowName} PTY created: ${session.id}`);
    }

    // Wait for shells to fully initialize before sending commands
    // The PTY is created but the shell needs time to start and show prompt
    // Cloud environments may have longer initialization times (loading zshrc, plugins, etc.)
    if (maintenancePtyId || devPtyId) {
      console.log("[ORCHESTRATOR] Waiting for shells to initialize...");
      await delay(3000);
    }
  } else {
    // tmux backend: create windows in the cmux session
    await ensureTmuxSession();

    if (config.hasMaintenanceScript) {
      console.log(`[ORCHESTRATOR] Creating ${config.maintenanceWindowName} window...`);
      await runCommand(
        `tmux new-window -t cmux: -n ${config.maintenanceWindowName} -d`,
      );
      console.log(`[ORCHESTRATOR] ${config.maintenanceWindowName} window created`);
    }

    if (config.hasDevScript) {
      console.log(`[ORCHESTRATOR] Creating ${config.devWindowName} window...`);
      await runCommand(`tmux new-window -t cmux: -n ${config.devWindowName} -d`);
      console.log(`[ORCHESTRATOR] ${config.devWindowName} window created`);
    }
  }
}

async function readErrorLog(logPath: string): Promise<string> {
  try {
    if (!(await fileExists(logPath))) {
      return "";
    }
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    return lines.slice(-100).join("\n");
  } catch (error) {
    console.error(`[ORCHESTRATOR] Failed to read log at ${logPath}:`, error);
    return "";
  }
}

async function runMaintenanceScript(): Promise<MaintenanceResult> {
  if (!config.hasMaintenanceScript) {
    console.log("[MAINTENANCE] No maintenance script to run");
    return { exitCode: 0, error: null };
  }

  try {
    console.log("[MAINTENANCE] Starting maintenance script...");

    if (useCmuxPty && maintenancePtyId) {
      // cmux-pty backend: send command to PTY session
      // Don't use exec zsh at the end - let the script run and keep the shell
      const command = `set +x; zsh '${config.maintenanceScriptPath}' 2>&1 | tee '${config.maintenanceErrorLogPath}'; echo $\{pipestatus[1]} > '${config.maintenanceExitCodePath}'\n`;
      console.log(`[MAINTENANCE] Sending command to PTY ${maintenancePtyId}: ${command.slice(0, 100)}...`);
      await sendPtyInput(maintenancePtyId, command);
      console.log(`[MAINTENANCE] Command sent to PTY`);
    } else {
      // tmux backend: send command via tmux send-keys
      await runCommand(
        `tmux send-keys -t cmux:${config.maintenanceWindowName} "set +x; zsh '${config.maintenanceScriptPath}' 2>&1 | tee '${config.maintenanceErrorLogPath}'; echo \\\${pipestatus[1]} > '${config.maintenanceExitCodePath}'" C-m`,
      );
    }

    await delay(2000);

    // Check PTY session status (non-fatal - the exit code check below is authoritative)
    if (useCmuxPty && maintenancePtyId) {
      const isAlive = await checkPtySessionAlive(maintenancePtyId);
      if (!isAlive) {
        console.warn(`[MAINTENANCE] WARN: PTY session check failed, but script may still be running`);
      }
    }

    // Wait a bit to see if the script exits early (error case)
    // This allows quick failures to be caught while letting long-running scripts continue
    console.log("[MAINTENANCE] Checking for early exit...");
    await delay(5000);

    if (await fileExists(config.maintenanceExitCodePath)) {
      // Script exited - check if it was an error
      await delay(200); // Small delay to ensure file is fully written

      // Read exit code with retry to handle potential race conditions
      let exitCodeText = "";
      for (let readAttempt = 0; readAttempt < 3; readAttempt++) {
        exitCodeText = (await readFile(config.maintenanceExitCodePath, "utf8")).trim();
        if (exitCodeText.length > 0) break;
        console.log(`[MAINTENANCE] Exit code file empty, retrying... (attempt ${readAttempt + 1})`);
        await delay(200);
      }
      await removeFile(config.maintenanceExitCodePath);

      const exitCode = Number.parseInt(exitCodeText, 10);

      if (Number.isNaN(exitCode)) {
        console.error(`[MAINTENANCE] Invalid exit code value: "${exitCodeText}"`);
        return {
          exitCode: 1,
          error: "Maintenance script exit code missing or invalid",
        };
      }

      if (exitCode !== 0) {
        console.error(`[MAINTENANCE] Script exited early with code ${exitCode}`);
        const errorDetails = await readErrorLog(config.maintenanceErrorLogPath);
        const errorMessage =
          errorDetails || `Maintenance script failed with exit code ${exitCode}`;
        return { exitCode, error: errorMessage };
      }

      console.log(`[MAINTENANCE] Script completed successfully with exit code 0`);
    } else {
      // Script still running after 7 seconds - assume it's a long-running process (e.g., dev server)
      console.log("[MAINTENANCE] Script still running (likely a long-running process) - continuing");
    }

    return { exitCode: 0, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MAINTENANCE] Error: ${errorMessage}`);
    return {
      exitCode: 1,
      error: `Maintenance script execution failed: ${errorMessage}`,
    };
  }
}

async function startDevScript(): Promise<DevResult> {
  if (!config.hasDevScript) {
    console.log("[DEV] No dev script to run");
    return { error: null };
  }

  try {
    console.log("[DEV] Starting dev script...");

    if (useCmuxPty && devPtyId) {
      // cmux-pty backend: send command to PTY session
      const command = `set +x; zsh '${config.devScriptPath}' 2>&1 | tee '${config.devErrorLogPath}'; echo $\{pipestatus[1]} > '${config.devExitCodePath}'\n`;
      console.log(`[DEV] Sending command to PTY ${devPtyId}`);
      await sendPtyInput(devPtyId, command);
      console.log(`[DEV] Command sent to PTY`);

      await delay(2000);

      // Check PTY session status (non-fatal - the exit code check below is authoritative)
      const isAlive = await checkPtySessionAlive(devPtyId);
      if (!isAlive) {
        // This can be a false positive if the shell exited after running the command
        // but the dev server is still running. The exit code check below is the real test.
        console.warn(`[DEV] WARN: PTY session check failed, but dev server may still be running`);
      }
    } else {
      // tmux backend: send command via tmux send-keys
      await runCommand(
        `tmux send-keys -t cmux:${config.devWindowName} "set +x; zsh '${config.devScriptPath}' 2>&1 | tee '${config.devErrorLogPath}'; echo \\\${pipestatus[1]} > '${config.devExitCodePath}'" C-m`,
      );

      await delay(2000);

      const { stdout: windowListing } = await runCommand("tmux list-windows -t cmux");
      if (!windowListing.includes(config.devWindowName)) {
        const error = "Dev window not found after starting script";
        console.error(`[DEV] ERROR: ${error}`);
        return { error };
      }
    }

    console.log("[DEV] Checking for early exit...");
    await delay(5000);

    if (await fileExists(config.devExitCodePath)) {
      const exitCodeText = (await readFile(config.devExitCodePath, "utf8")).trim();
      await removeFile(config.devExitCodePath);
      const exitCode = Number.parseInt(exitCodeText, 10);

      if (Number.isNaN(exitCode)) {
        console.error(`[DEV] Invalid exit code value: ${exitCodeText}`);
        return { error: "Dev script exit code missing or invalid" };
      }

      if (exitCode !== 0) {
        console.error(`[DEV] Script exited early with code ${exitCode}`);
        const errorDetails = await readErrorLog(config.devErrorLogPath);
        const errorMessage = errorDetails || `Dev script failed with exit code ${exitCode}`;
        return { error: errorMessage };
      }
    }

    console.log("[DEV] Script started successfully");
    return { error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[DEV] Error: ${errorMessage}`);
    return {
      error: `Dev script execution failed: ${errorMessage}`,
    };
  }
}

async function reportErrorToConvex(
  maintenanceError: string | null,
  devError: string | null,
): Promise<void> {
  if (!config.taskRunJwt || !config.convexUrl) {
    console.log(
      "[ORCHESTRATOR] Skipping Convex error reporting: missing configuration",
    );
    return;
  }

  if (!maintenanceError && !devError) {
    console.log("[ORCHESTRATOR] No errors to report");
    return;
  }

  try {
    console.log("[ORCHESTRATOR] Reporting errors to Convex HTTP action...");
    const body: Record<string, string> = {};
    if (maintenanceError) {
      body.maintenanceError = maintenanceError;
    }
    if (devError) {
      body.devError = devError;
    }

    const response = await fetch(
      `${config.convexUrl}/http/api/task-runs/report-environment-error`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.taskRunJwt}`,
        },
        body: JSON.stringify(body),
      },
    );

    console.log(`[ORCHESTRATOR] Convex response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[ORCHESTRATOR] Failed to report errors to Convex: ${response.status}`,
      );
      console.error(`[ORCHESTRATOR] Response body: ${errorText}`);
    } else {
      const responseData = await response.text();
      console.log(
        `[ORCHESTRATOR] Successfully reported errors to Convex: ${responseData}`,
      );
    }
  } catch (error) {
    console.error(`[ORCHESTRATOR] Exception while reporting errors to Convex:`, error);
  }
}

(async () => {
  try {
    console.log("[ORCHESTRATOR] Starting orchestrator...");
    console.log(`[ORCHESTRATOR] Workspace root: ${config.workspaceRoot}`);
    console.log(`[ORCHESTRATOR] Runtime dir: ${config.runtimeDir}`);
    console.log(`[ORCHESTRATOR] CONVEX_URL: ${config.convexUrl}`);
    console.log(`[ORCHESTRATOR] TASK_RUN_JWT present: ${Boolean(config.taskRunJwt)}`);

    // Detect which backend to use (cmux-pty or tmux)
    const backend = await detectBackend();
    useCmuxPty = backend === "cmux-pty";
    console.log(`[ORCHESTRATOR] Using backend: ${backend}`);

    await createWindows();

    const maintenanceResult = await runMaintenanceScript();
    if (maintenanceResult.error) {
      console.error(
        `[ORCHESTRATOR] Maintenance completed with error: ${maintenanceResult.error}`,
      );
    } else {
      console.log("[ORCHESTRATOR] Maintenance completed successfully");
    }

    const devResult = await startDevScript();
    if (devResult.error) {
      console.error(`[ORCHESTRATOR] Dev script failed: ${devResult.error}`);
    } else {
      console.log("[ORCHESTRATOR] Dev script started successfully");

      // Focus on the dev window for cloud environment workspaces
      // For cmux-pty, the VSCode extension handles terminal focus
      if (config.hasDevScript && config.isCloudWorkspace && !useCmuxPty) {
        console.log(`[ORCHESTRATOR] Focusing on ${config.devWindowName} window...`);
        await runCommand(
          `tmux select-window -t cmux:${config.devWindowName}`,
          { throwOnError: false }
        );
        console.log(`[ORCHESTRATOR] Focused on ${config.devWindowName} window`);
      }
    }

    const hasError = Boolean(maintenanceResult.error || devResult.error);
    console.log(
      `[ORCHESTRATOR] Checking if should report errors - maintenance: ${Boolean(maintenanceResult.error)}, dev: ${Boolean(devResult.error)}`,
    );

    if (hasError) {
      await reportErrorToConvex(maintenanceResult.error, devResult.error);
      process.exit(1);
    }

    console.log("[ORCHESTRATOR] Orchestrator completed successfully");
    process.exit(0);
  } catch (error) {
    console.error(`[ORCHESTRATOR] Fatal error: ${error}`);
    process.exit(1);
  }
})();
