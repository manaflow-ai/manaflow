import { start } from "workflow/api";
import { handleReplyToPost } from "@/workflows/create-post";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(request: Request) {
  const { content } = (await request.json()) as { content: string };

  console.log("[API] Creating post and starting reply workflow");

  try {
    // First create the user's post
    const postId = await convex.mutation(api.posts.createPost, {
      content,
      author: "User",
    });

    console.log("[API] Created post:", postId);

    // Then start the workflow to generate an AI reply
    const result = await start(handleReplyToPost, [postId, content]);
    console.log("[API] Workflow started:", result);

    return NextResponse.json({
      message: "Post created and reply workflow started",
      postId,
      workflowId: result,
    });
  } catch (error) {
    console.error("[API] Failed:", error);
    return NextResponse.json(
      { error: "Failed to create post or start workflow" },
      { status: 500 }
    );
  }
}
