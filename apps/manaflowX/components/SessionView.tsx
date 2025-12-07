"use client";

import { useQuery } from "convex/react";
import { Streamdown } from "streamdown";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

type Part = {
  type: "text" | "reasoning" | "tool_call" | "tool_result" | "file" | "step_start" | "step_finish" | "error";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  toolStatus?: "pending" | "running" | "completed" | "error";
  toolProgress?: {
    stage: string;
    message: string;
    sessionId?: string;
    instanceId?: string;
  };
  fileUrl?: string;
  fileMime?: string;
  fileName?: string;
  stepTokens?: { input: number; output: number };
  isComplete: boolean;
};

type Turn = {
  _id: Id<"turns">;
  sessionId: Id<"sessions">;
  role: "user" | "assistant" | "system" | "tool";
  status: "pending" | "streaming" | "complete" | "error";
  parts: Part[];
  order: number;
  createdAt: number;
  updatedAt: number;
  error?: { name: string; message: string };
  tokens?: { input: number; output: number };
  finishReason?: string;
};

// Progress stage display names
const stageLabels: Record<string, string> = {
  creating_session: "Creating session",
  starting_vm: "Starting VM",
  vm_ready: "VM ready",
  sending_task: "Sending task",
  running: "Running",
  completed: "Completed",
  error: "Error",
};

