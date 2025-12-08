"use client"

import { useQuery } from "convex/react"
import { useUser, SignIn } from "@stackframe/stack"
import * as Dialog from "@radix-ui/react-dialog"
import { useRouter, useSearchParams } from "next/navigation"
import { Streamdown } from "streamdown"
import { api } from "../convex/_generated/api"
import { embeddableComponents } from "../components/EmbeddableComponents"
import {
  useState,
  useCallback,
  Suspense,
  useRef,
  useEffect,
  useMemo,
} from "react"
import { Id } from "../convex/_generated/dataModel"
import { SessionsByPost } from "../components/SessionView"
import { CodingAgentSession } from "./components/CodingAgentSession"
import { BrowserAgentSession } from "./components/BrowserAgentSession"
import { RepoPickerDropdown } from "@/components/RepoPickerDropdown"
import { GrokIcon } from "@/components/GrokIcon"
import { XIcon } from "@/components/XIcon"
import { IssueDetailPanel } from "@/components/IssueDetailPanel"
import TextareaAutosize from "react-textarea-autosize"
import Image from "next/image"

type TweetSource = {
  tweetId: string
  tweetUrl: string
  authorUsername: string
  authorName: string
  authorProfileImageUrl?: string
  metrics?: {
    likes: number
    retweets: number
    replies: number
    views?: number
  }
  mediaUrls?: string[]
}

type Post = {
  _id: Id<"posts">
  content: string
  author: string
  replyTo?: Id<"posts">
  threadRoot?: Id<"posts">
  depth: number
  replyCount: number
  createdAt: number
  updatedAt: number
  tweetSource?: TweetSource
}

type FeedTab = "for_you" | "recent"

type CuratedItem = {
  post: Post | null
  parentPost?: Post | null
}

// Helper to format numbers for display (e.g., 1500 -> 1.5K)
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M"
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K"
  }
  return num.toString()
}

