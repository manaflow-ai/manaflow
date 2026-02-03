import type { Doc, Id } from "@cmux/convex/dataModel";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";
import { CommentThreadItem } from "./comment-thread-item";
import { CommentReplyInput } from "./comment-input-popover";

type DiffComment = Doc<"diffComments">;
type DiffCommentReply = Doc<"diffCommentReplies">;

interface InlineCommentThreadProps {
  comments: DiffComment[];
  replies?: Map<string, DiffCommentReply[]>;
  currentUserId?: string;
  currentUserProfileImageUrl?: string | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onResolve?: (commentId: Id<"diffComments">) => void;
  onUnresolve?: (commentId: Id<"diffComments">) => void;
  onEdit?: (commentId: Id<"diffComments">, content: string) => void;
  onDelete?: (commentId: Id<"diffComments">) => void;
  onAddReply?: (commentId: Id<"diffComments">, content: string) => void;
  onDeleteReply?: (replyId: Id<"diffCommentReplies">) => void;
  className?: string;
}

export function InlineCommentThread({
  comments,
  replies = new Map(),
  currentUserId,
  currentUserProfileImageUrl,
  isExpanded = true,
  onToggleExpand,
  onResolve,
  onUnresolve,
  onEdit,
  onDelete,
  onAddReply,
  onDeleteReply,
  className,
}: InlineCommentThreadProps) {
  const [replyingTo, setReplyingTo] = useState<Id<"diffComments"> | null>(null);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  const unresolvedCount = comments.filter((c) => !c.resolved).length;
  const totalCount = comments.length;

  const handleAddReply = useCallback(
    async (commentId: Id<"diffComments">, content: string) => {
      if (!onAddReply) return;
      setIsSubmittingReply(true);
      try {
        await onAddReply(commentId, content);
        setReplyingTo(null);
      } catch (error) {
        console.error("Failed to add reply:", error);
      } finally {
        setIsSubmittingReply(false);
      }
    },
    [onAddReply]
  );

  if (comments.length === 0) {
    return null;
  }

  // Collapsed view
  if (!isExpanded) {
    return (
      <button
        onClick={onToggleExpand}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-sm",
          "bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50",
          "border-l-2 border-blue-400 dark:border-blue-500",
          "text-blue-700 dark:text-blue-300 transition-colors",
          className
        )}
      >
        <ChevronRight className="w-4 h-4" />
        <MessageSquare className="w-4 h-4" />
        <span>
          {unresolvedCount === 0 ? (
            <span className="text-neutral-500 dark:text-neutral-400">
              {totalCount} resolved {totalCount === 1 ? "comment" : "comments"}
            </span>
          ) : (
            <>
              {unresolvedCount} {unresolvedCount === 1 ? "comment" : "comments"}
              {unresolvedCount < totalCount && (
                <span className="text-neutral-500 dark:text-neutral-400 ml-1">
                  ({totalCount - unresolvedCount} resolved)
                </span>
              )}
            </>
          )}
        </span>
      </button>
    );
  }

  // Expanded view
  return (
    <div
      className={cn(
        "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-400 dark:border-blue-500",
        className
      )}
    >
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
      >
        <ChevronDown className="w-4 h-4" />
        <MessageSquare className="w-4 h-4" />
        <span>
          {totalCount} {totalCount === 1 ? "comment" : "comments"}
          {unresolvedCount < totalCount && (
            <span className="text-neutral-500 dark:text-neutral-400 ml-1">
              ({totalCount - unresolvedCount} resolved)
            </span>
          )}
        </span>
      </button>

      {/* Comments */}
      <div className="px-3 pb-3 space-y-3">
        {comments.map((comment) => {
          const commentReplies = replies.get(comment._id) ?? [];
          const isResolved = comment.resolved ?? false;

          return (
            <div key={comment._id} className="space-y-2">
              <CommentThreadItem
                comment={comment}
                isResolved={isResolved}
                currentUserId={currentUserId}
                onResolve={onResolve ? () => onResolve(comment._id) : undefined}
                onUnresolve={
                  onUnresolve ? () => onUnresolve(comment._id) : undefined
                }
                onEdit={
                  onEdit
                    ? (content) => onEdit(comment._id, content)
                    : undefined
                }
                onDelete={onDelete ? () => onDelete(comment._id) : undefined}
              />

              {/* Replies */}
              {commentReplies.length > 0 && (
                <div className="space-y-2">
                  {commentReplies.map((reply) => (
                    <CommentThreadItem
                      key={reply._id}
                      comment={reply}
                      isReply
                      currentUserId={currentUserId}
                      onDelete={
                        onDeleteReply
                          ? () => onDeleteReply(reply._id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

              {/* Reply input */}
              {onAddReply &&
                (replyingTo === comment._id ? (
                  <CommentReplyInput
                    profileImageUrl={currentUserProfileImageUrl}
                    userId={currentUserId}
                    isSubmitting={isSubmittingReply}
                    onSubmit={(content) => handleAddReply(comment._id, content)}
                    onCancel={() => setReplyingTo(null)}
                    className="ml-6"
                  />
                ) : (
                  <button
                    onClick={() => setReplyingTo(comment._id)}
                    className="ml-6 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                  >
                    Reply
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
