import { z } from "zod";

import {
  DEFAULT_HEATMAP_COLORS,
  type HeatmapColorSettings,
} from "@/components/heatmap-diff-viewer/heatmap-gradient";

export const HEATMAP_MODEL_OPTIONS = [
  { value: "anthropic-opus-4-5", label: "Claude Opus 4.5" },
  { value: "cmux-heatmap-2", label: "cmux-heatmap-2" },
  { value: "cmux-heatmap-0", label: "cmux-heatmap-0" },
  { value: "cmux-heatmap-1", label: "cmux-heatmap-1" },
  { value: "anthropic", label: "Claude Opus 4.1" },
] as const;

export type HeatmapModelOptionValue =
  (typeof HEATMAP_MODEL_OPTIONS)[number]["value"];

export const DEFAULT_HEATMAP_MODEL: HeatmapModelOptionValue =
  "anthropic-opus-4-5";

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

export function normalizeHeatmapModel(
  value: string | null | undefined
): HeatmapModelOptionValue {
  const match = HEATMAP_MODEL_OPTIONS.find((option) => option.value === value);
  return match ? match.value : DEFAULT_HEATMAP_MODEL;
}

export function normalizeTooltipLanguage(
  value: string | null | undefined
): TooltipLanguageValue {
  const match = TOOLTIP_LANGUAGE_OPTIONS.find(
    (option) => option.value === value
  );
  return match ? match.value : DEFAULT_TOOLTIP_LANGUAGE;
}

const heatmapColorsSchema = z.object({
  line: z.object({
    start: z.string(),
    end: z.string(),
  }),
  token: z.object({
    start: z.string(),
    end: z.string(),
  }),
});

export function normalizeHeatmapColors(
  value: unknown
): HeatmapColorSettings {
  const parsed = heatmapColorsSchema.safeParse(value);
  if (!parsed.success) {
    return DEFAULT_HEATMAP_COLORS;
  }

  const lineStart = normalizeHexColor(parsed.data.line.start);
  const lineEnd = normalizeHexColor(parsed.data.line.end);
  const tokenStart = normalizeHexColor(parsed.data.token.start);
  const tokenEnd = normalizeHexColor(parsed.data.token.end);

  if (!lineStart || !lineEnd || !tokenStart || !tokenEnd) {
    return DEFAULT_HEATMAP_COLORS;
  }

  return {
    line: { start: lineStart, end: lineEnd },
    token: { start: tokenStart, end: tokenEnd },
  };
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isValidHexColor(withHash) ? withHash.toLowerCase() : null;
}

function isValidHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}
