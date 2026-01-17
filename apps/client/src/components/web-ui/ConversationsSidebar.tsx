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

export type ConversationListEntry = {
  conversationId: string;
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
  onNewConversation: () => void;
  onPrewarm?: () => void;
  onSubmitDraft?: (text: string) => void;
  isCreating: boolean;
}

const PAGE_SIZE = 30;

const providerMeta: Record<
  string,
  { label: string; icon: LucideIcon; tone: string }
> = {
  claude: { label: "claude", icon: Bot, tone: "text-emerald-500" },
  codex: { label: "codex", icon: TerminalSquare, tone: "text-sky-500" },
  gemini: { label: "gemini", icon: Sparkles, tone: "text-amber-500" },
  opencode: { label: "opencode", icon: Cpu, tone: "text-violet-500" },
};

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
  if (providerId && providerMeta[providerId]) {
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
}: ConversationsSidebarProps) {
  const canLoadMore = status === "CanLoadMore";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMore = status === "LoadingMore";
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
    onSubmitDraft(trimmed);
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
            onClick={onNewConversation}
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
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
}

function ConversationList({
  teamSlugOrId,
  entries,
  activeConversationId,
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
}: {
  entry: ConversationListEntry;
  teamSlugOrId: string;
  isActive: boolean;
}) {
  const { preview, unread, latestMessageAt, isOptimistic, title } = entry;
  const provider = getProviderMeta(entry.providerId);
  const timeLabel = formatTimestamp(latestMessageAt);
  // Show title if available, otherwise fallback to provider label (e.g., "claude")
  const displayTitle = title ?? provider.label;
  const subtitle = isOptimistic
    ? "creating conversation…"
    : preview.text ??
      (preview.kind === "image"
        ? "image"
        : preview.kind === "resource"
          ? "attachment"
          : "no messages yet");

  return (
    <Link
      to="/t/$teamSlugOrId/$conversationId"
      params={{
        teamSlugOrId,
        conversationId: entry.conversationId,
      }}
      className={clsx(
        "group flex h-20 items-center gap-3 border-b border-neutral-200/70 px-4 transition-colors",
        "hover:bg-neutral-100/80 dark:border-neutral-800/70 dark:hover:bg-neutral-900/60",
        isActive && "bg-neutral-200/60 dark:bg-neutral-900"
      )}
      activeProps={{
        className: "bg-neutral-200/60 dark:bg-neutral-900",
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
            {displayTitle}
          </span>
          <div className="flex items-center gap-2">
            {unread ? (
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            ) : null}
            <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
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
