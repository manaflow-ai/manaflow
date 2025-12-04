/**
 * Shared orchestrator script and utilities for running maintenance and dev scripts
 * in tmux windows. Used by both environment tasks (via www) and preview jobs (via convex).
 */

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";

export type ScriptIdentifiers = {
  maintenance: {
    windowName: string;
    scriptPath: string;
  };
  dev: {
    windowName: string;
    scriptPath: string;
  };
};

export const allocateScriptIdentifiers = (): ScriptIdentifiers => {
  return {
    maintenance: {
      windowName: MAINTENANCE_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${MAINTENANCE_SCRIPT_FILENAME}`,
    },
    dev: {
      windowName: DEV_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${DEV_SCRIPT_FILENAME}`,
    },
  };
};

const singleQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;

/**
 * The orchestrator script that runs inside the VM to coordinate maintenance
 * and dev scripts. This is a TypeScript/Bun script that:
 * 1. Ensures a tmux session exists
 * 2. Creates windows for maintenance and dev
 * 3. Runs maintenance script and waits for completion
 * 4. Starts dev script (fire and forget, but checks for early exit)
 * 5. Reports errors back to Convex
 */
const getOrchestratorScript = (): string => `#!/usr/bin/env bun

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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
        const error = new Error(\`Command failed (\${exitCode}): \${command}\`);
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

const WHITESPACE_REGEX = /\\s/;

function sanitizeEnvValue(name: string, value: string): string {
  if (value.trim().length === 0) {
    throw new Error(\`Env var \${name} is empty or whitespace\`);
  }

  if (WHITESPACE_REGEX.test(value)) {
    throw new Error(\`Env var \${name} must not contain whitespace characters\`);
  }

  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(\`Missing env var \${name}\`);
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

async function createWindows(): Promise<void> {
  await ensureTmuxSession();

  if (config.hasMaintenanceScript) {
    console.log(\`[ORCHESTRATOR] Creating \${config.maintenanceWindowName} window...\`);
    await runCommand(
      \`tmux new-window -t cmux: -n \${config.maintenanceWindowName} -d\`,
    );
    console.log(\`[ORCHESTRATOR] \${config.maintenanceWindowName} window created\`);
  }

  if (config.hasDevScript) {
    console.log(\`[ORCHESTRATOR] Creating \${config.devWindowName} window...\`);
    await runCommand(\`tmux new-window -t cmux: -n \${config.devWindowName} -d\`);
    console.log(\`[ORCHESTRATOR] \${config.devWindowName} window created\`);
  }
}

async function readErrorLog(logPath: string): Promise<string> {
  try {
    if (!(await fileExists(logPath))) {
      return "";
    }
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\\n");
    return lines.slice(-100).join("\\n");
  } catch (error) {
    console.error(\`[ORCHESTRATOR] Failed to read log at \${logPath}:\`, error);
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

    await runCommand(
      \`tmux send-keys -t cmux:\${config.maintenanceWindowName} "zsh '\${config.maintenanceScriptPath}' 2>&1 | tee '\${config.maintenanceErrorLogPath}'; echo \\\\\${pipestatus[1]} > '\${config.maintenanceExitCodePath}'; exec zsh" C-m\`,
    );

    await delay(2000);

    console.log("[MAINTENANCE] Waiting for script to complete...");
    let attempts = 0;
    const maxAttempts = 600;

    while (attempts < maxAttempts) {
      if (await fileExists(config.maintenanceExitCodePath)) {
        break;
      }
      await delay(1000);
      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.error("[MAINTENANCE] Script timed out after 10 minutes");
      return {
        exitCode: 124,
        error: "Maintenance script timed out after 10 minutes",
      };
    }

    const exitCodeText = (await readFile(config.maintenanceExitCodePath, "utf8")).trim();
    await removeFile(config.maintenanceExitCodePath);

    const exitCode = Number.parseInt(exitCodeText, 10);

    if (Number.isNaN(exitCode)) {
      console.error(\`[MAINTENANCE] Invalid exit code value: \${exitCodeText}\`);
      return {
        exitCode: 1,
        error: "Maintenance script exit code missing or invalid",
      };
    }

    console.log(\`[MAINTENANCE] Script completed with exit code \${exitCode}\`);

    if (exitCode !== 0) {
      const errorDetails = await readErrorLog(config.maintenanceErrorLogPath);
      const errorMessage =
        errorDetails || \`Maintenance script failed with exit code \${exitCode}\`;
      return { exitCode, error: errorMessage };
    }

    return { exitCode: 0, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(\`[MAINTENANCE] Error: \${errorMessage}\`);
    return {
      exitCode: 1,
      error: \`Maintenance script execution failed: \${errorMessage}\`,
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

    await runCommand(
      \`tmux send-keys -t cmux:\${config.devWindowName} "zsh '\${config.devScriptPath}' 2>&1 | tee '\${config.devErrorLogPath}'; echo \\\\\${pipestatus[1]} > '\${config.devExitCodePath}'" C-m\`,
    );

    await delay(2000);

    const { stdout: windowListing } = await runCommand("tmux list-windows -t cmux");
    if (!windowListing.includes(config.devWindowName)) {
      const error = "Dev window not found after starting script";
      console.error(\`[DEV] ERROR: \${error}\`);
      return { error };
    }

    console.log("[DEV] Checking for early exit...");
    await delay(5000);

    if (await fileExists(config.devExitCodePath)) {
      const exitCodeText = (await readFile(config.devExitCodePath, "utf8")).trim();
      await removeFile(config.devExitCodePath);
      const exitCode = Number.parseInt(exitCodeText, 10);

      if (Number.isNaN(exitCode)) {
        console.error(\`[DEV] Invalid exit code value: \${exitCodeText}\`);
        return { error: "Dev script exit code missing or invalid" };
      }

      if (exitCode !== 0) {
        console.error(\`[DEV] Script exited early with code \${exitCode}\`);
        const errorDetails = await readErrorLog(config.devErrorLogPath);
        const errorMessage = errorDetails || \`Dev script failed with exit code \${exitCode}\`;
        return { error: errorMessage };
      }
    }

    console.log("[DEV] Script started successfully");
    return { error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(\`[DEV] Error: \${errorMessage}\`);
    return {
      error: \`Dev script execution failed: \${errorMessage}\`,
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
      \`\${config.convexUrl}/http/api/task-runs/report-environment-error\`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: \`Bearer \${config.taskRunJwt}\`,
        },
        body: JSON.stringify(body),
      },
    );

    console.log(\`[ORCHESTRATOR] Convex response status: \${response.status}\`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        \`[ORCHESTRATOR] Failed to report errors to Convex: \${response.status}\`,
      );
      console.error(\`[ORCHESTRATOR] Response body: \${errorText}\`);
    } else {
      const responseData = await response.text();
      console.log(
        \`[ORCHESTRATOR] Successfully reported errors to Convex: \${responseData}\`,
      );
    }
  } catch (error) {
    console.error(\`[ORCHESTRATOR] Exception while reporting errors to Convex:\`, error);
  }
}

(async () => {
  try {
    console.log("[ORCHESTRATOR] Starting orchestrator...");
    console.log(\`[ORCHESTRATOR] Workspace root: \${config.workspaceRoot}\`);
    console.log(\`[ORCHESTRATOR] Runtime dir: \${config.runtimeDir}\`);
    console.log(\`[ORCHESTRATOR] CONVEX_URL: \${config.convexUrl}\`);
    console.log(\`[ORCHESTRATOR] TASK_RUN_JWT present: \${Boolean(config.taskRunJwt)}\`);

    await createWindows();

    const maintenanceResult = await runMaintenanceScript();
    if (maintenanceResult.error) {
      console.error(
        \`[ORCHESTRATOR] Maintenance completed with error: \${maintenanceResult.error}\`,
      );
    } else {
      console.log("[ORCHESTRATOR] Maintenance completed successfully");
    }

    const devResult = await startDevScript();
    if (devResult.error) {
      console.error(\`[ORCHESTRATOR] Dev script failed: \${devResult.error}\`);
    } else {
      console.log("[ORCHESTRATOR] Dev script started successfully");

      // Focus on the dev window for cloud environment workspaces
      if (config.hasDevScript && config.isCloudWorkspace) {
        console.log(\`[ORCHESTRATOR] Focusing on \${config.devWindowName} window...\`);
        await runCommand(
          \`tmux select-window -t cmux:\${config.devWindowName}\`,
          { throwOnError: false }
        );
        console.log(\`[ORCHESTRATOR] Focused on \${config.devWindowName} window\`);
      }
    }

    const hasError = Boolean(maintenanceResult.error || devResult.error);
    console.log(
      \`[ORCHESTRATOR] Checking if should report errors - maintenance: \${Boolean(maintenanceResult.error)}, dev: \${Boolean(devResult.error)}\`,
    );

    if (hasError) {
      await reportErrorToConvex(maintenanceResult.error, devResult.error);
      process.exit(1);
    }

    console.log("[ORCHESTRATOR] Orchestrator completed successfully");
    process.exit(0);
  } catch (error) {
    console.error(\`[ORCHESTRATOR] Fatal error: \${error}\`);
    process.exit(1);
  }
})();
`;

