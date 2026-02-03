import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { CommentAvatar } from "./comment-avatar";

interface CommentInputPopoverProps {
  profileImageUrl?: string | null;
  userId?: string;
  placeholder?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
  onSubmit: (content: string) => void;
  onCancel: () => void;
  className?: string;
  autoFocus?: boolean;
  initialValue?: string;
}

export function CommentInputPopover({
  profileImageUrl,
  userId,
  placeholder = "Add a comment...",
  submitLabel = "Comment",
  isSubmitting = false,
  onSubmit,
  onCancel,
  className,
  autoFocus = true,
  initialValue = "",
}: CommentInputPopoverProps) {
  const [content, setContent] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = content.trim().length > 0 && !isSubmitting;

  const handleSubmit = useCallback(() => {
    if (canSubmit) {
      onSubmit(content.trim());
    }
  }, [canSubmit, content, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSubmit, onCancel]
  );

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [content]);

  // Auto-focus
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div
      className={cn(
        "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg overflow-hidden",
        className
      )}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <CommentAvatar
            profileImageUrl={profileImageUrl}
            userId={userId}
            size="md"
          />
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full bg-transparent border-none outline-none text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 resize-none min-h-[60px]"
              rows={2}
              disabled={isSubmitting}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-200 dark:border-neutral-700">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          <kbd className="px-1 py-0.5 bg-neutral-200 dark:bg-neutral-700 rounded text-[10px]">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
          </kbd>
          <span className="mx-0.5">+</span>
          <kbd className="px-1 py-0.5 bg-neutral-200 dark:bg-neutral-700 rounded text-[10px]">
            Enter
          </kbd>
          <span className="ml-1">to submit</span>
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              canSubmit
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "bg-neutral-200 dark:bg-neutral-700 text-neutral-400 dark:text-neutral-500 cursor-not-allowed"
            )}
          >
            {isSubmitting ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-3 h-3" />
                {submitLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Compact version for inline replies
export function CommentReplyInput({
  profileImageUrl,
  userId,
  isSubmitting = false,
  onSubmit,
  onCancel,
  className,
}: {
  profileImageUrl?: string | null;
  userId?: string;
  isSubmitting?: boolean;
  onSubmit: (content: string) => void;
  onCancel?: () => void;
  className?: string;
}) {
  const [content, setContent] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const canSubmit = content.trim().length > 0 && !isSubmitting;

  const handleSubmit = useCallback(() => {
    if (canSubmit) {
      onSubmit(content.trim());
      setContent("");
    }
  }, [canSubmit, content, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape" && onCancel) {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSubmit, onCancel]
  );

  return (
    <div className={cn("flex items-start gap-2 mt-2", className)}>
      <CommentAvatar
        profileImageUrl={profileImageUrl}
        userId={userId}
        size="sm"
      />
      <div className="flex-1 flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply..."
          className="flex-1 px-2 py-1 text-sm bg-neutral-100 dark:bg-neutral-800 border-none rounded-md outline-none focus:ring-2 focus:ring-blue-500 placeholder-neutral-400 dark:placeholder-neutral-500"
          disabled={isSubmitting}
        />
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            canSubmit
              ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              : "text-neutral-300 dark:text-neutral-600 cursor-not-allowed"
          )}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
