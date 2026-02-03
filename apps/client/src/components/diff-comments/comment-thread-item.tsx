import type { Doc } from "@cmux/convex/dataModel";
import { formatDistanceToNow } from "date-fns";
import { Check, MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/dropdown";
import { CommentAvatar } from "./comment-avatar";

type DiffComment = Doc<"diffComments">;
type DiffCommentReply = Doc<"diffCommentReplies">;

interface CommentThreadItemProps {
  comment: DiffComment | DiffCommentReply;
  isReply?: boolean;
  isResolved?: boolean;
  currentUserId?: string;
  onResolve?: () => void;
  onUnresolve?: () => void;
  onEdit?: (content: string) => void;
  onDelete?: () => void;
  className?: string;
}

export function CommentThreadItem({
  comment,
  isReply = false,
  isResolved = false,
  currentUserId,
  onResolve,
  onUnresolve,
  onEdit,
  onDelete,
  className,
}: CommentThreadItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const isAuthor = currentUserId === comment.userId;
  const canEdit = isAuthor && onEdit;
  const canDelete = isAuthor && onDelete;
  const hasActions = !isReply && (onResolve || onUnresolve);

  const handleSubmitEdit = useCallback(() => {
    if (editContent.trim() && onEdit) {
      onEdit(editContent.trim());
      setIsEditing(false);
    }
  }, [editContent, onEdit]);

  const handleCancelEdit = useCallback(() => {
    setEditContent(comment.content);
    setIsEditing(false);
  }, [comment.content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelEdit();
      }
    },
    [handleSubmitEdit, handleCancelEdit]
  );

  return (
    <div
      className={cn(
        "group flex gap-2",
        isReply && "ml-6 pl-2 border-l-2 border-neutral-200 dark:border-neutral-700",
        isResolved && "opacity-60",
        className
      )}
    >
      <CommentAvatar
        profileImageUrl={comment.profileImageUrl}
        userId={comment.userId}
        size="sm"
      />

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-2 py-1.5 text-sm bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              autoFocus
            />
            <div className="flex gap-2 text-xs">
              <button
                onClick={handleSubmitEdit}
                className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-2 py-1 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-800 dark:text-neutral-200 break-words whitespace-pre-wrap">
              {comment.content}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {formatDistanceToNow(new Date(comment.createdAt), {
                  addSuffix: true,
                })}
              </span>
              {comment.updatedAt > comment.createdAt + 1000 && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500 italic">
                  (edited)
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (canEdit || canDelete || hasActions) && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-start gap-1">
          {/* Resolve/Unresolve button */}
          {hasActions && (
            <button
              onClick={isResolved ? onUnresolve : onResolve}
              className={cn(
                "p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors",
                isResolved
                  ? "text-neutral-500 dark:text-neutral-400"
                  : "text-green-600 dark:text-green-400"
              )}
              title={isResolved ? "Unresolve" : "Resolve"}
            >
              {isResolved ? (
                <Undo2 className="w-3.5 h-3.5" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Edit/Delete dropdown */}
          {(canEdit || canDelete) && (
            <Dropdown.Root>
              <Dropdown.Trigger className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-500 dark:text-neutral-400">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Dropdown.Trigger>
              <Dropdown.Positioner align="end">
                <Dropdown.Popup className="w-32">
                  {canEdit && (
                    <Dropdown.Item onClick={() => setIsEditing(true)}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      Edit
                    </Dropdown.Item>
                  )}
                  {canDelete && (
                    <Dropdown.Item
                      onClick={onDelete}
                      className="text-red-600 dark:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Delete
                    </Dropdown.Item>
                  )}
                </Dropdown.Popup>
              </Dropdown.Positioner>
            </Dropdown.Root>
          )}
        </div>
      )}
    </div>
  );
}
