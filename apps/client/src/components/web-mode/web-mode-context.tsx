import { createContext } from "react";

export type WebModeOverrideState = {
  /**
   * Whether web mode override is enabled (only used in dev mode).
   * When true, forces web mode behavior regardless of NEXT_PUBLIC_WEB_MODE env var.
   * When false, uses the original env var value.
   */
  webModeOverride: boolean;
  /**
   * Toggle the web mode override. Only available in dev mode.
   */
  setWebModeOverride: (enabled: boolean) => void;
  /**
   * The effective web mode value (considers both env var and override).
   */
  isWebMode: boolean;
};

export const initialState: WebModeOverrideState = {
  webModeOverride: false,
  setWebModeOverride: () => null,
  isWebMode: false,
};

export const WebModeOverrideContext =
  createContext<WebModeOverrideState>(initialState);
