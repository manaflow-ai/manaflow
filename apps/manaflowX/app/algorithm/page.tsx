"use client"

import { useQuery, useMutation } from "convex/react"
import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { useState, useEffect } from "react"
import { api } from "../../convex/_generated/api"

function GeneralContent() {
  const user = useUser()
  const grokSystemPrompt = useQuery(api.github.getAlgorithmTextSetting, { key: "grokSystemPrompt" })
  const setAlgorithmTextSetting = useMutation(api.github.setAlgorithmTextSetting)

  const [promptValue, setPromptValue] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const defaultPrompt = `You are curating a developer feed. Look at these open Pull Requests and pick the MOST INTERESTING one to share with the community.

Consider:
- Is it a significant feature or important bug fix?
- Does the title suggest something notable?
- Is it from an active/interesting project?
- Avoid drafts unless they look really interesting
- Prefer PRs with meaningful labels (bug, feature, enhancement) over chores/docs

Pick ONE PR that has NOT been posted yet and write an engaging tweet about it. The tweet should be concise and make developers want to check out the PR.`

  // Initialize prompt value when data loads
  useEffect(() => {
    if (grokSystemPrompt !== undefined) {
      setPromptValue(grokSystemPrompt || defaultPrompt)
    }
  }, [grokSystemPrompt, defaultPrompt])

  const handleChange = (value: string) => {
    setPromptValue(value)
    setHasChanges(value !== (grokSystemPrompt || defaultPrompt))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await setAlgorithmTextSetting({ key: "grokSystemPrompt", value: promptValue })
      setHasChanges(false)
    } catch (error) {
      console.error("Failed to save prompt:", error)
    } finally {
      setIsSaving(false)
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

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Grok System Prompt */}
      <div className="p-4 flex flex-col flex-1">
        <div className="mb-3">
          <h3 className="font-medium text-white">Grok System Prompt</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Customize how Grok selects and writes about content
          </p>
        </div>

        <textarea
          value={promptValue}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full flex-1 bg-gray-900 text-white text-sm p-3 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none resize-none font-mono"
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
