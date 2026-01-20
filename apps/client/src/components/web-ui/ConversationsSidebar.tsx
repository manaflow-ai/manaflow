import { Link } from "@tanstack/react-router";
import {
  Bot,
  Cpu,
  Sparkles,
  TerminalSquare,
  ChevronDown,
  ChevronRight,
  SquarePen,
  ArrowUp,
  Settings,
  ImagePlus,
} from "lucide-react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import SearchableSelect, {
  type SelectOptionObject,
} from "@/components/ui/searchable-select";
import { AgentLogo } from "@/components/icons/agent-logos";

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

const providerMeta: Record<
  ProviderId,
  { label: string; icon: LucideIcon; tone: string }
> = {
  claude: { label: "claude", icon: Bot, tone: "text-emerald-500" },
  codex: { label: "codex", icon: TerminalSquare, tone: "text-sky-500" },
  gemini: { label: "gemini", icon: Sparkles, tone: "text-amber-500" },
  opencode: { label: "opencode", icon: Cpu, tone: "text-violet-500" },
};

const providerOptions: SelectOptionObject[] = AVAILABLE_PROVIDERS.map(
  (provider) => {
    const meta = providerMeta[provider];
    return {
      label: meta.label,
      value: provider,
      icon: (
        <AgentLogo
          agentName={`${provider}/`}
          className="h-4 w-4 text-neutral-900 dark:text-neutral-100"
        />
      ),
      iconKey: provider,
    };
  }
);

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

function SidebarComposeVariantC({
  draft,
  isCreating,
  providerId,
  onProviderChange,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  isCreating: boolean;
  providerId: ProviderId;
  onProviderChange: (providerId: ProviderId) => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 dark:border-neutral-800/80 dark:bg-neutral-900/70">
      <div className="px-3 py-2">
        <SidebarDraftInput
          value={draft}
          onChange={onDraftChange}
          onSubmit={onSubmit}
          placeholder="Start a new conversation…"
          minRows={3}
          className={clsx(
            "w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none",
            "dark:text-neutral-100 dark:placeholder:text-neutral-500"
          )}
        />
      </div>
      <div className="flex items-center justify-between border-t border-neutral-200/70 px-1.5 py-1 dark:border-neutral-800/70">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            className="flex h-8 w-8 items-center justify-center text-neutral-400 opacity-60 dark:text-neutral-500"
            aria-label="attach image"
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
          </button>
          <SidebarProviderPicker
            providerId={providerId}
            onProviderChange={onProviderChange}
            disabled={isCreating}
            variant="compact"
          />
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={draft.trim().length === 0 || isCreating}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition",
            "hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
          )}
          aria-label="create conversation"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function SidebarProviderPicker({
  providerId,
  onProviderChange,
  disabled,
  variant,
}: {
  providerId: ProviderId;
  onProviderChange: (providerId: ProviderId) => void;
  disabled: boolean;
  variant: "compact" | "pill" | "ghost";
}) {
  const triggerClassName =
    variant === "compact"
      ? "h-6 rounded-full border-neutral-200/70 bg-white/80 px-2 text-[11px] font-normal text-neutral-600 dark:border-neutral-800/70 dark:bg-neutral-950/70 dark:text-neutral-300"
      : variant === "ghost"
        ? "h-7 rounded-full border-transparent bg-transparent px-2 text-[11px] font-normal text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
        : "h-7 rounded-full border-neutral-200/70 bg-white/80 px-2 text-[11px] font-normal text-neutral-600 dark:border-neutral-800/70 dark:bg-neutral-950/70 dark:text-neutral-300";

  return (
    <SearchableSelect
      options={providerOptions}
      value={[providerId]}
      onChange={(next) => {
        const nextValue = next[0];
        if (nextValue && isProviderId(nextValue)) {
          onProviderChange(nextValue);
        }
      }}
      singleSelect
      showSearch={false}
      disabled={disabled}
      classNames={{
        trigger: triggerClassName,
        popover:
          "w-[220px] rounded-xl border-neutral-200/80 dark:border-neutral-800/80",
        commandGroup: "p-2",
        commandItem:
          "rounded-lg data-[selected=true]:bg-neutral-100 dark:data-[selected=true]:bg-neutral-900",
      }}
      placeholder="Select model"
    />
  );
}

function SidebarDraftInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  className,
  minRows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  className: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight);
    const fontSize = Number.parseFloat(computed.fontSize);
    const paddingTop = Number.parseFloat(computed.paddingTop);
    const paddingBottom = Number.parseFloat(computed.paddingBottom);
    const borderTop = Number.parseFloat(computed.borderTopWidth);
    const borderBottom = Number.parseFloat(computed.borderBottomWidth);
    const resolvedLineHeight = Number.isFinite(lineHeight)
      ? lineHeight
      : Number.isFinite(fontSize)
        ? fontSize * 1.4
        : 16;
    const minHeight =
      resolvedLineHeight * minRows +
      paddingTop +
      paddingBottom +
      borderTop +
      borderBottom;
    textarea.style.height = "0px";
    textarea.style.minHeight = `${minHeight}px`;
    textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
  }, [value, minRows]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSubmit();
        }
      }}
      rows={minRows}
      placeholder={placeholder}
      className={clsx("resize-none", className)}
    />
  );
}

export function ConversationsSidebar({
  teamSlugOrId,
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
      <div className="flex items-center justify-between px-4 py-2">
        <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          cmux
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
            <SquarePen className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-3 px-4">
        <SidebarComposeVariantC
          draft={draft}
          isCreating={isCreating}
          providerId={providerId}
          onProviderChange={onProviderChange}
          onDraftChange={handleDraftChange}
          onSubmit={submitDraft}
        />
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
