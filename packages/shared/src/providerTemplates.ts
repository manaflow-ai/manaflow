/**
 * Provider Templates for Dynamic Agent Configuration
 *
 * This module enables adding new models without code changes or rebuilds.
 * Instead of hardcoding every model variant, we define templates per provider
 * and dynamically construct AgentConfig objects at runtime.
 */

import type {
  AgentConfig,
  AgentConfigApiKeys,
} from "./agentConfig";
import type {
  EnvironmentContext,
  EnvironmentResult,
} from "./providers/common/environment-result";

// API Keys
import {
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  OPENROUTER_API_KEY,
  GEMINI_API_KEY,
  AMP_API_KEY,
  CURSOR_API_KEY,
  MODEL_STUDIO_API_KEY,
  XAI_API_KEY,
  CLAUDE_CODE_OAUTH_TOKEN,
} from "./apiKeys";

// Environment functions - lazy loaded to avoid browser bundling issues
// We use dynamic imports in the template's environment function

// Completion detectors
import { startCodexCompletionDetector } from "./providers/openai/completion-detector";
import { startClaudeCompletionDetector } from "./providers/anthropic/completion-detector";
import { startGeminiCompletionDetector } from "./providers/gemini/completion-detector";
import { startOpenCodeCompletionDetector } from "./providers/opencode/completion-detector";
import { startQwenCompletionDetector } from "./providers/qwen/completion-detector";

// Check requirements
import { checkOpenAIRequirements } from "./providers/openai/check-requirements";
import { checkClaudeRequirements } from "./providers/anthropic/check-requirements";
import { checkGeminiRequirements } from "./providers/gemini/check-requirements";
import { checkOpencodeRequirements } from "./providers/opencode/check-requirements";
import { checkAmpRequirements } from "./providers/amp/check-requirements";
import { checkCursorRequirements } from "./providers/cursor/check-requirements";
import {
  checkQwenModelStudioRequirements,
  checkQwenOpenRouterRequirements,
} from "./providers/qwen/check-requirements";

// Telemetry
import { GEMINI_TELEMETRY_OUTFILE_TEMPLATE } from "./providers/gemini/telemetry";

// Constants
import {
  OPENCODE_HTTP_HOST,
  OPENCODE_HTTP_PORT,
} from "./providers/opencode/environment";

/**
 * Reasoning levels supported by codex models
 */
const CODEX_REASONING_LEVELS = ["xhigh", "high", "medium", "low", "minimal"] as const;
type CodexReasoningLevel = (typeof CODEX_REASONING_LEVELS)[number];

/**
 * Sub-provider configurations for opencode
 * Maps the provider prefix in the model string to API keys and environment
 */
interface OpencodeSubProvider {
  apiKeys: AgentConfigApiKeys;
  environmentVariant: "default" | "skipAuth" | "xai";
}

const OPENCODE_SUB_PROVIDERS: Record<string, OpencodeSubProvider> = {
  anthropic: {
    apiKeys: [ANTHROPIC_API_KEY],
    environmentVariant: "default",
  },
  openai: {
    apiKeys: [OPENAI_API_KEY],
    environmentVariant: "default",
  },
  xai: {
    apiKeys: [XAI_API_KEY],
    environmentVariant: "xai",
  },
  openrouter: {
    apiKeys: [OPENROUTER_API_KEY],
    environmentVariant: "default",
  },
  // Self-hosted/free models (like grok-code)
  opencode: {
    apiKeys: [],
    environmentVariant: "skipAuth",
  },
};

/**
 * Parse a codex model name to extract the base model and optional reasoning level
 * Examples:
 *   "gpt-5.2-codex-high" -> { model: "gpt-5.2-codex", reasoning: "high" }
 *   "gpt-5.2" -> { model: "gpt-5.2", reasoning: undefined }
 *   "o3" -> { model: "o3", reasoning: undefined }
 */
function parseCodexModel(modelPart: string): {
  model: string;
  reasoning: CodexReasoningLevel | undefined;
} {
  // Check if the model ends with a reasoning level
  for (const level of CODEX_REASONING_LEVELS) {
    if (modelPart.endsWith(`-${level}`)) {
      return {
        model: modelPart.slice(0, -(level.length + 1)), // Remove "-{level}"
        reasoning: level,
      };
    }
  }
  return { model: modelPart, reasoning: undefined };
}

/**
 * Parse an opencode model name to extract sub-provider and model
 * Examples:
 *   "anthropic/claude-sonnet-4" -> { subProvider: "anthropic", model: "anthropic/claude-sonnet-4" }
 *   "openai/gpt-5" -> { subProvider: "openai", model: "openai/gpt-5" }
 *   "grok-code" -> { subProvider: "opencode", model: "opencode/grok-code" }
 */
function parseOpencodeModel(modelPart: string): {
  subProvider: string;
  model: string;
} {
  const parts = modelPart.split("/");
  const firstPart = parts[0];
  if (parts.length >= 2 && firstPart) {
    // Format: "anthropic/claude-sonnet-4" or "openrouter/moonshotai/kimi-k2"
    return { subProvider: firstPart, model: modelPart };
  }
  // Legacy format without sub-provider prefix - treat as self-hosted
  return { subProvider: "opencode", model: `opencode/${modelPart}` };
}

