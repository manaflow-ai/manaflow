import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";
import {
  getMemoryStartupCommand,
  getMemorySeedFiles,
  getMemoryProtocolInstructions,
  getProjectContextFile,
  getCrossToolSymlinkCommands,
} from "../../agent-memory-protocol";

/**
 * Apply API keys for OpenAI Codex.
 *
 * Priority order:
 * 1. CODEX_AUTH_JSON - If provided, inject as ~/.codex/auth.json (OAuth tokens from `codex login`)
 * 2. OPENAI_API_KEY - Fallback if no auth.json, injected as environment variable
 *
 * When CODEX_AUTH_JSON is provided, OPENAI_API_KEY is ignored since auth.json
 * contains OAuth tokens that Codex CLI prefers over API keys.
 */
export function applyCodexApiKeys(
  keys: Record<string, string>
): Partial<EnvironmentResult> {
  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};

  const authJson = keys.CODEX_AUTH_JSON;
  if (authJson) {
    // Validate that it's valid JSON before injecting
    try {
      JSON.parse(authJson);
      files.push({
        destinationPath: "$HOME/.codex/auth.json",
        contentBase64: Buffer.from(authJson).toString("base64"),
        mode: "600",
      });
      // Don't inject OPENAI_API_KEY when auth.json is provided
      return { files, env };
    } catch {
      console.warn("CODEX_AUTH_JSON is not valid JSON, skipping injection");
    }
  }

  // Fallback: inject OPENAI_API_KEY as environment variable
  // Also set CODEX_API_KEY to the same value to skip the sign-in screen
  // (OPENAI_API_KEY only pre-fills the input, CODEX_API_KEY bypasses it entirely)
  const openaiKey = keys.OPENAI_API_KEY;
  if (openaiKey) {
    env.OPENAI_API_KEY = openaiKey;
    env.CODEX_API_KEY = openaiKey;
  }

  return { files, env };
}

// Keys to filter from user's config.toml (controlled by cmux CLI args)
const FILTERED_CONFIG_KEYS = ["model", "model_reasoning_effort"] as const;
const CODEX_NOTIFY_LINE = `notify = ["/root/lifecycle/codex-notify.sh"]`;
const CODEX_SANDBOX_MODE_LINE = `sandbox_mode = "danger-full-access"`;
const CODEX_ASK_FOR_APPROVAL_LINE = `ask_for_approval = "never"`;

