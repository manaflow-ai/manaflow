import type { AgentConfig } from "../../agentConfig";
import { OPENAI_API_KEY } from "../../apiKeys";
import { checkOpenAIRequirements } from "./check-requirements";
// Lazy-load Node-only completion detector to avoid bundling fs in browser
import { startCodexCompletionDetector } from "./completion-detector";
import { getOpenAIEnvironment } from "./environment";

export const CODEX_GPT_5_1_CODEX_MAX_XHIGH_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex-max-xhigh",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex-max",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="xhigh"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CODEX_MAX_HIGH_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex-max-high",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex-max",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="high"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CODEX_MAX_MEDIUM_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex-max-medium",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex-max",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="medium"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CODEX_MAX_LOW_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex-max-low",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex-max",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="low"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CODEX_MAX_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex-max",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex-max",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CODEX_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CODEX_MINI_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex-mini",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex-mini",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_1_CODEX_HIGH_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.1-codex-high",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.1-codex",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="high"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_CONFIG: AgentConfig = {
  name: "codex/gpt-5",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_HIGH_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5-high",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="high"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_MEDIUM_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5-medium",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="medium"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_LOW_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5-low",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="low"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_MINIMAL_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5-minimal",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="minimal"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_O3_CONFIG: AgentConfig = {
  name: "codex/o3",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "o3",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_O4_MINI_CONFIG: AgentConfig = {
  name: "codex/o4-mini",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "o4-mini",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_4_1_CONFIG: AgentConfig = {
  name: "codex/gpt-4.1",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-4.1",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_CODEX_MINI_CONFIG: AgentConfig = {
  name: "codex/gpt-5-codex-mini",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5-codex-mini",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_CODEX_LOW_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5-codex-low",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5-codex",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="low"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_CODEX_MEDIUM_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5-codex-medium",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5-codex",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="medium"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_CODEX_HIGH_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5-codex-high",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5-codex",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="high"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_2_CONFIG: AgentConfig = {
  name: "codex/gpt-5.2",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.2",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_2_LOW_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.2-low",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.2",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="low"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_2_MEDIUM_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.2-medium",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.2",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="medium"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};

export const CODEX_GPT_5_2_HIGH_REASONING_CONFIG: AgentConfig = {
  name: "codex/gpt-5.2-high",
  command: "bunx",
  args: [
    "@openai/codex@latest",
    "--model",
    "gpt-5.2",
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "-c",
    'model_reasoning_effort="high"',
    "$PROMPT",
  ],
  environment: getOpenAIEnvironment,
  checkRequirements: checkOpenAIRequirements,
  apiKeys: [OPENAI_API_KEY],
  completionDetector: startCodexCompletionDetector,
};