function PostCard({
  post,
  onReply,
  onMerge,
  onClick,
  isSelected = false,
  showThreadLine = false,
  showThreadLineAbove = false,
}: {
  post: Post
  onReply: () => void
  onMerge?: () => void
  onClick?: () => void
  isSelected?: boolean
  showThreadLine?: boolean // Line going down from avatar (parent post)
  showThreadLineAbove?: boolean // Line coming from above to avatar (reply post)
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [needsClamp, setNeedsClamp] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const isTweet = !!post.tweetSource

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    let measured = false

    // Check height after content renders - only measure once per content change
    const checkHeight = () => {
      if (measured) return
      const scrollHeight = el.scrollHeight
      // Only mark as measured once we have meaningful content
      if (scrollHeight > 0) {
        measured = true
        setNeedsClamp(scrollHeight > 240)
      }
    }

    // Use ResizeObserver to detect when Streamdown finishes rendering
    const observer = new ResizeObserver(checkHeight)
    observer.observe(el)
    checkHeight() // Initial check

    return () => observer.disconnect()
  }, [post.content])

  // Render avatar based on post type
  const renderAvatar = () => {
    if (isTweet && post.tweetSource) {
      // Tweet post - show profile image or X icon
      if (post.tweetSource.authorProfileImageUrl) {
        return (
          <Image
            src={post.tweetSource.authorProfileImageUrl}
            alt={post.tweetSource.authorName}
            width={40}
            height={40}
            className="w-10 h-10 rounded-full object-cover"
            unoptimized
          />
        )
      }
      return <XIcon className="w-10 h-10" size={32} />
    }
    if (post.author === "Grok") {
      return <GrokIcon className="w-10 h-10" size={32} />
    }
    return (
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
        {post.author[0].toUpperCase()}
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`p-4 hover:bg-accent/30 transition-colors cursor-pointer border-l-2 ${!showThreadLine ? "border-b border-border" : "pb-0"} ${isSelected ? "bg-accent/50 border-l-blue-500" : "border-l-transparent"} ${showThreadLineAbove ? "pt-0" : ""}`}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 flex flex-col items-center">
          {/* Thread line coming from parent above */}
          {showThreadLineAbove && <div className="w-0.5 bg-border h-4 mb-1" />}
          {renderAvatar()}
          {/* Thread line connecting to reply below */}
          {showThreadLine && (
            <div className="w-0.5 bg-border flex-grow mt-1 min-h-[8px]" />
          )}
        </div>
        <div
          className={`flex-grow min-w-0 ${showThreadLineAbove ? "pt-4" : ""} ${showThreadLine ? "pb-4" : ""}`}
        >
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isTweet && post.tweetSource ? (
              <>
                <span className="font-bold hover:underline">
                  {post.tweetSource.authorName}
                </span>
                <span className="text-muted-foreground text-sm">
                  @{post.tweetSource.authorUsername}
                </span>
                <XIcon className="w-4 h-4 opacity-60" size={16} />
              </>
            ) : (
              <span className="font-bold hover:underline">
                {post.author === "Assistant" ? "Grok" : post.author}
              </span>
            )}
            <span className="text-muted-foreground text-sm">
              · {new Date(post.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="relative">
            <div
              ref={contentRef}
              className={`prose dark:prose-invert prose-sm max-w-none ${!isExpanded && needsClamp ? "max-h-[240px] overflow-hidden" : "mb-3"}`}
            >
              <Streamdown components={embeddableComponents}>
                {post.content}
              </Streamdown>
            </div>
            {!isExpanded && needsClamp && (
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
            )}
          </div>
          {needsClamp && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(!isExpanded)
              }}
              className="text-blue-400 hover:text-blue-300 text-sm mb-3 transition-colors"
            >
              {isExpanded ? "Show less" : "Show more"}
            </button>
          )}
          <div className="flex gap-4 text-muted-foreground text-sm">
            {/* Tweet metrics */}
            {isTweet && post.tweetSource?.metrics && (
              <>
                <span className="flex items-center gap-1" title="Replies">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  {formatNumber(post.tweetSource.metrics.replies)}
                </span>
                <span className="flex items-center gap-1" title="Retweets">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {formatNumber(post.tweetSource.metrics.retweets)}
                </span>
                <span className="flex items-center gap-1" title="Likes">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                  </svg>
                  {formatNumber(post.tweetSource.metrics.likes)}
                </span>
                {post.tweetSource.metrics.views && (
                  <span className="flex items-center gap-1" title="Views">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                    {formatNumber(post.tweetSource.metrics.views)}
                  </span>
                )}
              </>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onReply()
              }}
              className="hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                />
              </svg>
              Reply
            </button>
            {post.replyCount > 0 && (
              <span className="text-muted-foreground">
                {post.replyCount} replies
              </span>
            )}
            {onMerge &&
              (post.replyTo ||
                post.author === "Grok" ||
                post.author === "Assistant") && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onMerge()
                  }}
                  className="hover:text-green-400 transition-colors flex items-center gap-1 ml-auto"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                    />
                  </svg>
                  Merge
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReplyComposer({
  replyingTo,
  onCancel,
  onSubmit,
  user,
  onShowSignIn,
}: {
  replyingTo: Post
  onCancel: () => void
  onSubmit: (content: string) => void
  user: ReturnType<typeof useUser>
  onShowSignIn: () => void
}) {
  const [content, setContent] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!content.trim()) return
    if (!user) {
      onShowSignIn()
      return
    }
    setIsSubmitting(true)
    await onSubmit(content)
    setContent("")
    setIsSubmitting(false)
  }

  return (
    <div className="p-4 border-b border-border bg-muted/50">
      <div className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
        Replying to{" "}
        {replyingTo.author === "Grok" || replyingTo.author === "Assistant" ? (
          <>
            <GrokIcon className="w-4 h-4 inline" />
            <span className="text-blue-400">@Grok</span>
          </>
        ) : (
          <span className="text-blue-400">@{replyingTo.author}</span>
        )}
      </div>
      <textarea
        className="w-full bg-card text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none p-3 rounded-lg"
        placeholder="Write your reply..."
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault()
            handleSubmit()
          }
        }}
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          disabled={!content.trim() || isSubmitting}
          onClick={handleSubmit}
          className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded-full transition-colors"
        >
          {isSubmitting ? "Posting..." : "Reply"}
        </button>
      </div>
    </div>
  )
}

