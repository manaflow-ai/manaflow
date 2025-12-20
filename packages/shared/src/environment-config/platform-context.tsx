"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_WIZARD_CONFIGS, type EnvironmentWizardConfig } from "./types";

/**
 * Context for environment wizard platform configuration.
 * Allows components to adapt their behavior based on platform.
 */
const EnvironmentWizardContext = createContext<EnvironmentWizardConfig | null>(
  null
);

export interface EnvironmentWizardProviderProps {
  /**
   * Platform for the wizard: 'electron', 'web', or 'www'.
   * Defaults to 'web'.
   */
  platform?: "electron" | "web" | "www";
  /**
   * Optional custom config to override defaults.
   */
  config?: Partial<EnvironmentWizardConfig>;
  children: ReactNode;
}

/**
 * Provider for environment wizard configuration.
 * Wrap your environment configuration flow with this provider.
 */
export function EnvironmentWizardProvider({
  platform = "web",
  config,
  children,
}: EnvironmentWizardProviderProps) {
  const defaultConfig = DEFAULT_WIZARD_CONFIGS[platform];
  const mergedConfig: EnvironmentWizardConfig = {
    ...defaultConfig,
    ...config,
  };

  return (
    <EnvironmentWizardContext.Provider value={mergedConfig}>
      {children}
    </EnvironmentWizardContext.Provider>
  );
}

/**
 * Hook to access the environment wizard configuration.
 * Returns default 'web' config if used outside provider.
 */
export function useEnvironmentWizardConfig(): EnvironmentWizardConfig {
  const context = useContext(EnvironmentWizardContext);
  if (!context) {
    // Return default web config if no provider
    return DEFAULT_WIZARD_CONFIGS.web;
  }
  return context;
}

/**
 * Hook to check if running in electron.
 */
export function useIsElectron(): boolean {
  const config = useEnvironmentWizardConfig();
  return config.platform === "electron";
}

/**
 * Hook to check if multiple repos are supported.
 */
export function useMultiRepoSupport(): boolean {
  const config = useEnvironmentWizardConfig();
  return config.multiRepoSupport;
}

/**
 * Hook to get workspace base path.
 */
export function useWorkspaceBasePath(): string {
  const config = useEnvironmentWizardConfig();
  return config.workspaceBasePath;
}
