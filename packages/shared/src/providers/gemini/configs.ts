import type { AgentConfig } from "../../agentConfig";
import { GEMINI_API_KEY } from "../../apiKeys";
import { checkGeminiRequirements } from "./check-requirements";
import { startGeminiCompletionDetector } from "./completion-detector";
import { GEMINI_TELEMETRY_OUTFILE_TEMPLATE } from "./telemetry";
import { getGeminiEnvironment } from "./environment";

export const GEMINI_3_PRO_PREVIEW_CONFIG: AgentConfig = {
  name: "gemini/3-pro-preview",
  command: "bunx",
  args: [
    "@google/gemini-cli@latest",
    "--model",
    "gemini-3-pro-preview",
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

export const GEMINI_3_1_PRO_PREVIEW_CONFIG: AgentConfig = {
  name: "gemini/3.1-pro-preview",
  command: "bunx",
  args: [
    "@google/gemini-cli@latest",
    "--model",
    "gemini-3.1-pro-preview",
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

export const GEMINI_FLASH_CONFIG: AgentConfig = {
  name: "gemini/2.5-flash",
  command: "bunx",
  args: [
    "@google/gemini-cli@latest",
    "--model",
    "gemini-2.5-flash",
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

export const GEMINI_PRO_CONFIG: AgentConfig = {
  name: "gemini/2.5-pro",
  command: "bunx",
  args: [
    "@google/gemini-cli@latest",
    "--model",
    "gemini-2.5-pro",
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
