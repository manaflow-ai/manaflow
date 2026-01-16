import type { AgentConfig, EnvironmentResult } from "../../agentConfig";
import { ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN } from "../../apiKeys";
import { checkClaudeRequirements } from "./check-requirements";
import { startClaudeCompletionDetector } from "./completion-detector";
import {
  CLAUDE_KEY_ENV_VARS_TO_UNSET,
  getClaudeEnvironment,
} from "./environment";

/**
 * Create applyApiKeys function for Claude agents.
 *
 * Priority:
 * 1. OAuth token (user-provided) - uses user's Claude subscription
 * 2. Anthropic API key (user-provided) - uses user's API key
 * 3. Platform proxy endpoint (fallback) - server handles auth via Cloudflare AI Gateway
 */
function createApplyClaudeApiKeys(): NonNullable<AgentConfig["applyApiKeys"]> {
  return async (keys): Promise<Partial<EnvironmentResult>> => {
    // Base env vars to unset (prevent conflicts)
    const unsetEnv = [...CLAUDE_KEY_ENV_VARS_TO_UNSET];

    const oauthToken = keys.CLAUDE_CODE_OAUTH_TOKEN;
    const anthropicKey = keys.ANTHROPIC_API_KEY;

    // Priority 1: OAuth token (user pays via their subscription)
    if (oauthToken && oauthToken.trim().length > 0) {
      // Ensure ANTHROPIC_API_KEY is in the unset list
      if (!unsetEnv.includes("ANTHROPIC_API_KEY")) {
        unsetEnv.push("ANTHROPIC_API_KEY");
      }
      return {
        env: {
          CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
        },
        unsetEnv,
      };
    }

    // Priority 2: User-provided Anthropic API key
    if (anthropicKey && anthropicKey.trim().length > 0) {
      return {
        env: {
          ANTHROPIC_API_KEY: anthropicKey,
        },
        unsetEnv,
      };
    }

    // Priority 3: Platform proxy endpoint (fallback)
    // Sandbox calls server endpoint which adds API key and forwards to Cloudflare AI Gateway
    return {
      env: {
        ANTHROPIC_API_KEY: "sk_placeholder_cmux_anthropic_api_key",
      },
      unsetEnv,
    };
  };
}

export const CLAUDE_OPUS_4_5_CONFIG: AgentConfig = {
  name: "claude/opus-4.5",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--model",
    "claude-opus-4-5",
    "--ide",
    "$PROMPT",
  ],
  environment: getClaudeEnvironment,
  checkRequirements: checkClaudeRequirements,
  // User-configurable: OAuth token (preferred) or API key; falls back to platform proxy
  apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
  applyApiKeys: createApplyClaudeApiKeys(),
  completionDetector: startClaudeCompletionDetector,
};

export const CLAUDE_SONNET_4_5_CONFIG: AgentConfig = {
  name: "claude/sonnet-4.5",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--model",
    "claude-sonnet-4-5",
    "--ide",
    "$PROMPT",
  ],
  environment: getClaudeEnvironment,
  checkRequirements: checkClaudeRequirements,
  // User-configurable: OAuth token (preferred) or API key; falls back to platform proxy
  apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
  applyApiKeys: createApplyClaudeApiKeys(),
  completionDetector: startClaudeCompletionDetector,
};

export const CLAUDE_HAIKU_4_5_CONFIG: AgentConfig = {
  name: "claude/haiku-4.5",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--model",
    "claude-haiku-4-5",
    "--ide",
    "$PROMPT",
  ],
  environment: getClaudeEnvironment,
  checkRequirements: checkClaudeRequirements,
  // User-configurable: OAuth token (preferred) or API key; falls back to platform proxy
  apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
  applyApiKeys: createApplyClaudeApiKeys(),
  completionDetector: startClaudeCompletionDetector,
};
