import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";

// Types
export type DiffComment = Doc<"diffComments">;
export type DiffCommentReply = Doc<"diffCommentReplies">;

export type DiffLineSide = "old" | "new";

export type DiffLineLocation = {
  filePath: string;
  lineNumber: number;
  side: DiffLineSide;
};

export type PendingComment = {
  id: string; // Local ID for tracking
  filePath: string;
  lineNumber: number;
  side: DiffLineSide;
  content: string;
};

export type CommentsByLine = Map<
  string, // Key: `${filePath}:${side}:${lineNumber}`
  DiffComment[]
>;

// Helper to create line key
export function createLineKey(
  filePath: string,
  side: DiffLineSide,
  lineNumber: number
): string {
  return `${filePath}:${side}:${lineNumber}`;
}

// Helper to parse line key
export function parseLineKey(
  key: string
): { filePath: string; side: DiffLineSide; lineNumber: number } | null {
  const match = key.match(/^(.+):(old|new):(\d+)$/);
  if (!match) return null;
  return {
    filePath: match[1],
    side: match[2] as DiffLineSide,
    lineNumber: parseInt(match[3], 10),
  };
}

interface UseDiffCommentsOptions {
  teamSlugOrId: string;
  taskRunId: Id<"taskRuns"> | undefined;
  enabled?: boolean;
}

interface UseDiffCommentsReturn {
  // Data
  comments: DiffComment[];
  commentsByLine: CommentsByLine;
  commentCountsByFile: Record<string, { total: number; unresolved: number }>;
  isLoading: boolean;

  // Pending comments (local, not yet submitted)
  pendingComments: PendingComment[];
  addPendingComment: (location: DiffLineLocation, content: string) => void;
  updatePendingComment: (id: string, content: string) => void;
  removePendingComment: (id: string) => void;
  clearPendingComments: () => void;

  // Submit
  submitComment: (
    location: DiffLineLocation,
    content: string,
    profileImageUrl?: string
  ) => Promise<Id<"diffComments">>;
  submitPendingComments: (profileImageUrl?: string) => Promise<void>;
  hasPendingComments: boolean;

  // Actions
  resolveComment: (commentId: Id<"diffComments">) => Promise<void>;
  unresolveComment: (commentId: Id<"diffComments">) => Promise<void>;
  deleteComment: (commentId: Id<"diffComments">) => Promise<void>;
  updateComment: (
    commentId: Id<"diffComments">,
    content: string
  ) => Promise<void>;

  // Replies
  addReply: (
    commentId: Id<"diffComments">,
    content: string,
    profileImageUrl?: string
  ) => Promise<Id<"diffCommentReplies">>;
  getReplies: (commentId: Id<"diffComments">) => DiffCommentReply[] | undefined;
  deleteReply: (replyId: Id<"diffCommentReplies">) => Promise<void>;

  // UI State
  activeCommentInput: DiffLineLocation | null;
  setActiveCommentInput: (location: DiffLineLocation | null) => void;
  expandedThreads: Set<string>; // Set of comment IDs
  toggleThread: (commentId: Id<"diffComments">) => void;
  expandThread: (commentId: Id<"diffComments">) => void;
  collapseThread: (commentId: Id<"diffComments">) => void;
}

