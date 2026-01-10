import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";
import {
  BEDROCK_CLAUDE_SONNET_45_MODEL_ID,
  BEDROCK_CLAUDE_OPUS_45_MODEL_ID,
  BEDROCK_CLAUDE_HAIKU_45_MODEL_ID,
  BEDROCK_AWS_REGION,
} from "../../utils/anthropic";

export const CLAUDE_KEY_ENV_VARS_TO_UNSET = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_API_KEY",
];

// Bedrock model ID mapping for each supported Claude model
export const BEDROCK_MODEL_IDS: Record<string, string> = {
  "claude-sonnet-4-5-20250929": BEDROCK_CLAUDE_SONNET_45_MODEL_ID,
  "claude-opus-4-5": BEDROCK_CLAUDE_OPUS_45_MODEL_ID,
  "claude-haiku-4-5-20251001": BEDROCK_CLAUDE_HAIKU_45_MODEL_ID,
};

/**
 * Factory function to create model-specific Claude environment functions.
 * This allows each model to have its own Bedrock model ID for fallback.
 */
export function createClaudeEnvironment(modelId: string) {
  return async (ctx: EnvironmentContext): Promise<EnvironmentResult> => {
    return getClaudeEnvironmentInternal(ctx, modelId);
  };
}

async function getClaudeEnvironmentInternal(
  ctx: EnvironmentContext,
  modelId: string,
): Promise<EnvironmentResult> {
  // These must be lazy since configs are imported into the browser
  // const { exec } = await import("node:child_process");
  // const { promisify } = await import("node:util");
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { Buffer } = await import("node:buffer");
  // const execAsync = promisify(exec);

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];
  const claudeLifecycleDir = "/root/lifecycle/claude";

  // Prepare .claude.json
  try {
    // Try to read existing .claude.json, or create a new one
    let existingConfig = {};
    try {
      const content = await readFile(`${homedir()}/.claude.json`, "utf-8");
      existingConfig = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid, start fresh
    }

    const config = {
      ...existingConfig,
      projects: {
        "/root/workspace": {
          allowedTools: [],
          history: [],
          mcpContextUris: [],
          mcpServers: {},
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
          hasTrustDialogAccepted: true,
          projectOnboardingSeenCount: 0,
          hasClaudeMdExternalIncludesApproved: false,
          hasClaudeMdExternalIncludesWarningShown: false,
        },
      },
      isQualifiedForDataSharing: false,
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
      hasAcknowledgedCostThreshold: true,
    };

    files.push({
      destinationPath: "$HOME/.claude.json",
      contentBase64: Buffer.from(JSON.stringify(config, null, 2)).toString(
        "base64",
      ),
      mode: "644",
    });
  } catch (error) {
    console.warn("Failed to prepare .claude.json:", error);
  }

  // // Try to get credentials and prepare .credentials.json
  // let credentialsAdded = false;
  // try {
  //   // First try Claude Code-credentials (preferred)
  //   const execResult = await execAsync(
  //     "security find-generic-password -a $USER -w -s 'Claude Code-credentials'",
  //   );
  //   const credentialsText = execResult.stdout.trim();

  //   // Validate that it's valid JSON with claudeAiOauth
  //   const credentials = JSON.parse(credentialsText);
  //   if (credentials.claudeAiOauth) {
  //     files.push({
  //       destinationPath: "$HOME/.claude/.credentials.json",
  //       contentBase64: Buffer.from(credentialsText).toString("base64"),
  //       mode: "600",
  //     });
  //     credentialsAdded = true;
  //   }
  // } catch {
  //   // noop
  // }

  // // If no credentials file was created, try to use API key via helper script (avoid env var to prevent prompts)
  // if (!credentialsAdded) {
  //   try {
  //     const execResult = await execAsync(
  //       "security find-generic-password -a $USER -w -s 'Claude Code'",
  //     );
  //     const apiKey = execResult.stdout.trim();

  //     // Write the key to a persistent location with strict perms
  //     files.push({
  //       destinationPath: claudeApiKeyPath,
  //       contentBase64: Buffer.from(apiKey).toString("base64"),
  //       mode: "600",
  //     });
  //     credentialsAdded = true;
  //   } catch {
  //     console.warn("No Claude API key found in keychain");
  //   }
  // }

  // Ensure directories exist
  startupCommands.unshift("mkdir -p ~/.claude");
  startupCommands.push(`mkdir -p ${claudeLifecycleDir}`);

  // Clean up any previous Claude completion markers
  // This should run before the agent starts to ensure clean state
  startupCommands.push(
    "rm -f /root/lifecycle/claude-complete-* 2>/dev/null || true",
  );

  // Create the stop hook script in /root/lifecycle (outside git repo)
  const stopHookScript = `#!/bin/bash
# Claude Code stop hook for cmux task completion detection
# This script is called when Claude Code finishes responding

LOG_FILE="/root/lifecycle/claude-hook.log"

echo "[CMUX Stop Hook] Script started at $(date)" >> "$LOG_FILE"
echo "[CMUX Stop Hook] CMUX_TASK_RUN_ID=\${CMUX_TASK_RUN_ID}" >> "$LOG_FILE"
echo "[CMUX Stop Hook] CMUX_CALLBACK_URL=\${CMUX_CALLBACK_URL}" >> "$LOG_FILE"

if [ -n "\${CMUX_TASK_RUN_JWT}" ] && [ -n "\${CMUX_TASK_RUN_ID}" ] && [ -n "\${CMUX_CALLBACK_URL}" ]; then
  (
    # Call crown/complete for status updates
    echo "[CMUX Stop Hook] Calling crown/complete..." >> "$LOG_FILE"
    curl -s -X POST "\${CMUX_CALLBACK_URL}/api/crown/complete" \\
      -H "Content-Type: application/json" \\
      -H "x-cmux-token: \${CMUX_TASK_RUN_JWT}" \\
      -d "{\\"taskRunId\\": \\"\${CMUX_TASK_RUN_ID}\\", \\"exitCode\\": 0}" \\
      >> "$LOG_FILE" 2>&1
    echo "" >> "$LOG_FILE"

    # Call notifications endpoint for user notification
    echo "[CMUX Stop Hook] Calling notifications/agent-stopped..." >> "$LOG_FILE"
    curl -s -X POST "\${CMUX_CALLBACK_URL}/api/notifications/agent-stopped" \\
      -H "Content-Type: application/json" \\
      -H "x-cmux-token: \${CMUX_TASK_RUN_JWT}" \\
      -d "{\\"taskRunId\\": \\"\${CMUX_TASK_RUN_ID}\\"}" \\
      >> "$LOG_FILE" 2>&1
    echo "" >> "$LOG_FILE"
    echo "[CMUX Stop Hook] API calls completed at $(date)" >> "$LOG_FILE"
  ) &
else
  echo "[CMUX Stop Hook] Missing required env vars, skipping API calls" >> "$LOG_FILE"
fi

# Write completion marker for backward compatibility
if [ -n "\${CMUX_TASK_RUN_ID}" ]; then
  COMPLETE_MARKER="/root/lifecycle/claude-complete-\${CMUX_TASK_RUN_ID}"
  echo "[CMUX Stop Hook] Creating completion marker at \${COMPLETE_MARKER}" >> "$LOG_FILE"
  mkdir -p "$(dirname "$COMPLETE_MARKER")"
  touch "$COMPLETE_MARKER"
fi

# Also log to stderr for visibility
echo "[CMUX Stop Hook] Task completed for task run ID: \${CMUX_TASK_RUN_ID:-unknown}" >&2

# Always allow Claude to stop (don't block)
exit 0`;

  // Add stop hook script to files array (like Codex does) to ensure it's created before git init
  files.push({
    destinationPath: `${claudeLifecycleDir}/stop-hook.sh`,
    contentBase64: Buffer.from(stopHookScript).toString("base64"),
    mode: "755",
  });

  // Check if user has provided an OAuth token (preferred) or their own API key
  // Priority:
  // 1. OAuth token - Direct to Anthropic (user pays via their subscription)
  // 2. User's ANTHROPIC_API_KEY - Direct to Anthropic (user pays via their API key)
  // 3. Neither - Fall back to AWS Bedrock (cmux pays)
  // IMPORTANT: We NEVER use cmux's platform-provided ANTHROPIC_API_KEY for Claude Code tasks
  const hasOAuthToken =
    ctx.apiKeys?.CLAUDE_CODE_OAUTH_TOKEN &&
    ctx.apiKeys.CLAUDE_CODE_OAUTH_TOKEN.trim().length > 0;
  const hasUserAnthropicApiKey =
    ctx.apiKeys?.ANTHROPIC_API_KEY &&
    ctx.apiKeys.ANTHROPIC_API_KEY.trim().length > 0;

  // Determine auth mode
  const useOAuth = hasOAuthToken;
  const useUserApiKey = !hasOAuthToken && hasUserAnthropicApiKey;
  const useBedrock = !hasOAuthToken && !hasUserAnthropicApiKey;

  // If OAuth token is provided, write it to /etc/claude-code/env
  // The wrapper scripts (claude, npx, bunx) source this file before running claude-code
  // This is necessary because CLAUDE_CODE_OAUTH_TOKEN must be set as an env var
  // BEFORE claude-code starts (it checks OAuth early, before loading settings.json)
  if (useOAuth) {
    const oauthEnvContent = `CLAUDE_CODE_OAUTH_TOKEN=${ctx.apiKeys?.CLAUDE_CODE_OAUTH_TOKEN}\n`;
    files.push({
      destinationPath: "/etc/claude-code/env",
      contentBase64: Buffer.from(oauthEnvContent).toString("base64"),
      mode: "600", // Restrictive permissions for the token
    });
  }

  // When using Bedrock, we need to set up AWS credentials and the Bedrock model ID
  // Get the Bedrock model ID for this model from the mapping
  const bedrockModelId = BEDROCK_MODEL_IDS[modelId];
  if (useBedrock && !bedrockModelId) {
    console.warn(
      `[Claude Environment] No Bedrock model ID mapping for model: ${modelId}. ` +
        `Available mappings: ${Object.keys(BEDROCK_MODEL_IDS).join(", ")}`,
    );
  }

  // For Bedrock, we need to pass AWS credentials to the sandbox
  // These are read from the server's environment
  const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const awsSessionToken = process.env.AWS_SESSION_TOKEN;

  // Build the env vars to pass to the sandbox
  const sandboxEnv: Record<string, string> = {};

  if (useBedrock) {
    // Enable Bedrock mode
    sandboxEnv.CLAUDE_CODE_USE_BEDROCK = "1";
    sandboxEnv.AWS_REGION = BEDROCK_AWS_REGION;

    // Pass AWS credentials if available
    if (awsAccessKeyId) {
      sandboxEnv.AWS_ACCESS_KEY_ID = awsAccessKeyId;
    }
    if (awsSecretAccessKey) {
      sandboxEnv.AWS_SECRET_ACCESS_KEY = awsSecretAccessKey;
    }
    if (awsSessionToken) {
      sandboxEnv.AWS_SESSION_TOKEN = awsSessionToken;
    }

    // Override the model to use the Bedrock model ID
    if (bedrockModelId) {
      sandboxEnv.ANTHROPIC_MODEL = bedrockModelId;
    }
  }

  // Create settings.json with hooks configuration
  // Priority:
  // 1. OAuth token - Direct to Anthropic (user pays via their subscription)
  // 2. User's ANTHROPIC_API_KEY - Route through cmux proxy for tracking (user pays via their API key)
  // 3. Neither - AWS Bedrock (cmux pays via Bedrock, credentials handled via env vars)
  // IMPORTANT: We NEVER use cmux's platform-provided ANTHROPIC_API_KEY
  const settingsConfig: Record<string, unknown> = {
    alwaysThinkingEnabled: true,
    // When user provides their own API key, set it in settings.json
    // The proxy will pass this key through to Anthropic (not use platform's key)
    ...(useUserApiKey ? { anthropicApiKey: ctx.apiKeys?.ANTHROPIC_API_KEY } : {}),
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `${claudeLifecycleDir}/stop-hook.sh`,
            },
          ],
        },
      ],
      Notification: [
        {
          matcher: ".*",
          hooks: [
            {
              type: "command",
              command: `${claudeLifecycleDir}/stop-hook.sh`,
            },
          ],
        },
      ],
    },
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: 0,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 1,
      // When user provides their own API key, route through cmux proxy for tracking
      // OAuth users go direct to Anthropic, Bedrock users don't need proxy
      ...(useUserApiKey
        ? {
            ANTHROPIC_BASE_URL: "https://www.cmux.dev/api/anthropic",
            ANTHROPIC_CUSTOM_HEADERS: `x-cmux-token:${ctx.taskRunJwt}`,
          }
        : {}),
    },
  };

  // If no OAuth token, ensure we don't use any cached credentials
  // This prevents using stale/leftover credentials from previous sessions
  if (!useOAuth) {
    // Clear any existing credentials file by writing an empty one
    files.push({
      destinationPath: "$HOME/.claude/.credentials.json",
      contentBase64: Buffer.from("{}").toString("base64"),
      mode: "600",
    });
  }

  // Add settings.json to files array
  files.push({
    destinationPath: "$HOME/.claude/settings.json",
    contentBase64: Buffer.from(
      JSON.stringify(settingsConfig, null, 2),
    ).toString("base64"),
    mode: "644",
  });

  // Log the files for debugging
  startupCommands.push(
    `echo '[CMUX] Created Claude hook files in /root/lifecycle:' && ls -la ${claudeLifecycleDir}/`,
  );
  startupCommands.push(
    "echo '[CMUX] Settings directory in ~/.claude:' && ls -la /root/.claude/",
  );

  return {
    files,
    env: { ...env, ...sandboxEnv },
    startupCommands,
    unsetEnv: [...CLAUDE_KEY_ENV_VARS_TO_UNSET],
  };
}

// Legacy export for backwards compatibility - uses a default model
// New code should use createClaudeEnvironment with a specific model ID
export async function getClaudeEnvironment(
  ctx: EnvironmentContext,
): Promise<EnvironmentResult> {
  // Default to opus-4.5 for backwards compatibility
  return getClaudeEnvironmentInternal(ctx, "claude-opus-4-5");
}
