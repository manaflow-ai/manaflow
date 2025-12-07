"use client"

import { useQuery } from "convex/react"
import { useState } from "react"
import { Streamdown } from "streamdown"
import { api } from "../../convex/_generated/api"
import { Id } from "../../convex/_generated/dataModel"
import { IframeViewer, VNCIcon, WorkspaceIcon, VSCodeIcon } from "./IframeViewer"
import { embeddableComponents } from "../../components/EmbeddableComponents"

// =============================================================================
// Types
// =============================================================================

interface TurnPart {
  type: string
  isComplete: boolean
  text?: string
  toolCallId?: string
  toolName?: string
  toolInput?: unknown
  toolOutput?: string
  toolStatus?: "pending" | "running" | "completed" | "error"
  toolTitle?: string
  toolError?: string
  fileMime?: string
  fileName?: string
  fileUrl?: string
  finishReason?: string
  stepCost?: number
  stepTokens?: {
    input: number
    output: number
    reasoning?: number
  }
}

interface Turn {
  _id: Id<"turns">
  sessionId: Id<"sessions">
  role: "user" | "assistant" | "system" | "tool"
  status: "pending" | "streaming" | "complete" | "error"
  parts: TurnPart[]
  order: number
  createdAt: number
  updatedAt: number
}


// =============================================================================
// Part Renderers
// =============================================================================

function TextPart({ part }: { part: TurnPart }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <Streamdown components={embeddableComponents}>{part.text ?? ""}</Streamdown>
    </div>
  )
}

function ReasoningPart({ part }: { part: TurnPart }) {
  return (
    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 my-2">
      <div className="text-xs text-purple-400 font-medium mb-1 flex items-center gap-1">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        Thinking
      </div>
      <div className="prose prose-invert prose-sm max-w-none opacity-70">
        <Streamdown components={embeddableComponents}>{part.text ?? ""}</Streamdown>
      </div>
    </div>
  )
}

function ToolCallPart({ part }: { part: TurnPart }) {
  const statusColors: Record<string, string> = {
    pending: "text-gray-400",
    running: "text-yellow-400 animate-pulse",
    completed: "text-green-400",
    error: "text-red-400",
  }

  const statusIcons: Record<string, React.ReactNode> = {
    pending: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" strokeWidth={2} strokeDasharray="4 4" />
      </svg>
    ),
    running: (
      <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth={4} />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ),
    completed: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  }

  const status = part.toolStatus || "pending"

  // Highlight chrome MCP tools with a cyan border
  const isChromeTool = part.toolName?.startsWith("chrome_")

  return (
    <div className={`bg-gray-800/50 border rounded-lg my-2 overflow-hidden ${
      isChromeTool ? "border-cyan-600" : "border-gray-700"
    }`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className={statusColors[status]}>
          {statusIcons[status]}
        </span>
        <span className={`font-mono text-sm ${isChromeTool ? "text-cyan-400" : "text-blue-400"}`}>
          {part.toolName}
        </span>
        {part.toolTitle && (
          <span className="text-gray-400 text-sm truncate">{part.toolTitle}</span>
        )}
      </div>

      {/* Input */}
      {part.toolInput !== undefined && (
        <details className="group">
          <summary className="px-3 py-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-400 flex items-center gap-1">
            <svg className="w-3 h-3 group-open:rotate-90 transition-transform" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 6L14 10L6 14V6Z" />
            </svg>
            Input
          </summary>
          <pre className="px-3 py-2 text-xs text-gray-400 bg-gray-900/50 overflow-x-auto max-h-48">
            {JSON.stringify(part.toolInput, null, 2)}
          </pre>
        </details>
      )}

      {/* Output */}
      {part.toolOutput && (
        <details className="group" open={status === "completed"}>
          <summary className="px-3 py-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-400 flex items-center gap-1">
            <svg className="w-3 h-3 group-open:rotate-90 transition-transform" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 6L14 10L6 14V6Z" />
            </svg>
            Output
          </summary>
          <pre className="px-3 py-2 text-xs text-gray-400 bg-gray-900/50 overflow-x-auto max-h-64 whitespace-pre-wrap">
            {part.toolOutput.length > 2000
              ? part.toolOutput.slice(0, 2000) + "..."
              : part.toolOutput}
          </pre>
        </details>
      )}

      {/* Error */}
      {part.toolError && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-900/20">
          {part.toolError}
        </div>
      )}
    </div>
  )
}

function FilePart({ part }: { part: TurnPart }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 my-2 flex items-center gap-3">
      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <div>
        <div className="text-sm text-gray-200">{part.fileName || "File"}</div>
        {part.fileMime && (
          <div className="text-xs text-gray-500">{part.fileMime}</div>
        )}
      </div>
      {part.fileUrl && (
        <a
          href={part.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-blue-400 hover:text-blue-300 text-sm"
        >
          View
        </a>
      )}
    </div>
  )
}

