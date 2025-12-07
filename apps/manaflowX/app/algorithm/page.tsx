"use client"

import { useQuery, useMutation, useAction } from "convex/react"
import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { useState } from "react"
import { api } from "../../convex/_generated/api"
import { Id } from "../../convex/_generated/dataModel"

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
  const testFetchPR = useAction(api.prMonitor.testFetchAndPostPR)

  // Algorithm settings
  const prMonitorEnabled = useQuery(api.github.getAlgorithmSetting, { key: "prMonitorEnabled" })
  const toggleAlgorithmSetting = useMutation(api.github.toggleAlgorithmSetting)

  const [testStatus, setTestStatus] = useState<{
    loading: boolean
    result?: { success: boolean; message: string; pr?: { title: string; url: string; repo: string } }
  }>({ loading: false })

  const handleTestFetch = async () => {
    setTestStatus({ loading: true })
    try {
      const result = await testFetchPR()
      setTestStatus({ loading: false, result })
    } catch (error) {
      setTestStatus({
        loading: false,
        result: {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })
    }
  }

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
      {/* Auto-Post Control */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-white">PR Auto-Post</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Post interesting PRs to feed every minute
            </p>
          </div>
          <button
            onClick={() => toggleAlgorithmSetting({ key: "prMonitorEnabled" })}
            disabled={monitoredCount === 0}
            className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 disabled:cursor-not-allowed ${
              prMonitorEnabled ? "bg-blue-600" : "bg-gray-700"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                prMonitorEnabled ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>

        {prMonitorEnabled && (
          <div className="mt-3 flex items-center gap-2 text-sm text-blue-400">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            Active
          </div>
        )}
      </div>

      {/* Manual Test */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-white">Manual Post</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Fetch and post a PR now
            </p>
          </div>
          <button
            onClick={handleTestFetch}
            disabled={testStatus.loading || monitoredCount === 0}
            className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testStatus.loading ? "Posting..." : "Post PR"}
          </button>
        </div>

        {testStatus.result && (
          <div className={`mt-3 text-sm ${testStatus.result.success ? "text-green-400" : "text-red-400"}`}>
            {testStatus.result.message}
          </div>
        )}
      </div>

      {/* Repositories */}
      <div>
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">Repositories</h3>
            <span className="text-sm text-gray-500">
              {monitoredCount} of {repos.length} monitored
            </span>
          </div>
        </div>

        {repos.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No repositories found.</p>
            <p className="text-sm mt-1">Connect your GitHub account to get started.</p>
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
