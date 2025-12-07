"use client"

import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { ConnectXButton } from "@/components/ConnectXButton"

export default function XPage() {
  const user = useUser()

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-3">Sign in to continue</h2>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 bg-foreground text-background font-medium py-2 px-4 rounded-lg hover:bg-foreground/90 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* X Account Connection */}
      <div className="p-4 border-b border-border">
        <div className="mb-3">
          <h3 className="font-medium text-foreground">X Account</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect your X account to enable posting and interactions
          </p>
        </div>
        <ConnectXButton />
      </div>
    </div>
  )
}
