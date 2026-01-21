import { Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  CircleDot,
  Cpu,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  TerminalSquare,
  Trash2,
  ChevronDown,
  ChevronRight,
  SquarePen,
  ArrowUp,
  Settings,
  ImagePlus,
} from "lucide-react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type Ref,
} from "react";
import SearchableSelect, {
  type SelectOptionObject,
} from "@/components/ui/searchable-select";
import { AgentLogo } from "@/components/icons/agent-logos";
import { ContextMenu } from "@base-ui-components/react/context-menu";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import { useConversationRename } from "@/hooks/useConversationRename";
import { toast } from "sonner";
import {
  clearConversationManualUnread,
  markConversationManualUnread,
} from "@/lib/conversationReadOverrides";
import { Menu } from "@base-ui-components/react/menu";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

const PREWARM_MESSAGES_PAGE_SIZE = 40;
const PREWARM_RAW_EVENTS_PAGE_SIZE = 120;

function ListFilterIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1="2"
        y1="3.5"
        x2="14"
        y2="3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="7.5"
        x2="13"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="11.5"
        x2="12"
        y2="11.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const AVAILABLE_PROVIDERS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
] as const;

export type ProviderId = (typeof AVAILABLE_PROVIDERS)[number];

export type ConversationFilterMode = "all" | "unread" | "archived";

export type ConversationListEntry = {
  conversationId: string;
  clientConversationId?: string | null;
  providerId: string;
  modelId: string | null;
  cwd: string;
  title: string | null;
  pinned: boolean;
  isArchived: boolean;
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
  filterMode: ConversationFilterMode;
  onFilterChange: (next: ConversationFilterMode) => void;
}

const PAGE_SIZE = 30;
const DEFAULT_PIN_LEFT_PX = 7;
const DEFAULT_PIN_TOP_PX = 16;

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

function isRealConversationEntry(
  entry: ConversationListEntry
): entry is ConversationListEntry & { conversationId: Id<"conversations"> } {
  return !entry.isOptimistic;
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
  filterMode,
  onFilterChange,
}: ConversationsSidebarProps) {
  const canLoadMore = status === "CanLoadMore";

  const scrollRef = useRef<HTMLDivElement>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const isLoadingMore = status === "LoadingMore";
  const [mutationLogEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("e2e-reset");
    if (resetToken && window.__cmuxE2EResetToken !== resetToken) {
      window.__cmuxMessageMutationLog = [];
      window.__cmuxE2EResetToken = resetToken;
    }
    const enabled = params.get("e2e") === "1" || window.__cmuxE2E === true;
    if (params.get("e2e") === "1") {
      window.__cmuxE2E = true;
    }
    return enabled;
  });
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

  const pinLeftPx = DEFAULT_PIN_LEFT_PX;
  const pinTopPx = DEFAULT_PIN_TOP_PX;
  const handleListRef = useCallback((node: HTMLDivElement | null) => {
    setListElement(node);
  }, []);

  return (
    <aside className="flex h-dvh w-full flex-col border-b border-neutral-200/70 bg-white dark:border-neutral-800/70 dark:bg-neutral-950 md:w-[320px] md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          cmux
        </div>
        <div className="flex items-center gap-2">
          <Menu.Root>
            <Menu.Trigger
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-full transition",
                "text-neutral-500 hover:bg-neutral-200/80 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-200"
              )}
              aria-label="Filter conversations"
            >
              <ListFilterIcon className="h-4 w-4" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                sideOffset={6}
                align="end"
                className="outline-none z-[var(--z-context-menu)]"
              >
                <Menu.Popup className="origin-[var(--transform-origin)] rounded-md bg-white dark:bg-neutral-800 py-1 text-neutral-900 dark:text-neutral-100 shadow-lg shadow-neutral-200 outline-1 outline-neutral-200 transition-[opacity] data-[ending-style]:opacity-0 dark:shadow-none dark:-outline-offset-1 dark:outline-neutral-700">
                  <Menu.RadioGroup
                    value={filterMode}
                    onValueChange={(value) =>
                      onFilterChange(value as ConversationFilterMode)
                    }
                  >
                    {[
                      { value: "all", label: "All conversations" },
                      { value: "unread", label: "Unread" },
                      { value: "archived", label: "Archived" },
                    ].map((option) => (
                      <Menu.RadioItem
                        key={option.value}
                        value={option.value}
                        className="grid cursor-default grid-cols-[0.75rem_1fr] items-center gap-2 py-1.5 pr-8 pl-2.5 text-[13px] leading-5 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-700"
                      >
                        <Menu.RadioItemIndicator className="col-start-1 flex items-center justify-center">
                          <Check className="h-3 w-3" />
                        </Menu.RadioItemIndicator>
                        <span className="col-start-2">{option.label}</span>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
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
            pinLeftPx={pinLeftPx}
            pinTopPx={pinTopPx}
            listRef={handleListRef}
          />
        )}
      </div>
      <ConversationListMutationLog
        enabled={mutationLogEnabled}
        listElement={listElement}
      />
    </aside>
  );
}

