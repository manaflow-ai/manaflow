import type { AgentConfig } from "../../agentConfig";
import {
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  OPENROUTER_API_KEY,
  XAI_API_KEY,
} from "../../apiKeys";
import { checkOpencodeRequirements } from "./check-requirements";
import { startOpenCodeCompletionDetector } from "./completion-detector";

import {
  getOpencodeEnvironment,
  getOpencodeEnvironmentSkipAuth,
  getOpencodeEnvironmentWithXai,
  OPENCODE_HTTP_HOST,
  OPENCODE_HTTP_PORT,
} from "./environment";

// Common args for all opencode configs - starts HTTP server for prompt submission
const OPENCODE_BASE_ARGS = [
  "opencode-ai@latest",
  "--hostname",
  OPENCODE_HTTP_HOST,
  "--port",
  String(OPENCODE_HTTP_PORT),
];

export const OPENCODE_GROK_CODE_CONFIG: AgentConfig = {
  name: "opencode/grok-code",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "opencode/grok-code"],
  environment: getOpencodeEnvironmentSkipAuth,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_SONNET_CONFIG: AgentConfig = {
  name: "opencode/sonnet-4",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "anthropic/claude-sonnet-4-20250514"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [ANTHROPIC_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_OPUS_CONFIG: AgentConfig = {
  name: "opencode/opus-4",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "anthropic/claude-opus-4-20250514"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [ANTHROPIC_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_KIMI_K2_CONFIG: AgentConfig = {
  name: "opencode/kimi-k2",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openrouter/moonshotai/kimi-k2"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENROUTER_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_QWEN3_CODER_CONFIG: AgentConfig = {
  name: "opencode/qwen3-coder",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openrouter/qwen/qwen3-coder"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [ANTHROPIC_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GLM_Z1_32B_FREE_CONFIG: AgentConfig = {
  name: "opencode/glm-4.5",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openrouter/z-ai/glm-4.5"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENROUTER_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_O3_PRO_CONFIG: AgentConfig = {
  name: "opencode/o3-pro",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openai/o3-pro"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GPT_5_CONFIG: AgentConfig = {
  name: "opencode/gpt-5",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openai/gpt-5"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GPT_5_MINI_CONFIG: AgentConfig = {
  name: "opencode/gpt-5-mini",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openai/gpt-5-mini"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GPT_5_NANO_CONFIG: AgentConfig = {
  name: "opencode/gpt-5-nano",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openai/gpt-5-nano"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GPT_OSS_120B_CONFIG: AgentConfig = {
  name: "opencode/gpt-oss-120b",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openrouter/openai/gpt-oss-120b"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENROUTER_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GPT_OSS_20B_CONFIG: AgentConfig = {
  name: "opencode/gpt-oss-20b",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "openrouter/openai/gpt-oss-20b"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [OPENROUTER_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_OPUS_4_1_20250805_CONFIG: AgentConfig = {
  name: "opencode/opus-4.1-20250805",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "anthropic/claude-opus-4-1-20250805"],
  environment: getOpencodeEnvironment,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [ANTHROPIC_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GROK_4_1_FAST_CONFIG: AgentConfig = {
  name: "opencode/grok-4-1-fast",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "xai/grok-4-1-fast"],
  environment: getOpencodeEnvironmentWithXai,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [XAI_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};

export const OPENCODE_GROK_4_1_FAST_NON_REASONING_CONFIG: AgentConfig = {
  name: "opencode/grok-4-1-fast-non-reasoning",
  command: "bunx",
  args: [...OPENCODE_BASE_ARGS, "--model", "xai/grok-4-1-fast-non-reasoning"],
  environment: getOpencodeEnvironmentWithXai,
  checkRequirements: checkOpencodeRequirements,
  apiKeys: [XAI_API_KEY],
  completionDetector: startOpenCodeCompletionDetector,
};
