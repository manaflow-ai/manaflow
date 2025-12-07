import { start } from "workflow/api";
import { handleReplyToPost } from "@/workflows/create-post";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

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
}

export async function POST(request: Request) {
  const { content, repo: repoFullName } = (await request.json()) as {
    content: string;
    repo?: string | null;
  };

  console.log("[API] Creating post and starting reply workflow");
  console.log("[API] Selected repo:", repoFullName);

  try {
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
        };
        console.log("[API] Repo config:", repoConfig);
      } else {
        console.log("[API] Repo not found in database");
      }
    }

    // First create the user's post
    const postId = await convex.mutation(api.posts.createPost, {
      content,
      author: "User",
    });

    console.log("[API] Created post:", postId);

    // Then start the workflow to generate an AI reply
    // Pass repo config to the workflow
    const result = await start(handleReplyToPost, [postId, content, repoConfig]);
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
