import { FatalError } from "workflow"
import { xai } from "@ai-sdk/xai"
import { generateText, stepCountIs } from "ai"
import { issueTools, postTools } from "./tools"

export async function handleCreatePost(content: string) {
  "use workflow"

  const post = await createPost(content)
  const reply = await generateReply(post)

  return { postId: post.id, reply, status: "published" }
}

async function createPost(content: string) {
  "use step"
  console.log(`Creating post with content: ${content}`)
  return { id: crypto.randomUUID(), content }
}

async function generateReply(post: { id: string; content: string }) {
  "use step"
  if (!post.content.trim()) {
    throw new FatalError("Empty post content")
  }

  console.log(`Generating reply for post: ${post.id}`)

  const result = await generateText({
    model: xai("grok-4-1"),
    system: `You are an AI assistant with access to an issue tracking system (similar to Beads) and a post activity stream.

You can:
- Create, update, close, and search issues
- Track dependencies between issues
- Find ready work (issues with no blockers)
- Create and reply to posts in the activity stream

When users mention bugs, features, tasks, or work items, consider creating or updating issues.
When users ask about status or progress, use the issue tools to look up information.

Keep responses concise and helpful.`,
    prompt: `Respond to this post:\n\n${post.content}`,
    tools: {
      ...issueTools,
      ...postTools,
    },
    stopWhen: stepCountIs(50),
  })

  console.log(`Generated reply: ${result.text}`)
  return { id: crypto.randomUUID(), content: result.text, parentId: post.id }
}
