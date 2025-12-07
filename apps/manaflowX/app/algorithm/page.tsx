"use client"

import { useQuery, useMutation, useAction } from "convex/react"
import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { useState, useEffect } from "react"
import TextareaAutosize from "react-textarea-autosize"
import { api } from "../../convex/_generated/api"

function GeneralContent() {
  const user = useUser()
  const algorithmSettings = useQuery(api.github.getAlgorithmSettings)
  const setAlgorithmPrompt = useMutation(api.github.setAlgorithmPrompt)
  const setCuratorPrompt = useMutation(api.github.setCuratorPrompt)
  const toggleAlgorithmEnabled = useMutation(api.github.toggleAlgorithmEnabled)

  // Algorithm controls
  const monitoredRepos = useQuery(api.github.getMonitoredRepos)
  const testFetchPR = useAction(api.githubMonitor.testFetchAndPostPR)

  const [testStatus, setTestStatus] = useState<{
    loading: boolean
    result?: { success: boolean; message: string; pr?: { title: string; url: string; repo: string } }
  }>({ loading: false })

  // X Feed controls
  const testXFeed = useAction(api.tweetFeed.testTweetFeed)
  const [xTestStatus, setXTestStatus] = useState<{
    loading: boolean
    result?: { success: boolean; message: string; tweet?: { text: string; author: string; url: string } }
  }>({ loading: false })

  // Poaster prompt state
  const [poasterPromptValue, setPoasterPromptValue] = useState("")
  const [isPoasterSaving, setIsPoasterSaving] = useState(false)
  const [hasPoasterChanges, setHasPoasterChanges] = useState(false)

  // Curator prompt state
  const [curatorPromptValue, setCuratorPromptValue] = useState("")
  const [isCuratorSaving, setIsCuratorSaving] = useState(false)
  const [hasCuratorChanges, setHasCuratorChanges] = useState(false)

  const defaultPoasterPrompt = `You are curating a developer feed and deciding how to engage with the codebase. You have two options:

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

  const defaultCuratorPrompt = `You are a feed curator focused on surfacing high-quality code changes ready for review and merging.

Review these posts and select up to 10 that are worth showing. Prioritize:
- PRs and code changes that appear complete and ready to merge
- PRs that need review attention (ready for eyes, not WIP)
- Significant features or bug fixes that are polished
- Code discussions showing finalized implementations
- Posts about merged or nearly-merged contributions
- Funny, clever, or genuinely interesting content that brings joy

Deprioritize:
- Work-in-progress or draft PRs
- Early-stage explorations or experiments
- Posts asking for help with incomplete code
- Low effort or trivial changes
- Off-topic or spam-like content

For replies: If a reply indicates a PR is approved, ready to merge, or provides final review feedback, surface it.

Select posts that help users see what's ready to ship. Return an empty array if none qualify.`

  // Initialize prompt values when data loads
  useEffect(() => {
    if (algorithmSettings !== undefined) {
      setPoasterPromptValue(algorithmSettings.prompt || defaultPoasterPrompt)
      setCuratorPromptValue(algorithmSettings.curatorPrompt || defaultCuratorPrompt)
    }
  }, [algorithmSettings, defaultPoasterPrompt, defaultCuratorPrompt])

  const handlePoasterChange = (value: string) => {
    setPoasterPromptValue(value)
    setHasPoasterChanges(value !== (algorithmSettings?.prompt || defaultPoasterPrompt))
  }

  const handleCuratorChange = (value: string) => {
    setCuratorPromptValue(value)
    setHasCuratorChanges(value !== (algorithmSettings?.curatorPrompt || defaultCuratorPrompt))
  }

  const handlePoasterSave = async () => {
    setIsPoasterSaving(true)
    try {
      await setAlgorithmPrompt({ prompt: poasterPromptValue })
      setHasPoasterChanges(false)
    } catch (error) {
      console.error("Failed to save Poaster prompt:", error)
    } finally {
      setIsPoasterSaving(false)
    }
  }

  const handleCuratorSave = async () => {
    setIsCuratorSaving(true)
    try {
      await setCuratorPrompt({ prompt: curatorPromptValue })
      setHasCuratorChanges(false)
    } catch (error) {
      console.error("Failed to save Curator prompt:", error)
    } finally {
      setIsCuratorSaving(false)
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

  const handleTestXFeed = async () => {
    setXTestStatus({ loading: true })
    try {
      const result = await testXFeed()
      setXTestStatus({ loading: false, result })
    } catch (error) {
      setXTestStatus({
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
      {/* Curator Section */}
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground mb-1">Curator</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Scans recent posts and replies, using AI to surface the most interesting content to the curated feed.
        </p>

        {/* Curator System Prompt */}
        <div>
          <div className="mb-3">
            <h3 className="font-medium text-foreground">System Prompt</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Customize how Curator evaluates and selects posts for the feed
            </p>
          </div>

          <TextareaAutosize
            value={curatorPromptValue}
            onChange={(e) => handleCuratorChange(e.target.value)}
            minRows={6}
            className="w-full bg-muted text-foreground text-sm p-3 rounded-lg border border-border focus:border-blue-500 focus:outline-none resize-none font-mono"
            placeholder="Enter the system prompt for Curator..."
          />

          <div className="flex justify-end mt-3">
            <button
              onClick={handleCuratorSave}
              disabled={isCuratorSaving || !hasCuratorChanges || !curatorPromptValue.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCuratorSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Poaster Section */}
      <div className="p-4">
        <h2 className="text-lg font-semibold text-foreground mb-1">Poaster</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Monitors your GitHub repos and autonomously posts about interesting PRs or delegates issues to coding agents.
        </p>

        {/* Auto Algorithm Control */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-medium text-foreground">Auto Mode</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Post about PRs or solve issues automatically
            </p>
          </div>
          <button
            onClick={() => toggleAlgorithmEnabled()}
            disabled={monitoredCount === 0}
            className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 disabled:cursor-not-allowed ${
              isEnabled ? "bg-blue-600" : "bg-muted"
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
          <div className="mb-4 flex items-center gap-2 text-sm text-blue-400">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            Active
          </div>
        )}

        {monitoredCount === 0 && (
          <p className="mb-4 text-sm text-muted-foreground">
            Enable monitoring on repos in the GitHub tab first
          </p>
        )}

        {/* Run Algorithm */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-medium text-foreground">Run Manually</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Post about a PR or start solving an issue now
            </p>
          </div>
          <button
            onClick={handleTestFetch}
            disabled={testStatus.loading || monitoredCount === 0}
            className="px-3 py-1.5 bg-card text-foreground text-sm rounded-lg hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testStatus.loading ? "Running..." : "Run"}
          </button>
        </div>

        {testStatus.result && (
          <div className={`mb-4 text-sm ${testStatus.result.success ? "text-green-400" : "text-red-400"}`}>
            {testStatus.result.message}
          </div>
        )}

        {/* Poaster System Prompt */}
        <div>
          <div className="mb-3">
            <h3 className="font-medium text-foreground">System Prompt</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Customize how Poaster selects PRs and issues to engage with
            </p>
          </div>

          <TextareaAutosize
            value={poasterPromptValue}
            onChange={(e) => handlePoasterChange(e.target.value)}
            minRows={6}
            className="w-full bg-muted text-foreground text-sm p-3 rounded-lg border border-border focus:border-blue-500 focus:outline-none resize-none font-mono"
            placeholder="Enter the system prompt for Poaster..."
          />

          <div className="flex justify-end mt-3">
            <button
              onClick={handlePoasterSave}
              disabled={isPoasterSaving || !hasPoasterChanges || !poasterPromptValue.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPoasterSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* X Feed Section */}
      <div className="p-4 border-t border-border">
        <h2 className="text-lg font-semibold text-foreground mb-1">X Feed</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Imports interesting developer tweets from X to populate the feed. Enabled automatically when Auto Mode is on.
        </p>

        {/* X Feed Status */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-medium text-foreground">Status</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              X feed runs automatically when Auto Mode is enabled
            </p>
          </div>
          <div className={`px-3 py-1.5 text-sm rounded-lg ${isEnabled ? "bg-blue-600/20 text-blue-400" : "bg-muted text-muted-foreground"}`}>
            {isEnabled ? "Active" : "Inactive"}
          </div>
        </div>

        {/* Test X Feed */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-medium text-foreground">Test Import</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Search X and import one tweet now
            </p>
          </div>
          <button
            onClick={handleTestXFeed}
            disabled={xTestStatus.loading}
            className="px-3 py-1.5 bg-card text-foreground text-sm rounded-lg hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {xTestStatus.loading ? "Searching..." : "Test"}
          </button>
        </div>

        {xTestStatus.result && (
          <div className={`mb-4 text-sm ${xTestStatus.result.success ? "text-green-400" : "text-red-400"}`}>
            {xTestStatus.result.message}
            {xTestStatus.result.tweet && (
              <div className="mt-2 p-2 bg-muted rounded text-muted-foreground">
                <div className="font-medium text-foreground">{xTestStatus.result.tweet.author}</div>
                <div className="text-xs mt-1">{xTestStatus.result.tweet.text}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function GeneralPage() {
  return <GeneralContent />
}
