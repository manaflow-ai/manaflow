import type { Doc, Id } from "@cmux/convex/dataModel";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  MessageSquare,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { CommentAvatar } from "./comment-avatar";
import { formatDistanceToNow } from "date-fns";

type DiffComment = Doc<"diffComments">;

type FilterOption = "all" | "unresolved" | "resolved";

interface CommentsPanelProps {
  comments: DiffComment[];
  currentUserId?: string;
  onNavigateToComment?: (comment: DiffComment) => void;
  onResolve?: (commentId: Id<"diffComments">) => void;
  onUnresolve?: (commentId: Id<"diffComments">) => void;
  className?: string;
}

export function CommentsPanel({
  comments,
  currentUserId,
  onNavigateToComment,
  onResolve,
  onUnresolve,
  className,
}: CommentsPanelProps) {
  const [filter, setFilter] = useState<FilterOption>("all");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Group comments by file
  const commentsByFile = useMemo(() => {
    const groups = new Map<string, DiffComment[]>();
    for (const comment of comments) {
      const existing = groups.get(comment.filePath) ?? [];
      existing.push(comment);
      groups.set(comment.filePath, existing);
    }
    // Sort comments within each group by createdAt
    for (const [, group] of groups) {
      group.sort((a, b) => a.createdAt - b.createdAt);
    }
    return groups;
  }, [comments]);

  // Filter comments
  const filteredCommentsByFile = useMemo(() => {
    const filtered = new Map<string, DiffComment[]>();
    for (const [filePath, fileComments] of commentsByFile) {
      const matchingComments = fileComments.filter((comment) => {
        if (filter === "unresolved") return !comment.resolved;
        if (filter === "resolved") return comment.resolved;
        return true;
      });
      if (matchingComments.length > 0) {
        filtered.set(filePath, matchingComments);
      }
    }
    return filtered;
  }, [commentsByFile, filter]);

  // Stats
  const totalCount = comments.length;
  const unresolvedCount = comments.filter((c) => !c.resolved).length;
  const resolvedCount = totalCount - unresolvedCount;

  // Toggle file expansion
  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  // Expand all by default
  const isExpanded = useCallback(
    (filePath: string) => {
      // If no files explicitly set, default to expanded
      if (expandedFiles.size === 0) return true;
      return expandedFiles.has(filePath);
    },
    [expandedFiles]
  );

  if (totalCount === 0) {
    return (
      <div className={cn("p-4", className)}>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <MessageSquare className="w-8 h-8 text-neutral-300 dark:text-neutral-600 mb-2" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No comments yet
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
            Click + on any line to add a comment
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-neutral-500" />
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Comments
            </span>
            <span className="px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-800 rounded text-neutral-600 dark:text-neutral-400">
              {totalCount}
            </span>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1 mt-2">
          <FilterButton
            active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All ({totalCount})
          </FilterButton>
          <FilterButton
            active={filter === "unresolved"}
            onClick={() => setFilter("unresolved")}
          >
            Open ({unresolvedCount})
          </FilterButton>
          <FilterButton
            active={filter === "resolved"}
            onClick={() => setFilter("resolved")}
          >
            Resolved ({resolvedCount})
          </FilterButton>
        </div>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto">
        {filteredCommentsByFile.size === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              No {filter === "all" ? "" : filter} comments
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {Array.from(filteredCommentsByFile.entries()).map(
              ([filePath, fileComments]) => (
                <FileCommentsGroup
                  key={filePath}
                  filePath={filePath}
                  comments={fileComments}
                  isExpanded={isExpanded(filePath)}
                  onToggle={() => toggleFile(filePath)}
                  currentUserId={currentUserId}
                  onNavigateToComment={onNavigateToComment}
                  onResolve={onResolve}
                  onUnresolve={onUnresolve}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-xs rounded transition-colors",
        active
          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      )}
    >
      {children}
    </button>
  );
}

function FileCommentsGroup({
  filePath,
  comments,
  isExpanded,
  onToggle,
  currentUserId,
  onNavigateToComment,
  onResolve,
  onUnresolve,
}: {
  filePath: string;
  comments: DiffComment[];
  isExpanded: boolean;
  onToggle: () => void;
  currentUserId?: string;
  onNavigateToComment?: (comment: DiffComment) => void;
  onResolve?: (commentId: Id<"diffComments">) => void;
  onUnresolve?: (commentId: Id<"diffComments">) => void;
}) {
  const unresolvedCount = comments.filter((c) => !c.resolved).length;
  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div>
      {/* File header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
        )}
        <FileCode className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate flex-1">
          {fileName}
        </span>
        <span className="flex-shrink-0 flex items-center gap-1">
          {unresolvedCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
              {unresolvedCount}
            </span>
          )}
        </span>
      </button>

      {/* Comments */}
      {isExpanded && (
        <div className="bg-neutral-50 dark:bg-neutral-800/30">
          {comments.map((comment) => (
            <CommentPreviewItem
              key={comment._id}
              comment={comment}
              currentUserId={currentUserId}
              onClick={() => onNavigateToComment?.(comment)}
              onResolve={onResolve ? () => onResolve(comment._id) : undefined}
              onUnresolve={
                onUnresolve ? () => onUnresolve(comment._id) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentPreviewItem({
  comment,
  currentUserId: _currentUserId,
  onClick,
  onResolve,
  onUnresolve,
}: {
  comment: DiffComment;
  currentUserId?: string;
  onClick?: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
}) {
  const isResolved = comment.resolved ?? false;

  return (
    <div
      className={cn(
        "group flex items-start gap-2 px-3 py-2 border-l-2",
        isResolved
          ? "border-neutral-300 dark:border-neutral-600 opacity-60"
          : "border-blue-400 dark:border-blue-500",
        onClick && "cursor-pointer hover:bg-white dark:hover:bg-neutral-800"
      )}
      onClick={onClick}
    >
      <CommentAvatar
        profileImageUrl={comment.profileImageUrl}
        userId={comment.userId}
        size="sm"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
            L{comment.lineNumber} ({comment.side})
          </span>
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
            {formatDistanceToNow(new Date(comment.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>
        <p className="text-xs text-neutral-700 dark:text-neutral-300 line-clamp-2">
          {comment.content}
        </p>
      </div>

      {/* Resolve button */}
      {(onResolve || onUnresolve) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isResolved) {
              onUnresolve?.();
            } else {
              onResolve?.();
            }
          }}
          className={cn(
            "opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity",
            isResolved
              ? "text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              : "text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
          )}
          title={isResolved ? "Unresolve" : "Resolve"}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
