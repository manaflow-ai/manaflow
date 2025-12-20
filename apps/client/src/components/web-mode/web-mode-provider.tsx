import { env } from "@/client-env";
import { useEffect, useState } from "react";
import { WebModeOverrideContext } from "./web-mode-context";

type WebModeOverrideProviderProps = {
  children: React.ReactNode;
  storageKey?: string;
};

const isDevEnvironment = import.meta.env.DEV;

/**
 * Provides web mode override functionality for development.
 * In production, this is a no-op and always uses the env var value.
 * In development, allows toggling web mode via localStorage.
 */
export function WebModeOverrideProvider({
  children,
  storageKey = "cmux-dev-web-mode-override",
}: WebModeOverrideProviderProps) {
  const [webModeOverride, setWebModeOverrideState] = useState<boolean>(() => {
    // Only read from localStorage in dev mode
    if (!isDevEnvironment) return false;
    const stored = localStorage.getItem(storageKey);
    return stored === "true";
  });

  // Sync to localStorage when override changes (dev only)
  useEffect(() => {
    if (!isDevEnvironment) return;
    localStorage.setItem(storageKey, String(webModeOverride));
  }, [webModeOverride, storageKey]);

  // In dev mode, override takes precedence. Otherwise, just use env var.
  const isWebMode = isDevEnvironment
    ? webModeOverride || env.NEXT_PUBLIC_WEB_MODE
    : env.NEXT_PUBLIC_WEB_MODE;

  const setWebModeOverride = (enabled: boolean) => {
    if (!isDevEnvironment) return;
    setWebModeOverrideState(enabled);
  };

  return (
    <WebModeOverrideContext.Provider
      value={{
        webModeOverride,
        setWebModeOverride,
        isWebMode,
      }}
    >
      {children}
    </WebModeOverrideContext.Provider>
  );
}
