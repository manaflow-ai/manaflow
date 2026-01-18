import { Link } from "@tanstack/react-router";
import {
  Bot,
  Cpu,
  Sparkles,
  TerminalSquare,
  ChevronDown,
  ChevronRight,
  Plus,
  Send,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ConversationScope = "mine" | "all";

export const AVAILABLE_PROVIDERS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
] as const;

export type ProviderId = (typeof AVAILABLE_PROVIDERS)[number];

export type ConversationListEntry = {
  conversationId: string;
  clientConversationId?: string | null;
  providerId: string;
  modelId: string | null;
  cwd: string;
  title: string | null;
  preview: {
    text: string | null;
    kind: "text" | "image" | "resource" | "empty";
  };
  unread: boolean;
  latestMessageAt: number;
  isOptimistic?: boolean;
};

interface ConversationsSidebarProps {
  teamSlugOrId: string;
  scope: ConversationScope;
  onScopeChange: (scope: ConversationScope) => void;
  entries: ConversationListEntry[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  onLoadMore: (count: number) => void;
  activeConversationId?: string;
  onNewConversation: (providerId: ProviderId) => void;
  onPrewarm?: () => void;
  onSubmitDraft?: (text: string, providerId: ProviderId) => void;
  isCreating: boolean;
  providerId: ProviderId;
  onProviderChange: (providerId: ProviderId) => void;
}

const PAGE_SIZE = 30;

const providerMeta: Record<ProviderId, { label: string; icon: LucideIcon; tone: string }> = {
  claude: { label: "claude", icon: Bot, tone: "text-emerald-500" },
  codex: { label: "codex", icon: TerminalSquare, tone: "text-sky-500" },
  gemini: { label: "gemini", icon: Sparkles, tone: "text-amber-500" },
  opencode: { label: "opencode", icon: Cpu, tone: "text-violet-500" },
};

const providerSet = new Set<string>(AVAILABLE_PROVIDERS);

function isProviderId(value: string): value is ProviderId {
  return providerSet.has(value);
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) return "";
  const now = Date.now();
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const days = Math.floor((now - value) / 86_400_000);

  if (isToday) {
    return date
      .toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
      .toLowerCase();
  }
  if (isYesterday) return "yesterday";
  if (days < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" }).toLowerCase();
  }
  return date
    .toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
      year: "2-digit",
    })
    .toLowerCase();
}

function getProviderMeta(providerId: string | undefined): {
  label: string;
  icon: LucideIcon;
  tone: string;
} {
  if (providerId && isProviderId(providerId)) {
    return providerMeta[providerId];
  }
  return { label: providerId ?? "agent", icon: Cpu, tone: "text-neutral-500" };
}

