"use client"

import { useQuery, useMutation } from "convex/react"
import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { useCallback, useEffect } from "react"
import { api } from "../../../convex/_generated/api"
import { Id } from "../../../convex/_generated/dataModel"

function formatTimeAgo(timestamp: number | undefined): string {
  if (!timestamp) return "Never"
  const seconds = Math.floor((Date.now() - timestamp) / 1000)

  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function RepoRow({
  repo,
  onToggle,
}: {
  repo: {
    _id: Id<"repos">
    fullName: string
    org: string
    name: string
    visibility?: "public" | "private"
    lastPushedAt?: number
    isMonitored?: boolean
  }
  onToggle: () => void
}) {
  const isMonitored = repo.isMonitored ?? false

  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-gray-900/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white truncate">{repo.fullName}</span>
            {repo.visibility === "private" && (
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded flex-shrink-0">
                private
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">{formatTimeAgo(repo.lastPushedAt)}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${
          isMonitored ? "bg-blue-600" : "bg-gray-700"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            isMonitored ? "left-5" : "left-0.5"
          }`}
        />
      </button>
    </div>
  )
}

function GitHubContent() {
  const user = useUser()
  const repos = useQuery(api.github.getReposSortedByActivity)
  const monitoredRepos = useQuery(api.github.getMonitoredRepos)
  const toggleMonitoring = useMutation(api.github.toggleRepoMonitoring)
  const mintState = useMutation(api.github_app.mintInstallState)

  // GitHub App installation
  const githubAppSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG
  const installNewUrl = githubAppSlug
    ? `https://github.com/apps/${githubAppSlug}/installations/new`
    : null

  const handleInstallApp = useCallback(async () => {
    if (!installNewUrl) {
      alert("GitHub App not configured")
      return
    }

    try {
      const returnUrl = window.location.href
      const { state } = await mintState({ returnUrl })
      const sep = installNewUrl.includes("?") ? "&" : "?"
      const url = `${installNewUrl}${sep}state=${encodeURIComponent(state)}`

      // Open in a centered popup
      const width = 980
      const height = 780
      const left = Math.max(0, (window.outerWidth - width) / 2 + window.screenX)
      const top = Math.max(0, (window.outerHeight - height) / 2 + window.screenY)
      const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`

      window.open(url, "github-install", features)
    } catch (err) {
      console.error("Failed to start GitHub install:", err)
      alert("Failed to start installation. Please try again.")
    }
  }, [installNewUrl, mintState])

  // Listen for popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const expectedOrigin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      if (event.origin !== expectedOrigin) return
      // Convex queries will auto-update
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-3">Sign in to continue</h2>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 bg-white text-black font-medium py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  if (!repos) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-pulse" />
          <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
          <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
        </div>
      </div>
    )
  }

  const monitoredCount = monitoredRepos?.length ?? 0

  return (
    <div className="max-w-2xl mx-auto">
      {/* Repositories */}
      <div>
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">Repositories</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                {monitoredCount} of {repos.length} monitored
              </span>
              {installNewUrl && (
                <button
                  onClick={handleInstallApp}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add repos
                </button>
              )}
            </div>
          </div>
        </div>

        {repos.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </div>
            <p className="text-gray-400 mb-1">No repositories connected</p>
            <p className="text-sm text-gray-500 mb-4">Connect your GitHub account to get started</p>
            {installNewUrl && (
              <button
                onClick={handleInstallApp}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Connect GitHub
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {repos.map((repo) => (
              <RepoRow
                key={repo._id}
                repo={repo}
                onToggle={() => toggleMonitoring({ repoId: repo._id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function GitHubPage() {
  return <GitHubContent />
}
