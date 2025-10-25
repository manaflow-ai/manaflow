import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { promisify } from "node:util";

type Logger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
};

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 39384;
let resolvedVSCodeExecutable: string | null = null;
const unavailableServeWebPorts = new Set<number>();

export type VSCodeServeWebHandle = {
  process: ChildProcess;
  port: number;
  executable: string;
};

export async function ensureVSCodeServeWeb(
  logger: Logger,
  options?: { port?: number }
): Promise<VSCodeServeWebHandle | null> {
  logger.info("Ensuring VS Code serve-web availability...");

  const executable = await getVSCodeExecutable(logger);
  if (!executable) {
    logger.warn("VS Code CLI executable unavailable; serve-web will not be launched.");
    return null;
  }

  const port = options?.port ?? DEFAULT_PORT;
  const portAvailable = await isPortAvailable(port, logger);
  if (!portAvailable) {
    if (!unavailableServeWebPorts.has(port)) {
      unavailableServeWebPorts.add(port);
      logger.warn(`VS Code serve-web skipped because port ${port} is not available.`);
    } else {
      logger.debug?.(`VS Code serve-web still unavailable on port ${port}; skipping launch.`);
    }
    return null;
  }

  try {
    logger.info(
      `Starting VS Code serve-web using executable ${executable} on port ${port}...`
    );
    const child = spawn(
      executable,
      [
        "serve-web",
        "--accept-server-license-terms",
        "--without-connection-token",
        "--port",
        String(port),
      ],
      {
        detached: true,
        stdio: "ignore",
      }
    );

    child.on("error", (error) => {
      logger.error("VS Code serve-web process error:", error);
    });

    child.on("exit", (code, signal) => {
      logger.info(
        `VS Code serve-web process exited${
          typeof code === "number" ? ` with code ${code}` : ""
        }${signal ? ` due to signal ${signal}` : ""}.`
      );
    });

    child.unref();
    logger.info(`Launched VS Code serve-web on port ${port}.`);

    await warmUpVSCodeServeWeb(port, logger);

    return { process: child, port, executable };
  } catch (error) {
    logger.error("Failed to launch VS Code serve-web:", error);
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

  const { process: child, port } = handle;
  if (
    child.killed ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  logger.info(`Stopping VS Code serve-web process on port ${port}...`);
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
        resolvedVSCodeExecutable = candidate;
        logger.info(`Resolved VS Code CLI executable: ${candidate}`);
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
        resolvedVSCodeExecutable = candidate;
        logger.info(
          `Resolved VS Code CLI executable via shell lookup: ${candidate}`
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

async function isPortAvailable(port: number, logger: Logger) {
  return new Promise<boolean>((resolve) => {
    const tester = createNetServer();

    tester.once("error", (error) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EADDRINUSE"
      ) {
        logger.warn(
          `Port ${port} is already in use, skipping VS Code serve-web launch.`
        );
      } else {
        logger.error(`Error while checking port ${port}:`, error);
      }
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port, "127.0.0.1");
  });
}

async function warmUpVSCodeServeWeb(port: number, logger: Logger) {
  const warmupDeadline = Date.now() + 10_000;
  const endpoint = `http://127.0.0.1:${port}/`;

  while (Date.now() < warmupDeadline) {
    try {
      const response = await fetch(endpoint, { redirect: "manual" });
      if (response.status === 200) {
        logger.info("VS Code serve-web warm-up succeeded.");
        return;
      }
    } catch (error) {
      logger.debug?.("VS Code serve-web warm-up attempt failed:", error);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }

  logger.warn(
    "VS Code serve-web did not respond with HTTP 200 during warm-up window."
  );
}