// Strip top-level keys that are controlled by cmux CLI args
// Matches: key = "value" or key = 'value' or key = bareword (entire line)
export function stripFilteredConfigKeys(toml: string): string {
  let result = toml;
  for (const key of FILTERED_CONFIG_KEYS) {
    // Match key at start of line (not in a section), with any value format
    // Handles: model = "gpt-5.2", model_reasoning_effort = "high", etc.
    result = result.replace(new RegExp(`^${key}\\s*=\\s*.*$`, "gm"), "");
  }
  // Clean up multiple blank lines
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function ensureCodexDefaults(toml: string): string {
  const hasNotify = /(^|\n)\s*notify\s*=/.test(toml);
  const hasSandboxMode = /(^|\n)\s*sandbox_mode\s*=/.test(toml);
  const hasAskForApproval = /(^|\n)\s*ask_for_approval\s*=/.test(toml);

  // Always force ask_for_approval to "never" for unattended runs
  // Even if user has a different value in their host config, we override it
  // Handles double-quoted, single-quoted, and bare TOML values
  let result = toml;
  if (hasAskForApproval) {
    // Replace the entire ask_for_approval line with our required value
    result = result.replace(
      /(^|\n)\s*ask_for_approval\s*=\s*.*/g,
      `$1${CODEX_ASK_FOR_APPROVAL_LINE}`
    );
  }

  if (hasNotify && hasSandboxMode && hasAskForApproval) {
    return result;
  }

  const defaults: string[] = [];
  if (!hasNotify) {
    defaults.push(CODEX_NOTIFY_LINE);
  }
  if (!hasSandboxMode) {
    defaults.push(CODEX_SANDBOX_MODE_LINE);
  }
  if (!hasAskForApproval) {
    defaults.push(CODEX_ASK_FOR_APPROVAL_LINE);
  }

  return result ? `${defaults.join("\n")}\n${result}` : defaults.join("\n");
}

// Target model for migrations - change this when a new latest model is released
const MIGRATION_TARGET_MODEL = "gpt-5.3-codex";

// Models to migrate (legacy models and models without model_reasoning_effort support)
const MODELS_TO_MIGRATE = [
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5",
  "o3",
  "o4-mini",
  "gpt-4.1",
  "gpt-5-codex",
  "gpt-5-codex-mini",
];

// Generate model_migrations TOML section
function generateModelMigrations(): string {
  const migrations = MODELS_TO_MIGRATE.map(
    (model) => `"${model}" = "${MIGRATION_TARGET_MODEL}"`
  ).join("\n");
  return `\n[notice.model_migrations]\n${migrations}\n`;
}

// Strip existing [notice.model_migrations] section from TOML
// Regex matches from [notice.model_migrations] to next section header or EOF
function stripModelMigrations(toml: string): string {
  return toml.replace(/\[notice\.model_migrations\][\s\S]*?(?=\n\[|$)/g, "");
}

function stripManagedMemoryMcpBlock(toml: string): string {
  // First, strip any nested subtables under devsh-memory (e.g., [mcp_servers.devsh-memory.env])
  let result = toml.replace(
    /\n?\[mcp_servers(?:\.devsh-memory|\."devsh-memory")\.[^\]]+\][\s\S]*?(?=\n\[|$)/g,
    ""
  );
  // Then strip the main devsh-memory block
  result = result.replace(
    /\n?\[mcp_servers(?:\.devsh-memory|\."devsh-memory")\][\s\S]*?(?=\n\[|$)/g,
    ""
  );
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function getMemoryMcpServerConfig(agentName?: string): string {
  const args = agentName
    ? ["-y", "devsh-memory-mcp@latest", "--agent", agentName]
    : ["-y", "devsh-memory-mcp@latest"];

  return `[mcp_servers.devsh-memory]
type = "stdio"
command = "npx"
args = ${JSON.stringify(args)}`;
}

function ensureManagedMemoryMcpServerConfig(toml: string, agentName?: string): string {
  const normalizedToml = stripManagedMemoryMcpBlock(toml);
  const managedMemoryBlock = getMemoryMcpServerConfig(agentName);

  if (!normalizedToml) {
    return `${managedMemoryBlock}\n`;
  }

  return `${normalizedToml}\n\n${managedMemoryBlock}\n`;
}

export async function getOpenAIEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  // These must be lazy since configs are imported into the browser
  const { Buffer } = await import("node:buffer");

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];

  // useHostConfig is safe for desktop/Electron apps where the host IS the user's machine.
  // For server deployments, this should be false to prevent credential leakage.
  const useHostConfig = ctx.useHostConfig ?? false;

  // Get home directory only if we need to read host config
  let homeDir: string | undefined;
  let readFile: ((path: string, encoding: "utf-8") => Promise<string>) | undefined;
  if (useHostConfig) {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    readFile = fs.readFile;
    homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  }

  // Ensure .codex directory exists
  startupCommands.push("mkdir -p ~/.codex");
  // Ensure notify sink starts clean for this run; write JSONL under /root/lifecycle
  startupCommands.push("mkdir -p /root/lifecycle");
  // Clear stale session state from prior runs to prevent cross-run resume bugs
  startupCommands.push(
    "rm -f /root/workspace/.cmux/tmp/codex-turns.jsonl /root/workspace/codex-turns.jsonl /root/workspace/logs/codex-turns.jsonl /tmp/codex-turns.jsonl /tmp/cmux/codex-turns.jsonl /root/lifecycle/codex-turns.jsonl /root/lifecycle/codex-session-id.txt /root/lifecycle/codex-done.txt || true"
  );

  // Add a small notify handler script that appends the payload to JSONL and marks completion
  // Note: crown/complete is called by the worker after the completion detector resolves,
  // NOT here. The notify hook fires on every turn, not just task completion.
  // Memory sync runs on every turn (idempotent upsert captures intermediate progress).
  const notifyScript = `#!/usr/bin/env sh
set -eu
echo "$1" >> /root/lifecycle/codex-turns.jsonl
# Extract thread id from Codex payload and persist for explicit resume.
# Prefer jq for valid JSON; fall back to regex when payload contains multiline text.
THREAD_ID=$(printf '%s' "$1" | jq -r '.thread_id // ."thread-id" // empty' 2>/dev/null || true)
if [ -z "$THREAD_ID" ]; then
  THREAD_ID=$(printf '%s' "$1" | grep -oE '"thread-id":"[^"]+"|"thread_id":"[^"]+"' | head -1 | cut -d'"' -f4 || true)
fi
if [ -n "$THREAD_ID" ]; then
  echo "$THREAD_ID" > /root/lifecycle/codex-session-id.txt
fi
# Sync memory files to Convex (best-effort, idempotent upsert)
/root/lifecycle/memory/sync.sh >> /root/lifecycle/memory-sync.log 2>&1 || true
touch /root/lifecycle/codex-done.txt /root/lifecycle/done.txt
`;
  files.push({
    destinationPath: "/root/lifecycle/codex-notify.sh",
    contentBase64: Buffer.from(notifyScript).toString("base64"),
    mode: "755",
  });

  const resumeScript = `#!/usr/bin/env sh
set -eu
SESSION_ID_FILE="/root/lifecycle/codex-session-id.txt"

if [ -f "$SESSION_ID_FILE" ]; then
  THREAD_ID="$(cat "$SESSION_ID_FILE")"
  if [ -n "$THREAD_ID" ]; then
    exec codex resume "$THREAD_ID"
  fi
fi

echo "No session to resume"
exit 1
`;
  files.push({
    destinationPath: "/root/lifecycle/codex-resume.sh",
    contentBase64: Buffer.from(resumeScript).toString("base64"),
    mode: "755",
  });

  // Copy auth.json from host .codex directory (desktop mode only)
  // For server mode, auth.json is injected separately via applyCodexApiKeys()
  // using credentials from the user's data vault (CODEX_AUTH_JSON or OPENAI_API_KEY).
  if (useHostConfig && readFile && homeDir) {
    try {
      const authContent = await readFile(`${homeDir}/.codex/auth.json`, "utf-8");
      files.push({
        destinationPath: "$HOME/.codex/auth.json",
        contentBase64: Buffer.from(authContent).toString("base64"),
        mode: "600",
      });
    } catch (error) {
      console.warn("Failed to read .codex/auth.json:", error);
    }
  }

  // Apply provider override if present (custom proxy like AnyRouter)
  if (ctx.providerConfig?.isOverridden && ctx.providerConfig.baseUrl) {
    env.OPENAI_BASE_URL = ctx.providerConfig.baseUrl;
  }

  // Copy instructions.md from host and append memory protocol instructions (desktop mode)
  // For server mode, only include memory protocol instructions to avoid leaking host-specific content
  let instructionsContent = "";
  if (useHostConfig && readFile && homeDir) {
    try {
      instructionsContent = await readFile(
        `${homeDir}/.codex/instructions.md`,
        "utf-8"
      );
    } catch (error) {
      // File doesn't exist, start with empty content
      console.warn("Failed to read .codex/instructions.md:", error);
    }
  }
  const fullInstructions =
    instructionsContent +
    (instructionsContent ? "\n\n" : "") +
    getMemoryProtocolInstructions();
  files.push({
    destinationPath: "$HOME/.codex/instructions.md",
    contentBase64: Buffer.from(fullInstructions).toString("base64"),
    mode: "644",
  });

  // Memory MCP server configuration for Codex
  // Uses npm package for latest version without snapshot rebuild
  // -y auto-confirms install, @latest ensures fresh version
  const memoryMcpServerConfig = getMemoryMcpServerConfig(ctx.agentName);

  // Build config.toml - merge with host config in desktop mode, or generate clean in server mode
  let toml: string;
  if (useHostConfig && readFile && homeDir) {
    try {
      const rawToml = await readFile(`${homeDir}/.codex/config.toml`, "utf-8");
      // Filter out keys controlled by cmux CLI args (model, model_reasoning_effort)
      const filteredToml = stripFilteredConfigKeys(rawToml);
      toml = ensureCodexDefaults(filteredToml);
      // Strip existing model_migrations and append managed ones
      toml = stripModelMigrations(toml) + generateModelMigrations();
      // Always normalize and replace the managed memory MCP block.
      toml = ensureManagedMemoryMcpServerConfig(toml, ctx.agentName);
    } catch (_error) {
      // No host config.toml; create minimal one
      toml = `${ensureCodexDefaults("")}${generateModelMigrations()}${memoryMcpServerConfig}\n`;
    }
  } else {
    // Server mode: generate clean config without host-specific settings
    toml = `${ensureCodexDefaults("")}${generateModelMigrations()}${memoryMcpServerConfig}\n`;
  }
  files.push({
    destinationPath: `$HOME/.codex/config.toml`,
    contentBase64: Buffer.from(toml).toString("base64"),
    mode: "644",
  });

  // Add agent memory protocol support
  startupCommands.push(getMemoryStartupCommand());
  files.push(
    ...getMemorySeedFiles(
      ctx.taskRunId,
      ctx.previousKnowledge,
      ctx.previousMailbox,
      ctx.orchestrationOptions
    )
  );

  // Create cross-tool symlinks for shared instructions
  // If Claude's CLAUDE.md exists, link it to ~/.codex/AGENTS.md
  // This allows all tools to share the same instructions
  startupCommands.push(...getCrossToolSymlinkCommands());

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

  return { files, env, startupCommands };
}
