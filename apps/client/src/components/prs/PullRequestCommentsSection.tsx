import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import type { Doc } from "@cmux/convex/dataModel";

type PullRequestCommentDoc = Doc<"pullRequestComments">;

type PullRequestCommentsSectionProps = {
  comments: PullRequestCommentDoc[] | undefined;
  isLoading: boolean;
};

const REACTION_DISPLAY = [
  { key: "plusOne", emoji: "👍" },
  { key: "minusOne", emoji: "👎" },
  { key: "laugh", emoji: "😄" },
  { key: "confused", emoji: "😕" },
  { key: "heart", emoji: "❤️" },
  { key: "hooray", emoji: "🎉" },
  { key: "rocket", emoji: "🚀" },
  { key: "eyes", emoji: "👀" },
] as const;

type ReactionKey = (typeof REACTION_DISPLAY)[number]["key"];

function formatTimestamp(value?: number | null) {
  if (!value) return null;
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return null;
  }
}

function formatLocation(comment: PullRequestCommentDoc) {
  if (!comment.path) return null;
  if (typeof comment.line === "number") {
    return `${comment.path}:${comment.line}`;
  }
  if (typeof comment.originalLine === "number") {
    return `${comment.path}:${comment.originalLine}`;
  }
  return comment.path;
}

function Avatar({ login, avatarUrl }: { login?: string; avatarUrl?: string | null }) {
  const fallback = login?.charAt(0)?.toUpperCase() ?? "?";
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={login ?? "GitHub user"}
        className="h-8 w-8 rounded-full border border-neutral-200 dark:border-neutral-800"
      />
    );
  }
  return (
    <div className="h-8 w-8 rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center text-sm font-semibold">
      {fallback}
    </div>
  );
}

function CommentReactions({ reactions }: { reactions?: PullRequestCommentDoc["reactions"] }) {
  if (!reactions) return null;
  const items = REACTION_DISPLAY.filter(({ key }) => (reactions[key as ReactionKey] ?? 0) > 0);
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      {items.map(({ key, emoji }) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
        >
          <span>{emoji}</span>
          <span>{reactions[key as ReactionKey]}</span>
        </span>
      ))}
    </div>
  );
}

function CommentBody({ comment }: { comment: PullRequestCommentDoc }) {
  if (comment.isDeleted) {
    return (
      <p className="italic text-sm text-neutral-500 dark:text-neutral-400">
        This comment was deleted on GitHub.
      </p>
    );
  }
  if (!comment.body) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">No content provided.</p>
    );
  }
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {comment.body}
      </ReactMarkdown>
    </div>
  );
}

export function PullRequestCommentsSection({ comments, isLoading }: PullRequestCommentsSectionProps) {
  return (
    <section className="border-t border-neutral-200 bg-white px-6 py-5 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          GitHub comments
        </h3>
        {comments && comments.length > 0 ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {comments.length}
          </span>
        ) : null}
      </div>
      {isLoading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="animate-pulse rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                <div className="space-y-2">
                  <span className="inline-block h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <span className="inline-block h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <span className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
                <span className="h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
              </div>
            </div>
          ))}
        </div>
      ) : comments && comments.length > 0 ? (
        <div className="mt-4 space-y-4">
          {comments.map((comment) => (
            <article
              key={comment._id}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start gap-3">
                <Avatar login={comment.authorLogin ?? undefined} avatarUrl={comment.authorAvatarUrl} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {comment.authorLogin ?? "Unknown author"}
                    </span>
                    {comment.authorAssociation ? (
                      <span className="text-[11px] uppercase tracking-wide text-neutral-400">
                        {comment.authorAssociation}
                      </span>
                    ) : null}
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {formatTimestamp(comment.createdAt) ?? "just now"}
                    </span>
                    {comment.htmlUrl ? (
                      <a
                        href={comment.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 transition hover:text-blue-500 dark:text-blue-400"
                      >
                        View on GitHub
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                    <span
                      className={clsx(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                        comment.type === "review"
                          ? "bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-300"
                          : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
                      )}
                    >
                      {comment.type === "review" ? "Review comment" : "Issue comment"}
                    </span>
                    {formatLocation(comment) ? (
                      <span className="font-mono text-[11px]">
                        {formatLocation(comment)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 text-sm text-neutral-900 dark:text-neutral-100">
                    <CommentBody comment={comment} />
                  </div>
                  <CommentReactions reactions={comment.reactions} />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          No comments yet. When someone leaves a comment on this pull request, it will appear here automatically.
        </div>
      )}
    </section>
  );
}
