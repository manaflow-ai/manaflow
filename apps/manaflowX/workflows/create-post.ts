import { FatalError } from "workflow"
import { xai } from "@ai-sdk/xai"
import { streamText, stepCountIs } from "ai"
import { ConvexHttpClient } from "convex/browser"
import { api } from "../convex/_generated/api"
import { Id } from "../convex/_generated/dataModel"
import { issueTools, codingAgentTools, browserAgentTools } from "./tools"

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

// Repo config passed from the API
export interface RepoConfig {
  fullName: string;
  gitRemote: string;
  branch: string;
  installationId?: number;
  scripts?: {
    maintenanceScript: string;
    devScript: string;
  };
}

type TurnPart = {
  type:
    | "text"
    | "reasoning"
    | "tool_call"
    | "tool_result"
    | "file"
    | "step_start"
    | "step_finish"
    | "error"
  text?: string
  toolCallId?: string
  toolName?: string
  toolInput?: unknown
  toolOutput?: string
  toolStatus?: "pending" | "running" | "completed" | "error"
  fileUrl?: string
  fileMime?: string
  fileName?: string
  stepTokens?: { input: number; output: number }
  isComplete: boolean
}

// Generate an AI reply to an existing post
export async function handleReplyToPost(
  postId: string,
  content: string,
  repoConfig?: RepoConfig,
  issueId?: string
) {
  "use workflow"

  const reply = await generateStreamingReply({
    id: postId as Id<"posts">,
    content,
    repoConfig,
  })

  // If this was triggered for an issue, mark it as closed
  if (issueId) {
    await closeIssueOnCompletion(issueId)
  }

  return {
    postId,
    replyPostId: reply.postId,
    sessionId: reply.sessionId,
    status: "published",
  }
}

// Close the issue when the workflow completes
async function closeIssueOnCompletion(issueId: string) {
  "use step"
  try {
    await convex.mutation(api.issues.closeIssue, {
      issueId: issueId as Id<"issues">,
      reason: "Workflow completed - PR created",
    })
    console.log(`Closed issue ${issueId} after workflow completion`)
  } catch (error) {
    console.error(`Failed to close issue ${issueId}:`, error)
  }
}

