import {
  createEmptyEnvironmentConfig,
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

class EnvironmentDraftStore {
  private drafts = new Map<string, EnvironmentDraft>();
  private listeners = new Set<() => void>();

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

  get(teamSlugOrId: string): EnvironmentDraft | null {
    return this.drafts.get(teamSlugOrId) ?? null;
  }

  set(teamSlugOrId: string, draft: EnvironmentDraft | null): EnvironmentDraft | null {
    if (draft === null) {
      if (!this.drafts.has(teamSlugOrId)) {
        return null;
      }
      this.drafts.delete(teamSlugOrId);
      this.notify();
      return null;
    }
    this.drafts.set(teamSlugOrId, draft);
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
    const nextStep = options?.step ?? "configure";
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
    return buildDraft(nextMetadata, nextConfig);
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
