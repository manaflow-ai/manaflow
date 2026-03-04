import type { AgentConfig } from "../../agentConfig";
import { CODEX_AUTH_JSON, OPENAI_API_KEY } from "../../apiKeys";
import { checkOpenAIRequirements } from "./check-requirements";
// Lazy-load Node-only completion detector to avoid bundling fs in browser
import { startCodexCompletionDetector } from "./completion-detector";
import { applyCodexApiKeys, getOpenAIEnvironment } from "./environment";

// Factory types and helpers
type CodexReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal";

interface CodexModelSpec {
  model: string;
  reasoningEffort?: CodexReasoningEffort;
}

function createCodexConfig(spec: CodexModelSpec): AgentConfig {
  const nameSuffix = spec.reasoningEffort
    ? `${spec.model}-${spec.reasoningEffort}`
    : spec.model;
  const reasoningArgs: string[] = spec.reasoningEffort
    ? ["-c", `model_reasoning_effort="${spec.reasoningEffort}"`]
    : [];
  return {
    name: `codex/${nameSuffix}`,
    command: "codex",
    args: [
      "--model",
      spec.model,
      "--sandbox",
      "danger-full-access",
      ...reasoningArgs,
      "$PROMPT",
    ],
    environment: getOpenAIEnvironment,
    checkRequirements: checkOpenAIRequirements,
    apiKeys: [OPENAI_API_KEY, CODEX_AUTH_JSON],
    applyApiKeys: applyCodexApiKeys,
    completionDetector: startCodexCompletionDetector,
  };
}

// Helper to generate a model with standard reasoning efforts (xhigh, high, medium, low) plus base
const STANDARD_EFFORTS: CodexReasoningEffort[] = ["xhigh", "high", "medium", "low"];

function codexWithEfforts(
  model: string,
  efforts: CodexReasoningEffort[] = STANDARD_EFFORTS
): CodexModelSpec[] {
  return [...efforts.map((e) => ({ model, reasoningEffort: e })), { model }];
}

// Spec array preserves exact ordering of the original CODEX_AGENT_CONFIGS export
const CODEX_MODEL_SPECS: CodexModelSpec[] = [
  // gpt-5.3-codex family (xhigh, high, medium, low, base)
  ...codexWithEfforts("gpt-5.3-codex"),
  // gpt-5.2-codex family (xhigh, high, medium, low, base)
  ...codexWithEfforts("gpt-5.2-codex"),
  // gpt-5.1-codex-max family (xhigh, high, medium, low, base)
  ...codexWithEfforts("gpt-5.1-codex-max"),
  // gpt-5.1-codex with high reasoning, then base
  { model: "gpt-5.1-codex", reasoningEffort: "high" },
  { model: "gpt-5.1-codex" },
  // gpt-5.1-codex-mini (base only)
  { model: "gpt-5.1-codex-mini" },
  // gpt-5.1 (base only)
  { model: "gpt-5.1" },
  // gpt-5.2 family (base, xhigh, high, medium, low) - note different order
  { model: "gpt-5.2" },
  { model: "gpt-5.2", reasoningEffort: "xhigh" },
  { model: "gpt-5.2", reasoningEffort: "high" },
  { model: "gpt-5.2", reasoningEffort: "medium" },
  { model: "gpt-5.2", reasoningEffort: "low" },
];

export const CODEX_AGENT_CONFIGS: AgentConfig[] =
  CODEX_MODEL_SPECS.map(createCodexConfig);