async function generateStreamingReply(post: {
  id: Id<"posts">
  content: string
  repoConfig?: RepoConfig
}) {
  "use step"
  if (!post.content.trim()) {
    throw new FatalError("Empty post content")
  }

  console.log(`Generating streaming reply for post: ${post.id}`)
  console.log(`Repo config:`, post.repoConfig)

  // Create a session to track this AI conversation
  const sessionId = await convex.mutation(api.sessions.createSession, {
    source: "workflow",
    postId: post.id,
    model: "grok-4-1",
    provider: "xai",
    agent: "assistant",
  })

  // Create user turn (the original post content)
  await convex.mutation(api.sessions.createTurn, {
    sessionId,
    role: "user",
    parts: [
      {
        type: "text",
        text: post.content,
        isComplete: true,
      },
    ],
  })

  // Create assistant turn (will be updated as we stream)
  const assistantTurnId = await convex.mutation(api.sessions.createTurn, {
    sessionId,
    role: "assistant",
  })

  // Update turn to streaming status
  await convex.mutation(api.sessions.updateTurn, {
    turnId: assistantTurnId,
    status: "streaming",
  })

  // Issue tools + coding agent tools + browser agent tools
  // Don't let the agent create posts (it would create duplicates)
  const allTools = {
    ...issueTools,
    ...codingAgentTools,
    ...browserAgentTools,
  }

  let currentParts: TurnPart[] = []
  let currentTextPartIndex = -1
  let totalInputTokens = 0
  let totalOutputTokens = 0

  // Build system prompt - include repo context if available
  const repoContext = post.repoConfig
    ? `\n\nIMPORTANT: A repository has been selected for this task: ${post.repoConfig.fullName}
When delegating to the coding agent, ALWAYS include the repo parameter:
- gitRemote: "${post.repoConfig.gitRemote}"
- branch: "${post.repoConfig.branch}"
${post.repoConfig.installationId ? `- installationId: ${post.repoConfig.installationId}` : ""}`
    : ""

  // Build scripts context for the coding agent
  const scriptsContext = post.repoConfig?.scripts
    ? `

## Workspace Scripts
The repository has the following workspace scripts configured:

### Dev Script (run this to start the development environment):
\`\`\`bash
${post.repoConfig.scripts.devScript}
\`\`\`

### Maintenance Script (run this for maintenance tasks like installing dependencies):
\`\`\`bash
${post.repoConfig.scripts.maintenanceScript}
\`\`\`
`
    : ""

  // Build prompt - if repo is selected, automatically delegate to coding agent
  const autoDelegate = post.repoConfig !== undefined
  const prompt = autoDelegate
    ? `The user has selected the repository "${post.repoConfig!.fullName}" and sent this message:

${post.content}

Since a repository is selected, delegate this task to the coding agent immediately. Use the delegateToCodingAgent tool with:
- task: The user's request
- context: Include any relevant context about the task${scriptsContext ? ". IMPORTANT: Include the workspace scripts context below so the coding agent knows how to set up and run the dev environment." : ""}
- agent: "build" (for coding tasks)
- repo: { gitRemote: "${post.repoConfig!.gitRemote}", branch: "${post.repoConfig!.branch}"${post.repoConfig!.installationId ? `, installationId: ${post.repoConfig!.installationId}` : ""} }${scriptsContext}`
    : `Respond to this post:\n\n${post.content}`

  try {
    const result = streamText({
      model: xai("grok-4-1-fast-non-reasoning"),
      system: `You are an AI assistant with access to an issue tracking system, a post activity stream, coding agents, and browser automation.

You can:
- Create, update, close, and search issues
- Track dependencies between issues
- Find ready work (issues with no blockers)
- Create and reply to posts in the activity stream
- Delegate coding tasks to a remote coding agent (use delegateToCodingAgent)
- Delegate browser automation tasks to a browser agent (use delegateToBrowserAgent)

When users mention bugs, features, tasks, or work items, consider creating or updating issues.
When users ask about status or progress, use the issue tools to look up information.
When users ask you to write code, run tests, modify files, or perform any coding task, use the delegateToCodingAgent tool.
When users ask you to interact with websites, scrape data, fill forms, or perform browser automation, use the delegateToBrowserAgent tool.

You can chain tools together. For example, after delegateToCodingAgent returns a morphInstanceId and path, you can pass those to delegateToBrowserAgent to run browser tests on the same VM.

Keep responses concise and helpful.${repoContext}`,
      prompt,
      tools: allTools,
      stopWhen: stepCountIs(50),
      onStepFinish: async (event) => {
        // Update tokens
        if (event.usage) {
          totalInputTokens += event.usage.inputTokens ?? 0
          totalOutputTokens += event.usage.outputTokens ?? 0
        }

        // Add step_finish part
        currentParts.push({
          type: "step_finish",
          stepTokens: event.usage
            ? {
                input: event.usage.inputTokens ?? 0,
                output: event.usage.outputTokens ?? 0,
              }
            : undefined,
          isComplete: true,
        })

        await convex.mutation(api.sessions.updateTurn, {
          turnId: assistantTurnId,
          parts: currentParts,
        })
      },
      onChunk: async (event) => {
        const chunk = event.chunk

        if (chunk.type === "text-delta") {
          const textDelta = chunk.text

          // Find or create text part
          if (
            currentTextPartIndex === -1 ||
            currentParts[currentTextPartIndex]?.type !== "text"
          ) {
            currentTextPartIndex = currentParts.length
            currentParts.push({
              type: "text",
              text: textDelta,
              isComplete: false,
            })
          } else {
            // Append to existing text part
            currentParts[currentTextPartIndex] = {
              ...currentParts[currentTextPartIndex],
              text: (currentParts[currentTextPartIndex].text ?? "") + textDelta,
            }
          }

          // Batch updates - only update every ~100 chars to reduce mutation frequency
          const currentText = currentParts[currentTextPartIndex].text ?? ""
          if (
            currentText.length % 100 < textDelta.length ||
            currentText.length < 50
          ) {
            await convex.mutation(api.sessions.updateTurn, {
              turnId: assistantTurnId,
              parts: currentParts,
            })
          }
        } else if (chunk.type === "reasoning-delta") {
          // Handle reasoning content
          const lastPart = currentParts[currentParts.length - 1]
          if (lastPart?.type === "reasoning" && !lastPart.isComplete) {
            currentParts[currentParts.length - 1] = {
              ...lastPart,
              text: (lastPart.text ?? "") + chunk.text,
            }
          } else {
            currentParts.push({
              type: "reasoning",
              text: chunk.text,
              isComplete: false,
            })
          }

          // Batch updates for reasoning too
          await convex.mutation(api.sessions.updateTurn, {
            turnId: assistantTurnId,
            parts: currentParts,
          })
        } else if (chunk.type === "tool-call") {
          // Mark any open text part as complete
          if (currentTextPartIndex >= 0 && currentParts[currentTextPartIndex]) {
            currentParts[currentTextPartIndex] = {
              ...currentParts[currentTextPartIndex],
              isComplete: true,
            }
          }
          currentTextPartIndex = -1

          // Add tool call part
          currentParts.push({
            type: "tool_call",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            toolInput: chunk.input,
            toolStatus: "pending",
            isComplete: false,
          })

          await convex.mutation(api.sessions.updateTurn, {
            turnId: assistantTurnId,
            parts: currentParts,
          })

          // Register coding agent tool calls for immediate UI linking
          if (chunk.toolName === "delegateToCodingAgent") {
            const input = chunk.input as { task?: string }
            if (input.task) {
              await convex.mutation(
                api.codingAgent.registerCodingAgentToolCall,
                {
                  toolCallId: chunk.toolCallId,
                  parentSessionId: sessionId,
                  task: input.task,
                },
              )
            }
          }

          // Register browser agent tool calls for immediate UI linking
          if (chunk.toolName === "delegateToBrowserAgent") {
            const input = chunk.input as { task?: string }
            if (input.task) {
              await convex.mutation(
                api.codingAgent.registerCodingAgentToolCall,
                {
                  toolCallId: chunk.toolCallId,
                  parentSessionId: sessionId,
                  task: input.task,
                },
              )
            }
          }
        } else if (chunk.type === "tool-result") {
          // Find the tool call part and update it
          const toolCallIndex = currentParts.findIndex(
            (p) => p.type === "tool_call" && p.toolCallId === chunk.toolCallId,
          )
          if (toolCallIndex >= 0) {
            const output = chunk.output
            currentParts[toolCallIndex] = {
              ...currentParts[toolCallIndex],
              toolStatus: "completed",
              toolOutput:
                typeof output === "string" ? output : JSON.stringify(output),
              isComplete: true,
            }
          }

          await convex.mutation(api.sessions.updateTurn, {
            turnId: assistantTurnId,
            parts: currentParts,
          })
        }
      },
      onFinish: async (event) => {
        // Mark any remaining parts as complete
        currentParts = currentParts.map((p) => ({ ...p, isComplete: true }))

        // Update turn with final state
        await convex.mutation(api.sessions.updateTurn, {
          turnId: assistantTurnId,
          status: "complete",
          parts: currentParts,
          tokens: {
            input: totalInputTokens,
            output: totalOutputTokens,
          },
          finishReason: event.finishReason,
        })

        // Update session as completed
        await convex.mutation(api.sessions.updateSession, {
          sessionId,
          status: "completed",
          tokens: {
            input: totalInputTokens,
            output: totalOutputTokens,
          },
        })
      },
    })

    // Consume the stream to trigger all callbacks
    const finalText = await result.text

    // Create a reply post with the generated text
    const replyPostId = await convex.mutation(api.posts.createPost, {
      content: finalText || "[No response generated]",
      author: "Grok",
      replyTo: post.id,
    })

    console.log(`Generated streaming reply: ${finalText?.slice(0, 100)}...`)

    return {
      postId: replyPostId,
      sessionId,
      text: finalText,
    }
  } catch (error) {
    // Update turn with error status
    await convex.mutation(api.sessions.updateTurn, {
      turnId: assistantTurnId,
      status: "error",
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    })

    // Update session as failed
    await convex.mutation(api.sessions.updateSession, {
      sessionId,
      status: "failed",
    })

    throw error
  }
}