export type RunMaintenanceAndDevScriptsOptions = {
  maintenanceScript?: string;
  devScript?: string;
  identifiers?: ScriptIdentifiers;
  convexUrl: string;
  taskRunJwt: string;
  isCloudWorkspace?: boolean;
};

/**
 * Generates the shell command that sets up and runs the orchestrator script.
 * Returns the command string to be executed via instance.exec().
 */
export function generateOrchestratorSetupCommand(
  options: RunMaintenanceAndDevScriptsOptions,
): string | null {
  const {
    maintenanceScript,
    devScript,
    convexUrl,
    taskRunJwt,
    isCloudWorkspace = false,
  } = options;

  const ids = options.identifiers ?? allocateScriptIdentifiers();

  const hasMaintenanceScript = Boolean(
    maintenanceScript && maintenanceScript.trim().length > 0,
  );
  const hasDevScript = Boolean(devScript && devScript.trim().length > 0);

  if (!hasMaintenanceScript && !hasDevScript) {
    return null;
  }

  // Generate unique run IDs for this execution
  const runId = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const orchestratorScriptPath = `${CMUX_RUNTIME_DIR}/orchestrator_${runId}.ts`;
  const maintenanceExitCodePath = `${CMUX_RUNTIME_DIR}/maintenance_${runId}.exit-code`;
  const maintenanceErrorLogPath = `${CMUX_RUNTIME_DIR}/maintenance_${runId}.log`;
  const devExitCodePath = `${CMUX_RUNTIME_DIR}/dev_${runId}.exit-code`;
  const devErrorLogPath = `${CMUX_RUNTIME_DIR}/dev_${runId}.log`;

  // Create maintenance script if provided
  const maintenanceScriptContent = hasMaintenanceScript
    ? `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \\$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \\$(date) ==="
`
    : null;

  // Create dev script if provided
  const devScriptContent = hasDevScript
    ? `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${devScript}
`
    : null;

  const orchestratorScript = getOrchestratorScript();

  const orchestratorEnvVars: Record<string, string> = {
    CMUX_ORCH_WORKSPACE_ROOT: WORKSPACE_ROOT,
    CMUX_ORCH_RUNTIME_DIR: CMUX_RUNTIME_DIR,
    CMUX_ORCH_MAINTENANCE_SCRIPT_PATH: ids.maintenance.scriptPath,
    CMUX_ORCH_DEV_SCRIPT_PATH: ids.dev.scriptPath,
    CMUX_ORCH_MAINTENANCE_WINDOW_NAME: ids.maintenance.windowName,
    CMUX_ORCH_DEV_WINDOW_NAME: ids.dev.windowName,
    CMUX_ORCH_MAINTENANCE_EXIT_CODE_PATH: maintenanceExitCodePath,
    CMUX_ORCH_MAINTENANCE_ERROR_LOG_PATH: maintenanceErrorLogPath,
    CMUX_ORCH_DEV_EXIT_CODE_PATH: devExitCodePath,
    CMUX_ORCH_DEV_ERROR_LOG_PATH: devErrorLogPath,
    CMUX_ORCH_HAS_MAINTENANCE_SCRIPT: hasMaintenanceScript ? "1" : "0",
    CMUX_ORCH_HAS_DEV_SCRIPT: hasDevScript ? "1" : "0",
    CMUX_ORCH_CONVEX_URL: convexUrl,
    CMUX_ORCH_TASK_RUN_JWT: taskRunJwt,
    CMUX_ORCH_IS_CLOUD_WORKSPACE: isCloudWorkspace ? "1" : "0",
  };

  const orchestratorEnvString = Object.entries(orchestratorEnvVars)
    .map(([key, value]) => `export ${key}=${singleQuote(value)}`)
    .join("\n");

  // Create the command that sets up all scripts and starts the orchestrator in background
  const setupAndRunCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}

# Write maintenance script if provided
${maintenanceScriptContent ? `cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}
rm -f ${maintenanceExitCodePath}` : ''}

# Write dev script if provided
${devScriptContent ? `cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}` : ''}

# Write orchestrator script
cat > ${orchestratorScriptPath} <<'ORCHESTRATOR_EOF'
${orchestratorScript}
ORCHESTRATOR_EOF
chmod +x ${orchestratorScriptPath}

# Export orchestrator environment variables
${orchestratorEnvString}

# Start orchestrator as a background process (fire-and-forget)
# Redirect output to log file
nohup bun ${orchestratorScriptPath} > ${CMUX_RUNTIME_DIR}/orchestrator_${runId}.log 2>&1 &
ORCHESTRATOR_PID=$!

# Give it a moment to start
sleep 1

# Verify the process is still running
if kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
  echo "[ORCHESTRATOR] Started successfully in background (PID: $ORCHESTRATOR_PID)"
else
  echo "[ORCHESTRATOR] ERROR: Process failed to start or exited immediately" >&2
  exit 1
fi
`;

  return setupAndRunCommand;
}
