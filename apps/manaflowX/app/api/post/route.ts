import { start } from "workflow/api";
import { handleReplyToPost } from "@/workflows/create-post";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { stackServerApp } from "@/stack/server";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Repo config to pass to the workflow
export interface RepoConfig {
  fullName: string;
  gitRemote: string;
  branch: string;
  installationId?: number;
  scripts?: {
    maintenanceScript: string;
    devScript: string;
  };
  repoId?: string;  // Convex repo ID for env var lookup
  userId?: string;  // User ID for env var lookup
}

// Thread context for replies
export interface ThreadContext {
  rootPost: { content: string; author: string };
  replies: Array<{ content: string; author: string }>;
}

export async function POST(request: Request) {
  const { content, repo: repoFullName, replyTo } = (await request.json()) as {
    content: string;
    repo?: string | null;
    replyTo?: string | null;
  };

  console.log("[API] Creating post and starting reply workflow");
  console.log("[API] Selected repo:", repoFullName);
  console.log("[API] Reply to:", replyTo);

  try {
    // Get the current user for env var lookup
    const user = await stackServerApp.getUser();

    // Fetch full repo details if a repo is selected
    let repoConfig: RepoConfig | undefined;
    if (repoFullName) {
      console.log("[API] Fetching repo details for:", repoFullName);
      // Fetch repo details from Convex using the new query that includes installationId
      const repo = await convex.query(api.github.getRepoWithInstallation, {
        fullName: repoFullName,
      });
      console.log("[API] Got repo from Convex:", repo);

      if (repo) {
        repoConfig = {
          fullName: repo.fullName,
          gitRemote: repo.gitRemote,
          branch: repo.defaultBranch ?? "main",
          installationId: repo.installationId,
          scripts: repo.scripts,
          repoId: repo._id,
          userId: user?.id,
        };
        console.log("[API] Repo config:", repoConfig);
      } else {
        console.log("[API] Repo not found in database");
      }
    }

    // Fetch thread context if this is a reply
    let threadContext: ThreadContext | undefined;
    if (replyTo) {
      console.log("[API] Fetching thread context for reply");
      const thread = await convex.query(api.posts.getPostThread, {
        postId: replyTo as Id<"posts">,
      });
      if (thread) {
        threadContext = {
          rootPost: { content: thread.root.content, author: thread.root.author },
          replies: thread.replies.map((r) => ({ content: r.content, author: r.author })),
        };
        console.log("[API] Thread context:", threadContext);
      }
    }

    // Create the user's post
    const postId = await convex.mutation(api.posts.createPost, {
      content,
      author: "User",
      replyTo: replyTo ? (replyTo as Id<"posts">) : undefined,
    });

    console.log("[API] Created post:", postId);

    // Start the workflow to generate an AI reply
    // Pass repo config and thread context to the workflow
    const result = await start(handleReplyToPost, [postId, content, repoConfig, threadContext]);
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
