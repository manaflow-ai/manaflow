import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { getLocalVSCodeSettingsSnapshot } from "../utils/editorSettings";
import {
  getVSCodeInstallation,
  formatDetectionResultForUser,
  clearVSCodeDetectionCache,
  type VSCodeDetectionResult,
} from "./vscodeDetection";

type Logger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
};
export const LOCAL_VSCODE_HOST = "localhost";
const SERVE_WEB_PORT_START = 39_400;
const SERVE_WEB_MAX_PORT_ATTEMPTS = 200;
const SERVER_READY_TIMEOUT_MS = 15_000;
const SERVE_WEB_AGENT_FOLDER = path.join(
  os.homedir(),
  ".cmux",
  "vscode-serve-web"
);
const SERVE_WEB_PROFILE_ID = "default-profile";
const BUILD_WITH_AGENT_SETTING_KEY = "cmux.buildWithAgent";

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
    await syncLocalVSCodeSettingsForServeWeb(logger);

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
          VSCODE_AGENT_FOLDER: SERVE_WEB_AGENT_FOLDER,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQuoteEscaped(input: string, index: number): boolean {
  let backslashCount = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        output += char;
      }
      continue;
    }

    if (inMultiLineComment) {
      if (char === "*" && next === "/") {
        inMultiLineComment = false;
        i += 1;
      }
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      inSingleLineComment = true;
      i += 1;
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      inMultiLineComment = true;
      i += 1;
      continue;
    }

    if (char === '"' && !isQuoteEscaped(input, i)) {
      inString = !inString;
    }

    output += char;
  }

  return output;
}

function removeTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inString) {
      output += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j] ?? "")) {
        j += 1;
      }
      const next = input[j];
      if (next === "}" || next === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function parseSettingsJson(
  raw: string | undefined,
  logger: Logger
): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  const tryParse = (value: string, label: string) => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) {
        return parsed;
      }
      logger.warn(`Parsed ${label} but it was not an object.`);
      return null;
    } catch (error) {
      console.error(`Failed to parse ${label}:`, error);
      logger.error(`Failed to parse ${label}:`, error);
      return null;
    }
  };

  const direct = tryParse(raw, "settings.json");
  if (direct) {
    return direct;
  }

  const stripped = stripJsonComments(raw);
  const normalized = removeTrailingCommas(stripped);
  const fallback = tryParse(normalized, "settings.json (jsonc)");
  if (fallback) {
    return fallback;
  }

  return {};
}

async function safeWriteFile(
  target: string,
  content: string,
  logger: Logger
): Promise<void> {
  try {
    await writeFile(target, content, { encoding: "utf8" });
  } catch (error) {
    console.error(`Failed to write ${target}:`, error);
    logger.error(`Failed to write ${target}:`, error);
  }
}

async function syncLocalVSCodeSettingsForServeWeb(logger: Logger): Promise<void> {
  const dataDir = path.join(SERVE_WEB_AGENT_FOLDER, "data");
  const userDir = path.join(dataDir, "User");
  const profileDir = path.join(userDir, "profiles", SERVE_WEB_PROFILE_ID);
  const machineDir = path.join(dataDir, "Machine");
  const userSnippetsDir = path.join(userDir, "snippets");
  const profileSnippetsDir = path.join(profileDir, "snippets");

  try {
    await Promise.all([
      mkdir(userDir, { recursive: true }),
      mkdir(profileDir, { recursive: true }),
      mkdir(machineDir, { recursive: true }),
      mkdir(userSnippetsDir, { recursive: true }),
      mkdir(profileSnippetsDir, { recursive: true }),
    ]);
  } catch (error) {
    console.error("Failed to prepare serve-web settings directories:", error);
    logger.error("Failed to prepare serve-web settings directories:", error);
    return;
  }

  let localSettings: Awaited<ReturnType<typeof getLocalVSCodeSettingsSnapshot>> =
    null;
  try {
    localSettings = await getLocalVSCodeSettingsSnapshot();
  } catch (error) {
    console.error("Failed to load local VS Code settings:", error);
    logger.error("Failed to load local VS Code settings:", error);
  }

  const mergedSettings = parseSettingsJson(localSettings?.settingsJson, logger);
  mergedSettings[BUILD_WITH_AGENT_SETTING_KEY] = false;
  mergedSettings["security.workspace.trust.enabled"] = false;
  mergedSettings["security.workspace.trust.startupPrompt"] = "never";
  mergedSettings["security.workspace.trust.untrustedFiles"] = "open";
  mergedSettings["security.workspace.trust.emptyWindow"] = false;
  const settingsContent = `${JSON.stringify(mergedSettings, null, 2)}\n`;

  await Promise.all([
    safeWriteFile(path.join(userDir, "settings.json"), settingsContent, logger),
    safeWriteFile(path.join(profileDir, "settings.json"), settingsContent, logger),
    safeWriteFile(path.join(machineDir, "settings.json"), settingsContent, logger),
  ]);

  if (localSettings?.keybindingsJson) {
    await Promise.all([
      safeWriteFile(
        path.join(userDir, "keybindings.json"),
        localSettings.keybindingsJson,
        logger
      ),
      safeWriteFile(
        path.join(profileDir, "keybindings.json"),
        localSettings.keybindingsJson,
        logger
      ),
    ]);
  }

  if (localSettings?.snippets && localSettings.snippets.length > 0) {
    await Promise.all(
      localSettings.snippets.flatMap((snippet) => {
        const userSnippetPath = path.join(userSnippetsDir, snippet.name);
        const profileSnippetPath = path.join(profileSnippetsDir, snippet.name);
        return [
          safeWriteFile(userSnippetPath, snippet.content, logger),
          safeWriteFile(profileSnippetPath, snippet.content, logger),
        ];
      })
    );
  }
}

// Store the last detection result for error reporting
let lastDetectionResult: VSCodeDetectionResult | null = null;

/**
 * Get the VS Code executable path using comprehensive detection.
 * Uses the vscodeDetection module for reliable cross-platform detection.
 */
async function getVSCodeExecutable(logger: Logger) {
  logger.info("Attempting to resolve VS Code CLI executable for serve-web.");

  const result = await getVSCodeInstallation(logger);

  if (!result.found || !result.installation) {
    // Log detailed information for debugging
    logger.warn(formatDetectionResultForUser(result));
    // Store the last detection result for retrieval by other modules
    lastDetectionResult = result;
    return null;
  }

  const executable = result.installation.executablePath;
  logger.info(
    `Resolved VS Code CLI executable: ${executable} (${result.installation.variant} via ${result.installation.source})`
  );

  // Verify it's actually executable
  try {
    if (process.platform !== "win32") {
      await access(executable, fsConstants.X_OK);
    }
    lastDetectionResult = result;
    return executable;
  } catch (error) {
    logger.error(`VS Code CLI at ${executable} is not executable:`, error);
    return null;
  }
}

/**
 * Get the last VS Code detection result for error reporting purposes.
 * This allows socket handlers to provide detailed error messages to users.
 */
export function getLastVSCodeDetectionResult(): VSCodeDetectionResult | null {
  return lastDetectionResult;
}

/**
 * Force re-detection of VS Code (useful after user installs it)
 */
export async function refreshVSCodeDetection(
  logger: Logger
): Promise<VSCodeDetectionResult> {
  clearVSCodeDetectionCache();

  const result = await getVSCodeInstallation(logger, { forceRefresh: true });
  lastDetectionResult = result;

  return result;
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
