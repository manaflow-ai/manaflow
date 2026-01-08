import type { ModelConfig } from "./run-simple-anthropic-review";

type SearchParamsRecord = {
  [key: string]: string | string[] | undefined;
};

export const HEATMAP_MODEL_QUERY_KEY = "model";
export const HEATMAP_LANGUAGE_QUERY_KEY = "lang";

// Supported languages for tooltip localization
export const TOOLTIP_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "hi", label: "हिन्दी" },
  { value: "bn", label: "বাংলা" },
  { value: "te", label: "తెలుగు" },
  { value: "mr", label: "मराठी" },
  { value: "ta", label: "தமிழ்" },
  { value: "gu", label: "ગુજરાતી" },
  { value: "kn", label: "ಕನ್ನಡ" },
  { value: "ml", label: "മലയാളം" },
  { value: "pa", label: "ਪੰਜਾਬੀ" },
  { value: "ar", label: "العربية" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "th", label: "ไทย" },
  { value: "id", label: "Bahasa Indonesia" },
] as const;

export type TooltipLanguageValue =
  (typeof TOOLTIP_LANGUAGE_OPTIONS)[number]["value"];

export const DEFAULT_TOOLTIP_LANGUAGE: TooltipLanguageValue = "en";

// Map browser language codes to supported tooltip languages
// Handles both full codes (e.g., "zh-Hans") and base codes (e.g., "zh" -> "zh-Hans")
const BROWSER_LANGUAGE_MAP: Record<string, TooltipLanguageValue> = {
  // Direct mappings for supported languages
  en: "en",
  "zh-hans": "zh-Hans",
  "zh-hant": "zh-Hant",
  "zh-cn": "zh-Hans",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-sg": "zh-Hans",
  zh: "zh-Hans", // Default Chinese to Simplified
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  pt: "pt",
  ru: "ru",
  hi: "hi",
  bn: "bn",
  te: "te",
  mr: "mr",
  ta: "ta",
  gu: "gu",
  kn: "kn",
  ml: "ml",
  pa: "pa",
  ar: "ar",
  vi: "vi",
  th: "th",
  id: "id",
};

/**
 * Detects the user's preferred language from the browser and maps it to a supported tooltip language.
 * Falls back to English if no supported language is detected.
 * This should only be called on the client side.
 */
export function detectBrowserLanguage(): TooltipLanguageValue {
  if (typeof navigator === "undefined") {
    return DEFAULT_TOOLTIP_LANGUAGE;
  }

  // Get browser languages in order of preference
  const browserLanguages = navigator.languages ?? [navigator.language];

  for (const lang of browserLanguages) {
    if (!lang) continue;

    const normalized = lang.toLowerCase();

    // Try exact match first (e.g., "zh-Hans", "zh-TW")
    if (normalized in BROWSER_LANGUAGE_MAP) {
      return BROWSER_LANGUAGE_MAP[normalized];
    }

    // Try base language code (e.g., "en-US" -> "en")
    const baseCode = normalized.split("-")[0];
    if (baseCode in BROWSER_LANGUAGE_MAP) {
      return BROWSER_LANGUAGE_MAP[baseCode];
    }
  }

  return DEFAULT_TOOLTIP_LANGUAGE;
}

export const TOOLTIP_LANGUAGE_STORAGE_KEY = "cmux-tooltip-language";

/**
 * Synchronously gets the initial tooltip language for use as a default value.
 * This reads directly from localStorage to avoid the race condition where
 * useLocalStorage returns the default on first render, causing Convex queries
 * to run with the wrong language.
 *
 * Priority:
 * 1. Stored preference in localStorage
 * 2. Browser language detection
 * 3. Default (English)
 *
 * This should only be called on the client side.
 */
export function getInitialTooltipLanguage(): TooltipLanguageValue {
  if (typeof window === "undefined") {
    return DEFAULT_TOOLTIP_LANGUAGE;
  }

  try {
    const raw = window.localStorage.getItem(TOOLTIP_LANGUAGE_STORAGE_KEY);
    if (raw !== null) {
      // Mantine useLocalStorage stores values as JSON, so we need to parse it
      const stored = JSON.parse(raw) as string;
      // Validate it's a known language value
      return normalizeTooltipLanguage(stored);
    }
  } catch {
    // localStorage not available or JSON parse failed
  }

  // No stored preference - detect from browser
  return detectBrowserLanguage();
}

export function normalizeTooltipLanguage(
  raw: string | null | undefined
): TooltipLanguageValue {
  if (typeof raw !== "string") {
    return DEFAULT_TOOLTIP_LANGUAGE;
  }
  const normalized = raw.trim().toLowerCase();
  const found = TOOLTIP_LANGUAGE_OPTIONS.find(
    (opt) => opt.value.toLowerCase() === normalized
  );
  return found ? found.value : DEFAULT_TOOLTIP_LANGUAGE;
}

export function getLanguageDisplayName(value: TooltipLanguageValue): string {
  const found = TOOLTIP_LANGUAGE_OPTIONS.find((opt) => opt.value === value);
  return found ? found.label : "English";
}

export function parseTooltipLanguageFromUrlSearchParams(
  searchParams: URLSearchParams
): TooltipLanguageValue {
  return normalizeTooltipLanguage(
    searchParams.get(HEATMAP_LANGUAGE_QUERY_KEY)
  );
}
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
// AWS Bedrock model IDs for Claude (using cross-region inference)
const ANTHROPIC_OPUS_41_MODEL_ID = "global.anthropic.claude-opus-4-1-20250807-v1:0";
const ANTHROPIC_OPUS_45_MODEL_ID = "global.anthropic.claude-opus-4-5-20251101-v1:0";

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