function StepFinishPart({ part }: { part: TurnPart }) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 py-1 border-t border-gray-800 mt-2">
      {part.finishReason && (
        <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-400">
          {part.finishReason}
        </span>
      )}
      {part.stepTokens && (
        <span>
          {part.stepTokens.input + part.stepTokens.output} tokens
        </span>
      )}
      {part.stepCost !== undefined && (
        <span>${part.stepCost.toFixed(4)}</span>
      )}
    </div>
  )
}

function MessagePart({ part }: { part: TurnPart }) {
  switch (part.type) {
    case "text":
      return <TextPart part={part} />
    case "reasoning":
      return <ReasoningPart part={part} />
    case "tool_call":
      return <ToolCallPart part={part} />
    case "file":
      return <FilePart part={part} />
    case "step_finish":
      return <StepFinishPart part={part} />
    default:
      return null
  }
}

// =============================================================================
// Turn Component
// =============================================================================

function TurnMessage({ turn }: { turn: Turn }) {
  const roleColors: Record<string, string> = {
    user: "border-l-blue-500",
    assistant: "border-l-green-500",
    system: "border-l-gray-500",
    tool: "border-l-purple-500",
  }

  const roleLabels: Record<string, string> = {
    user: "User",
    assistant: "Grok",
    system: "System",
    tool: "Tool",
  }

  return (
    <div className={`border-l-2 pl-4 py-3 ${roleColors[turn.role] || "border-l-gray-700"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-400">
          {roleLabels[turn.role] || turn.role}
        </span>
        <span className="text-xs text-gray-600 ml-auto">
          {new Date(turn.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="space-y-1">
        {turn.parts.map((part, idx) => (
          <MessagePart key={idx} part={part} />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

interface BrowserAgentSessionProps {
  sessionId: Id<"sessions">
  onClose?: () => void
}

export function BrowserAgentSession({ sessionId, onClose }: BrowserAgentSessionProps) {
  const data = useQuery(api.codingAgent.getCodingAgentSession, { sessionId })
  const [vncExpanded, setVncExpanded] = useState(true)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false)
  const [vscodeExpanded, setVscodeExpanded] = useState(false)

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth={4} />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading session...
        </div>
      </div>
    )
  }

  const { session, turns } = data

  // Get morphInstanceId from session data
  const morphInstanceId = session.morphInstanceId

  const statusColors: Record<string, string> = {
    active: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
  }

  const instanceSlug = morphInstanceId?.replace('_', '-')
  const vmUrl = instanceSlug ? `https://port-4096-${instanceSlug}.http.cloud.morph.so` : null
  const vscodeUrl = instanceSlug ? `https://code-server-${instanceSlug}.http.cloud.morph.so/?folder=/root/workspace` : null

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header */}
      <div className="flex-shrink-0 h-[60px] px-4 border-b border-gray-800 bg-black/80 backdrop-blur-md flex items-center">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span className="font-semibold text-white">Browser Agent</span>
            {session.tokens && (
              <span className="text-xs text-gray-500">
                {session.tokens.input + session.tokens.output} tokens
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[session.status]}`}>
              {session.status}
            </span>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {!morphInstanceId && (
          <div className="m-4 flex items-center gap-2 p-2 bg-gray-900/50 border border-gray-700 rounded-lg">
            <svg className="w-4 h-4 text-yellow-400 animate-pulse flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-gray-400">Waiting for VM to start...</span>
          </div>
        )}

        {/* Iframe Viewers - Live Browser, Opencode, VS Code */}
        {morphInstanceId && (
          <>
            <IframeViewer
              url={`https://novnc-${instanceSlug}.http.cloud.morph.so/vnc.html?autoconnect=true&resize=scale`}
              title="Live Browser View"
              icon={VNCIcon}
              color="text-cyan-400"
              isExpanded={vncExpanded}
              onToggle={() => setVncExpanded(!vncExpanded)}
              aspectRatio="16/9"
            />
            {vmUrl && (
              <IframeViewer
                url={vmUrl}
                title="Opencode"
                icon={WorkspaceIcon}
                color="text-green-400"
                isExpanded={workspaceExpanded}
                onToggle={() => setWorkspaceExpanded(!workspaceExpanded)}
              />
            )}
            {vscodeUrl && (
              <IframeViewer
                url={vscodeUrl}
                title="VS Code"
                icon={VSCodeIcon}
                color="text-blue-400"
                isExpanded={vscodeExpanded}
                onToggle={() => setVscodeExpanded(!vscodeExpanded)}
              />
            )}
          </>
        )}

        {/* Messages */}
        <div className="p-4 space-y-4">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <svg className="w-8 h-8 mb-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>Waiting for messages...</span>
            </div>
          ) : (
            turns.map((turn) => (
              <TurnMessage key={turn._id} turn={turn as Turn} />
            ))
          )}
        </div>
      </div>

      {/* Footer with session info */}
      <div className="flex-shrink-0 px-4 py-2 border-t border-gray-800 text-xs text-gray-600 flex items-center justify-between">
        <span>Session: {sessionId.slice(0, 12)}...</span>
        <span>
          {new Date(session.createdAt).toLocaleString()}
        </span>
      </div>
    </div>
  )
}

export default BrowserAgentSession
