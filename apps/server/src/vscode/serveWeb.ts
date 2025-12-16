import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { promisify } from "node:util";

type Logger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
};

const execFileAsync = promisify(execFile);
export const LOCAL_VSCODE_HOST = "localhost";
const SERVE_WEB_PORT_START = 39_400;
const SERVE_WEB_MAX_PORT_ATTEMPTS = 200;
const SERVER_READY_TIMEOUT_MS = 15_000;

let resolvedVSCodeExecutable: string | null = null;
let currentServeWebBaseUrl: string | null = null;
let currentServeWebPort: number | null = null;

export type VSCodeServeWebHandle = {
  process: ChildProcess;
  executable: string;
  port: number;
};

export function getVSCodeServeWebBaseUrl(): string | null {
  return currentServeWebBaseUrl;
}

export function getVSCodeServeWebPort(): number | null {
  return currentServeWebPort;
}

export async function waitForVSCodeServeWebBaseUrl(
  timeoutMs = 15_000
): Promise<string | null> {
  if (currentServeWebBaseUrl) {
    return currentServeWebBaseUrl;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (currentServeWebBaseUrl) {
      return currentServeWebBaseUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return currentServeWebBaseUrl;
}

export async function ensureVSCodeServeWeb(
  logger: Logger
): Promise<VSCodeServeWebHandle | null> {
  logger.info("Ensuring VS Code serve-web availability...");

  const executable = await getVSCodeExecutable(logger);
  if (!executable) {
    logger.warn(
      "VS Code CLI executable unavailable; serve-web will not be launched."
    );
    return null;
  }

  let child: ChildProcess | null = null;

  try {
    const port = await claimServeWebPort(logger);
    logger.info(
      `Starting VS Code serve-web using executable ${executable} on port ${port}...`
    );

    child = spawn(
      executable,
      [
        "serve-web",
        "--accept-server-license-terms",
        "--without-connection-token",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Make sure VS Code CLI does not inherit our existing IPC hook.
          VSCODE_IPC_HOOK_CLI: undefined,
        },
      }
    );

    attachServeWebProcessLogging(child, logger);

    child!.on("error", (error) => {
      logger.error("VS Code serve-web process error:", error);
    });

    child!.on("exit", (code, signal) => {
      const exitMessage = `VS Code serve-web process exited${
        typeof code === "number" ? ` with code ${code}` : ""
      }${signal ? ` due to signal ${signal}` : ""}.`;
      if (code === 0 && !signal) {
        logger.info(exitMessage);
      } else {
        logger.warn(exitMessage);
      }
      if (currentServeWebBaseUrl) {
        logger.info("Clearing cached VS Code serve-web base URL");
        currentServeWebBaseUrl = null;
      }
      currentServeWebPort = null;
    });

    await waitForServeWebPort(port, logger);

    currentServeWebBaseUrl = `http://${LOCAL_VSCODE_HOST}:${port}`;
    currentServeWebPort = port;
    const baseUrl = currentServeWebBaseUrl;

    logger.info(
      `VS Code serve-web ready at ${baseUrl} (pid ${child.pid ?? "unknown"}).`
    );

    await warmUpVSCodeServeWeb(port, logger);

    return {
      process: child!,
      executable,
      port,
    };
  } catch (error) {
    logger.error("Failed to launch VS Code serve-web:", error);
    if (child && !child.killed && child.exitCode === null) {
      try {
        child.kill();
      } catch (killError) {
        logger.warn(
          "Failed to terminate VS Code serve-web after launch failure:",
          killError
        );
      }
    }
    currentServeWebBaseUrl = null;
    currentServeWebPort = null;
    return null;
  }
}

export function stopVSCodeServeWeb(
  handle: VSCodeServeWebHandle | null,
  logger: Logger
): void {
  if (!handle) {
    return;
  }

  const { process: child } = handle;

  currentServeWebBaseUrl = null;
  currentServeWebPort = null;

  if (child.killed || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  logger.info("Stopping VS Code serve-web process...");
  try {
    child.kill();
  } catch (error) {
    logger.error("Failed to stop VS Code serve-web process:", error);
  }
}

async function getVSCodeExecutable(logger: Logger) {
  logger.info("Attempting to resolve VS Code CLI executable for serve-web.");
  const executable = await resolveVSCodeExecutable(logger);
  if (!executable) {
    return null;
  }

  try {
    if (process.platform !== "win32") {
      await access(executable, fsConstants.X_OK);
    }
    return executable;
  } catch (error) {
    logger.error(`VS Code CLI at ${executable} is not executable:`, error);
    return null;
  }
}

async function resolveVSCodeExecutable(logger: Logger) {
  if (resolvedVSCodeExecutable) {
    return resolvedVSCodeExecutable;
  }

  const lookups =
    process.platform === "win32"
      ? [
          { command: "where", args: ["code.cmd"] },
          { command: "where", args: ["code.exe"] },
          { command: "where", args: ["code"] },
        ]
      : [{ command: "/usr/bin/env", args: ["which", "code"] }];

  for (const { command, args } of lookups) {
    try {
      const { stdout } = await execFileAsync(command, args);
      const candidate = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      if (candidate) {
        const normalizedCandidate =
          normalizeVSCodeExecutableCandidate(candidate);
        resolvedVSCodeExecutable = normalizedCandidate;
        logger.info(
          `Resolved VS Code CLI executable: ${
            normalizedCandidate !== candidate
              ? `${normalizedCandidate} (from ${candidate})`
              : normalizedCandidate
          }`
        );
        break;
      }
    } catch (error) {
      logger.debug?.(`VS Code CLI lookup with ${command} failed:`, error);
    }
  }

  if (!resolvedVSCodeExecutable && process.env.SHELL) {
    try {
      const { stdout } = await execFileAsync(process.env.SHELL, [
        "-lc",
        "command -v code",
      ]);
      const candidate = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (candidate) {
        const normalizedCandidate =
          normalizeVSCodeExecutableCandidate(candidate);
        resolvedVSCodeExecutable = normalizedCandidate;
        logger.info(
          `Resolved VS Code CLI executable via shell lookup: ${
            normalizedCandidate !== candidate
              ? `${normalizedCandidate} (from ${candidate})`
              : normalizedCandidate
          }`
        );
      }
    } catch (error) {
      logger.debug?.(
        `VS Code CLI SHELL lookup failed (${process.env.SHELL}):`,
        error
      );
    }
  }

  return resolvedVSCodeExecutable;
}

/**
 * VS Code CLI binaries are sometimes exposed as shell aliases (e.g.
 * `alias code=/app/openvscode-server/bin/openvscode-server`). Normalize those
 * alias strings into an executable path we can `access`/`spawn`.
 */
export function normalizeVSCodeExecutableCandidate(candidate: string): string {
  const trimmed = candidate.trim();
  const aliasPatterns = [
    /^alias\s+code=(.+)$/i,
    /^code:\s*aliased to\s*(.+)$/i,
    /^code is an alias for\s+(.+)$/i,
  ];

  for (const pattern of aliasPatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      let aliasTarget = match[1].trim();
      if (
        (aliasTarget.startsWith("'") && aliasTarget.endsWith("'")) ||
        (aliasTarget.startsWith('"') && aliasTarget.endsWith('"'))
      ) {
        aliasTarget = aliasTarget.slice(1, -1);
      }
      // Alias definitions can include arguments; we only need the binary path.
      const [path] = aliasTarget.split(/\s+/);
      if (path) {
        return path;
      }
    }
  }

  return trimmed;
}

async function warmUpVSCodeServeWeb(port: number, logger: Logger) {
  const warmupDeadline = Date.now() + 10_000;

  while (Date.now() < warmupDeadline) {
    try {
      await performServeWebRequest("GET", port);
      logger.info("VS Code serve-web warm-up succeeded.");
      return;
    } catch (error) {
      logger.debug?.("VS Code serve-web warm-up attempt failed:", error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  logger.warn(
    "VS Code serve-web did not respond with HTTP 200 during warm-up window."
  );
}

function attachServeWebProcessLogging(child: ChildProcess, logger: Logger) {
  const debugLog = logger.debug ?? logger.info;

  pipeStreamLines(child.stdout, (line) => {
    debugLog(`[VS Code serve-web stdout] ${line}`);
  });

  pipeStreamLines(child.stderr, (line) => {
    logger.warn(`[VS Code serve-web stderr] ${line}`);
  });
}

function pipeStreamLines(
  stream: NodeJS.ReadableStream | null | undefined,
  onLine: (line: string) => void
) {
  if (!stream) {
    return;
  }

  let buffered = "";

  stream.on("data", (chunk: Buffer | string) => {
    buffered += chunk.toString();

    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffered.slice(0, newlineIndex).replace(/\r$/, "");
      onLine(line);
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
    }
  });

  stream.on("end", () => {
    if (buffered.length > 0) {
      onLine(buffered.replace(/\r$/, ""));
    }
  });
}

async function waitForServeWebPort(port: number, logger: Logger) {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await performServeWebRequest("HEAD", port);
      return;
    } catch (error) {
      logger.debug?.("VS Code serve-web readiness check failed:", error);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error(
    `VS Code serve-web port ${port} was not ready within ${SERVER_READY_TIMEOUT_MS} ms`
  );
}

async function performServeWebRequest(
  method: "GET" | "HEAD",
  port: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path: "/",
        headers: {
          host: `${LOCAL_VSCODE_HOST}:${port}`,
        },
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function claimServeWebPort(logger: Logger): Promise<number> {
  for (let attempt = 0; attempt < SERVE_WEB_MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = SERVE_WEB_PORT_START + attempt;
    // eslint-disable-next-line no-await-in-loop
    const isAvailable = await isPortAvailable(port);
    if (isAvailable) {
      return port;
    }
    logger.debug?.(
      `VS Code serve-web port ${port} unavailable, trying next candidate...`
    );
  }

  throw new Error(
    `Unable to find an available port for VS Code serve-web after ${SERVE_WEB_MAX_PORT_ATTEMPTS} attempts starting at ${SERVE_WEB_PORT_START}`
  );
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.unref();

    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      resolve(false);
    };

    tester.once("error", onError);
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    try {
      tester.listen(port, "127.0.0.1");
    } catch {
      resolve(false);
    }
  });
}
