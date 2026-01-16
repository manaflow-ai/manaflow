// Heatmap gradient CSS generation for diff viewer
// Supports dynamic color customization and generates CSS for 100 gradient steps

import {
  HEATMAP_GRADIENT_STEPS,
  HEATMAP_LINE_CLASS_PREFIX,
  HEATMAP_CHAR_CLASS_PREFIX,
} from "@/lib/heatmap";

export type HeatmapGradientStops = {
  start: string;
  end: string;
};

export type HeatmapColorSettings = {
  line: HeatmapGradientStops;
  token: HeatmapGradientStops;
};

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

// Default heatmap colors - works in both light and dark mode
export const DEFAULT_HEATMAP_COLORS: HeatmapColorSettings = {
  line: {
    start: "#fefce8", // Light yellow
    end: "#f8e1c9", // Light orange
  },
  token: {
    start: "#fde047", // Yellow
    end: "#ffa270", // Orange
  },
};

// Dark mode heatmap colors
export const DARK_MODE_HEATMAP_COLORS: HeatmapColorSettings = {
  line: {
    start: "#422006", // Dark amber
    end: "#7c2d12", // Dark orange
  },
  token: {
    start: "#ca8a04", // Yellow-600
    end: "#ea580c", // Orange-600
  },
};

export function buildHeatmapGradientStyles(
  colors: HeatmapColorSettings,
  theme: "light" | "dark" = "light"
): string {
  const effectiveColors = theme === "dark" ? adjustColorsForDarkMode(colors) : colors;

  const fallbackLineStart = parseHexColor(DEFAULT_HEATMAP_COLORS.line.start) ?? {
    r: 254,
    g: 249,
    b: 195,
  };
  const fallbackLineEnd = parseHexColor(DEFAULT_HEATMAP_COLORS.line.end) ?? {
    r: 253,
    g: 186,
    b: 116,
  };
  const fallbackTokenStart = parseHexColor(DEFAULT_HEATMAP_COLORS.token.start) ?? {
    r: 253,
    g: 224,
    b: 71,
  };
  const fallbackTokenEnd = parseHexColor(DEFAULT_HEATMAP_COLORS.token.end) ?? {
    r: 234,
    g: 88,
    b: 12,
  };

  const lineStart = parseHexColor(effectiveColors.line.start) ?? fallbackLineStart;
  const lineEnd = parseHexColor(effectiveColors.line.end) ?? fallbackLineEnd;
  const tokenStart = parseHexColor(effectiveColors.token.start) ?? fallbackTokenStart;
  const tokenEnd = parseHexColor(effectiveColors.token.end) ?? fallbackTokenEnd;
  const steps = HEATMAP_GRADIENT_STEPS;
  const rules: string[] = [];

  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    const mixedLine = mixRgb(lineStart, lineEnd, ratio);
    const mixedToken = mixRgb(tokenStart, tokenEnd, ratio);

    // Adjust alpha values for dark mode
    const baseLineAlpha = theme === "dark" ? 0.25 : 0.35;
    const baseCharAlpha = theme === "dark" ? 0.45 : 0.55;

    const lineAlpha = clampAlpha(baseLineAlpha + 0.3 * ratio);
    const charAlpha = clampAlpha(baseCharAlpha + 0.25 * ratio);
    const lineColor = rgbaString(mixedLine, lineAlpha);
    const charColor = rgbaString(mixedToken, charAlpha);
    const charTextColor = getContrastingTextColor(mixedToken, theme);

    rules.push(
      `.${HEATMAP_LINE_CLASS_PREFIX}-${step} .diff-gutter, .${HEATMAP_LINE_CLASS_PREFIX}-${step} .diff-code { box-shadow: inset 0 0 0 999px ${lineColor}; }`
    );
    rules.push(
      `.${HEATMAP_CHAR_CLASS_PREFIX}-${step} { background-color: ${charColor}; color: ${charTextColor}; }`
    );
  }

  return rules.join("\n");
}

export function buildThemedHeatmapGradientStyles(
  colors: HeatmapColorSettings
): string {
  const lightRules = buildHeatmapGradientStyles(colors, "light");
  const darkRules = buildHeatmapGradientStyles(colors, "dark");

  return `
/* Light mode heatmap styles */
${lightRules}

/* Dark mode heatmap styles */
.dark {
${darkRules.split("\n").map(rule => `  ${rule}`).join("\n")}
}
`;
}

function adjustColorsForDarkMode(colors: HeatmapColorSettings): HeatmapColorSettings {
  // For dark mode, we want slightly more saturated and darker base colors
  const adjustColor = (hex: string): string => {
    const rgb = parseHexColor(hex);
    if (!rgb) return hex;

    // Darken and slightly increase saturation for dark mode visibility
    const darken = (value: number) => Math.max(0, Math.floor(value * 0.7));

    return rgbToHex({
      r: darken(rgb.r),
      g: darken(rgb.g),
      b: darken(rgb.b),
    });
  };

  return {
    line: {
      start: adjustColor(colors.line.start),
      end: adjustColor(colors.line.end),
    },
    token: {
      start: adjustColor(colors.token.start),
      end: adjustColor(colors.token.end),
    },
  };
}

function parseHexColor(value: string): RgbColor | null {
  if (!isValidHexColor(value)) {
    return null;
  }
  const normalized = value.replace("#", "");
  if (normalized.length === 3) {
    const chars = normalized.split("");
    const r = Number.parseInt((chars[0] ?? "0").repeat(2), 16);
    const g = Number.parseInt((chars[1] ?? "0").repeat(2), 16);
    const b = Number.parseInt((chars[2] ?? "0").repeat(2), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return null;
    }
    return { r, g, b };
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }
  return { r, g, b };
}

function rgbToHex(color: RgbColor): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function mixRgb(start: RgbColor, end: RgbColor, ratio: number): RgbColor {
  const clampRatio = Math.min(Math.max(ratio, 0), 1);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * clampRatio);
  return {
    r: lerp(start.r, end.r),
    g: lerp(start.g, end.g),
    b: lerp(start.b, end.b),
  };
}

function rgbaString(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`;
}

function clampAlpha(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0.1), 0.85);
}

function getContrastingTextColor(color: RgbColor, theme: "light" | "dark"): string {
  const normalized = {
    r: color.r / 255,
    g: color.g / 255,
    b: color.b / 255,
  };
  const luminance =
    0.2126 * normalized.r + 0.7152 * normalized.g + 0.0722 * normalized.b;

  if (theme === "dark") {
    // In dark mode, prefer lighter text
    return luminance > 0.4 ? "#1f2937" : "#f9fafb";
  }

  return luminance > 0.6 ? "#1f2937" : "#fefefe";
}

function isValidHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}