function ThreadPanel({
  postId,
  onClose,
  onSelectPost,
  onCodingAgentSessionSelect,
  onBrowserAgentSessionSelect,
  user,
  onShowSignIn,
}: {
  postId: Id<"posts">
  onClose: () => void
  onSelectPost: (postId: Id<"posts">) => void
  onCodingAgentSessionSelect?: (sessionId: Id<"sessions"> | null) => void
  onBrowserAgentSessionSelect?: (sessionId: Id<"sessions"> | null) => void
  user: ReturnType<typeof useUser>
  onShowSignIn: () => void
}) {
  const thread = useQuery(api.posts.getPostThread, { postId })
  const [replyingTo, setReplyingTo] = useState<Post | null>(null)

  const handleReply = async (content: string) => {
    if (!replyingTo) return
    try {
      // Call the workflow API to create reply post and generate AI reply
      const response = await fetch("/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, replyTo: replyingTo._id }),
      })
      if (!response.ok) {
        throw new Error("Failed to create reply")
      }
    } catch (error) {
      console.error("Failed to create reply:", error)
    }
    setReplyingTo(null)
  }

  if (!thread) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  // Build nested structure from flat replies
  const repliesByParent = new Map<string, Post[]>()
  for (const reply of thread.replies) {
    const parentId = reply.replyTo?.toString() ?? thread.root._id.toString()
    if (!repliesByParent.has(parentId)) {
      repliesByParent.set(parentId, [])
    }
    repliesByParent.get(parentId)!.push(reply)
  }

  // Flatten all replies into a single list for linear display
  const flattenReplies = (parentId: string): Post[] => {
    const replies = repliesByParent.get(parentId) ?? []
    const result: Post[] = []
    for (const reply of replies) {
      result.push(reply)
      result.push(...flattenReplies(reply._id.toString()))
    }
    return result
  }

  const allReplies = flattenReplies(thread.root._id.toString())

  return (
    <div className="h-full flex flex-col">
      <div className="h-[55px] px-4 border-b border-border flex justify-between items-center sticky top-0 bg-background/80 backdrop-blur-md">
        <h2 className="font-semibold">Thread</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <PostCard
          post={thread.root}
          onReply={() => setReplyingTo(thread.root)}
          onClick={() => onSelectPost(thread.root._id)}
          isSelected={thread.root._id === postId}
        />
        {replyingTo?._id === thread.root._id && (
          <ReplyComposer
            replyingTo={thread.root}
            onCancel={() => setReplyingTo(null)}
            onSubmit={handleReply}
            user={user}
            onShowSignIn={onShowSignIn}
          />
        )}

        {/* Show AI sessions for the root post */}
        <div className="px-4">
          <SessionsByPost
            postId={thread.root._id}
            onCodingAgentSessionSelect={onCodingAgentSessionSelect}
            onBrowserAgentSessionSelect={onBrowserAgentSessionSelect}
          />
        </div>

        {/* Render replies with linear indent */}
        {allReplies.map((reply) => (
          <div key={reply._id}>
            <PostCard
              post={reply}
              onReply={() => setReplyingTo(reply)}
              onClick={() => onSelectPost(reply._id)}
              isSelected={reply._id === postId}
            />
            {replyingTo?._id === reply._id && (
              <ReplyComposer
                replyingTo={reply}
                onCancel={() => setReplyingTo(null)}
                onSubmit={handleReply}
                user={user}
                onShowSignIn={onShowSignIn}
              />
            )}
            <div className="px-4">
              <SessionsByPost
                postId={reply._id}
                onCodingAgentSessionSelect={onCodingAgentSessionSelect}
                onBrowserAgentSessionSelect={onBrowserAgentSessionSelect}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useUser()
  const [feedTab, setFeedTab] = useState<FeedTab>("for_you")
  const recentData = useQuery(api.posts.listPosts, { limit: 20 })
  const curatedData = useQuery(api.curator.listCuratedFeed, { limit: 20 })
  const [content, setContent] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [showSignInModal, setShowSignInModal] = useState(false)

  // Track optimistically submitted posts to show at top of "for you" feed
  const [optimisticPostIds, setOptimisticPostIds] = useState<Set<string>>(
    new Set(),
  )

  // Track displayed posts to show "new posts" indicator instead of jarring updates
  const [displayedPosts, setDisplayedPosts] = useState<Post[]>([])
  const [newPostsAvailable, setNewPostsAvailable] = useState(0)
  const isInitialLoad = useRef(true)

  // Track scroll position and main feed position for "back to top" pill
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [feedCenter, setFeedCenter] = useState<number | null>(null)
  const mainFeedRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const updateFeedCenter = () => {
      if (mainFeedRef.current) {
        const rect = mainFeedRef.current.getBoundingClientRect()
        setFeedCenter(rect.left + rect.width / 2)
      }
    }

    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300)
      updateFeedCenter()
    }

    // Initial calculation
    updateFeedCenter()

    window.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("resize", updateFeedCenter)
    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", updateFeedCenter)
    }
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Get selected post, issue, and agent sessions from URL search params
  const selectedThread = searchParams.get("post") as Id<"posts"> | null
  const selectedIssue = searchParams.get("issue") as Id<"issues"> | null
  const selectedCodingAgentSession = searchParams.get(
    "codingAgent",
  ) as Id<"sessions"> | null
  const selectedBrowserAgentSession = searchParams.get(
    "browserAgent",
  ) as Id<"sessions"> | null

  // Build URL with params, omitting null values
  const buildUrl = useCallback(
    (params: {
      post?: Id<"posts"> | null
      issue?: Id<"issues"> | null
      codingAgent?: Id<"sessions"> | null
      browserAgent?: Id<"sessions"> | null
    }) => {
      const urlParams = new URLSearchParams()
      if (params.post) urlParams.set("post", params.post)
      if (params.issue) urlParams.set("issue", params.issue)
      if (params.codingAgent) urlParams.set("codingAgent", params.codingAgent)
      if (params.browserAgent)
        urlParams.set("browserAgent", params.browserAgent)
      const queryString = urlParams.toString()
      return queryString ? `/?${queryString}` : "/"
    },
    [],
  )

  // When changing post, clear the agent panels (they're associated with the previous post)
  const setSelectedThread = useCallback(
    (postId: Id<"posts"> | null) => {
      router.push(buildUrl({ post: postId, issue: selectedIssue }), {
        scroll: false,
      })
    },
    [router, buildUrl, selectedIssue],
  )

  // Set selected issue (preserves post selection)
  const setSelectedIssue = useCallback(
    (issueId: Id<"issues"> | null) => {
      router.push(buildUrl({ post: selectedThread, issue: issueId }), {
        scroll: false,
      })
    },
    [router, buildUrl, selectedThread],
  )

  const setSelectedCodingAgentSession = useCallback(
    (sessionId: Id<"sessions"> | null) => {
      router.push(
        buildUrl({
          post: selectedThread,
          issue: selectedIssue,
          codingAgent: sessionId,
          browserAgent: selectedBrowserAgentSession,
        }),
        { scroll: false },
      )
    },
    [
      router,
      buildUrl,
      selectedThread,
      selectedIssue,
      selectedBrowserAgentSession,
    ],
  )

  const setSelectedBrowserAgentSession = useCallback(
    (sessionId: Id<"sessions"> | null) => {
      router.push(
        buildUrl({
          post: selectedThread,
          issue: selectedIssue,
          codingAgent: selectedCodingAgentSession,
          browserAgent: sessionId,
        }),
        { scroll: false },
      )
    },
    [
      router,
      buildUrl,
      selectedThread,
      selectedIssue,
      selectedCodingAgentSession,
    ],
  )

  // Get posts based on active tab (compute before hooks)
  const recentPosts = recentData?.posts ?? []
  const curatedItems: CuratedItem[] = useMemo(
    () =>
      curatedData?.items
        .filter((item: CuratedItem) => item.post !== null)
        .map((item: CuratedItem) => ({
          post: item.post,
          parentPost: item.parentPost,
        })) ?? [],
    [curatedData?.items],
  )

  // Optimistic posts rendered separately at top of "for you" feed
  const optimisticPosts: Post[] =
    feedTab === "for_you"
      ? recentPosts.filter((post) => optimisticPostIds.has(post._id))
      : []

  // For "for you" tab, use curated items; for "recent" tab, convert to simple items
  const liveItems: CuratedItem[] =
    feedTab === "for_you" && curatedItems.length
      ? curatedItems.filter(
          (item) => !item.post || !optimisticPostIds.has(item.post._id),
        )
      : recentPosts.map((post) => ({ post, parentPost: null }))

  // Handle new posts without scroll jump
  useEffect(() => {
    if (!liveItems.length) return

    if (isInitialLoad.current) {
      // First load - just set the posts
      setDisplayedPosts(
        liveItems.map((item) => item.post).filter(Boolean) as Post[],
      )
      isInitialLoad.current = false
      return
    }

    // Check if there are new posts at the top (excluding optimistic posts)
    const displayedIds = new Set(displayedPosts.map((p) => p._id))
    const newPosts = liveItems.filter(
      (item) =>
        item.post &&
        !displayedIds.has(item.post._id) &&
        !optimisticPostIds.has(item.post._id),
    )

    if (newPosts.length > 0) {
      setNewPostsAvailable(newPosts.length)
    }
  }, [liveItems, displayedPosts, optimisticPostIds])

  // Reset when tab changes
  useEffect(() => {
    isInitialLoad.current = true
    setDisplayedPosts([])
    setNewPostsAvailable(0)
  }, [feedTab])

  // Remove optimistic posts once they appear in curated feed
  useEffect(() => {
    if (optimisticPostIds.size === 0) return
    const curatedPostIds = new Set(
      curatedItems.map((item) => item.post?._id).filter(Boolean),
    )
    const stillOptimistic = new Set(
      [...optimisticPostIds].filter(
        (id) => !curatedPostIds.has(id as Id<"posts">),
      ),
    )
    if (stillOptimistic.size !== optimisticPostIds.size) {
      setOptimisticPostIds(stillOptimistic)
    }
  }, [curatedItems, optimisticPostIds])

  const showNewPosts = () => {
    setDisplayedPosts(
      liveItems.map((item) => item.post).filter(Boolean) as Post[],
    )
    setNewPostsAvailable(0)
    // Scroll to top after state update is rendered
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "instant" })
    }, 50)
  }

  // Create a map of displayed post IDs for quick lookup
  const displayedPostIds = new Set(displayedPosts.map((p) => p._id))

  // Filter live items to only show displayed posts (for scroll preservation)
  const itemsToShow: CuratedItem[] = displayedPosts.length
    ? liveItems.filter(
        (item) => item.post && displayedPostIds.has(item.post._id),
      )
    : liveItems

  const handleSubmit = async () => {
    if (!content.trim()) return
    setIsSubmitting(true)
    try {
      // Call the workflow API to create post and generate AI reply
      const response = await fetch("/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, repo: selectedRepo }),
      })
      if (!response.ok) {
        throw new Error("Failed to create post")
      }
      const result = await response.json()
      setContent("")
      // Focus on the newly created post and add to optimistic list for "for you" feed
      if (result.postId) {
        setSelectedThread(result.postId as Id<"posts">)
        // Add to optimistic posts so it appears at top of "for you" feed
        setOptimisticPostIds((prev) => new Set([...prev, result.postId]))
      }
    } catch (error) {
      console.error("Failed to create post:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleMerge = async (post: Post) => {
    if (!user) {
      setShowSignInModal(true)
      return
    }

    const mergeInstructions = `Merge the PR for this thread. Follow these steps:

1. First, merge main into this branch and fix any conflicts that arise
2. Run the CI checks and ensure all GitHub Actions pass
3. Use the gh CLI to merge the PR (e.g., \`gh pr merge --squash\`)

Make sure all checks pass before merging. If there are any failing checks, fix them first.`

    try {
      const response = await fetch("/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: mergeInstructions, replyTo: post._id }),
      })
      if (!response.ok) {
        throw new Error("Failed to create merge post")
      }
      const result = await response.json()
      if (result.postId) {
        setSelectedThread(result.postId as Id<"posts">)
      }
    } catch (error) {
      console.error("Failed to create merge post:", error)
    }
  }

  if (!recentData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
          <div
            className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: "0.1s" }}
          ></div>
          <div
            className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: "0.2s" }}
          ></div>
          <p className="ml-2 text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  const { viewer } = recentData

  return (
    <div className="min-h-screen">
      <div className="flex justify-center">
        {/* Main Feed Column */}
        <main
          ref={mainFeedRef}
          className={`w-full sm:min-w-[450px] max-w-[666px] shrink sm:border-x border-border min-h-screen`}
        >
          <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
            {/* Feed tabs */}
            <div className="flex h-[53px]">
              <button
                onClick={() => setFeedTab("for_you")}
                className={`flex-1 py-3 text-center font-semibold transition-colors relative ${
                  feedTab === "for_you"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                For you
                {feedTab === "for_you" && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
                )}
              </button>
              <button
                onClick={() => setFeedTab("recent")}
                className={`flex-1 py-3 text-center font-semibold transition-colors relative ${
                  feedTab === "recent"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                Recent
                {feedTab === "recent" && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
                )}
              </button>
            </div>
          </div>

          <div className="p-4 border-b border-border">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                {viewer === "Grok" ? (
                  <GrokIcon className="w-10 h-10" size={32} />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                    {viewer ? viewer[0].toUpperCase() : "?"}
                  </div>
                )}
              </div>
              <div className="flex-grow">
                <TextareaAutosize
                  className="w-full bg-transparent text-xl placeholder-muted-foreground focus:outline-none resize-none py-2"
                  placeholder="What's happening?"
                  minRows={1}
                  maxRows={10}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex justify-between items-center mt-2 pt-3">
              <div className="flex gap-2 items-center">
                {/* Repo picker dropdown */}
                {user && (
                  <RepoPickerDropdown
                    selectedRepo={selectedRepo}
                    onRepoSelect={setSelectedRepo}
                  />
                )}
              </div>
              <button
                disabled={!content.trim() || isSubmitting}
                onClick={() => {
                  if (!user) {
                    setShowSignInModal(true)
                    return
                  }
                  handleSubmit()
                }}
                className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded-full transition-colors"
              >
                {isSubmitting ? "Posting..." : "Post"}
              </button>
            </div>
          </div>

          {/* New posts indicator */}
          {newPostsAvailable > 0 && (
            <button
              onClick={showNewPosts}
              className="w-full py-3 text-blue-400 hover:bg-blue-500/10 transition-colors border-b border-border font-medium"
            >
              Show {newPostsAvailable} new post
              {newPostsAvailable > 1 ? "s" : ""}
            </button>
          )}

          {/* Optimistic posts - user's own submissions shown immediately */}
          {optimisticPosts.map((post) => (
            <PostCard
              key={`optimistic-${post._id}`}
              post={post}
              onClick={() => setSelectedThread(post._id)}
              onReply={() => setSelectedThread(post._id)}
              onMerge={() => handleMerge(post)}
              isSelected={selectedThread === post._id}
            />
          ))}

          <div>
            {itemsToShow.length === 0 && optimisticPosts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {feedTab === "for_you"
                  ? "No curated posts yet. Check back soon or switch to Recent!"
                  : "No posts yet. Share something!"}
              </div>
            ) : (
              itemsToShow.map((item) => {
                if (!item.post) return null
                const post = item.post
                const hasParent = !!item.parentPost
                return (
                  <div key={post._id}>
                    {/* Show parent post with thread line if this is a curated reply */}
                    {item.parentPost && (
                      <PostCard
                        post={item.parentPost}
                        onClick={() => setSelectedThread(item.parentPost!._id)}
                        onReply={() => setSelectedThread(item.parentPost!._id)}
                        onMerge={() => handleMerge(item.parentPost!)}
                        isSelected={selectedThread === item.parentPost!._id}
                        showThreadLine
                      />
                    )}
                    <PostCard
                      post={post}
                      onClick={() => setSelectedThread(post._id)}
                      onReply={() => setSelectedThread(post._id)}
                      onMerge={() => handleMerge(post)}
                      isSelected={selectedThread === post._id}
                      showThreadLineAbove={hasParent}
                    />
                  </div>
                )
              })
            )}
          </div>
        </main>

        {/* Thread Panel - Right Column */}
        {selectedThread && (
          <aside className="w-[550px] shrink-0 border-r border-border min-h-screen sticky top-0 h-screen overflow-hidden hidden lg:block">
            <ThreadPanel
              postId={selectedThread}
              onClose={() => setSelectedThread(null)}
              onSelectPost={setSelectedThread}
              onCodingAgentSessionSelect={setSelectedCodingAgentSession}
              onBrowserAgentSessionSelect={setSelectedBrowserAgentSession}
              user={user}
              onShowSignIn={() => setShowSignInModal(true)}
            />
          </aside>
        )}

        {/* Coding Agent Session Panel - Third Column */}
        {selectedCodingAgentSession && !selectedBrowserAgentSession && (
          <aside className="w-[500px] shrink border-r border-border min-h-screen sticky top-0 h-screen overflow-hidden hidden xl:block">
            <CodingAgentSession
              sessionId={selectedCodingAgentSession}
              onClose={() => setSelectedCodingAgentSession(null)}
            />
          </aside>
        )}

        {/* Browser Agent Session Panel - Third Column (takes precedence over coding agent) */}
        {selectedBrowserAgentSession && (
          <aside className="w-[600px] shrink border-r border-border min-h-screen sticky top-0 h-screen overflow-hidden hidden xl:block">
            <BrowserAgentSession
              sessionId={selectedBrowserAgentSession}
              onClose={() => setSelectedBrowserAgentSession(null)}
            />
          </aside>
        )}

        {/* Issue Detail Panel - Shows when issue is selected and no agent session is active */}
        {selectedIssue &&
          !selectedCodingAgentSession &&
          !selectedBrowserAgentSession && (
            <aside className="w-[500px] shrink border-r border-border min-h-screen sticky top-0 h-screen overflow-hidden hidden xl:block">
              <IssueDetailPanel
                issueId={selectedIssue}
                onClose={() => setSelectedIssue(null)}
                onIssueClick={setSelectedIssue}
              />
            </aside>
          )}
      </div>

      {/* Back to top floating pill - only shows when there are new posts and user has scrolled */}
      {feedCenter !== null && (
        <button
          onClick={scrollToTop}
          style={{ left: feedCenter }}
          className={`fixed top-[70px] -translate-x-1/2 bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-full shadow-lg transition-all duration-300 flex items-center gap-2 z-50 ${
            showBackToTop && newPostsAvailable > 0
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
          {newPostsAvailable} new post{newPostsAvailable > 1 ? "s" : ""}
        </button>
      )}

      {/* Sign-in modal */}
      <Dialog.Root open={showSignInModal} onOpenChange={setShowSignInModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50" />
          <Dialog.Content className="fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] w-full max-w-md bg-card border border-border rounded-xl shadow-2xl z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
            <div className="flex items-center justify-between px-4 py-3">
              <Dialog.Title className="text-lg font-semibold text-foreground sr-only">
                Sign in to post
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors not-sr-only absolute top-4 right-4"
                  aria-label="Close"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Sign in or create an account to post
            </Dialog.Description>
            <div className="pt-4 pb-8 flex items-center justify-center">
              <SignIn />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
            <div
              className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
              style={{ animationDelay: "0.1s" }}
            ></div>
            <div
              className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
              style={{ animationDelay: "0.2s" }}
            ></div>
            <p className="ml-2 text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  )
}
