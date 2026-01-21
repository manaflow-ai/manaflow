import clsx from "clsx";
import type { ReactNode } from "react";

type MessageWrapperProps = {
  isOwn: boolean;
  children: ReactNode;
  footer?: ReactNode;
  messageId?: string;
  messageKey?: string;
  messageRole?: string;
};

export function MessageWrapper({
  isOwn,
  children,
  footer,
  messageId,
  messageKey,
  messageRole,
}: MessageWrapperProps) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-1.5",
        isOwn ? "items-end" : "items-start"
      )}
      data-message-id={messageId}
      data-message-key={messageKey}
      data-message-role={messageRole}
    >
      <div
        className={clsx(
          "max-w-[90%] text-sm leading-relaxed",
          isOwn
            ? "bg-neutral-100 dark:bg-neutral-800 rounded-lg px-4 py-3"
            : "text-neutral-900 dark:text-neutral-100"
        )}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

export function StreamingMessageWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 items-start">
      <div className="max-w-[90%] text-sm leading-relaxed text-neutral-900 dark:text-neutral-100">
        {children}
      </div>
      <div className="text-[10px] text-neutral-400 dark:text-neutral-500">streaming...</div>
    </div>
  );
}
