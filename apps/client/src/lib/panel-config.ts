import type { LucideIcon } from "lucide-react";
import { MessageSquare, Code2, TerminalSquare, Globe2, GitCompare, Brain } from "lucide-react";

export type PanelType = "chat" | "workspace" | "terminal" | "browser" | "gitDiff" | "memory";

/**
 * All available panel types. When adding a new panel:
 * 1. Add to PanelType union above
 * 2. Add to this array
 * 3. Add to PANEL_LABELS
 * 4. Add to PANEL_ICON_COMPONENTS
 * 5. Handle in TaskPanelFactory.tsx switch statement
 */
export const ALL_PANEL_TYPES: PanelType[] = ["chat", "workspace", "terminal", "browser", "gitDiff", "memory"];

export type LayoutMode =
  | "single-panel"    // Single full-width panel
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

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  layoutMode: "three-left",
  layouts: {
    "single-panel": { topLeft: "workspace", topRight: null, bottomLeft: null, bottomRight: null },
    "four-panel": { ...DEFAULT_LAYOUT_PANELS },
    "two-horizontal": { topLeft: "workspace", topRight: "browser", bottomLeft: null, bottomRight: null },
    "two-vertical": { topLeft: "chat", topRight: null, bottomLeft: "workspace", bottomRight: null },
    "three-left": { topLeft: "workspace", topRight: "browser", bottomLeft: null, bottomRight: "gitDiff" },
    "three-right": { topLeft: "chat", topRight: null, bottomLeft: "terminal", bottomRight: "workspace" },
    "three-top": { topLeft: "workspace", topRight: null, bottomLeft: "chat", bottomRight: "terminal" },
    "three-bottom": { topLeft: "chat", topRight: "workspace", bottomLeft: null, bottomRight: "terminal" },
  },
};

export const PANEL_LABELS: Record<PanelType, string> = {
  chat: "Activity",
  workspace: "Workspace",
  terminal: "Terminal",
  browser: "Browser",
  gitDiff: "Git Diff",
  memory: "Memory",
};

/** @deprecated Use PANEL_ICON_COMPONENTS instead */
export const PANEL_ICONS: Record<PanelType, string> = {
  chat: "MessageSquare",
  workspace: "Code2",
  terminal: "TerminalSquare",
  browser: "Globe2",
  gitDiff: "GitCompare",
  memory: "Brain",
};

/**
 * Single source of truth for panel icons.
 * Use this instead of duplicating icon mappings in components.
 */
export const PANEL_ICON_COMPONENTS: Record<PanelType, LucideIcon> = {
  chat: MessageSquare,
  workspace: Code2,
  terminal: TerminalSquare,
  browser: Globe2,
  gitDiff: GitCompare,
  memory: Brain,
};

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  "single-panel": "Single Panel",
  "four-panel": "Four Panel Grid",
  "two-horizontal": "Two Panels (Side-by-Side)",
  "two-vertical": "Two Panels (Stacked)",
  "three-left": "Three Panels (Large Left)",
  "three-right": "Three Panels (Large Right)",
  "three-top": "Three Panels (Large Top)",
  "three-bottom": "Three Panels (Large Bottom)",
};

export const LAYOUT_DESCRIPTIONS: Record<LayoutMode, string> = {
  "single-panel": "Single full-width panel",
  "four-panel": "2×2 grid with four equal panels",
  "two-horizontal": "Two panels side-by-side",
  "two-vertical": "Two panels stacked vertically",
  "three-left": "One large panel on left, two stacked on right",
  "three-right": "Two stacked panels on left, one large on right",
  "three-top": "One large panel on top, two side-by-side below",
  "three-bottom": "Two panels side-by-side on top, one large below",
};

const STORAGE_KEY = "taskPanelConfig";

export function loadPanelConfig(): PanelConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);

      // Migrate old config format to new format
      if (parsed.topLeft !== undefined && !parsed.layouts) {
        // Old format detected, migrate to new format
        const layoutMode: LayoutMode = parsed.layoutMode ?? "four-panel";
        const config: PanelConfig = {
          layoutMode,
          layouts: { ...DEFAULT_PANEL_CONFIG.layouts },
        };
        // Set the current layout mode's panels from the old config
        config.layouts[layoutMode] = {
          topLeft: parsed.topLeft ?? null,
          topRight: parsed.topRight ?? null,
          bottomLeft: parsed.bottomLeft ?? null,
          bottomRight: parsed.bottomRight ?? null,
        };
        return config;
      }

      // New format
      const layoutMode = parsed.layoutMode ?? DEFAULT_PANEL_CONFIG.layoutMode;
      const layouts = { ...DEFAULT_PANEL_CONFIG.layouts };

      // Merge stored layouts with defaults
      if (parsed.layouts) {
        for (const mode of Object.keys(layouts) as LayoutMode[]) {
          if (parsed.layouts[mode]) {
            layouts[mode] = {
              topLeft: parsed.layouts[mode].topLeft ?? layouts[mode].topLeft,
              topRight: parsed.layouts[mode].topRight ?? layouts[mode].topRight,
              bottomLeft: parsed.layouts[mode].bottomLeft ?? layouts[mode].bottomLeft,
              bottomRight: parsed.layouts[mode].bottomRight ?? layouts[mode].bottomRight,
            };
          }
        }
      }

      return { layoutMode, layouts };
    }
  } catch (error) {
    console.error("Failed to load panel config:", error);
  }
  return DEFAULT_PANEL_CONFIG;
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
  const currentLayout = getCurrentLayoutPanels(config);

  // Check all positions (including inactive) to prevent duplicates within current layout
  const usedPanels = new Set([
    currentLayout.topLeft,
    currentLayout.topRight,
    currentLayout.bottomLeft,
    currentLayout.bottomRight,
  ].filter((p): p is PanelType => p !== null));

  return ALL_PANEL_TYPES.filter(panel => !usedPanels.has(panel));
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
 * Ensures the terminal panel is visible in the current layout.
 * If terminal is already visible, returns unchanged config.
 * If there's an empty slot, adds terminal there.
 * If all slots are full, switches to 4-panel layout to make room for terminal.
 */
export function ensureTerminalPanelVisible(config: PanelConfig): PanelConfig {
  const currentLayout = getCurrentLayoutPanels(config);
  const activePositions = getActivePanelPositions(config.layoutMode);

  // Check if terminal is already in an active position
  for (const pos of activePositions) {
    if (currentLayout[pos] === "terminal") {
      return config; // Already visible, no change
    }
  }

  // Find first empty active position to add terminal
  for (const pos of activePositions) {
    if (currentLayout[pos] === null) {
      return {
        ...config,
        layouts: {
          ...config.layouts,
          [config.layoutMode]: {
            ...currentLayout,
            [pos]: "terminal",
          },
        },
      };
    }
  }

  // All active positions filled - don't change layout, return unchanged
  // User can manually add terminal panel if needed
  return config;
}

/**
 * Returns which panel positions are visible for the given layout mode
 */
export function getActivePanelPositions(layoutMode: LayoutMode): PanelPosition[] {
  switch (layoutMode) {
    case "single-panel":
      return ["topLeft"];
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
