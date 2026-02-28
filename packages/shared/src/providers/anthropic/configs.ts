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
 *    - If user explicitly provides the placeholder key 'sk_placeholder_cmux_anthropic_api_key',
 *      the request will be routed to platform Bedrock proxy
 * 3. No fallback - users must provide credentials to use Claude agents
 */
export function createApplyClaudeApiKeys(): NonNullable<AgentConfig["applyApiKeys"]> {
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

    // Priority 2: User-provided Anthropic API key (includes explicit placeholder key for platform credits)
    if (anthropicKey && anthropicKey.trim().length > 0) {
      return {
        env: {
          ANTHROPIC_API_KEY: anthropicKey,
        },
        unsetEnv,
      };
    }

    // No credentials provided - return empty env (will fail requirements check)
    return {
      env: {},
      unsetEnv,
    };
  };
}

// Factory types and implementation
interface ClaudeModelSpec {
  nameSuffix: string;
  modelApiId: string;
}

function createClaudeConfig(spec: ClaudeModelSpec): AgentConfig {
  return {
    name: `claude/${spec.nameSuffix}`,
    command: "claude",
    args: [
      "--allow-dangerously-skip-permissions",
      "--dangerously-skip-permissions",
      "--model",
      spec.modelApiId,
      "--ide",
      "$PROMPT",
    ],
    environment: getClaudeEnvironment,
    checkRequirements: checkClaudeRequirements,
    apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
    applyApiKeys: createApplyClaudeApiKeys(),
    completionDetector: startClaudeCompletionDetector,
  };
}

const CLAUDE_MODEL_SPECS: ClaudeModelSpec[] = [
  { nameSuffix: "opus-4.6", modelApiId: "claude-opus-4-6" },
  { nameSuffix: "opus-4.5", modelApiId: "claude-opus-4-5-20251101" },
  { nameSuffix: "sonnet-4.5", modelApiId: "claude-sonnet-4-5-20250929" },
  { nameSuffix: "haiku-4.5", modelApiId: "claude-haiku-4-5-20251001" },
];

export const CLAUDE_AGENT_CONFIGS: AgentConfig[] =
  CLAUDE_MODEL_SPECS.map(createClaudeConfig);