type ConversationMutationRef = {
  conversationId: string;
  clientConversationId: string | null;
};

type ConversationMutationItem = ConversationMutationRef & {
  title: string;
  preview: string;
};

type ConversationMutationSnapshot = {
  at: number;
  reason: "init" | "mutation";
  items: ConversationMutationItem[];
  added: ConversationMutationRef[];
  removed: ConversationMutationRef[];
};

const MAX_CONVERSATION_MUTATION_LOG_ENTRIES = 200;

function normalizeClientConversationId(value: string | undefined): string | null {
  if (!value) return null;
  return value;
}

function collectConversationItems(
  container: HTMLElement
): ConversationMutationItem[] {
  const items: ConversationMutationItem[] = [];
  const elements = container.querySelectorAll<HTMLElement>(
    "[data-conversation-id]"
  );
  for (const element of elements) {
    const conversationId = element.dataset.conversationId;
    if (!conversationId) continue;
    items.push({
      conversationId,
      clientConversationId: normalizeClientConversationId(
        element.dataset.clientConversationId
      ),
      title: element.dataset.conversationTitle ?? "",
      preview: element.dataset.conversationPreview ?? "",
    });
  }
  return items;
}

function upsertConversationRef(
  target: Map<string, ConversationMutationRef>,
  conversationId: string,
  clientConversationId: string | null
) {
  const key = `${conversationId}::${clientConversationId ?? ""}`;
  if (!target.has(key)) {
    target.set(key, { conversationId, clientConversationId });
  }
}

function collectConversationRefsFromNode(
  node: Node,
  target: Map<string, ConversationMutationRef>
) {
  if (!(node instanceof HTMLElement)) return;
  const nodes: HTMLElement[] = [];
  if (node.dataset.conversationId) {
    nodes.push(node);
  }
  const childNodes = node.querySelectorAll<HTMLElement>(
    "[data-conversation-id]"
  );
  for (const child of childNodes) {
    nodes.push(child);
  }
  for (const element of nodes) {
    const conversationId = element.dataset.conversationId;
    if (!conversationId) continue;
    upsertConversationRef(
      target,
      conversationId,
      normalizeClientConversationId(element.dataset.clientConversationId)
    );
  }
}

// E2E-only mutation log for catching sidebar row flashes/duplicates.
function ConversationListMutationLog({
  enabled,
  listElement,
}: {
  enabled: boolean;
  listElement: HTMLDivElement | null;
}) {
  const logRef = useRef<ConversationMutationSnapshot[]>([]);
  const logTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingAddedRef = useRef<Map<string, ConversationMutationRef>>(
    new Map()
  );
  const pendingRemovedRef = useRef<Map<string, ConversationMutationRef>>(
    new Map()
  );
  const rafPendingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const list = listElement;
    const logTextarea = logTextareaRef.current;
    if (!list || !logTextarea) return;

    const recordSnapshot = (reason: "init" | "mutation") => {
      const items = collectConversationItems(list);
      const added = Array.from(pendingAddedRef.current.values());
      const removed = Array.from(pendingRemovedRef.current.values());
      pendingAddedRef.current.clear();
      pendingRemovedRef.current.clear();
      const entry: ConversationMutationSnapshot = {
        at: Date.now(),
        reason,
        items,
        added,
        removed,
      };
      const nextLog = [...logRef.current, entry].slice(
        -MAX_CONVERSATION_MUTATION_LOG_ENTRIES
      );
      logRef.current = nextLog;
      logTextarea.value = JSON.stringify(nextLog);
    };

    const scheduleSnapshot = () => {
      if (rafPendingRef.current) return;
      rafPendingRef.current = true;
      window.requestAnimationFrame(() => {
        rafPendingRef.current = false;
        recordSnapshot("mutation");
      });
    };

    recordSnapshot("init");

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          collectConversationRefsFromNode(node, pendingAddedRef.current);
        }
        for (const node of record.removedNodes) {
          collectConversationRefsFromNode(node, pendingRemovedRef.current);
        }
      }
      scheduleSnapshot();
    });

    observer.observe(list, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [enabled, listElement]);

  if (!enabled) return null;

  return (
    <textarea
      ref={logTextareaRef}
      aria-label="conversation mutation log"
      data-testid="conversation-mutation-log"
      readOnly
      defaultValue="[]"
      className="sr-only"
    />
  );
}

