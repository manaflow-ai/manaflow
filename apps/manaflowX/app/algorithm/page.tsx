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

function RepoCard({
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
    <div
      className={`p-4 border rounded-lg transition-all ${
        isMonitored
          ? "border-blue-500 bg-blue-500/10"
          : "border-gray-700 hover:border-gray-600"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white truncate">{repo.fullName}</h3>
            {repo.visibility === "private" && (
              <span className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">
                private
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Last push: {formatTimeAgo(repo.lastPushedAt)}
          </p>
        </div>
        <button
          onClick={onToggle}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isMonitored
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {isMonitored ? "Monitoring" : "Monitor"}
        </button>
      </div>
    </div>
  )
}

function AlgorithmContent() {
  const user = useUser()
  const repos = useQuery(api.github.getReposSortedByActivity)
  const monitoredRepos = useQuery(api.github.getMonitoredRepos)
  const toggleMonitoring = useMutation(api.github.toggleRepoMonitoring)
  const testFetchPR = useAction(api.prMonitor.testFetchAndPostPR)

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Sign in to manage Algorithm</h2>
          <Link
            href="/sign-in"
            className="bg-white text-black font-bold py-2 px-6 rounded-full hover:bg-gray-200 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  if (!repos) {
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

  const monitoredCount = monitoredRepos?.length ?? 0

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Algorithm</h1>
          <p className="text-gray-400">
            Select repositories to monitor for interesting PRs. The Algorithm will
            curate your feed with PRs that are ready to merge.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
            <p className="text-3xl font-bold text-white">{repos.length}</p>
            <p className="text-sm text-gray-400">Total Repos</p>
          </div>
          <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
            <p className="text-3xl font-bold text-blue-400">{monitoredCount}</p>
            <p className="text-sm text-gray-400">Monitored</p>
          </div>
        </div>

        {/* Test PR Fetch */}
        <div className="mb-8 p-4 bg-gray-900 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold text-white">Test PR Fetch</h2>
              <p className="text-sm text-gray-400">
                Fetch PRs from monitored repos and post one to the feed
              </p>
            </div>
            <button
              onClick={handleTestFetch}
              disabled={testStatus.loading || monitoredCount === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testStatus.loading ? "Fetching..." : "Fetch & Post PR"}
            </button>
          </div>

          {/* Result display */}
          {testStatus.result && (
            <div
              className={`p-3 rounded-lg ${
                testStatus.result.success
                  ? "bg-green-900/30 border border-green-700"
                  : "bg-red-900/30 border border-red-700"
              }`}
            >
              <p
                className={`text-sm ${
                  testStatus.result.success ? "text-green-400" : "text-red-400"
                }`}
              >
                {testStatus.result.message}
              </p>
              {testStatus.result.pr && (
                <div className="mt-2 text-sm">
                  <p className="text-gray-300">
                    <strong>PR:</strong>{" "}
                    <a
                      href={testStatus.result.pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {testStatus.result.pr.title}
                    </a>
                  </p>
                  <p className="text-gray-400">
                    <strong>Repo:</strong> {testStatus.result.pr.repo}
                  </p>
                </div>
              )}
            </div>
          )}

          {monitoredCount === 0 && (
            <p className="text-sm text-yellow-500 mt-2">
              Select at least one repo to monitor first
            </p>
          )}
        </div>

        {/* Repo List */}
        {repos.length === 0 ? (
          <div className="text-center py-12 border border-gray-800 rounded-lg">
            <svg
              className="w-12 h-12 mx-auto text-gray-600 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <h3 className="text-lg font-semibold mb-2">No repositories</h3>
            <p className="text-gray-400 mb-4">
              Connect your GitHub account to see your repositories.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                Repositories
                <span className="text-gray-400 font-normal ml-2">
                  (sorted by recent activity)
                </span>
              </h2>
            </div>
            {repos.map((repo) => (
              <RepoCard
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

export default function AlgorithmPage() {
  return <AlgorithmContent />
}
