"use client"

import { useQuery, useMutation, useAction } from "convex/react"
import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { useState, useEffect } from "react"
import { api } from "../../convex/_generated/api"

function GeneralContent() {
  const user = useUser()
  const algorithmSettings = useQuery(api.github.getAlgorithmSettings)
  const setAlgorithmPrompt = useMutation(api.github.setAlgorithmPrompt)
  const toggleAlgorithmEnabled = useMutation(api.github.toggleAlgorithmEnabled)

  // Algorithm controls
  const monitoredRepos = useQuery(api.github.getMonitoredRepos)
  const testFetchPR = useAction(api.githubMonitor.testFetchAndPostPR)

  const [testStatus, setTestStatus] = useState<{
    loading: boolean
    result?: { success: boolean; message: string; pr?: { title: string; url: string; repo: string } }
  }>({ loading: false })

  const [promptValue, setPromptValue] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const defaultPrompt = `You are curating a developer feed and deciding how to engage with the codebase. You have two options:

1. **Post about a PR** - Share an interesting Pull Request with the community
2. **Solve an Issue** - Pick an issue to work on and delegate to a coding agent

IMPORTANT: Aim for roughly 50/50 balance between these actions over time. Alternate between them - if you'd normally pick a PR, consider if there's a good issue to solve instead, and vice versa. Both actions are equally valuable.

For PRs, look for:
- Significant features or important bug fixes
- PRs that look ready to merge or need review
- Interesting technical changes

For Issues, look for:
- Tractable bugs or features that can realistically be solved
- Well-defined issues with clear requirements
- Issues that would provide clear value when fixed

Pick the most interesting item from whichever category you choose. Write engaging content that makes developers want to check it out.`

  // Initialize prompt value when data loads
  useEffect(() => {
    if (algorithmSettings !== undefined) {
      setPromptValue(algorithmSettings.prompt || defaultPrompt)
    }
  }, [algorithmSettings, defaultPrompt])

  const handleChange = (value: string) => {
    setPromptValue(value)
    setHasChanges(value !== (algorithmSettings?.prompt || defaultPrompt))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await setAlgorithmPrompt({ prompt: promptValue })
      setHasChanges(false)
    } catch (error) {
      console.error("Failed to save prompt:", error)
    } finally {
      setIsSaving(false)
    }
  }

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

  const monitoredCount = monitoredRepos?.length ?? 0
  const isEnabled = algorithmSettings?.enabled ?? false

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

  return (
    <div className="max-w-2xl mx-auto">
      {/* Auto Algorithm Control */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-white">Auto Algorithm</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Post about PRs or solve issues automatically
            </p>
          </div>
          <button
            onClick={() => toggleAlgorithmEnabled()}
            disabled={monitoredCount === 0}
            className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 disabled:cursor-not-allowed ${
              isEnabled ? "bg-blue-600" : "bg-gray-700"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                isEnabled ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>

        {isEnabled && (
          <div className="mt-3 flex items-center gap-2 text-sm text-blue-400">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            Active
          </div>
        )}

        {monitoredCount === 0 && (
          <p className="mt-2 text-sm text-gray-500">
            Enable monitoring on repos in the GitHub tab first
          </p>
        )}
      </div>

      {/* Run Algorithm */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-white">Run Algorithm</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Post about a PR or start solving an issue now
            </p>
          </div>
          <button
            onClick={handleTestFetch}
            disabled={testStatus.loading || monitoredCount === 0}
            className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testStatus.loading ? "Running..." : "Run"}
          </button>
        </div>

        {testStatus.result && (
          <div className={`mt-3 text-sm ${testStatus.result.success ? "text-green-400" : "text-red-400"}`}>
            {testStatus.result.message}
          </div>
        )}
      </div>

      {/* Grok System Prompt */}
      <div className="p-4">
        <div className="mb-3">
          <h3 className="font-medium text-white">Grok System Prompt</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Customize how Grok selects and writes about content
          </p>
        </div>

        <textarea
          value={promptValue}
          onChange={(e) => handleChange(e.target.value)}
          rows={12}
          className="w-full bg-gray-900 text-white text-sm p-3 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none resize-none font-mono"
          placeholder="Enter the system prompt for Grok..."
        />

        <div className="flex justify-end mt-3">
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges || !promptValue.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GeneralPage() {
  return <GeneralContent />
}