/**
 * Build a codex AgentConfig dynamically
 */
async function buildCodexConfig(
  name: string,
  modelPart: string
): Promise<AgentConfig> {
  const { model, reasoning } = parseCodexModel(modelPart);

  const args = [
    "@openai/codex@latest",
    "--model",
    model,
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
  ];

  if (reasoning) {
    args.push("-c", `model_reasoning_effort="${reasoning}"`);
  }

  args.push("$PROMPT");

  // Import environment function lazily
  const { getOpenAIEnvironment } = await import("./providers/openai/environment");

  return {
    name,
    command: "bunx",
    args,
    environment: getOpenAIEnvironment,
    checkRequirements: checkOpenAIRequirements,
    apiKeys: [OPENAI_API_KEY],
    completionDetector: startCodexCompletionDetector,
  };
}

/**
 * Build a claude AgentConfig dynamically
 */
async function buildClaudeConfig(
  name: string,
  modelPart: string
): Promise<AgentConfig> {
  // Import environment and applyApiKeys lazily
  const { getClaudeEnvironment, CLAUDE_KEY_ENV_VARS_TO_UNSET } = await import(
    "./providers/anthropic/environment"
  );

  const applyClaudeApiKeys: NonNullable<AgentConfig["applyApiKeys"]> = async (
    keys
  ) => {
    const oauthToken = keys.CLAUDE_CODE_OAUTH_TOKEN;
    const unsetEnv = [...CLAUDE_KEY_ENV_VARS_TO_UNSET];

    if (oauthToken && oauthToken.trim().length > 0) {
      if (!unsetEnv.includes("ANTHROPIC_API_KEY")) {
        unsetEnv.push("ANTHROPIC_API_KEY");
      }
      return {
        env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken },
        unsetEnv,
      };
    }

    return { unsetEnv };
  };

  return {
    name,
    command: "bunx",
    args: [
      "@anthropic-ai/claude-code@latest",
      "--model",
      modelPart, // Use the model name directly (e.g., "claude-opus-4-5")
      "--dangerously-skip-permissions",
      "--ide",
      "$PROMPT",
    ],
    environment: getClaudeEnvironment,
    checkRequirements: checkClaudeRequirements,
    apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
    applyApiKeys: applyClaudeApiKeys,
    completionDetector: startClaudeCompletionDetector,
  };
}

/**
 * Build a gemini AgentConfig dynamically
 */
async function buildGeminiConfig(
  name: string,
  modelPart: string
): Promise<AgentConfig> {
  const { getGeminiEnvironment } = await import("./providers/gemini/environment");

  return {
    name,
    command: "bunx",
    args: [
      "@google/gemini-cli@latest",
      "--model",
      modelPart, // e.g., "gemini-2.5-pro"
      "--yolo",
      "--telemetry",
      "--telemetry-target=local",
      "--telemetry-otlp-endpoint=",
      `--telemetry-outfile=${GEMINI_TELEMETRY_OUTFILE_TEMPLATE}`,
      "--telemetry-log-prompts",
      "--prompt-interactive",
      "$PROMPT",
    ],
    environment: getGeminiEnvironment,
    apiKeys: [GEMINI_API_KEY],
    checkRequirements: checkGeminiRequirements,
    completionDetector: startGeminiCompletionDetector,
  };
}

/**
 * Build an opencode AgentConfig dynamically
 */
async function buildOpencodeConfig(
  name: string,
  modelPart: string
): Promise<AgentConfig> {
  const { subProvider, model } = parseOpencodeModel(modelPart);

  const subProviderConfig = OPENCODE_SUB_PROVIDERS[subProvider];
  if (!subProviderConfig) {
    throw new Error(
      `Unknown opencode sub-provider: ${subProvider}. Valid sub-providers: ${Object.keys(OPENCODE_SUB_PROVIDERS).join(", ")}`
    );
  }

  // Import the appropriate environment function
  const {
    getOpencodeEnvironment,
    getOpencodeEnvironmentSkipAuth,
    getOpencodeEnvironmentWithXai,
  } = await import("./providers/opencode/environment");

  let environmentFn: (ctx: EnvironmentContext) => Promise<EnvironmentResult>;
  switch (subProviderConfig.environmentVariant) {
    case "skipAuth":
      environmentFn = getOpencodeEnvironmentSkipAuth;
      break;
    case "xai":
      environmentFn = getOpencodeEnvironmentWithXai;
      break;
    default:
      environmentFn = getOpencodeEnvironment;
  }

  const baseArgs = [
    "opencode-ai@latest",
    "--hostname",
    OPENCODE_HTTP_HOST,
    "--port",
    String(OPENCODE_HTTP_PORT),
  ];

  return {
    name,
    command: "bunx",
    args: [...baseArgs, "--model", model],
    environment: environmentFn,
    checkRequirements: checkOpencodeRequirements,
    apiKeys: subProviderConfig.apiKeys,
    completionDetector: startOpenCodeCompletionDetector,
  };
}

