"use client"

import { useQuery } from "convex/react"
import { useRouter } from "next/navigation"
import { api } from "../../../convex/_generated/api"
import { Id } from "../../../convex/_generated/dataModel"
import { CodingAgentSession } from "../../components/CodingAgentSession"
import { BrowserAgentSession } from "../../components/BrowserAgentSession"

export default function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const router = useRouter()

  // Unwrap params for Next.js 15+
  const { sessionId } = params as unknown as { sessionId: string }

  const session = useQuery(api.sessions.getSession, {
    sessionId: sessionId as Id<"sessions">,
  })

  // Loading state
  if (session === undefined) {
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
          <p className="ml-2 text-muted-foreground">Loading session...</p>
        </div>
      </div>
    )
  }

  // Not found state
  if (session === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-muted-foreground">Session not found</div>
        <button
          onClick={() => router.push("/")}
          className="text-blue-400 hover:text-blue-300 transition-colors"
        >
          Go back home
        </button>
      </div>
    )
  }

  // Determine which session component to show based on agent type
  const isBrowserAgent = session.agent === "browser"

  return (
    <div className="min-h-screen">
      <div className="flex justify-center">
        <main className="w-full max-w-[800px] border-x border-border min-h-screen">
          {isBrowserAgent ? (
            <BrowserAgentSession
              sessionId={sessionId as Id<"sessions">}
              onClose={() => router.push("/")}
            />
          ) : (
            <CodingAgentSession
              sessionId={sessionId as Id<"sessions">}
              onClose={() => router.push("/")}
            />
          )}
        </main>
      </div>
    </div>
  )
}