// Separate component for coding agent tool calls that queries for the session
function CodingAgentToolCallPart({
  part,
  onCodingAgentClick,
}: {
  part: Part;
  onCodingAgentClick?: (sessionId: Id<"sessions">) => void;
}) {
  // Extract task from toolInput
  const task = (part.toolInput as { task?: string })?.task;

  // Get session ID from progress or query by task
  const progressSessionId = part.toolProgress?.sessionId as Id<"sessions"> | undefined;

  // Query for the coding agent session directly by task text (fallback)
  const queriedSessionId = useQuery(
    api.codingAgent.getCodingAgentSessionByTask,
    !progressSessionId && task ? { task } : "skip"
  );

  // Also check toolOutput for backwards compatibility (when tool completes)
  let outputSessionId: Id<"sessions"> | null = null;
  if (part.toolOutput) {
    try {
      const output = JSON.parse(part.toolOutput);
      if (output.convexSessionId) {
        outputSessionId = output.convexSessionId as Id<"sessions">;
      }
    } catch {
      // Ignore parse errors
    }
  }

  const sessionId = progressSessionId ?? queriedSessionId ?? outputSessionId;
  const progress = part.toolProgress;

  return (
    <div
      className={`my-2 bg-gray-800 rounded-lg p-3 pr-4 border border-purple-600 hover:border-purple-500 ${
        sessionId ? "cursor-pointer" : ""
      }`}
      onClick={() => {
        if (sessionId && onCodingAgentClick) {
          onCodingAgentClick(sessionId);
        }
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-2 h-2 rounded-full ${
            part.toolStatus === "pending"
              ? "bg-yellow-500"
              : part.toolStatus === "running"
                ? "bg-blue-500 animate-pulse"
                : part.toolStatus === "completed"
                  ? "bg-green-500"
                  : "bg-red-500"
          }`}
        />
        <span className="text-sm font-mono text-purple-400">{part.toolName}</span>
        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span className="text-xs text-gray-500">
          {progress ? (
            <span className="flex items-center gap-1">
              {part.toolStatus === "running" && (
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              )}
              {stageLabels[progress.stage] || progress.stage}
            </span>
          ) : (
            <>
              {part.toolStatus === "pending" && "Preparing..."}
              {part.toolStatus === "running" && "Running..."}
              {part.toolStatus === "completed" && "Completed"}
              {part.toolStatus === "error" && "Failed"}
            </>
          )}
        </span>
        {sessionId && (
          <span className="ml-auto text-xs text-purple-400 flex items-center gap-1">
            View session
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        )}
      </div>
      {progress && progress.message && part.toolStatus === "running" && (
        <div className="text-xs text-gray-400 mb-2 flex items-center gap-2">
          <span className="w-1 h-1 bg-blue-400 rounded-full animate-pulse" />
          {progress.message}
        </div>
      )}
      {part.toolInput !== undefined && (
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-300">Input</summary>
          <pre className="mt-1 p-2 bg-gray-900 rounded overflow-x-auto text-gray-300">
            {JSON.stringify(part.toolInput, null, 2)}
          </pre>
        </details>
      )}
      {sessionId && (
        <div className="text-xs mt-2 text-gray-400">Click to view coding agent session details</div>
      )}
    </div>
  );
}

function PartRenderer({ part, onCodingAgentClick }: { part: Part; onCodingAgentClick?: (sessionId: Id<"sessions">) => void }) {
  switch (part.type) {
    case "text":
      return (
        <div className="prose prose-invert prose-sm max-w-none">
          <Streamdown>{part.text ?? ""}</Streamdown>
          {!part.isComplete && (
            <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
          )}
        </div>
      );

    case "reasoning":
      return (
        <div className="text-gray-400 italic border-l-2 border-gray-600 pl-3 my-2">
          <div className="text-xs text-gray-500 mb-1">Thinking...</div>
          <div className="prose prose-invert prose-sm max-w-none opacity-70">
            <Streamdown>{part.text ?? ""}</Streamdown>
            {!part.isComplete && (
              <span className="inline-block w-2 h-3 bg-gray-500 animate-pulse ml-0.5" />
            )}
          </div>
        </div>
      );

    case "tool_call": {
      // Use specialized component for delegateToCodingAgent
      if (part.toolName === "delegateToCodingAgent") {
        return <CodingAgentToolCallPart part={part} onCodingAgentClick={onCodingAgentClick} />;
      }

      // Regular tool call rendering
      return (
        <div className="my-2 bg-gray-800 rounded-lg p-3 pr-4 border border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${
              part.toolStatus === "pending" ? "bg-yellow-500" :
              part.toolStatus === "running" ? "bg-blue-500 animate-pulse" :
              part.toolStatus === "completed" ? "bg-green-500" :
              "bg-red-500"
            }`} />
            <span className="text-sm font-mono text-blue-400">{part.toolName}</span>
            <span className="text-xs text-gray-500">
              {part.toolStatus === "pending" && "Preparing..."}
              {part.toolStatus === "running" && "Running..."}
              {part.toolStatus === "completed" && "Completed"}
              {part.toolStatus === "error" && "Failed"}
            </span>
          </div>
          {part.toolInput !== undefined && (
            <details className="text-xs">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-300">
                Input
              </summary>
              <pre className="mt-1 p-2 bg-gray-900 rounded overflow-x-auto text-gray-300">
                {JSON.stringify(part.toolInput, null, 2)}
              </pre>
            </details>
          )}
          {part.toolOutput && (
            <details className="text-xs mt-2">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-300">
                Output
              </summary>
              <pre className="mt-1 p-2 bg-gray-900 rounded overflow-x-auto text-gray-300 max-h-40 overflow-y-auto">
                {part.toolOutput.length > 500
                  ? part.toolOutput.slice(0, 500) + "..."
                  : part.toolOutput}
              </pre>
            </details>
          )}
        </div>
      );
    }

    case "step_finish":
      if (part.stepTokens) {
        return (
          <div className="text-xs text-gray-600 my-1">
            Step: {part.stepTokens.input} in / {part.stepTokens.output} out tokens
          </div>
        );
      }
      return null;

    case "error":
      return (
        <div className="my-2 bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300">
          <div className="font-bold text-sm mb-1">Error</div>
          <div className="text-sm">{part.text}</div>
        </div>
      );

    case "file":
      return (
        <div className="my-2">
          <a
            href={part.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline text-sm"
          >
            {part.fileName || "Download file"}
          </a>
        </div>
      );

    case "step_start":
    case "tool_result":
      // These are handled elsewhere or not displayed directly
      return null;

    default:
      return null;
  }
}

