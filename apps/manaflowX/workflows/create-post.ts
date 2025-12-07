import { FatalError, sleep, createWebhook } from "workflow"

export async function handleCreatePost(content: string) {
  "use workflow"

  const post = await createPost(content)

  await notifyFollowers(post)
  await sleep("5s") // Pause for 5s - doesn't consume any resources

  const webhook = createWebhook()
  console.log("Webhook URL:", webhook.url)

  // Workflow pauses here until an HTTP request is received at webhook.url
  await webhook

  await processPostEngagement(post)

  return { postId: post.id, status: "published" }
}

async function createPost(content: string) {
  "use step"
  console.log(`Creating post with content: ${content}`)
  // Full Node.js access - database calls, APIs, etc.
  return await Promise.resolve({ id: crypto.randomUUID(), content })
}

async function notifyFollowers(post: { id: string; content: string }) {
  "use step"
  console.log(`Notifying followers about post: ${post.id}`)
  if (Math.random() < 0.3) {
    // By default, steps will be retried for unhandled errors
    throw new Error("Retryable!")
  }
  await Promise.resolve()
}

async function processPostEngagement(post: { id: string; content: string }) {
  "use step"
  if (!post.content.trim()) {
    // To skip retrying, throw a FatalError instead
    throw new FatalError("Empty post content")
  }
  console.log(`Processing engagement for post: ${post.id}`)
  await Promise.resolve()
}
