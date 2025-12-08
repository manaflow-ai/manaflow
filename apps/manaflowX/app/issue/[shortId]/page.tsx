"use client"

import { useQuery } from "convex/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { api } from "../../../convex/_generated/api"

export default function IssueByShortIdPage({
  params,
}: {
  params: Promise<{ shortId: string }>
}) {
  const router = useRouter()

  // Unwrap params with React.use pattern for Next.js 15+
  const { shortId } = params as unknown as { shortId: string }

  const issue = useQuery(api.issues.getIssueByShortId, { shortId })

  useEffect(() => {
    if (issue === null) {
      // Issue not found - redirect to issues page
      router.replace("/issues")
    } else if (issue) {
      // Issue found - redirect to issues page with issue selected
      router.replace(`/issues?issue=${issue._id}`)
    }
  }, [issue, router])

  // Loading state
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
        <p className="ml-2 text-muted-foreground">
          {issue === null ? "Issue not found..." : `Loading issue ${shortId}...`}
        </p>
      </div>
    </div>
  )
}
