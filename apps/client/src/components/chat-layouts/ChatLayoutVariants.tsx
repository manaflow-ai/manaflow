import type { ReactNode, RefObject, MutableRefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { ArrowDown } from "lucide-react";

type ChatLayoutProps = {
  header: ReactNode;
  messages: ReactNode;
  composer: ReactNode;
  permissionPrompt?: ReactNode;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isLoadingMore: boolean;
  scrollContainerRef?: MutableRefObject<HTMLElement | null>;
  scrollToBottomOnMount?: boolean;
  resetKey?: string;
};

const MAX_WIDTH = "max-w-3xl";
const COMPOSER_MAX_WIDTH = "max-w-[52rem]";

/** Threshold in pixels from bottom to consider "at bottom" */
const AT_BOTTOM_THRESHOLD = 8;

type MessageMutationRef = {
  messageId: string;
  messageKey: string | null;
  renderId: string | null;
};

type MessageMutationItem = MessageMutationRef & {
  role: string | null;
  text: string;
};

type MessageMutationSnapshot = {
  at: number;
  reason: "init" | "mutation";
  items: MessageMutationItem[];
  added: MessageMutationRef[];
  removed: MessageMutationRef[];
};

declare global {
  interface Window {
    __cmuxE2E?: boolean;
    __cmuxE2EResetToken?: string;
    __cmuxMessageMutationLog?: MessageMutationSnapshot[];
  }
}

const MAX_MESSAGE_MUTATION_LOG_ENTRIES = 300;

function normalizeMessageKey(value: string | undefined): string | null {
  if (!value) return null;
  return value;
}

function normalizeMessageRole(value: string | undefined): string | null {
  if (!value) return null;
  return value;
}

function collectMessageItems(container: HTMLElement): MessageMutationItem[] {
  const items: MessageMutationItem[] = [];
  const elements = container.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const element of elements) {
    const messageId = element.dataset.messageId;
    if (!messageId) continue;
    items.push({
      messageId,
      messageKey: normalizeMessageKey(element.dataset.messageKey),
      renderId: element.dataset.renderId ?? null,
      role: normalizeMessageRole(element.dataset.messageRole),
      text: element.textContent?.trim() ?? "",
    });
  }
  return items;
}

function upsertMessageRef(
  target: Map<string, MessageMutationRef>,
  messageId: string,
  messageKey: string | null,
  renderId: string | null
) {
  const key = `${messageId}::${messageKey ?? ""}`;
  if (!target.has(key)) {
    target.set(key, { messageId, messageKey, renderId });
  }
}

function collectMessageRefsFromNode(
  node: Node,
  target: Map<string, MessageMutationRef>
) {
  if (!(node instanceof HTMLElement)) return;
  const nodes: HTMLElement[] = [];
  if (node.dataset.messageId) {
    nodes.push(node);
  }
  const childNodes = node.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const child of childNodes) {
    nodes.push(child);
  }
  for (const element of nodes) {
    const messageId = element.dataset.messageId;
    if (!messageId) continue;
    upsertMessageRef(
      target,
      messageId,
      normalizeMessageKey(element.dataset.messageKey),
      element.dataset.renderId ?? null
    );
  }
}

