import type { ModelConfig } from "./run-simple-anthropic-review";

type SearchParamsRecord = {
  [key: string]: string | string[] | undefined;
};

export const HEATMAP_MODEL_QUERY_KEY = "model";
export const HEATMAP_MODEL_FINETUNE_QUERY_VALUE = "finetune";
export const HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE = "cmux-heatmap-1";
export const HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE = "cmux-heatmap-2";
export const HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE = "anthropic-opus-4-5";
export const HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE = "anthropic";
export type HeatmapModelQueryValue =
  | typeof HEATMAP_MODEL_FINETUNE_QUERY_VALUE
  | typeof HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE
  | typeof HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE
  | typeof HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE
  | typeof HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE;

const LEGACY_HEATMAP_MODEL_PARAM_MAP: Record<string, HeatmapModelQueryValue> = {
  ft0: HEATMAP_MODEL_FINETUNE_QUERY_VALUE,
  ft1: HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE,
};

const FINE_TUNED_OPENAI_MODEL_ID =
  "ft:gpt-4.1-mini-2025-04-14:lawrence:cmux-heatmap-sft:CZW6Lc77";
const FINE_TUNED_OPENAI_DENSE_MODEL_ID =
  "ft:gpt-4.1-mini-2025-04-14:lawrence:cmux-heatmap-dense:CaaqvYVO";
const FINE_TUNED_OPENAI_DENSE_V2_MODEL_ID =
  "ft:gpt-4.1-2025-04-14:lawrence:cmux-heatmap-dense-4-1:CahKn54r";
const ANTHROPIC_OPUS_41_MODEL_ID = "claude-opus-4-1-20250805";
const ANTHROPIC_OPUS_45_MODEL_ID = "claude-opus-4-5";

function createFineTunedOpenAiConfig(): ModelConfig {
  return {
    provider: "openai",
    model: FINE_TUNED_OPENAI_MODEL_ID,
  };
}

function createFineTunedDenseOpenAiConfig(): ModelConfig {
  return {
    provider: "openai",
    model: FINE_TUNED_OPENAI_DENSE_MODEL_ID,
  };
}

function createFineTunedDenseV2OpenAiConfig(): ModelConfig {
  return {
    provider: "openai",
    model: FINE_TUNED_OPENAI_DENSE_V2_MODEL_ID,
  };
}

function createAnthropicOpus41Config(): ModelConfig {
  return {
    provider: "anthropic",
    model: ANTHROPIC_OPUS_41_MODEL_ID,
  };
}

function createAnthropicOpus45Config(): ModelConfig {
  return {
    provider: "anthropic",
    model: ANTHROPIC_OPUS_45_MODEL_ID,
  };
}

export function getDefaultHeatmapModelConfig(): ModelConfig {
  return createAnthropicOpus45Config();
}

export function getHeatmapModelConfigForSelection(
  selection: HeatmapModelQueryValue
): ModelConfig {
  if (selection === HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE) {
    return createAnthropicOpus45Config();
  }
  if (selection === HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE) {
    return createFineTunedDenseV2OpenAiConfig();
  }
  if (selection === HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE) {
    return createAnthropicOpus41Config();
  }
  if (selection === HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE) {
    return createFineTunedDenseOpenAiConfig();
  }
  return createFineTunedOpenAiConfig();
}

export function normalizeHeatmapModelQueryValue(
  raw: string | null | undefined
): HeatmapModelQueryValue {
  if (typeof raw !== "string") {
    return HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE) {
    return HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE) {
    return HEATMAP_MODEL_DENSE_V2_FINETUNE_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE) {
    return HEATMAP_MODEL_ANTHROPIC_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE) {
    return HEATMAP_MODEL_DENSE_FINETUNE_QUERY_VALUE;
  }
  if (normalized === HEATMAP_MODEL_FINETUNE_QUERY_VALUE) {
    return HEATMAP_MODEL_FINETUNE_QUERY_VALUE;
  }
  return HEATMAP_MODEL_ANTHROPIC_OPUS_45_QUERY_VALUE;
}

function extractRecordValue(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function resolveModelSelectionFromRecord(
  searchParams: SearchParamsRecord
): HeatmapModelQueryValue {
  for (const paramKey of Object.keys(LEGACY_HEATMAP_MODEL_PARAM_MAP)) {
    if (paramKey in searchParams) {
      return LEGACY_HEATMAP_MODEL_PARAM_MAP[paramKey];
    }
  }
  const raw = extractRecordValue(searchParams[HEATMAP_MODEL_QUERY_KEY]);
  return normalizeHeatmapModelQueryValue(raw ?? null);
}

function resolveModelSelectionFromUrlSearchParams(
  searchParams: URLSearchParams
): HeatmapModelQueryValue {
  for (const paramKey of Object.keys(LEGACY_HEATMAP_MODEL_PARAM_MAP)) {
    if (searchParams.has(paramKey)) {
      return LEGACY_HEATMAP_MODEL_PARAM_MAP[paramKey];
    }
  }
  return normalizeHeatmapModelQueryValue(
    searchParams.get(HEATMAP_MODEL_QUERY_KEY)
  );
}

export function parseModelConfigFromRecord(
  searchParams: SearchParamsRecord
): ModelConfig | undefined {
  const selection = resolveModelSelectionFromRecord(searchParams);
  return getHeatmapModelConfigForSelection(selection);
}

export function parseModelConfigFromUrlSearchParams(
  searchParams: URLSearchParams
): ModelConfig | undefined {
  const selection = resolveModelSelectionFromUrlSearchParams(searchParams);
  return getHeatmapModelConfigForSelection(selection);
}