interface ConversationListProps {
  teamSlugOrId: string;
  entries: ConversationListEntry[];
  activeConversationId?: string;
  isWindowFocused: boolean;
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  pinLeftPx: number;
  pinTopPx: number;
  listRef: Ref<HTMLDivElement>;
}

function ConversationList({
  teamSlugOrId,
  entries,
  activeConversationId,
  isWindowFocused,
  status,
  pinLeftPx,
  pinTopPx,
  listRef,
}: ConversationListProps) {
  const isLoadingMore = status === "LoadingMore";

  return (
    <div ref={listRef} data-testid="conversation-list">
      {entries.map((entry) => (
        <ConversationRow
          key={entry.conversationId}
          entry={entry}
          teamSlugOrId={teamSlugOrId}
          isActive={activeConversationId === entry.conversationId}
          isWindowFocused={isWindowFocused}
          pinLeftPx={pinLeftPx}
          pinTopPx={pinTopPx}
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
  pinLeftPx,
  pinTopPx,
}: {
  entry: ConversationListEntry;
  teamSlugOrId: string;
  isActive: boolean;
  isWindowFocused: boolean;
  pinLeftPx: number;
  pinTopPx: number;
}) {
  const { preview, unread, latestMessageAt, isOptimistic, title } = entry;
  const navigate = useNavigate();
  const conversationId = isRealConversationEntry(entry)
    ? entry.conversationId
    : null;
  const canMutate = conversationId !== null;
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
    preview.text ??
    (preview.kind === "empty" ? "creating conversation…" : fallbackSubtitle);
  const subtitle = isOptimistic
    ? optimisticSubtitle
    : preview.text ?? fallbackSubtitle;
  const showUnread = unread && !(isActive && isWindowFocused);
  const hasPrefetchedRef = useRef(false);

  const {
    isRenaming,
    renameValue,
    renameError,
    isRenamePending,
    renameInputRef,
    handleRenameChange,
    handleRenameKeyDown,
    handleRenameBlur,
    handleRenameFocus,
    handleStartRenaming,
  } = useConversationRename({
    conversationId,
    teamSlugOrId,
    currentText: displayTitle,
    canRename: canMutate,
  });

  const pinConversation = useMutation(
    api.conversations.pin
  ).withOptimisticUpdate((localStore, args) => {
    const queries = localStore.getAllQueries(
      api.conversations.listPagedWithLatest
    );
    for (const { args: queryArgs, value } of queries) {
      if (!value) {
        continue;
      }
      const nextPage = value.page.map((item) =>
        item.conversation._id === args.conversationId
          ? {
              ...item,
              conversation: {
                ...item.conversation,
                pinned: true,
              },
            }
          : item
      );
      localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
        ...value,
        page: nextPage,
      });
    }

    const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
    for (const { args: queryArgs, value } of detailQueries) {
      if (!value?.conversation) {
        continue;
      }
      if (value.conversation._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getDetail, queryArgs, {
        ...value,
        conversation: {
          ...value.conversation,
          pinned: true,
        },
      });
    }
  });

  const unpinConversation = useMutation(
    api.conversations.unpin
  ).withOptimisticUpdate((localStore, args) => {
    const queries = localStore.getAllQueries(
      api.conversations.listPagedWithLatest
    );
    for (const { args: queryArgs, value } of queries) {
      if (!value) {
        continue;
      }
      const nextPage = value.page.map((item) =>
        item.conversation._id === args.conversationId
          ? {
              ...item,
              conversation: {
                ...item.conversation,
                pinned: false,
              },
            }
          : item
      );
      localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
        ...value,
        page: nextPage,
      });
    }

    const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
    for (const { args: queryArgs, value } of detailQueries) {
      if (!value?.conversation) {
        continue;
      }
      if (value.conversation._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getDetail, queryArgs, {
        ...value,
        conversation: {
          ...value.conversation,
          pinned: false,
        },
      });
    }
  });

  const archiveConversation = useMutation(
    api.conversations.archive
  ).withOptimisticUpdate((localStore, args) => {
    const queries = localStore.getAllQueries(
      api.conversations.listPagedWithLatest
    );
    for (const { args: queryArgs, value } of queries) {
      if (!value) {
        continue;
      }
      const includeArchived =
        (queryArgs as { includeArchived?: boolean }).includeArchived === true;
      const nextPage = includeArchived
        ? value.page.map((item) =>
            item.conversation._id === args.conversationId
              ? {
                  ...item,
                  conversation: {
                    ...item.conversation,
                    isArchived: true,
                  },
                }
              : item
          )
        : value.page.filter(
            (item) => item.conversation._id !== args.conversationId
          );
      localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
        ...value,
        page: nextPage,
      });
    }

    const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
    for (const { args: queryArgs, value } of detailQueries) {
      if (!value?.conversation) {
        continue;
      }
      if (value.conversation._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getDetail, queryArgs, {
        ...value,
        conversation: {
          ...value.conversation,
          isArchived: true,
        },
      });
    }
  });

  const unarchiveConversation = useMutation(
    api.conversations.unarchive
  ).withOptimisticUpdate((localStore, args) => {
    const queries = localStore.getAllQueries(
      api.conversations.listPagedWithLatest
    );
    for (const { args: queryArgs, value } of queries) {
      if (!value) {
        continue;
      }
      const nextPage = value.page.map((item) =>
        item.conversation._id === args.conversationId
          ? {
              ...item,
              conversation: {
                ...item.conversation,
                isArchived: false,
              },
            }
          : item
      );
      localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
        ...value,
        page: nextPage,
      });
    }

    const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
    for (const { args: queryArgs, value } of detailQueries) {
      if (!value?.conversation) {
        continue;
      }
      if (value.conversation._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getDetail, queryArgs, {
        ...value,
        conversation: {
          ...value.conversation,
          isArchived: false,
        },
      });
    }
  });

  const removeConversation = useMutation(
    api.conversations.remove
  ).withOptimisticUpdate((localStore, args) => {
    const queries = localStore.getAllQueries(
      api.conversations.listPagedWithLatest
    );
    for (const { args: queryArgs, value } of queries) {
      if (!value) {
        continue;
      }
      const nextPage = value.page.filter(
        (item) => item.conversation._id !== args.conversationId
      );
      localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
        ...value,
        page: nextPage,
      });
    }

    const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
    for (const { args: queryArgs, value } of detailQueries) {
      if (!value?.conversation) {
        continue;
      }
      if (value.conversation._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getDetail, queryArgs, null);
    }

    const byIdQueries = localStore.getAllQueries(api.conversations.getById);
    for (const { args: queryArgs, value } of byIdQueries) {
      if (!value || value._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getById, queryArgs, null);
    }
  });

  const markUnread = useMutation(
    api.conversationReads.markUnread
  ).withOptimisticUpdate((localStore, args) => {
    const queries = localStore.getAllQueries(
      api.conversations.listPagedWithLatest
    );
    for (const { args: queryArgs, value } of queries) {
      if (!value) {
        continue;
      }
      const nextPage = value.page.map((item) =>
        item.conversation._id === args.conversationId
          ? { ...item, unread: true }
          : item
      );
      localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
        ...value,
        page: nextPage,
      });
    }

    const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
    for (const { args: queryArgs, value } of detailQueries) {
      if (!value?.conversation) {
        continue;
      }
      if (value.conversation._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getDetail, queryArgs, {
        ...value,
        lastReadAt: 0,
      });
    }
  });

  const markRead = useMutation(
    api.conversationReads.markRead
  ).withOptimisticUpdate((localStore, args) => {
    const queries = localStore.getAllQueries(
      api.conversations.listPagedWithLatest
    );
    for (const { args: queryArgs, value } of queries) {
      if (!value) {
        continue;
      }
      const nextPage = value.page.map((item) =>
        item.conversation._id === args.conversationId
          ? { ...item, unread: false }
          : item
      );
      localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
        ...value,
        page: nextPage,
      });
    }

    const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
    for (const { args: queryArgs, value } of detailQueries) {
      if (!value?.conversation) {
        continue;
      }
      if (value.conversation._id !== args.conversationId) {
        continue;
      }
      localStore.setQuery(api.conversations.getDetail, queryArgs, {
        ...value,
        lastReadAt: args.lastReadAt ?? Date.now(),
      });
    }
  });

  const handleLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (isRenaming || event.defaultPrevented) {
        event.preventDefault();
      }
    },
    [isRenaming]
  );

  const handlePrefetch = useCallback(() => {
    if (!conversationId) {
      return;
    }
    if (hasPrefetchedRef.current) {
      return;
    }
    hasPrefetchedRef.current = true;
    convexQueryClient.convexClient.prewarmQuery({
      query: api.conversations.getDetail,
      args: { teamSlugOrId, conversationId },
    });
    convexQueryClient.convexClient.prewarmQuery({
      query: api.acp.getStreamInfo,
      args: { teamSlugOrId, conversationId },
    });
    convexQueryClient.convexClient.prewarmQuery({
      query: api.conversationMessages.listByConversationFirstPage,
      args: {
        teamSlugOrId,
        conversationId,
        numItems: PREWARM_MESSAGES_PAGE_SIZE,
      },
    });
    convexQueryClient.convexClient.prewarmQuery({
      query: api.acpRawEvents.listByConversationFirstPage,
      args: {
        teamSlugOrId,
        conversationId,
        numItems: PREWARM_RAW_EVENTS_PAGE_SIZE,
      },
    });
  }, [conversationId, teamSlugOrId]);

  const handlePinFromMenu = useCallback(() => {
    if (!conversationId) {
      return;
    }
    void pinConversation({ teamSlugOrId, conversationId }).catch((error) => {
      console.error("Failed to pin conversation", error);
      toast.error("Failed to pin conversation");
    });
  }, [conversationId, pinConversation, teamSlugOrId]);

  const handleUnpinFromMenu = useCallback(() => {
    if (!conversationId) {
      return;
    }
    void unpinConversation({ teamSlugOrId, conversationId }).catch((error) => {
      console.error("Failed to unpin conversation", error);
      toast.error("Failed to unpin conversation");
    });
  }, [conversationId, teamSlugOrId, unpinConversation]);

  const handleArchiveFromMenu = useCallback(() => {
    if (!conversationId) {
      return;
    }
    void archiveConversation({ teamSlugOrId, conversationId })
      .then(() => {
        if (isActive) {
          void navigate({
            to: "/t/$teamSlugOrId",
            params: { teamSlugOrId },
          });
        }
      })
      .catch((error) => {
        console.error("Failed to archive conversation", error);
        toast.error("Failed to archive conversation");
      });
  }, [archiveConversation, conversationId, isActive, navigate, teamSlugOrId]);

  const handleUnarchiveFromMenu = useCallback(() => {
    if (!conversationId) {
      return;
    }
    void unarchiveConversation({ teamSlugOrId, conversationId }).catch(
      (error) => {
        console.error("Failed to unarchive conversation", error);
        toast.error("Failed to unarchive conversation");
      }
    );
  }, [conversationId, teamSlugOrId, unarchiveConversation]);

  const handleDeleteFromMenu = useCallback(() => {
    if (!conversationId) {
      return;
    }
    if (
      !confirm(
        "Are you sure you want to delete this conversation? This action cannot be undone."
      )
    ) {
      return;
    }
    void removeConversation({ teamSlugOrId, conversationId })
      .then(() => {
        if (isActive) {
          void navigate({
            to: "/t/$teamSlugOrId",
            params: { teamSlugOrId },
          });
        }
      })
      .catch((error) => {
        console.error("Failed to delete conversation", error);
        toast.error("Failed to delete conversation");
      });
  }, [conversationId, isActive, navigate, removeConversation, teamSlugOrId]);

  const handleMarkUnread = useCallback(() => {
    if (!conversationId) {
      return;
    }
    markConversationManualUnread(conversationId);
    void markUnread({ teamSlugOrId, conversationId }).catch((error) => {
      clearConversationManualUnread(conversationId);
      console.error("Failed to mark conversation unread", error);
      toast.error("Failed to mark conversation unread");
    });
  }, [conversationId, markUnread, teamSlugOrId]);

  const handleMarkRead = useCallback(() => {
    if (!conversationId) {
      return;
    }
    clearConversationManualUnread(conversationId);
    void markRead({
      teamSlugOrId,
      conversationId,
      lastReadAt: Date.now(),
    }).catch((error) => {
      console.error("Failed to mark conversation read", error);
      toast.error("Failed to mark conversation read");
    });
  }, [conversationId, markRead, teamSlugOrId]);

  const menuItemClassName =
    "flex items-center gap-2 cursor-default py-1.5 pr-8 pl-3 text-[13px] leading-5 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-700";

  return (
    <div className="relative">
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <Link
            to="/t/$teamSlugOrId/$conversationId"
            params={{
              teamSlugOrId,
              conversationId: entry.conversationId,
            }}
            onClick={handleLinkClick}
            onMouseEnter={handlePrefetch}
            onFocus={handlePrefetch}
            data-conversation-id={entry.conversationId}
            data-client-conversation-id={entry.clientConversationId ?? ""}
            data-conversation-title={displayTitle}
            data-conversation-preview={subtitle}
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
            {entry.pinned ? (
              <Pin
                className="pointer-events-none absolute h-2.5 w-2.5 text-neutral-400 dark:text-neutral-500"
                style={{ left: pinLeftPx, top: pinTopPx }}
                aria-hidden
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={handleRenameChange}
                      onKeyDown={handleRenameKeyDown}
                      onBlur={handleRenameBlur}
                      onFocus={handleRenameFocus}
                      disabled={isRenamePending}
                      autoFocus
                      placeholder="Conversation title"
                      aria-label="Conversation title"
                      aria-invalid={renameError ? true : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      className={clsx(
                        "w-full bg-transparent text-[14px] font-semibold text-neutral-900 outline-none placeholder:text-neutral-400",
                        "dark:text-neutral-100 dark:placeholder:text-neutral-500",
                        isRenamePending &&
                          "text-neutral-400/70 dark:text-neutral-500/70 cursor-wait"
                      )}
                    />
                  ) : (
                    <span className="truncate text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
                      {displayTitle}
                    </span>
                  )}
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
        </ContextMenu.Trigger>
        {renameError ? (
          <div className="mt-1 pl-6 pr-4 text-[11px] text-red-500 dark:text-red-400">
            {renameError}
          </div>
        ) : null}
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="outline-none z-[var(--z-context-menu)]">
            <ContextMenu.Popup className="origin-[var(--transform-origin)] rounded-md bg-white dark:bg-neutral-800 py-1 text-neutral-900 dark:text-neutral-100 shadow-lg shadow-neutral-200 outline-1 outline-neutral-200 transition-[opacity] data-[ending-style]:opacity-0 dark:shadow-none dark:-outline-offset-1 dark:outline-neutral-700">
              {canMutate && unread ? (
                <ContextMenu.Item
                  className={menuItemClassName}
                  onClick={handleMarkRead}
                >
                  <Check className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                  <span>Mark as read</span>
                </ContextMenu.Item>
              ) : null}
              {canMutate && !unread ? (
                <ContextMenu.Item
                  className={menuItemClassName}
                  onClick={handleMarkUnread}
                >
                  <CircleDot className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                  <span>Mark as unread</span>
                </ContextMenu.Item>
              ) : null}
              {canMutate ? (
                <ContextMenu.Item
                  className={menuItemClassName}
                  onClick={handleStartRenaming}
                >
                  <Pencil className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                  <span>Rename</span>
                </ContextMenu.Item>
              ) : null}
              {canMutate ? (
                entry.pinned ? (
                  <ContextMenu.Item
                    className={menuItemClassName}
                    onClick={handleUnpinFromMenu}
                  >
                    <PinOff className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                    <span>Unpin</span>
                  </ContextMenu.Item>
                ) : (
                  <ContextMenu.Item
                    className={menuItemClassName}
                    onClick={handlePinFromMenu}
                  >
                    <Pin className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                    <span>Pin</span>
                  </ContextMenu.Item>
                )
              ) : null}
              {canMutate ? (
                entry.isArchived ? (
                  <ContextMenu.Item
                    className={menuItemClassName}
                    onClick={handleUnarchiveFromMenu}
                  >
                    <ArchiveRestore className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                    <span>Unarchive</span>
                  </ContextMenu.Item>
                ) : (
                  <ContextMenu.Item
                    className={menuItemClassName}
                    onClick={handleArchiveFromMenu}
                  >
                    <Archive className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                    <span>Archive</span>
                  </ContextMenu.Item>
                )
              ) : null}
              {canMutate ? (
                <ContextMenu.Item
                  className={clsx(menuItemClassName, "text-red-600 dark:text-red-400")}
                  onClick={handleDeleteFromMenu}
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  <span>Delete</span>
                </ContextMenu.Item>
              ) : null}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}
