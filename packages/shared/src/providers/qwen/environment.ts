import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";
import {
  getMemoryStartupCommand,
  getMemorySeedFiles,
  getMemoryProtocolInstructions,
  getProjectContextFile,
} from "../../agent-memory-protocol";

// Prepare Qwen CLI environment for OpenAI-compatible API key mode.
// We previously supported the Qwen OAuth device flow, but cmux now uses
// API keys via DashScope or OpenRouter configured in Settings.
async function makeQwenEnvironment(
  ctx: EnvironmentContext,
  defaultBaseUrl: string | null,
  defaultModel: string | null
): Promise<EnvironmentResult> {
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { Buffer } = await import("node:buffer");

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];

  // Ensure .qwen directory exists
  startupCommands.push("mkdir -p ~/.qwen");

  // Clean up any old Qwen telemetry files from previous runs
  // The actual telemetry path will be set by the agent spawner with the task ID
  startupCommands.push("rm -f /tmp/qwen-telemetry-*.log 2>/dev/null || true");

  // Merge/update ~/.qwen/settings.json with selectedAuthType = "openai"
  const qwenDir = join(homedir(), ".qwen");
  const settingsPath = join(qwenDir, "settings.json");

  type QwenSettings = {
    selectedAuthType?: string;
    useExternalAuth?: boolean;
    [key: string]: unknown;
  };

  let settings: QwenSettings = {};
  try {
    const content = await readFile(settingsPath, "utf-8");
    try {
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === "object") {
        settings = parsed as QwenSettings;
      }
    } catch {
      // Ignore invalid JSON and recreate with defaults
    }
  } catch {
    // File might not exist; we'll create it
  }

  // Force OpenAI-compatible auth so the CLI doesn't ask interactively
  settings.selectedAuthType = "openai";
  // Ensure we don't try an external OAuth flow in ephemeral sandboxes
  if (settings.useExternalAuth === undefined) {
    settings.useExternalAuth = false;
  }

  const mergedContent = JSON.stringify(settings, null, 2) + "\n";
  files.push({
    destinationPath: "$HOME/.qwen/settings.json",
    contentBase64: Buffer.from(mergedContent).toString("base64"),
    mode: "644",
  });

  // Set sensible default base URL for the OpenAI-compatible API if none provided via settings
  if (defaultBaseUrl) env.OPENAI_BASE_URL = defaultBaseUrl;
  if (defaultModel) env.OPENAI_MODEL = defaultModel;

  // Provider override takes precedence over default base URL
  if (ctx.providerConfig?.isOverridden && ctx.providerConfig.baseUrl) {
    env.OPENAI_BASE_URL = ctx.providerConfig.baseUrl;
  }

  // Add agent memory protocol support
  startupCommands.push(getMemoryStartupCommand());
  files.push(...getMemorySeedFiles(ctx.taskRunId, ctx.previousKnowledge, ctx.previousMailbox, ctx.orchestrationOptions));

  // Inject GitHub Projects context if task is linked to a project item (Phase 5)
  if (ctx.githubProjectContext) {
    files.push(
      getProjectContextFile({
        ...ctx.githubProjectContext,
        taskRunJwt: ctx.taskRunJwt,
        callbackUrl: ctx.callbackUrl,
      }),
    );
  }

  // Add QWEN.md with memory protocol instructions for the project
  const qwenMdContent = `# cmux Project Instructions

${getMemoryProtocolInstructions()}
`;
  files.push({
    destinationPath: "/root/workspace/QWEN.md",
    contentBase64: Buffer.from(qwenMdContent).toString("base64"),
    mode: "644",
  });

  return { files, env, startupCommands };
}

// OpenAI-compatible mode without provider defaults.
// Base URL and model are supplied via env (Settings):
//  - DashScope: set OPENAI_API_KEY and (optionally) OPENAI_BASE_URL + OPENAI_MODEL
//  - OpenRouter: set OPENROUTER_API_KEY (server maps to OPENAI_API_KEY) and optional OPENAI_MODEL
export async function getQwenOpenRouterEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  // Hardcode OpenRouter compatible endpoint and default Qwen model.
  return makeQwenEnvironment(
    ctx,
    "https://openrouter.ai/api/v1",
    "qwen/qwen3-coder:free"
  );
}

export async function getQwenModelStudioEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  // Hardcode DashScope Intl (ModelStudio) endpoint and qwen3-coder-plus model.
  return makeQwenEnvironment(
    ctx,
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "qwen3-coder-plus"
  );
}
