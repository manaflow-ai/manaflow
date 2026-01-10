import type { ITerminalOptions } from "@xterm/xterm";

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
  scrollback: 10000,
};

/**
 * Terminal configuration for server-side (headless) terminals.
 * Note: Server terminals use a different Terminal class from @xterm/headless
 * which has slightly different options.
 *
 * Memory optimization: Reduced scrollback from 100000 to 5000 lines to prevent
 * swap thrashing when running multiple concurrent agent terminals. Each line
 * can be ~500 bytes, so 100k lines = ~50MB per terminal. With 50 concurrent
 * terminals, this was causing ~2.5GB of memory usage just for scrollback.
 * 5000 lines (~2.5MB) is sufficient for most agent workflows.
 */
export const SERVER_TERMINAL_CONFIG = {
  cols: 80,
  rows: 24,
  scrollback: 5000,
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