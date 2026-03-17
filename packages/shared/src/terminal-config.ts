import type { ITerminalOptions } from "@xterm/xterm";

// Keep scrollback bounded to avoid runaway memory growth in long-running sessions.
export const ACTIVE_TERMINAL_SCROLLBACK = 20_000;
export const INACTIVE_TERMINAL_SCROLLBACK = 2_000;

/**
 * Default terminal configuration based on the TerminalContextProvider settings.
 * This is the source of truth for terminal appearance across the application.
 */
export const DEFAULT_TERMINAL_CONFIG: ITerminalOptions = {
  fontSize: 12,
  fontFamily:
    "Menlo, Monaco, operator mono,SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace",
  theme: {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#aeafad",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#e5e5e5",
  },
  cursorStyle: "bar",
  cursorBlink: false,
  allowProposedApi: true,
  scrollback: ACTIVE_TERMINAL_SCROLLBACK,
};

/**
 * Terminal configuration for server-side (headless) terminals.
 * Note: Server terminals use a different Terminal class from @xterm/headless
 * which has slightly different options.
 */
export const SERVER_TERMINAL_CONFIG = {
  cols: 80,
  rows: 24,
  scrollback: ACTIVE_TERMINAL_SCROLLBACK,
  allowProposedApi: true,
};

/**
 * Helper function to create terminal options with overrides.
 * This maintains the default configuration while allowing customization.
 */
export function createTerminalOptions(
  overrides?: Partial<ITerminalOptions>
): ITerminalOptions {
  return {
    ...DEFAULT_TERMINAL_CONFIG,
    ...overrides,
    theme: {
      ...DEFAULT_TERMINAL_CONFIG.theme,
      ...(overrides?.theme || {}),
    },
  };
}
