export type PanelType = "chat" | "workspace" | "terminal" | "browser" | "gitDiff";

export type LayoutMode =
  | "four-panel"      // 2x2 grid
  | "two-horizontal"  // Two panels side-by-side
  | "two-vertical"    // Two panels stacked
  | "three-left"      // One large panel on left, two stacked on right
  | "three-right"     // Two stacked on left, one large panel on right
  | "three-top"       // One large panel on top, two side-by-side on bottom
  | "three-bottom";   // Two side-by-side on top, one large panel on bottom

export interface LayoutPanels {
  topLeft: PanelType | null;
  topRight: PanelType | null;
  bottomLeft: PanelType | null;
  bottomRight: PanelType | null;
}

export interface PanelConfig {
  layoutMode: LayoutMode;
  layouts: {
    [key in LayoutMode]: LayoutPanels;
  };
}

const DEFAULT_LAYOUT_PANELS: LayoutPanels = {
  topLeft: "chat",
  topRight: "workspace",
  bottomLeft: "terminal",
  bottomRight: "browser",
};

const SHARED_LAYOUTS: PanelConfig["layouts"] = {
  "four-panel": { ...DEFAULT_LAYOUT_PANELS },
  "two-horizontal": { topLeft: "chat", topRight: "workspace", bottomLeft: null, bottomRight: null },
  "two-vertical": { topLeft: "chat", topRight: null, bottomLeft: "workspace", bottomRight: null },
  "three-left": { topLeft: "workspace", topRight: "chat", bottomLeft: null, bottomRight: "terminal" },
  "three-right": { topLeft: "chat", topRight: null, bottomLeft: "terminal", bottomRight: "workspace" },
  "three-top": { topLeft: "workspace", topRight: null, bottomLeft: "chat", bottomRight: "terminal" },
  "three-bottom": { topLeft: "chat", topRight: "workspace", bottomLeft: null, bottomRight: "terminal" },
};

const LEGACY_PANEL_CONFIG: PanelConfig = {
  layoutMode: "four-panel",
  layouts: SHARED_LAYOUTS,
};

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  layoutMode: "three-left",
  layouts: {
    ...SHARED_LAYOUTS,
    "three-left": { topLeft: "workspace", topRight: "browser", bottomLeft: null, bottomRight: "gitDiff" },
  },
};

export const PANEL_LABELS: Record<PanelType, string> = {
  chat: "Activity",
  workspace: "Workspace",
  terminal: "Terminal",
  browser: "Browser",
  gitDiff: "Git Diff",
};

export const PANEL_ICONS: Record<PanelType, string> = {
  chat: "MessageSquare",
  workspace: "Code2",
  terminal: "TerminalSquare",
  browser: "Globe2",
  gitDiff: "GitCompare",
};

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  "four-panel": "Four Panel Grid",
  "two-horizontal": "Two Panels (Side-by-Side)",
  "two-vertical": "Two Panels (Stacked)",
  "three-left": "Three Panels (Large Left)",
  "three-right": "Three Panels (Large Right)",
  "three-top": "Three Panels (Large Top)",
  "three-bottom": "Three Panels (Large Bottom)",
};

export const LAYOUT_DESCRIPTIONS: Record<LayoutMode, string> = {
  "four-panel": "2×2 grid with four equal panels",
  "two-horizontal": "Two panels side-by-side",
  "two-vertical": "Two panels stacked vertically",
  "three-left": "One large panel on left, two stacked on right",
  "three-right": "Two stacked panels on left, one large on right",
  "three-top": "One large panel on top, two side-by-side below",
  "three-bottom": "Two panels side-by-side on top, one large below",
};

const STORAGE_KEY = "taskPanelConfig";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLayoutMode(value: unknown): value is LayoutMode {
  return (
    value === "four-panel" ||
    value === "two-horizontal" ||
    value === "two-vertical" ||
    value === "three-left" ||
    value === "three-right" ||
    value === "three-top" ||
    value === "three-bottom"
  );
}

function isPanelType(value: unknown): value is PanelType {
  return (
    value === "chat" ||
    value === "workspace" ||
    value === "terminal" ||
    value === "browser" ||
    value === "gitDiff"
  );
}

function normalizePanel(value: unknown): PanelType | null | undefined {
  if (value === null) {
    return null;
  }
  if (isPanelType(value)) {
    return value;
  }
  return undefined;
}

function cloneLayouts(layouts: PanelConfig["layouts"]): PanelConfig["layouts"] {
  const clone: Partial<PanelConfig["layouts"]> = {};
  for (const mode of Object.keys(layouts) as LayoutMode[]) {
    clone[mode] = { ...layouts[mode] };
  }
  return clone as PanelConfig["layouts"];
}

function clonePanelConfig(config: PanelConfig): PanelConfig {
  return {
    layoutMode: config.layoutMode,
    layouts: cloneLayouts(config.layouts),
  };
}

function resolvePanelValue(
  value: unknown,
  fallback: PanelType | null
): PanelType | null {
  const parsed = normalizePanel(value);
  return parsed === undefined ? fallback : parsed;
}