function TurnView({ turn, onCodingAgentClick }: { turn: Turn; onCodingAgentClick?: (sessionId: Id<"sessions">) => void }) {
  const isUser = turn.role === "user";
  const isAssistant = turn.role === "assistant";
  const isStreaming = turn.status === "streaming";
  const hasError = turn.status === "error";

  return (
    <div className={`py-3 pr-4 ${isUser ? "bg-gray-900/30" : ""}`}>
      <div className="flex gap-3">
        <div className="flex-shrink-0 pl-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
            isUser ? "bg-blue-600" : isAssistant ? "bg-purple-600" : "bg-gray-600"
          }`}>
            {isUser ? "U" : isAssistant ? "A" : turn.role[0].toUpperCase()}
          </div>
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm capitalize">{turn.role}</span>
            {isStreaming && (
              <span className="text-xs text-blue-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                Streaming
              </span>
            )}
            {hasError && turn.error && (
              <span className="text-xs text-red-400">Error: {turn.error.message}</span>
            )}
          </div>
          <div className="text-gray-200">
            {turn.parts.map((part, idx) => (
              <PartRenderer key={idx} part={part} onCodingAgentClick={onCodingAgentClick} />
            ))}
            {turn.parts.length === 0 && isStreaming && (
              <span className="text-gray-500 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-pulse" />
                Generating response...
              </span>
            )}
          </div>
          {turn.tokens && turn.status === "complete" && (
            <div className="text-xs text-gray-600 mt-2">
              {turn.tokens.input} input / {turn.tokens.output} output tokens
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SessionView({
  sessionId,
  onCodingAgentSessionSelect,
}: {
  sessionId: Id<"sessions">;
  onCodingAgentSessionSelect?: (sessionId: Id<"sessions"> | null) => void;
}) {
  const data = useQuery(api.sessions.getSessionWithTurns, { sessionId });

  if (!data) {
    return (
      <div className="p-4 text-gray-500 flex items-center gap-2">
        <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse" />
        Loading session...
      </div>
    );
  }

  const { session, turns } = data;

  // Sort turns by order to ensure correct display order
  const sortedTurns = [...turns].sort((a, b) => a.order - b.order);

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="bg-gray-900 px-4 py-2 border-b border-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            session.status === "active" ? "bg-blue-500 animate-pulse" :
            session.status === "completed" ? "bg-green-500" :
            "bg-red-500"
          }`} />
          <span className="text-sm font-medium capitalize">{session.status}</span>
          {session.model && (
            <span className="text-xs text-gray-500">· {session.model}</span>
          )}
        </div>
        {session.tokens && (
          <div className="text-xs text-gray-500">
            {session.tokens.input + session.tokens.output} total tokens
          </div>
        )}
      </div>
      <div className="divide-y divide-gray-800">
        {sortedTurns.map((turn) => (
          <TurnView
            key={turn._id}
            turn={turn as Turn}
            onCodingAgentClick={onCodingAgentSessionSelect}
          />
        ))}
      </div>
    </div>
  );
}

export function SessionsByPost({
  postId,
  onCodingAgentSessionSelect,
}: {
  postId: Id<"posts">;
  onCodingAgentSessionSelect?: (sessionId: Id<"sessions"> | null) => void;
}) {
  const sessions = useQuery(api.sessions.listSessionsByPost, { postId });

  if (!sessions || sessions.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="text-sm text-gray-500">AI Sessions</div>
      {sessions.map((session) => (
        <SessionView
          key={session._id}
          sessionId={session._id}
          onCodingAgentSessionSelect={onCodingAgentSessionSelect}
        />
      ))}
    </div>
  );
}
