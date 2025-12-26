import {
  createEmptyEnvironmentConfig,
  ensureInitialEnvVars,
  type EnvironmentConfigDraft,
  type EnvironmentDraftMetadata,
} from "@/types/environment";
import { useSyncExternalStore } from "react";

export interface EnvironmentDraft extends EnvironmentDraftMetadata {
  step: "select" | "configure";
  config: EnvironmentConfigDraft;
  lastUpdatedAt: number;
}

type DraftUpdater = (draft: EnvironmentDraft | null) => EnvironmentDraft | null;

const STORAGE_KEY_PREFIX = "cmux:env-draft:";

// Helper to safely access localStorage (handles SSR)
const safeLocalStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error("Failed to save to localStorage:", error);
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error("Failed to remove from localStorage:", error);
    }
  },
};

class EnvironmentDraftStore {
  private drafts = new Map<string, EnvironmentDraft>();
  private listeners = new Set<() => void>();
  private loadedFromStorage = new Set<string>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private loadFromStorage(teamSlugOrId: string): EnvironmentDraft | null {
    if (this.loadedFromStorage.has(teamSlugOrId)) {
      return this.drafts.get(teamSlugOrId) ?? null;
    }
    this.loadedFromStorage.add(teamSlugOrId);

    const stored = safeLocalStorage.getItem(STORAGE_KEY_PREFIX + teamSlugOrId);
    if (!stored) return null;

    try {
      const parsed = JSON.parse(stored) as EnvironmentDraft;
      // Validate basic structure
      if (
        parsed &&
        typeof parsed === "object" &&
        "step" in parsed &&
        "selectedRepos" in parsed &&
        "config" in parsed
      ) {
        // SECURITY: envVars are not persisted to localStorage, so initialize them fresh
        // This ensures users need to re-enter secrets after page reload
        const draft: EnvironmentDraft = {
          ...parsed,
          config: {
            ...parsed.config,
            envVars: ensureInitialEnvVars(parsed.config.envVars),
          },
        };
        this.drafts.set(teamSlugOrId, draft);
        return draft;
      }
    } catch (error) {
      console.error("Failed to parse stored draft:", error);
      safeLocalStorage.removeItem(STORAGE_KEY_PREFIX + teamSlugOrId);
    }
    return null;
  }

  private saveToStorage(teamSlugOrId: string, draft: EnvironmentDraft | null): void {
    if (draft === null) {
      safeLocalStorage.removeItem(STORAGE_KEY_PREFIX + teamSlugOrId);
    } else {
      // SECURITY: Don't persist envVars to localStorage - they may contain secrets
      // Only persist non-sensitive draft data (name, scripts, ports, metadata)
      const safeToStore: EnvironmentDraft = {
        ...draft,
        config: {
          ...draft.config,
          envVars: [], // Clear envVars before storing
        },
      };
      safeLocalStorage.setItem(STORAGE_KEY_PREFIX + teamSlugOrId, JSON.stringify(safeToStore));
    }
  }

  get(teamSlugOrId: string): EnvironmentDraft | null {
    // Try to load from storage if not already loaded
    if (!this.loadedFromStorage.has(teamSlugOrId)) {
      return this.loadFromStorage(teamSlugOrId);
    }
    return this.drafts.get(teamSlugOrId) ?? null;
  }

  set(teamSlugOrId: string, draft: EnvironmentDraft | null): EnvironmentDraft | null {
    this.loadedFromStorage.add(teamSlugOrId);

    if (draft === null) {
      if (!this.drafts.has(teamSlugOrId)) {
        this.saveToStorage(teamSlugOrId, null);
        return null;
      }
      this.drafts.delete(teamSlugOrId);
      this.saveToStorage(teamSlugOrId, null);
      this.notify();
      return null;
    }
    this.drafts.set(teamSlugOrId, draft);
    this.saveToStorage(teamSlugOrId, draft);
    this.notify();
    return draft;
  }

  update(teamSlugOrId: string, updater: DraftUpdater): EnvironmentDraft | null {
    const next = updater(this.get(teamSlugOrId));
    if (next === null) {
      return this.set(teamSlugOrId, null);
    }
    return this.set(teamSlugOrId, next);
  }
}

const store = new EnvironmentDraftStore();

const now = () => Date.now();

const buildDraft = (
  metadata: EnvironmentDraftMetadata,
  config: EnvironmentConfigDraft,
): EnvironmentDraft => ({
  step: "configure",
  selectedRepos: metadata.selectedRepos,
  instanceId: metadata.instanceId,
  snapshotId: metadata.snapshotId,
  config,
  lastUpdatedAt: now(),
});

export const useEnvironmentDraft = (
  teamSlugOrId: string,
): EnvironmentDraft | null =>
  useSyncExternalStore(
    store.subscribe,
    () => store.get(teamSlugOrId),
    () => null,
  );

export const persistEnvironmentDraftMetadata = (
  teamSlugOrId: string,
  metadata: EnvironmentDraftMetadata,
  options?: {
    resetConfig?: boolean;
    step?: "select" | "configure";
  },
): EnvironmentDraft | null =>
  store.update(teamSlugOrId, (prev) => {
    const nextConfig =
      options?.resetConfig || !prev
        ? createEmptyEnvironmentConfig()
        : prev.config;
    const nextMetadata: EnvironmentDraftMetadata = {
      selectedRepos: metadata.selectedRepos,
      instanceId: metadata.instanceId ?? prev?.instanceId,
      snapshotId: metadata.snapshotId ?? prev?.snapshotId,
    };
    // Preserve current step if not explicitly specified
    const nextStep = options?.step ?? prev?.step ?? "configure";
    if (nextStep === "select") {
      return {
        step: "select",
        selectedRepos: nextMetadata.selectedRepos,
        instanceId: nextMetadata.instanceId,
        snapshotId: nextMetadata.snapshotId,
        config: nextConfig,
        lastUpdatedAt: now(),
      };
    }
    return {
      step: "configure",
      selectedRepos: nextMetadata.selectedRepos,
      instanceId: nextMetadata.instanceId,
      snapshotId: nextMetadata.snapshotId,
      config: nextConfig,
      lastUpdatedAt: now(),
    };
  });

export const updateEnvironmentDraftConfig = (
  teamSlugOrId: string,
  partial: Partial<EnvironmentConfigDraft>,
  metadataFallback?: EnvironmentDraftMetadata,
): EnvironmentDraft | null =>
  store.update(teamSlugOrId, (prev) => {
    const selectedRepos =
      metadataFallback?.selectedRepos ??
      prev?.selectedRepos ??
      [];
    const instanceId =
      metadataFallback?.instanceId ?? prev?.instanceId;
    const snapshotId =
      metadataFallback?.snapshotId ?? prev?.snapshotId;
    const baseConfig = prev?.config ?? createEmptyEnvironmentConfig();
    const nextConfig: EnvironmentConfigDraft = {
      ...baseConfig,
      ...partial,
    };
    return buildDraft(
      { selectedRepos, instanceId, snapshotId },
      nextConfig,
    );
  });

export const clearEnvironmentDraft = (teamSlugOrId: string): void => {
  store.set(teamSlugOrId, null);
};
