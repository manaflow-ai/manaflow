#!/usr/bin/env bun
/**
 * Test script for GitHub video upload via Release Assets API
 *
 * Usage:
 *   cd packages/convex
 *   GITHUB_TOKEN=<your-token> REPO=owner/repo bun scripts/test-github-video-upload.ts
 */

const ASSET_RELEASE_TAG = "cmux-preview-assets";

async function uploadVideoToGitHub(options: {
  repoFullName: string;
  accessToken: string;
  videoData: ArrayBuffer;
  fileName: string;
  contentType: string;
}): Promise<{ ok: true; assetUrl: string } | { ok: false; error: string }> {
  const { repoFullName, accessToken, videoData, fileName, contentType } = options;
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    return { ok: false, error: `Invalid repo name: ${repoFullName}` };
  }

  const headers = {
    "Authorization": `token ${accessToken}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    // Step 1: Get or create the assets release
    console.log("\n📦 Step 1: Getting or creating assets release...");
    console.log(`   Tag: ${ASSET_RELEASE_TAG}`);

    let releaseId: number | null = null;

    // Try to get existing release
    const getReleaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${ASSET_RELEASE_TAG}`;
    console.log(`   GET ${getReleaseUrl}`);

    const getReleaseResponse = await fetch(getReleaseUrl, { headers });
    console.log(`   Response: ${getReleaseResponse.status} ${getReleaseResponse.statusText}`);

    if (getReleaseResponse.ok) {
      const releaseData = await getReleaseResponse.json() as { id: number };
      releaseId = releaseData.id;
      console.log(`   ✓ Found existing release (ID: ${releaseId})`);
    } else if (getReleaseResponse.status === 404) {
      // Create new release
      console.log("   Release not found, creating new one...");

      // Get default branch
      const repoResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers }
      );

      if (!repoResponse.ok) {
        const error = await repoResponse.text();
        return { ok: false, error: `Failed to get repo info: ${error}` };
      }

      const repoData = await repoResponse.json() as { default_branch: string };
      const defaultBranch = repoData.default_branch;
      console.log(`   Default branch: ${defaultBranch}`);

      // Create the release
      const createReleaseResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            tag_name: ASSET_RELEASE_TAG,
            target_commitish: defaultBranch,
            name: "Preview Assets (cmux)",
            body: "Auto-generated release for storing preview screenshots and videos. Do not delete.",
            draft: false,
            prerelease: true,
          }),
        }
      );

      if (!createReleaseResponse.ok) {
        const error = await createReleaseResponse.text();
        return { ok: false, error: `Failed to create release: ${error}` };
      }

      const newRelease = await createReleaseResponse.json() as { id: number };
      releaseId = newRelease.id;
      console.log(`   ✓ Created new release (ID: ${releaseId})`);
    } else {
      const error = await getReleaseResponse.text();
      return { ok: false, error: `Failed to get release: ${error}` };
    }

    // Step 2: Upload the video as a release asset
    console.log("\n📤 Step 2: Uploading video as release asset...");
    console.log(`   File: ${fileName}`);
    console.log(`   Size: ${videoData.byteLength} bytes`);
    console.log(`   Content-Type: ${contentType}`);

    // Generate unique filename with timestamp to avoid conflicts
    // Sanitize filename: remove spaces, parentheses, and other special chars that GitHub mangles
    const timestamp = Date.now();
    const sanitizedFileName = fileName
      .replace(/\s+/g, "-")           // spaces to dashes
      .replace(/[()[\]{}]/g, "")      // remove brackets/parens
      .replace(/--+/g, "-")           // collapse multiple dashes
      .replace(/[^a-zA-Z0-9._-]/g, ""); // remove other special chars
    const uniqueFileName = `${timestamp}-${sanitizedFileName}`;
    console.log(`   Unique name: ${uniqueFileName}`);

    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(uniqueFileName)}`;
    console.log(`   Upload URL: ${uploadUrl.slice(0, 80)}...`);

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": contentType,
        "Content-Length": String(videoData.byteLength),
      },
      body: videoData,
    });

    console.log(`   Response: ${uploadResponse.status} ${uploadResponse.statusText}`);

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      return { ok: false, error: `Failed to upload asset: ${uploadResponse.status} ${error}` };
    }

    const assetData = await uploadResponse.json() as {
      browser_download_url: string;
      id: number;
      name: string;
    };

    console.log(`   ✓ Asset uploaded (ID: ${assetData.id})`);

    return { ok: true, assetUrl: assetData.browser_download_url };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function postPrComment(options: {
  repoFullName: string;
  accessToken: string;
  prNumber: number;
  body: string;
}): Promise<{ ok: true; commentUrl: string } | { ok: false; error: string }> {
  const { repoFullName, accessToken, prNumber, body } = options;
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    return { ok: false, error: `Invalid repo name: ${repoFullName}` };
  }

  const headers = {
    "Authorization": `token ${accessToken}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { ok: false, error: `Failed to post comment: ${response.status} ${error}` };
    }

    const data = await response.json() as { html_url: string };
    return { ok: true, commentUrl: data.html_url };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  console.log("🧪 GitHub Video Upload Test (Release Assets API)\n");
  console.log("=".repeat(60));

  const accessToken = process.env.GITHUB_TOKEN;
  const repoFullName = process.env.REPO || "manaflow-ai/manaflow";
  const videoFilePath = process.env.VIDEO_FILE;
  const prNumber = process.env.PR_NUMBER ? parseInt(process.env.PR_NUMBER, 10) : undefined;

  if (!accessToken) {
    console.error("❌ Please set GITHUB_TOKEN environment variable");
    console.error("\nUsage:");
    console.error("  GITHUB_TOKEN=ghp_xxx REPO=owner/repo bun scripts/test-github-video-upload.ts");
    console.error("  VIDEO_FILE=/path/to/video.mp4 PR_NUMBER=123 (optional)");
    console.error("\nYou can get a token with: gh auth token");
    process.exit(1);
  }

  console.log(`Token: ${accessToken.slice(0, 10)}...${accessToken.slice(-4)}`);
  console.log(`Repo: ${repoFullName}`);
  if (videoFilePath) {
    console.log(`Video file: ${videoFilePath}`);
  }
  if (prNumber) {
    console.log(`PR Number: ${prNumber}`);
  }

  let videoData: ArrayBuffer;
  let fileName: string;

  if (videoFilePath) {
    // Read actual video file
    console.log("\n📹 Reading video file...");
    const file = Bun.file(videoFilePath);
    if (!(await file.exists())) {
      console.error(`❌ Video file not found: ${videoFilePath}`);
      process.exit(1);
    }
    videoData = await file.arrayBuffer();
    fileName = videoFilePath.split("/").pop() || "video.mp4";
    console.log(`   File: ${fileName}`);
    console.log(`   Size: ${videoData.byteLength} bytes (${(videoData.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    // Create a minimal test MP4 file
    console.log("\n📹 Creating test video file...");

    const testVideoData = new Uint8Array([
      // ftyp box
      0x00, 0x00, 0x00, 0x14,
      0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x00, 0x01,
      0x69, 0x73, 0x6f, 0x6d,
      // mdat box
      0x00, 0x00, 0x00, 0x08,
      0x6d, 0x64, 0x61, 0x74,
    ]);
    videoData = testVideoData.buffer as ArrayBuffer;
    fileName = "test-video.mp4";
    console.log(`   Size: ${videoData.byteLength} bytes`);
  }

  const result = await uploadVideoToGitHub({
    repoFullName,
    accessToken,
    videoData,
    fileName,
    contentType: "video/mp4",
  });

  console.log("\n" + "=".repeat(60));
  if (result.ok) {
    console.log("🎉 UPLOAD PASSED!\n");
    console.log("Asset URL:");
    console.log(`  ${result.assetUrl}\n`);

    // Post comment if PR number provided
    if (prNumber) {
      console.log(`\n💬 Posting comment to PR #${prNumber}...`);
      const commentBody = `## Preview Video\n\n${result.assetUrl}\n\n_Test video upload from cmux_`;
      const commentResult = await postPrComment({
        repoFullName,
        accessToken,
        prNumber,
        body: commentBody,
      });

      if (commentResult.ok) {
        console.log(`✓ Comment posted: ${commentResult.commentUrl}`);
      } else {
        console.log(`❌ Failed to post comment: ${commentResult.error}`);
      }
    }
  } else {
    console.log("❌ TEST FAILED!\n");
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
