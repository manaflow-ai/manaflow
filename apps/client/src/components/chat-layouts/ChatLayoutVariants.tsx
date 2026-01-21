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
};

const MAX_WIDTH = "max-w-3xl";

/** Threshold in pixels from bottom to consider "at bottom" */
const AT_BOTTOM_THRESHOLD = 8;

export function ChatLayout({
  header,
  messages,
  composer,
  permissionPrompt,
  loadMoreRef,
  isLoadingMore,
  scrollContainerRef,
  scrollToBottomOnMount,
}: ChatLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const hasScrolledToBottomRef = useRef(false);
  const isUserScrollingRef = useRef(false);
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

  // Initial scroll to bottom on mount - use useLayoutEffect for synchronous execution before paint
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
  }, [scrollToBottomOnMount, scrollToBottom]);

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
          <div className="h-10 bg-gradient-to-t from-white to-transparent dark:from-[#191919]" />
          <div className="bg-white/80 backdrop-blur-2xl dark:bg-[#191919]/80 pointer-events-auto">
            {permissionPrompt}
            <div className={clsx("mx-auto px-6 py-4", MAX_WIDTH)}>
              {composer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
