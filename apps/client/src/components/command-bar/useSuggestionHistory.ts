import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_PREFIX = "command-bar:suggestions:";
const MAX_HISTORY = 50;

export type SuggestionHistoryEntry = {
  value: string;
  lastUsedAt: number;
};

const isBrowser = typeof window !== "undefined";

const safeParseHistory = (raw: string | null): SuggestionHistoryEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.value === "string" &&
        typeof entry.lastUsedAt === "number"
          ? { value: entry.value, lastUsedAt: entry.lastUsedAt }
          : null,
      )
      .filter((entry): entry is SuggestionHistoryEntry => Boolean(entry));
  } catch {
    return [];
  }
};

const readHistory = (storageKey: string): SuggestionHistoryEntry[] => {
  if (!isBrowser) return [];
  try {
    return safeParseHistory(window.localStorage.getItem(storageKey));
  } catch {
    return [];
  }
};

const persistHistory = (
  storageKey: string,
  entries: SuggestionHistoryEntry[],
) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // Ignore storage errors (e.g. private mode)
  }
};

export const buildScopeKey = (scope: string, identity?: string) => {
  const slug = identity ? `${scope}:${identity}` : scope;
  return `${STORAGE_PREFIX}${slug}`;
};

export function useSuggestionHistory(scopeKey: string) {
  const [history, setHistory] = useState<SuggestionHistoryEntry[]>(() =>
    readHistory(scopeKey),
  );
  const keyRef = useRef(scopeKey);

  useEffect(() => {
    if (keyRef.current === scopeKey) return;
    keyRef.current = scopeKey;
    setHistory(readHistory(scopeKey));
  }, [scopeKey]);

  const update = useCallback(
    (updater: (prev: SuggestionHistoryEntry[]) => SuggestionHistoryEntry[]) => {
      setHistory((prev) => {
        const next = updater(prev);
        persistHistory(scopeKey, next);
        return next;
      });
    },
    [scopeKey],
  );

  const record = useCallback(
    (value: string) => {
      if (!value) return;
      update((prev) => {
        const withoutValue = prev.filter((entry) => entry.value !== value);
        return [
          { value, lastUsedAt: Date.now() },
          ...withoutValue,
        ].slice(0, MAX_HISTORY);
      });
    },
    [update],
  );

  const prune = useCallback(
    (validValues: Set<string>) => {
      update((prev) => {
        const filtered = prev.filter((entry) => validValues.has(entry.value));
        return filtered.length === prev.length ? prev : filtered;
      });
    },
    [update],
  );

  const historySet = useMemo(
    () => new Set(history.map((entry) => entry.value)),
    [history],
  );

  return {
    history,
    historySet,
    record,
    prune,
  };
}

export function selectSuggestedItems<T extends { value: string }>(
  history: SuggestionHistoryEntry[],
  items: T[],
  limit = 5,
) {
  if (history.length === 0 || items.length === 0 || limit <= 0) {
    return [];
  }
  const lookup = new Map(items.map((item) => [item.value, item]));
  const suggestions: T[] = [];
  for (const entry of history) {
    const match = lookup.get(entry.value);
    if (match) {
      suggestions.push(match);
    }
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}