function applyParsedConfig(parsed: unknown, base: PanelConfig): PanelConfig {
  const layouts = cloneLayouts(base.layouts);

  if (!isRecord(parsed)) {
    return { layoutMode: base.layoutMode, layouts };
  }

  // Migrate old config format to new format
  if (parsed.topLeft !== undefined && parsed.layouts === undefined) {
    const layoutMode = isLayoutMode(parsed.layoutMode)
      ? parsed.layoutMode
      : LEGACY_PANEL_CONFIG.layoutMode;
    const current = layouts[layoutMode];
    layouts[layoutMode] = {
      topLeft: resolvePanelValue(parsed.topLeft, current.topLeft),
      topRight: resolvePanelValue(parsed.topRight, current.topRight),
      bottomLeft: resolvePanelValue(parsed.bottomLeft, current.bottomLeft),
      bottomRight: resolvePanelValue(parsed.bottomRight, current.bottomRight),
    };
    return { layoutMode, layouts };
  }

  // New format
  const layoutMode = isLayoutMode(parsed.layoutMode)
    ? parsed.layoutMode
    : base.layoutMode;

  if (isRecord(parsed.layouts)) {
    for (const mode of Object.keys(layouts) as LayoutMode[]) {
      const stored = parsed.layouts[mode];
      if (!isRecord(stored)) {
        continue;
      }
      const current = layouts[mode];
      layouts[mode] = {
        topLeft: resolvePanelValue(stored.topLeft, current.topLeft),
        topRight: resolvePanelValue(stored.topRight, current.topRight),
        bottomLeft: resolvePanelValue(stored.bottomLeft, current.bottomLeft),
        bottomRight: resolvePanelValue(stored.bottomRight, current.bottomRight),
      };
    }
  }

  return { layoutMode, layouts };
}

function layoutsEqual(first: LayoutPanels, second: LayoutPanels): boolean {
  return (
    first.topLeft === second.topLeft &&
    first.topRight === second.topRight &&
    first.bottomLeft === second.bottomLeft &&
    first.bottomRight === second.bottomRight
  );
}

function isLegacyDefaultConfig(config: PanelConfig): boolean {
  if (config.layoutMode !== LEGACY_PANEL_CONFIG.layoutMode) {
    return false;
  }

  for (const mode of Object.keys(LEGACY_PANEL_CONFIG.layouts) as LayoutMode[]) {
    if (!layoutsEqual(config.layouts[mode], LEGACY_PANEL_CONFIG.layouts[mode])) {
      return false;
    }
  }

  return true;
}

export function loadPanelConfig(): PanelConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      const legacyConfig = applyParsedConfig(parsed, LEGACY_PANEL_CONFIG);
      if (isLegacyDefaultConfig(legacyConfig)) {
        return clonePanelConfig(DEFAULT_PANEL_CONFIG);
      }
      return applyParsedConfig(parsed, DEFAULT_PANEL_CONFIG);
    }
  } catch (error) {
    console.error("Failed to load panel config:", error);
  }
  return clonePanelConfig(DEFAULT_PANEL_CONFIG);
}

export function savePanelConfig(config: PanelConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.error("Failed to save panel config:", error);
  }
}

export function resetPanelConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to reset panel config:", error);
  }
}

/**
 * Gets the current layout's panel configuration
 */
export function getCurrentLayoutPanels(config: PanelConfig): LayoutPanels {
  return config.layouts[config.layoutMode];
}

export function getAvailablePanels(config: PanelConfig): PanelType[] {
  const allPanels: PanelType[] = ["chat", "workspace", "terminal", "browser", "gitDiff"];
  const currentLayout = getCurrentLayoutPanels(config);

  // Check all positions (including inactive) to prevent duplicates within current layout
  const usedPanels = new Set([
    currentLayout.topLeft,
    currentLayout.topRight,
    currentLayout.bottomLeft,
    currentLayout.bottomRight,
  ].filter((p): p is PanelType => p !== null));

  return allPanels.filter(panel => !usedPanels.has(panel));
}

/**
 * Removes a panel type from all positions in the current layout
 */
export function removePanelFromAllPositions(config: PanelConfig, panelType: PanelType): PanelConfig {
  const currentLayout = getCurrentLayoutPanels(config);
  return {
    ...config,
    layouts: {
      ...config.layouts,
      [config.layoutMode]: {
        topLeft: currentLayout.topLeft === panelType ? null : currentLayout.topLeft,
        topRight: currentLayout.topRight === panelType ? null : currentLayout.topRight,
        bottomLeft: currentLayout.bottomLeft === panelType ? null : currentLayout.bottomLeft,
        bottomRight: currentLayout.bottomRight === panelType ? null : currentLayout.bottomRight,
      },
    },
  };
}

export type PanelPosition = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/**
 * Returns which panel positions are visible for the given layout mode
 */
export function getActivePanelPositions(layoutMode: LayoutMode): PanelPosition[] {
  switch (layoutMode) {
    case "four-panel":
      return ["topLeft", "topRight", "bottomLeft", "bottomRight"];
    case "two-horizontal":
      return ["topLeft", "topRight"];
    case "two-vertical":
      return ["topLeft", "bottomLeft"];
    case "three-left":
      return ["topLeft", "topRight", "bottomRight"];
    case "three-right":
      return ["topLeft", "bottomLeft", "bottomRight"];
    case "three-top":
      return ["topLeft", "bottomLeft", "bottomRight"];
    case "three-bottom":
      return ["topLeft", "topRight", "bottomRight"];
  }
}

/**
 * Returns the maximum number of panels for a layout mode
 */
export function getMaxPanelsForLayout(layoutMode: LayoutMode): number {
  return getActivePanelPositions(layoutMode).length;
}
