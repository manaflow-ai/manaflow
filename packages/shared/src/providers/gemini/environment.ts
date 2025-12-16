import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";
import { getGeminiTelemetryPath } from "./telemetry";

type GeminiModelSettings = {
  skipNextSpeakerCheck?: boolean;
  [key: string]: unknown;
};

type GeminiTelemetrySettings = {
  outfile?: string;
  target?: string;
  otlpEndpoint?: string;
  logPrompts?: boolean;
  [key: string]: unknown;
};

type GeminiSettings = {
  selectedAuthType?: string;
  model?: GeminiModelSettings;
  telemetry?: GeminiTelemetrySettings;
  [key: string]: unknown;
};

export async function getGeminiEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  // These must be lazy since configs are imported into the browser
  const { readFile, stat } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { Buffer } = await import("node:buffer");
  const { join } = await import("node:path");

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];
  const telemetryOutfile = getGeminiTelemetryPath(ctx.taskRunId);

  // Ensure .gemini directory exists
  startupCommands.push("mkdir -p ~/.gemini");
  startupCommands.push("mkdir -p ~/.gemini/commands");

  // Clean up any old Gemini telemetry files from previous runs
  // The actual telemetry path will be set by the agent spawner with the task ID
  startupCommands.push("rm -f /tmp/gemini-telemetry-*.log 2>/dev/null || true");

  const geminiDir = join(homedir(), ".gemini");

  // Helper function to safely copy file
  async function copyFile(
    filename: string,
    destinationPath: string,
    mode: string = "644"
  ) {
    try {
      const content = await readFile(join(geminiDir, filename), "utf-8");
      files.push({
        destinationPath,
        contentBase64: Buffer.from(content).toString("base64"),
        mode,
      });
      return true;
    } catch (error) {
      // Only log if it's not a "file not found" error
      if (
        error instanceof Error &&
        "code" in error &&
        error.code !== "ENOENT"
      ) {
        console.warn(`Failed to read ${filename}:`, error);
      }
      return false;
    }
  }

  // 1. Settings file (required) — ensure selectedAuthType is set
  try {
    const settingsPath = join(geminiDir, "settings.json");
    let settingsContent: string | undefined;
    try {
      settingsContent = await readFile(settingsPath, "utf-8");
    } catch (error) {
      // If missing, we'll create a new one
      const isNodeErr = (err: unknown): err is { code?: string } =>
        typeof err === "object" && err !== null && "code" in err;
      if (
        !(error instanceof Error && isNodeErr(error) && error.code === "ENOENT")
      ) {
        console.warn("Failed to read settings.json:", error);
      }
    }

    let settings: GeminiSettings = {};
    if (settingsContent) {
      try {
        const parsed = JSON.parse(settingsContent) as unknown;
        if (parsed && typeof parsed === "object") {
          settings = parsed as GeminiSettings;
        }
      } catch (e) {
        console.warn(
          "Invalid JSON in settings.json; recreating with defaults.",
          e
        );
      }
    }

    // Force the desired auth type
    settings.selectedAuthType = "gemini-api-key";

    // Ensure telemetry is routed to our per-task logfile.
    const telemetrySettings =
      settings.telemetry && typeof settings.telemetry === "object"
        ? (settings.telemetry as GeminiTelemetrySettings)
        : {};
    settings.telemetry = {
      ...telemetrySettings,
      outfile: telemetryOutfile,
      target: "local",
      otlpEndpoint: "",
      logPrompts: true,
    };

    // Force skipNextSpeakerCheck=false so completion events are emitted.
    const modelSettings =
      settings.model && typeof settings.model === "object"
        ? (settings.model as GeminiModelSettings)
        : {};
    settings.model = {
      ...modelSettings,
      skipNextSpeakerCheck: false,
    };

    const mergedContent = JSON.stringify(settings, null, 2) + "\n";
    files.push({
      destinationPath: "$HOME/.gemini/settings.json",
      contentBase64: Buffer.from(mergedContent).toString("base64"),
      mode: "644",
    });
  } catch (e) {
    console.warn("Unexpected error preparing settings.json:", e);
  }

  // 2. OAuth tokens (if exists)
  await copyFile("oauth_creds.json", "$HOME/.gemini/oauth_creds.json", "600");
  await copyFile(
    "mcp-oauth-tokens.json",
    "$HOME/.gemini/mcp-oauth-tokens.json",
    "600"
  );

  // 3. Google account authentication
  await copyFile(
    "google_accounts.json",
    "$HOME/.gemini/google_accounts.json",
    "600"
  );
  await copyFile("google_account_id", "$HOME/.gemini/google_account_id");

  // 4. Installation and user IDs
  await copyFile("installation_id", "$HOME/.gemini/installation_id");
  await copyFile("user_id", "$HOME/.gemini/user_id");

  // 5. Check for .env files
  const envPaths = [join(geminiDir, ".env"), join(homedir(), ".env")];

  for (const envPath of envPaths) {
    try {
      const content = await readFile(envPath, "utf-8");
      const filename =
        envPath === join(geminiDir, ".env") ? ".gemini/.env" : ".env";
      files.push({
        destinationPath: `$HOME/${filename}`,
        contentBase64: Buffer.from(content).toString("base64"),
        mode: "600",
      });
      break; // Use first found .env file
    } catch {
      // Continue to next path
    }
  }

  // 6. Check for commands directory
  try {
    const commandsDir = join(geminiDir, "commands");
    const stats = await stat(commandsDir);
    if (stats.isDirectory()) {
      // Create commands directory in destination
      startupCommands.push("mkdir -p ~/.gemini/commands");
      // Note: We're not copying the contents of commands directory
      // as it may contain many files and we don't know what's needed
    }
  } catch {
    // Commands directory doesn't exist
  }

  return { files, env, startupCommands };
}
