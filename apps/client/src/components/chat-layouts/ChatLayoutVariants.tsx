import type { ReactNode, RefObject, MutableRefObject } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import clsx from "clsx";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { ArrowDown } from "lucide-react";

type ChatLayoutProps = {
  header: ReactNode;
  messages: ReactNode;
  composer: ReactNode;
  permissionPrompt?: ReactNode;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isLoadingMore: boolean;
  scrollContainerRef?: MutableRefObject<HTMLElement | null>;
  scrollToBottomKey?: string | number;
  shouldScrollToBottom?: boolean;
};

const MAX_WIDTH = "max-w-3xl";

export function ChatLayout({
  header,
  messages,
  composer,
  permissionPrompt,
  loadMoreRef,
  isLoadingMore,
  scrollContainerRef,
  scrollToBottomKey,
  shouldScrollToBottom,
}: ChatLayoutProps) {
  return (
    <div className="flex h-dvh min-h-dvh flex-1 flex-col overflow-hidden bg-white dark:bg-[#191919]">
      <div className="border-b border-neutral-200/40 dark:border-neutral-800/40">
        <div className={clsx("mx-auto px-6 py-2", MAX_WIDTH)}>{header}</div>
      </div>

      <StickToBottom
        className="relative flex flex-1 min-h-0 flex-col overflow-hidden"
        resize="instant"
        initial={false}
      >
        <StickToBottom.Content className="flex flex-col gap-1 pb-36">
          <ScrollContainerRefSetter scrollContainerRef={scrollContainerRef} />
          <ScrollToBottomOnKey
            scrollToBottomKey={scrollToBottomKey}
            shouldScrollToBottom={shouldScrollToBottom}
          />
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
        </StickToBottom.Content>

        <ScrollToBottomButton />

        <div className="absolute inset-x-0 bottom-0 pointer-events-none">
          <div className="h-10 bg-gradient-to-t from-white to-transparent dark:from-[#191919]" />
          <div className="bg-white/80 backdrop-blur-2xl dark:bg-[#191919]/80 pointer-events-auto">
            {permissionPrompt}
            <div className={clsx("mx-auto px-6 py-4", MAX_WIDTH)}>
              {composer}
            </div>
          </div>
        </div>
      </StickToBottom>
    </div>
  );
}

function ScrollContainerRefSetter({
  scrollContainerRef,
}: {
  scrollContainerRef?: MutableRefObject<HTMLElement | null>;
}) {
  const { scrollRef } = useStickToBottomContext();

  useEffect(() => {
    if (scrollContainerRef) {
      scrollContainerRef.current = scrollRef.current;
    }
  }, [scrollContainerRef, scrollRef]);

  return null;
}

function ScrollToBottomOnKey({
  scrollToBottomKey,
  shouldScrollToBottom,
}: {
  scrollToBottomKey?: string | number;
  shouldScrollToBottom?: boolean;
}) {
  const { scrollToBottom } = useStickToBottomContext();
  const lastKeyRef = useRef<string | number | null>(null);

  useLayoutEffect(() => {
    if (scrollToBottomKey === undefined) return;
    if (!shouldScrollToBottom) return;
    if (lastKeyRef.current === scrollToBottomKey) return;
    lastKeyRef.current = scrollToBottomKey;
    void scrollToBottom({ animation: "instant", wait: true });
  }, [scrollToBottom, scrollToBottomKey, shouldScrollToBottom]);

  return null;
}

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <button
      type="button"
      onClick={() => scrollToBottom()}
      className="absolute left-1/2 -translate-x-1/2 bottom-40 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-lg transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
    >
      <ArrowDown className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
    </button>
  );
}