export function useDiffComments({
  teamSlugOrId,
  taskRunId,
  enabled = true,
}: UseDiffCommentsOptions): UseDiffCommentsReturn {
  // Local state
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [activeCommentInput, setActiveCommentInput] =
    useState<DiffLineLocation | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(
    new Set()
  );
  const [repliesCache, _setRepliesCache] = useState<
    Map<string, DiffCommentReply[]>
  >(new Map());

  // Convex queries
  const commentsQuery = useQuery(
    api.diffComments.listByTaskRun,
    enabled && taskRunId ? { teamSlugOrId, taskRunId } : "skip"
  );

  const countsQuery = useQuery(
    api.diffComments.getCountsByFile,
    enabled && taskRunId ? { teamSlugOrId, taskRunId } : "skip"
  );

  // Convex mutations
  const createMutation = useMutation(api.diffComments.create);
  const updateMutation = useMutation(api.diffComments.update);
  const resolveMutation = useMutation(api.diffComments.resolve);
  const unresolveMutation = useMutation(api.diffComments.unresolve);
  const removeMutation = useMutation(api.diffComments.remove);
  const addReplyMutation = useMutation(api.diffComments.addReply);
  const deleteReplyMutation = useMutation(api.diffComments.deleteReply);

  // Derived data
  const comments = useMemo(() => commentsQuery ?? [], [commentsQuery]);
  const commentCountsByFile = useMemo(() => countsQuery ?? {}, [countsQuery]);

  const commentsByLine = useMemo(() => {
    const map: CommentsByLine = new Map();
    for (const comment of comments) {
      const key = createLineKey(
        comment.filePath,
        comment.side,
        comment.lineNumber
      );
      const existing = map.get(key) ?? [];
      existing.push(comment);
      map.set(key, existing);
    }
    return map;
  }, [comments]);

  // Pending comment management
  const addPendingComment = useCallback(
    (location: DiffLineLocation, content: string) => {
      const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPendingComments((prev) => [
        ...prev,
        { id, ...location, content },
      ]);
    },
    []
  );

  const updatePendingComment = useCallback((id: string, content: string) => {
    setPendingComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, content } : c))
    );
  }, []);

  const removePendingComment = useCallback((id: string) => {
    setPendingComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearPendingComments = useCallback(() => {
    setPendingComments([]);
  }, []);

  // Submit a single comment
  const submitComment = useCallback(
    async (
      location: DiffLineLocation,
      content: string,
      profileImageUrl?: string
    ) => {
      if (!taskRunId) {
        throw new Error("No task run ID");
      }
      return createMutation({
        teamSlugOrId,
        taskRunId,
        filePath: location.filePath,
        lineNumber: location.lineNumber,
        side: location.side,
        content,
        profileImageUrl,
      });
    },
    [createMutation, taskRunId, teamSlugOrId]
  );

  // Submit all pending comments
  const submitPendingComments = useCallback(
    async (profileImageUrl?: string) => {
      if (!taskRunId) {
        throw new Error("No task run ID");
      }
      const toSubmit = [...pendingComments];
      for (const pending of toSubmit) {
        await createMutation({
          teamSlugOrId,
          taskRunId,
          filePath: pending.filePath,
          lineNumber: pending.lineNumber,
          side: pending.side,
          content: pending.content,
          profileImageUrl,
        });
      }
      clearPendingComments();
    },
    [createMutation, pendingComments, taskRunId, teamSlugOrId, clearPendingComments]
  );

  // Comment actions
  const resolveComment = useCallback(
    async (commentId: Id<"diffComments">) => {
      await resolveMutation({ teamSlugOrId, commentId });
    },
    [resolveMutation, teamSlugOrId]
  );

  const unresolveComment = useCallback(
    async (commentId: Id<"diffComments">) => {
      await unresolveMutation({ teamSlugOrId, commentId });
    },
    [unresolveMutation, teamSlugOrId]
  );

  const deleteComment = useCallback(
    async (commentId: Id<"diffComments">) => {
      await removeMutation({ teamSlugOrId, commentId });
    },
    [removeMutation, teamSlugOrId]
  );

  const updateComment = useCallback(
    async (commentId: Id<"diffComments">, content: string) => {
      await updateMutation({ teamSlugOrId, commentId, content });
    },
    [updateMutation, teamSlugOrId]
  );

  // Reply management
  const addReply = useCallback(
    async (
      commentId: Id<"diffComments">,
      content: string,
      profileImageUrl?: string
    ) => {
      return addReplyMutation({
        teamSlugOrId,
        diffCommentId: commentId,
        content,
        profileImageUrl,
      });
    },
    [addReplyMutation, teamSlugOrId]
  );

  const getReplies = useCallback(
    (commentId: Id<"diffComments">) => {
      return repliesCache.get(commentId);
    },
    [repliesCache]
  );

  const deleteReply = useCallback(
    async (replyId: Id<"diffCommentReplies">) => {
      await deleteReplyMutation({ teamSlugOrId, replyId });
    },
    [deleteReplyMutation, teamSlugOrId]
  );

  // Thread expansion
  const toggleThread = useCallback((commentId: Id<"diffComments">) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  }, []);

  const expandThread = useCallback((commentId: Id<"diffComments">) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      next.add(commentId);
      return next;
    });
  }, []);

  const collapseThread = useCallback((commentId: Id<"diffComments">) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      next.delete(commentId);
      return next;
    });
  }, []);

  return {
    // Data
    comments,
    commentsByLine,
    commentCountsByFile,
    isLoading: commentsQuery === undefined,

    // Pending
    pendingComments,
    addPendingComment,
    updatePendingComment,
    removePendingComment,
    clearPendingComments,

    // Submit
    submitComment,
    submitPendingComments,
    hasPendingComments: pendingComments.length > 0,

    // Actions
    resolveComment,
    unresolveComment,
    deleteComment,
    updateComment,

    // Replies
    addReply,
    getReplies,
    deleteReply,

    // UI State
    activeCommentInput,
    setActiveCommentInput,
    expandedThreads,
    toggleThread,
    expandThread,
    collapseThread,
  };
}