/**
 * Build an amp AgentConfig dynamically
 */
async function buildAmpConfig(
  name: string,
  modelPart: string
): Promise<AgentConfig> {
  const { getAmpEnvironment } = await import("./providers/amp/environment");

  const args = [
    "--prompt-env",
    "CMUX_PROMPT",
    "--",
    "bunx",
    "@sourcegraph/amp@latest",
    "--dangerously-allow-all",
  ];

  // Add model-specific flags
  if (modelPart === "gpt-5") {
    args.push("--try-gpt5");
  }

  return {
    name,
    command: "prompt-wrapper",
    args,
    environment: getAmpEnvironment,
    apiKeys: [AMP_API_KEY],
    checkRequirements: checkAmpRequirements,
    // No completion detector for AMP - handled by proxy
  };
}

/**
 * Build a cursor AgentConfig dynamically
 */
async function buildCursorConfig(
  name: string,
  modelPart: string
): Promise<AgentConfig> {
  const { getCursorEnvironment } = await import("./providers/cursor/environment");

  return {
    name,
    command: "/root/.local/bin/cursor-agent",
    args: ["--force", "--model", modelPart, "$PROMPT"],
    environment: getCursorEnvironment,
    checkRequirements: checkCursorRequirements,
    apiKeys: [CURSOR_API_KEY],
    waitForString: "Ready",
  };
}

/**
 * Build a qwen AgentConfig dynamically
 */
async function buildQwenConfig(
  name: string,
  modelPart: string
): Promise<AgentConfig> {
  // Determine which backend to use based on model name
  const isOpenRouter = modelPart.includes(":free") || modelPart.startsWith("qwen/");

  const {
    getQwenOpenRouterEnvironment,
    getQwenModelStudioEnvironment,
  } = await import("./providers/qwen/environment");

  const args = [
    "@qwen-code/qwen-code",
    "--telemetry",
    "--telemetry-target=local",
    "--telemetry-otlp-endpoint=",
    "--telemetry-outfile=/tmp/qwen-telemetry-$CMUX_TASK_RUN_ID.log",
    "--telemetry-log-prompts",
    "--prompt-interactive",
    "$PROMPT",
    "--yolo",
    "--model",
    modelPart,
  ];

  if (isOpenRouter) {
    return {
      name,
      command: "bunx",
      args,
      environment: getQwenOpenRouterEnvironment,
      apiKeys: [{ ...OPENROUTER_API_KEY, mapToEnvVar: "OPENAI_API_KEY" }],
      checkRequirements: checkQwenOpenRouterRequirements,
      completionDetector: startQwenCompletionDetector,
    };
  }

  return {
    name,
    command: "bunx",
    args,
    environment: getQwenModelStudioEnvironment,
    apiKeys: [{ ...MODEL_STUDIO_API_KEY, mapToEnvVar: "OPENAI_API_KEY" }],
    checkRequirements: checkQwenModelStudioRequirements,
    completionDetector: startQwenCompletionDetector,
  };
}

/**
 * Provider prefix to builder function mapping
 */
const PROVIDER_BUILDERS: Record<
  string,
  (name: string, modelPart: string) => Promise<AgentConfig>
> = {
  codex: buildCodexConfig,
  claude: buildClaudeConfig,
  gemini: buildGeminiConfig,
  opencode: buildOpencodeConfig,
  amp: buildAmpConfig,
  cursor: buildCursorConfig,
  qwen: buildQwenConfig,
};

/**
 * List of supported provider prefixes
 */
export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_BUILDERS);

/**
 * Check if a model name matches a supported provider pattern
 */
export function isSupportedProvider(name: string): boolean {
  const provider = name.split("/")[0];
  return provider !== undefined && provider in PROVIDER_BUILDERS;
}

/**
 * Build an AgentConfig dynamically from a model name
 *
 * @param name - Full model name like "codex/gpt-5.2-high" or "opencode/anthropic/sonnet-4"
 * @returns AgentConfig or null if the provider is not supported
 */
export async function buildAgentConfig(name: string): Promise<AgentConfig | null> {
  const parts = name.split("/");
  const provider = parts[0];
  const modelPart = parts.slice(1).join("/");

  if (!provider) {
    return null;
  }

  const builder = PROVIDER_BUILDERS[provider];
  if (!builder) {
    return null;
  }

  // Special case: "amp" without model part should still work
  if (provider === "amp" && modelPart === "") {
    return builder(name, "");
  }

  if (!modelPart) {
    return null;
  }

  return builder(name, modelPart);
}

/**
 * Resolve an AgentConfig by name using dynamic resolution
 *
 * @param name - Model name to resolve (e.g., "codex/gpt-5.2-high", "opencode/anthropic/claude-4")
 * @returns AgentConfig or null if provider is not supported
 */
export async function resolveAgentConfig(
  name: string
): Promise<AgentConfig | null> {
  return buildAgentConfig(name);
}