export function ConversationsSidebar({
  teamSlugOrId,
  scope,
  onScopeChange,
  entries,
  status,
  onLoadMore,
  activeConversationId,
  onNewConversation,
  onPrewarm,
  onSubmitDraft,
  isCreating,
  providerId,
  onProviderChange,
}: ConversationsSidebarProps) {
  const canLoadMore = status === "CanLoadMore";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMore = status === "LoadingMore";
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.hasFocus();
  });
  const [draft, setDraft] = useState("");
  const hasPrewarmedRef = useRef(false);
  const prewarmTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (prewarmTimeoutRef.current) {
        window.clearTimeout(prewarmTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!canLoadMore || isLoadingMore) return;
      const remaining =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining < 160) {
        onLoadMore(PAGE_SIZE);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [canLoadMore, isLoadingMore, onLoadMore]);

  const submitDraft = () => {
    if (!onSubmitDraft) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSubmitDraft(trimmed, providerId);
    setDraft("");
    hasPrewarmedRef.current = false;
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);

    if (!onPrewarm) return;

    if (value.trim().length === 0) {
      hasPrewarmedRef.current = false;
      if (prewarmTimeoutRef.current) {
        window.clearTimeout(prewarmTimeoutRef.current);
      }
      return;
    }

    if (hasPrewarmedRef.current) {
      return;
    }

    if (prewarmTimeoutRef.current) {
      window.clearTimeout(prewarmTimeoutRef.current);
    }

    prewarmTimeoutRef.current = window.setTimeout(() => {
      if (hasPrewarmedRef.current) return;
      hasPrewarmedRef.current = true;
      onPrewarm();
    }, 600);
  };

  return (
    <aside className="flex h-dvh w-full flex-col border-b border-neutral-200/70 bg-white dark:border-neutral-800/70 dark:bg-neutral-950 md:w-[320px] md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-5 pt-6">
        <div>
          <div className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
            conversations
          </div>
          <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {teamSlugOrId}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/t/$teamSlugOrId/settings"
            params={{ teamSlugOrId }}
            className={clsx(
              "flex h-8 w-8 items-center justify-center rounded-full transition",
              "text-neutral-500 hover:bg-neutral-200/80 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-200"
            )}
            aria-label="conversation settings"
          >
            <Settings className="h-4 w-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => onNewConversation(providerId)}
            disabled={isCreating}
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200/80 bg-white text-neutral-700 transition",
              "hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800/80 dark:bg-neutral-900 dark:text-neutral-200",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-5 px-5">
        <div className="flex items-center gap-2 rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2 dark:border-neutral-800/80 dark:bg-neutral-900/70">
          <select
            value={providerId}
            onChange={(event) => {
              const selected = AVAILABLE_PROVIDERS.find(
                (value) => value === event.target.value
              );
              if (selected) {
                onProviderChange(selected);
              }
            }}
            className={clsx(
              "min-w-[96px] appearance-none rounded-full border border-neutral-200/80 bg-white/80 px-2 py-1 text-[11px] font-semibold text-neutral-600",
              "dark:border-neutral-800/80 dark:bg-neutral-950/70 dark:text-neutral-300"
            )}
            aria-label="agent"
          >
            {AVAILABLE_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {providerMeta[provider].label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitDraft();
              }
            }}
            placeholder="start a new conversation…"
            className={clsx(
              "w-full bg-transparent px-1 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none",
              "dark:text-neutral-100 dark:placeholder:text-neutral-500"
            )}
          />
          <button
            type="button"
            onClick={submitDraft}
            disabled={draft.trim().length === 0 || isCreating}
            className={clsx(
              "flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-neutral-50 transition",
              "hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-200"
            )}
            aria-label="create conversation"
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-4 px-5">
        <div className="flex rounded-full border border-neutral-200/80 bg-neutral-100/70 p-1 text-xs dark:border-neutral-800/80 dark:bg-neutral-900/70">
          {([
            { value: "mine", label: "mine" },
            { value: "all", label: "all" },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onScopeChange(option.value)}
              className={clsx(
                "flex-1 rounded-full px-3 py-2 text-[11px] font-semibold transition",
                scope === option.value
                  ? "bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="mt-6 flex-1 overflow-y-auto pb-6">
        {entries.length === 0 && status === "LoadingFirstPage" ? (
          <div className="mx-4 rounded-2xl border border-neutral-200/70 bg-neutral-50/80 p-4 text-sm text-neutral-500 dark:border-neutral-800/70 dark:bg-neutral-900/60 dark:text-neutral-400">
            loading conversations…
          </div>
        ) : entries.length === 0 ? (
          <div className="mx-4 rounded-2xl border border-neutral-200/70 bg-neutral-50/80 p-4 text-sm text-neutral-500 dark:border-neutral-800/70 dark:bg-neutral-900/60 dark:text-neutral-400">
            no conversations yet. start a new one to see it here.
          </div>
        ) : (
          <ConversationList
            entries={entries}
            teamSlugOrId={teamSlugOrId}
            activeConversationId={activeConversationId}
            isWindowFocused={isWindowFocused}
            status={status}
          />
        )}
      </div>
    </aside>
  );
}

interface ConversationListProps {
  teamSlugOrId: string;
  entries: ConversationListEntry[];
  activeConversationId?: string;
  isWindowFocused: boolean;
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
}

function ConversationList({
  teamSlugOrId,
  entries,
  activeConversationId,
  isWindowFocused,
  status,
}: ConversationListProps) {
  const isLoadingMore = status === "LoadingMore";

  return (
    <div>
      {entries.map((entry) => (
        <ConversationRow
          key={entry.conversationId}
          entry={entry}
          teamSlugOrId={teamSlugOrId}
          isActive={activeConversationId === entry.conversationId}
          isWindowFocused={isWindowFocused}
        />
      ))}
      {isLoadingMore ? (
        <div className="py-3 text-center text-xs text-neutral-400">
          loading more…
        </div>
      ) : null}
      {status === "Exhausted" ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-neutral-400">
          <ChevronDown className="h-3 w-3" aria-hidden />
          end
        </div>
      ) : null}
    </div>
  );
}

function ConversationRow({
  entry,
  teamSlugOrId,
  isActive,
  isWindowFocused,
}: {
  entry: ConversationListEntry;
  teamSlugOrId: string;
  isActive: boolean;
  isWindowFocused: boolean;
}) {
  const { preview, unread, latestMessageAt, isOptimistic, title } = entry;
  const provider = getProviderMeta(entry.providerId);
  const timeLabel = formatTimestamp(latestMessageAt);
  // Show title if available, otherwise fallback to provider label (e.g., "claude")
  const displayTitle = title ?? provider.label;
  const fallbackSubtitle =
    preview.kind === "image"
      ? "image"
      : preview.kind === "resource"
        ? "attachment"
        : "no messages yet";
  const optimisticSubtitle =
    preview.text ?? (preview.kind === "empty" ? "creating conversation…" : fallbackSubtitle);
  const subtitle = isOptimistic ? optimisticSubtitle : preview.text ?? fallbackSubtitle;
  const showUnread = unread && !(isActive && isWindowFocused);

  return (
    <Link
      to="/t/$teamSlugOrId/$conversationId"
      params={{
        teamSlugOrId,
        conversationId: entry.conversationId,
      }}
      className={clsx(
        "group relative flex h-20 items-center gap-3 border-b border-neutral-200/70 pl-6 pr-4 transition-colors",
        "hover:bg-neutral-100/80 dark:border-neutral-800/70 dark:hover:bg-neutral-900/60",
        isActive && "bg-neutral-200/60 dark:bg-neutral-900"
      )}
      activeProps={{
        className: "bg-neutral-200/60 dark:bg-neutral-900",
      }}
    >
      <span
        className={clsx(
          "pointer-events-none absolute left-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#007AFF] transition-opacity",
          showUnread ? "opacity-100" : "opacity-0"
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
              {displayTitle}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[12px] text-neutral-500 dark:text-neutral-400">
              {timeLabel}
            </span>
            <ChevronRight className="h-3 w-3 text-neutral-400 dark:text-neutral-600" />
          </div>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </div>
      </div>
    </Link>
  );
}
