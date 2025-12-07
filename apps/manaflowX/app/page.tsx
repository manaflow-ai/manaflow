"use client"

import { useQuery, useMutation } from "convex/react"
import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Streamdown } from "streamdown"
import { api } from "../convex/_generated/api"
import { useState, useCallback, Suspense } from "react"
import { Id } from "../convex/_generated/dataModel"
import { SessionsByPost } from "../components/SessionView"
import { CodingAgentSession } from "./components/CodingAgentSession"
import { BrowserAgentSession } from "./components/BrowserAgentSession"
import { RepoPickerDropdown } from "@/components/RepoPickerDropdown"
import { ConnectXButton } from "@/components/ConnectXButton"
import { GrokIcon } from "@/components/GrokIcon"

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
}

function PostCard({
  post,
  onReply,
  onClick,
  isSelected = false,
  isReply = false,
}: {
  post: Post
  onReply: () => void
  onClick?: () => void
  isSelected?: boolean
  isReply?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`p-4 border-b border-gray-800 hover:bg-gray-900/30 transition-colors cursor-pointer ${
        isReply ? "border-l border-gray-700" : ""
      } ${isSelected ? "bg-gray-900/50 border-l-2 border-l-blue-500" : ""}`}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {post.author === "Assistant" || post.author === "Grok" ? (
            <div className="w-10 h-10 rounded-full bg-black border border-gray-700 flex items-center justify-center">
              <GrokIcon size={24} className="text-white" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold">
              {post.author[0].toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-bold hover:underline">
              {post.author === "Assistant" ? "Grok" : post.author}
            </span>
            <span className="text-gray-500 text-sm">
              · {new Date(post.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="prose prose-invert prose-sm max-w-none mb-3">
            <Streamdown>{post.content}</Streamdown>
          </div>
          <div className="flex gap-4 text-gray-500 text-sm">
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
              <span className="text-gray-400">{post.replyCount} replies</span>
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
}: {
  replyingTo: Post
  onCancel: () => void
  onSubmit: (content: string) => void
}) {
  const [content, setContent] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!content.trim()) return
    setIsSubmitting(true)
    await onSubmit(content)
    setContent("")
    setIsSubmitting(false)
  }

  return (
    <div className="p-4 border-b border-gray-800 bg-gray-900/50">
      <div className="text-sm text-gray-500 mb-2">
        Replying to{" "}
        <span className="text-blue-400">
          @{replyingTo.author === "Assistant" ? "Grok" : replyingTo.author}
        </span>
      </div>
      <textarea
        className="w-full bg-gray-800 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none p-3 rounded-lg"
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
          className="px-4 py-1.5 text-gray-400 hover:text-white transition-colors"
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
}: {
  postId: Id<"posts">
  onClose: () => void
  onSelectPost: (postId: Id<"posts">) => void
  onCodingAgentSessionSelect?: (sessionId: Id<"sessions"> | null) => void
  onBrowserAgentSessionSelect?: (sessionId: Id<"sessions"> | null) => void
}) {
  const thread = useQuery(api.posts.getPostThread, { postId })
  const createPost = useMutation(api.posts.createPost)
  const [replyingTo, setReplyingTo] = useState<Post | null>(null)

  const handleReply = async (content: string) => {
    if (!replyingTo) return
    await createPost({
      content,
      replyTo: replyingTo._id,
    })
    setReplyingTo(null)
  }

  if (!thread) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
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

  const renderReplies = (parentId: string, depth: number): React.ReactNode => {
    const replies = repliesByParent.get(parentId) ?? []
    if (replies.length === 0) return null

    return (
      <div className={depth > 0 ? "pl-4 border-l border-gray-800" : ""}>
        {replies.map((reply) => (
          <div key={reply._id}>
            <PostCard
              post={reply}
              onReply={() => setReplyingTo(reply)}
              onClick={() => onSelectPost(reply._id)}
              isReply
              isSelected={reply._id === postId}
            />
            {replyingTo?._id === reply._id && (
              <ReplyComposer
                replyingTo={reply}
                onCancel={() => setReplyingTo(null)}
                onSubmit={handleReply}
              />
            )}
            {renderReplies(reply._id.toString(), depth + 1)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center sticky top-0 bg-black/80 backdrop-blur-md">
        <h2 className="text-lg font-bold">Thread</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors"
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
          />
        )}

        {/* Show AI sessions for the focused post */}
        <div className="px-4">
          <SessionsByPost
            postId={postId}
            onCodingAgentSessionSelect={onCodingAgentSessionSelect}
            onBrowserAgentSessionSelect={onBrowserAgentSessionSelect}
          />
        </div>

        {/* Render nested replies */}
        {renderReplies(thread.root._id.toString(), 0)}
      </div>
    </div>
  )
}

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useUser()
  const data = useQuery(api.posts.listPosts, { limit: 20 })
  const [content, setContent] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)

  // Get selected post and agent sessions from URL search params
  const selectedThread = searchParams.get("post") as Id<"posts"> | null
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
      codingAgent?: Id<"sessions"> | null
      browserAgent?: Id<"sessions"> | null
    }) => {
      const urlParams = new URLSearchParams()
      if (params.post) urlParams.set("post", params.post)
      if (params.codingAgent) urlParams.set("codingAgent", params.codingAgent)
      if (params.browserAgent) urlParams.set("browserAgent", params.browserAgent)
      const queryString = urlParams.toString()
      return queryString ? `/?${queryString}` : "/"
    },
    [],
  )

  // When changing post, clear the agent panels (they're associated with the previous post)
  const setSelectedThread = useCallback(
    (postId: Id<"posts"> | null) => {
      router.push(buildUrl({ post: postId }), { scroll: false })
    },
    [router, buildUrl],
  )

  const setSelectedCodingAgentSession = useCallback(
    (sessionId: Id<"sessions"> | null) => {
      router.push(
        buildUrl({
          post: selectedThread,
          codingAgent: sessionId,
          browserAgent: selectedBrowserAgentSession,
        }),
        { scroll: false },
      )
    },
    [router, buildUrl, selectedThread, selectedBrowserAgentSession],
  )

  const setSelectedBrowserAgentSession = useCallback(
    (sessionId: Id<"sessions"> | null) => {
      router.push(
        buildUrl({
          post: selectedThread,
          codingAgent: selectedCodingAgentSession,
          browserAgent: sessionId,
        }),
        { scroll: false },
      )
    },
    [router, buildUrl, selectedThread, selectedCodingAgentSession],
  )

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
      // Focus on the newly created post
      if (result.postId) {
        setSelectedThread(result.postId as Id<"posts">)
      }
    } catch (error) {
      console.error("Failed to create post:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
          <div
            className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "0.1s" }}
          ></div>
          <div
            className="w-2 h-2 bg-gray-600 rounded-full animate-bounce"
            style={{ animationDelay: "0.2s" }}
          ></div>
          <p className="ml-2 text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  const { viewer, posts } = data

  return (
    <div className="min-h-screen">
      <div className="flex justify-center">
        {/* Main Feed Column */}
        <main
          className={`w-full max-w-[600px] border-x border-gray-800 min-h-screen`}
        >
          <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-gray-800 p-4 flex justify-between items-center">
            <h1 className="text-xl font-bold">Feed</h1>
            {!user ? (
              <Link
                href="/sign-in"
                className="bg-white text-black font-bold py-1.5 px-4 rounded-full hover:bg-gray-200 transition-colors"
              >
                Sign in
              </Link>
            ) : null}
          </div>

          <div className="p-4 border-b border-gray-800">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-sm font-bold">
                  {viewer ? viewer[0].toUpperCase() : "?"}
                </div>
              </div>
              <div className="flex-grow">
                <textarea
                  className="w-full bg-transparent text-xl placeholder-gray-500 focus:outline-none resize-none py-2"
                  placeholder="What's happening?"
                  rows={3}
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
            <div className="flex justify-between items-center mt-2 border-t border-gray-800 pt-3">
              <div className="flex gap-2 items-center">
                {/* Repo picker dropdown */}
                {user && (
                  <RepoPickerDropdown
                    selectedRepo={selectedRepo}
                    onRepoSelect={setSelectedRepo}
                  />
                )}
                {/* Connect X account button */}
                {user && <ConnectXButton />}
              </div>
              <button
                disabled={!content.trim() || isSubmitting}
                onClick={handleSubmit}
                className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded-full transition-colors"
              >
                {isSubmitting ? "Posting..." : "Post"}
              </button>
            </div>
          </div>

          <div>
            {posts.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No posts yet. Share something!
              </div>
            ) : (
              posts.map((post) => (
                <PostCard
                  key={post._id}
                  post={post}
                  onClick={() => setSelectedThread(post._id)}
                  onReply={() => setSelectedThread(post._id)}
                  isSelected={selectedThread === post._id}
                />
              ))
            )}
          </div>
        </main>

        {/* Thread Panel - Right Column */}
        {selectedThread && (
          <aside className="w-[550px] border-r border-gray-800 min-h-screen sticky top-0 h-screen overflow-hidden hidden lg:block">
            <ThreadPanel
              postId={selectedThread}
              onClose={() => setSelectedThread(null)}
              onSelectPost={setSelectedThread}
              onCodingAgentSessionSelect={setSelectedCodingAgentSession}
              onBrowserAgentSessionSelect={setSelectedBrowserAgentSession}
            />
          </aside>
        )}

        {/* Coding Agent Session Panel - Third Column */}
        {selectedCodingAgentSession && !selectedBrowserAgentSession && (
          <aside className="w-[500px] border-r border-gray-800 min-h-screen sticky top-0 h-screen overflow-hidden hidden xl:block">
            <CodingAgentSession
              sessionId={selectedCodingAgentSession}
              onClose={() => setSelectedCodingAgentSession(null)}
            />
          </aside>
        )}

        {/* Browser Agent Session Panel - Third Column (takes precedence over coding agent) */}
        {selectedBrowserAgentSession && (
          <aside className="w-[600px] border-r border-gray-800 min-h-screen sticky top-0 h-screen overflow-hidden hidden xl:block">
            <BrowserAgentSession
              sessionId={selectedBrowserAgentSession}
              onClose={() => setSelectedBrowserAgentSession(null)}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
            <div
              className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.1s" }}
            ></div>
            <div
              className="w-2 h-2 bg-gray-600 rounded-full animate-bounce"
              style={{ animationDelay: "0.2s" }}
            ></div>
            <p className="ml-2 text-gray-400">Loading...</p>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  )
}
