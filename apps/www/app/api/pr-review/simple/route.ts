import { NextRequest, NextResponse } from "next/server";

import { stackServerApp } from "@/lib/utils/stack";
import { runSimpleAnthropicReviewStream } from "@/lib/services/code-review/run-simple-anthropic-review";
import { isRepoPublic } from "@/lib/github/check-repo-visibility";
import {
  HEATMAP_MODEL_QUERY_KEY,
  parseModelConfigFromUrlSearchParams,
  parseTooltipLanguageFromUrlSearchParams,
} from "@/lib/services/code-review/model-config";
import { trackHeatmapReviewRequested } from "@/lib/analytics/track-heatmap-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRepoFullName(repoFullName: string | null): {
  owner: string;
  repo: string;
} | null {
  if (!repoFullName) {
    return null;
  }
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

function parsePrNumber(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const repoFullName = parseRepoFullName(searchParams.get("repoFullName"));
    const prNumber = parsePrNumber(searchParams.get("prNumber"));
    const modelConfig = parseModelConfigFromUrlSearchParams(searchParams);
    const tooltipLanguage = parseTooltipLanguageFromUrlSearchParams(searchParams);

    if (!repoFullName || prNumber === null) {
      return NextResponse.json(
        { error: "repoFullName and prNumber query params are required" },
        { status: 400 }
      );
    }

    const user = await stackServerApp.getUser({ or: "anonymous" });

    const repoIsPublic = await isRepoPublic(
      repoFullName.owner,
      repoFullName.repo
    );

    let githubToken: string | null = null;
    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (githubAccount) {
        const tokenResult = await githubAccount.getAccessToken();
        githubToken = tokenResult.accessToken ?? null;
      }
    } catch (error) {
      console.warn("[simple-review][api] Failed to resolve GitHub account", {
        error,
      });
    }

    const normalizedGithubToken =
      typeof githubToken === "string" && githubToken.trim().length > 0
        ? githubToken.trim()
        : null;

    if (!repoIsPublic && !normalizedGithubToken) {
      return NextResponse.json(
        {
          error:
            "GitHub authentication is required to review private repositories.",
        },
        { status: 403 }
      );
    }

    const prIdentifier = `https://github.com/${repoFullName.owner}/${repoFullName.repo}/pull/${prNumber}`;
    const repoFullNameStr = `${repoFullName.owner}/${repoFullName.repo}`;
    const modelQueryValue =
      searchParams.get(HEATMAP_MODEL_QUERY_KEY) ?? "default";

    console.info("[simple-review][api] Request params", {
      prIdentifier,
      tooltipLanguage,
      rawLangParam: searchParams.get("lang"),
      modelQueryValue,
    });

    // Track analytics (fire and forget - don't block the request)
    trackHeatmapReviewRequested({
      repo: repoFullNameStr,
      pullNumber: prNumber,
      language: tooltipLanguage,
      model: modelQueryValue,
      userId: user.id ?? undefined,
    }).catch((error) => {
      console.error("[simple-review][api] Failed to track analytics", error);
    });

    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let isClosed = false;

        const enqueue = (payload: unknown) => {
          // Silently skip if controller is already closed (happens when client disconnects)
          if (isClosed) {
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
          } catch {
            // Mark as closed if enqueue fails
            isClosed = true;
          }
        };

        enqueue({ type: "status", message: "starting" });

        try {
          await runSimpleAnthropicReviewStream({
            prIdentifier,
            githubToken: normalizedGithubToken,
            modelConfig,
            tooltipLanguage,
            signal: abortController.signal,
            onEvent: async (event) => {
              switch (event.type) {
                case "file":
                  enqueue({
                    type: "file",
                    filePath: event.filePath,
                  });
                  break;
                case "skip":
                  enqueue({
                    type: "skip",
                    filePath: event.filePath,
                    reason: event.reason,
                  });
                  break;
                case "hunk":
                  enqueue({
                    type: "hunk",
                    filePath: event.filePath,
                    header: event.header,
                  });
                  break;
                case "file-complete":
                  enqueue({
                    type: "file-complete",
                    filePath: event.filePath,
                    status: event.status,
                    summary: event.summary,
                  });
                  break;
                case "line": {
                  const {
                    changeType,
                    diffLine,
                    codeLine,
                    mostImportantWord,
                    shouldReviewWhy,
                    score,
                    scoreNormalized,
                    oldLineNumber,
                    newLineNumber,
                  } = event.line;

                  enqueue({
                    type: "line",
                    filePath: event.filePath,
                    changeType,
                    diffLine,
                    codeLine,
                    mostImportantWord,
                    shouldReviewWhy,
                    score,
                    scoreNormalized,
                    oldLineNumber,
                    newLineNumber,
                    line: event.line,
                  });
                  break;
                }
                default:
                  break;
              }
            },
          });
          enqueue({ type: "complete" });
          isClosed = true;
          controller.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";

          // Don't log expected errors
          const isAuthError = message.includes("status 401") || message.includes("status 403") || message.includes("status 404");
          const isAbortError = message.includes("Stream aborted") || message.includes("aborted");

          if (isAuthError) {
            console.info("[simple-review][api] Auth failed, fallback should handle", {
              prIdentifier,
              message,
            });
          } else if (isAbortError) {
            // Client disconnected - this is expected, don't log as error
            console.info("[simple-review][api] Stream aborted by client", {
              prIdentifier,
            });
          } else {
            console.error("[simple-review][api] Stream failed", {
              prIdentifier,
              message,
              error,
            });
          }

          enqueue({ type: "error", message });
          isClosed = true;
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("[simple-review][api] Unexpected failure", {
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
