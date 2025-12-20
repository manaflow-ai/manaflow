import { useContext } from "react";
import { WebModeOverrideContext } from "./web-mode-context";

/**
 * Hook to access web mode state and override functionality.
 * In dev mode, allows toggling web mode for testing.
 * In production, always returns the env var value.
 */
export function useWebMode() {
  const context = useContext(WebModeOverrideContext);
  if (context === undefined) {
    throw new Error("useWebMode must be used within a WebModeOverrideProvider");
  }
  return context;
}