export function ChatLayout({
  header,
  messages,
  composer,
  permissionPrompt,
  loadMoreRef,
  isLoadingMore,
  scrollContainerRef,
  scrollToBottomOnMount,
  resetKey,
}: ChatLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const hasScrolledToBottomRef = useRef(false);
  const lastResetKeyRef = useRef<string | null>(null);
  const isUserScrollingRef = useRef(false);
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
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const prevScrollHeightRef = useRef(0);

  // Expose scroll container ref to parent
  useLayoutEffect(() => {
    if (scrollContainerRef) {
      scrollContainerRef.current = containerRef.current;
    }
  }, [scrollContainerRef]);

  // Calculate if we're at the bottom
  const checkIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= AT_BOTTOM_THRESHOLD;
  }, []);

  // Scroll to bottom using sentinel element for reliability
  const scrollToBottom = useCallback((instant = false) => {
    const sentinel = bottomSentinelRef.current;
    const el = containerRef.current;

    if (sentinel) {
      // Use scrollIntoView on sentinel - more reliable than manual scrollTop
      sentinel.scrollIntoView({
        behavior: instant ? "instant" : "smooth",
        block: "end",
      });
    } else if (el) {
      // Fallback: use scrollTo with large value (browser clamps automatically)
      el.scrollTo({
        top: el.scrollHeight,
        behavior: instant ? "instant" : "smooth",
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!resetKey) return;
    if (lastResetKeyRef.current === resetKey) return;
    lastResetKeyRef.current = resetKey;
    hasScrolledToBottomRef.current = false;
    prevScrollHeightRef.current = 0;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    isUserScrollingRef.current = false;
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
      userScrollTimeoutRef.current = null;
    }
  }, [resetKey]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const atBottom = checkIsAtBottom();

    // If user is actively scrolling up, don't auto-scroll
    if (isUserScrollingRef.current && !atBottom) {
      isAtBottomRef.current = false;
      setIsAtBottom(false);
      return;
    }

    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, [checkIsAtBottom]);

  // Track user-initiated scrolls (wheel, touch)
  const handleUserScrollStart = useCallback(() => {
    isUserScrollingRef.current = true;
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 150);
  }, []);

  // Initial scroll to bottom on mount or when resetKey changes (navigation between conversations)
  // useLayoutEffect for synchronous execution before paint
  useLayoutEffect(() => {
    if (!scrollToBottomOnMount) return;
    if (hasScrolledToBottomRef.current) return;

    const el = containerRef.current;

    // Set the ref immediately and record initial height to prevent content-change from firing
    hasScrolledToBottomRef.current = true;
    prevScrollHeightRef.current = el?.scrollHeight ?? 0;

    // Immediate scroll - useLayoutEffect runs before paint
    scrollToBottom(true);
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, [scrollToBottomOnMount, scrollToBottom, resetKey]);

  // Auto-scroll when content changes - useLayoutEffect runs synchronously before paint
  // This prevents the "flash" of old scroll position that MutationObserver causes
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!hasScrolledToBottomRef.current) return; // Wait for initial scroll

    const currentScrollHeight = el.scrollHeight;

    // Skip if height hasn't changed
    if (currentScrollHeight === prevScrollHeightRef.current) return;

    // Update height tracking
    prevScrollHeightRef.current = currentScrollHeight;

    // Only scroll if we're at bottom and user isn't scrolling
    if (isAtBottomRef.current && !isUserScrollingRef.current) {
      // Instant scroll before paint - no visible jump
      scrollToBottom(true);
    }
  }); // No deps - runs on every render to catch all content changes

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex h-dvh min-h-dvh flex-1 flex-col overflow-hidden bg-white dark:bg-[#191919]">
      <div className="border-b border-neutral-200/40 dark:border-neutral-800/40">
        <div className={clsx("mx-auto px-6 py-2", MAX_WIDTH)}>{header}</div>
      </div>

      <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onWheel={handleUserScrollStart}
          onTouchStart={handleUserScrollStart}
          className="flex-1 overflow-y-auto"
          style={{ overflowAnchor: "none" }} // Disable browser scroll anchoring - we manage it manually
        >
          <div className="flex flex-col gap-1 pb-36">
            <div className={clsx("mx-auto px-6 py-6 w-full", MAX_WIDTH)}>
              <div className="flex flex-col-reverse gap-1">
                {messages}
                <div ref={loadMoreRef} />
                {isLoadingMore && (
                  <div className="flex items-center justify-center py-4 text-xs text-neutral-400 dark:text-neutral-500">
                    Loading older messages...
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Bottom sentinel for reliable scrollIntoView targeting */}
          <div ref={bottomSentinelRef} aria-hidden="true" />
        </div>

        {!isAtBottom && (
          <button
            type="button"
            onClick={() => {
              scrollToBottom();
              isAtBottomRef.current = true;
              setIsAtBottom(true);
            }}
            className="absolute left-1/2 -translate-x-1/2 bottom-40 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-lg transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            <ArrowDown className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 pointer-events-none">
          <div className="bg-white dark:bg-[#191919] pointer-events-auto">
            {permissionPrompt}
            <div className={clsx("mx-auto px-6 pb-4", COMPOSER_MAX_WIDTH)}>
              {composer}
            </div>
          </div>
        </div>
      </div>
      <MessageMutationLog enabled={mutationLogEnabled} />
    </div>
  );
}

// E2E-only mutation log for detecting message flashes/duplicates.
function MessageMutationLog({
  enabled,
}: {
  enabled: boolean;
}) {
  const logRef = useRef<MessageMutationSnapshot[]>([]);
  const logTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingAddedRef = useRef<Map<string, MessageMutationRef>>(
    new Map()
  );
  const pendingRemovedRef = useRef<Map<string, MessageMutationRef>>(
    new Map()
  );
  const rafPendingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    const container = document.body;
    const logTextarea = logTextareaRef.current;
    if (!container || !logTextarea) return;

    const storedLog = window.__cmuxMessageMutationLog;
    if (storedLog && storedLog.length > 0) {
      logRef.current = storedLog;
      logTextarea.value = JSON.stringify(storedLog);
    }

    const recordSnapshot = (reason: "init" | "mutation") => {
      const items = collectMessageItems(container);
      const added = Array.from(pendingAddedRef.current.values());
      const removed = Array.from(pendingRemovedRef.current.values());
      pendingAddedRef.current.clear();
      pendingRemovedRef.current.clear();
      const entry: MessageMutationSnapshot = {
        at: Date.now(),
        reason,
        items,
        added,
        removed,
      };
      const nextLog = [...logRef.current, entry].slice(
        -MAX_MESSAGE_MUTATION_LOG_ENTRIES
      );
      logRef.current = nextLog;
      window.__cmuxMessageMutationLog = nextLog;
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
          collectMessageRefsFromNode(node, pendingAddedRef.current);
        }
        for (const node of record.removedNodes) {
          collectMessageRefsFromNode(node, pendingRemovedRef.current);
        }
      }
      scheduleSnapshot();
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled) return null;

  return (
    <textarea
      ref={logTextareaRef}
      aria-label="message mutation log"
      data-testid="message-mutation-log"
      readOnly
      defaultValue="[]"
      className="sr-only"
    />
  );
}
