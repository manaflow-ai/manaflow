import { randomUUID } from "node:crypto";
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

function parseTimeoutMsFromEnv(envVar: string, defaultMs: number): number {
  const raw = process.env[envVar];
  if (!raw) {
    return defaultMs;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultMs;
  }
  return parsed;
}

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
  const requestId = randomUUID();
  const vercelId = request.headers.get("x-vercel-id");
  const startTime = Date.now();

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
      requestId,
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

    const hardTimeoutMs = parseTimeoutMsFromEnv(
      "CMUX_PR_REVIEW_HARD_TIMEOUT_MS",
      120_000,
    );
    const hardTimeoutSignal = AbortSignal.timeout(hardTimeoutMs);
    const combinedSignal = AbortSignal.any([
      abortController.signal,
      hardTimeoutSignal,
    ]);

    let clientAbortAtMs: number | null = null;
    const onRequestAbort = () => {
      clientAbortAtMs = Date.now() - startTime;
      abortController.abort(new Error("Client disconnected"));
    };

    if (request.signal.aborted) {
      clientAbortAtMs = 0;
      abortController.abort(new Error("Client disconnected"));
    } else {
      request.signal.addEventListener("abort", onRequestAbort, { once: true });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let isClosed = false;
        let firstByteAtMs: number | null = null;
        let eventsEmitted = 0;
        let bytesEnqueued = 0;
        let fileCompleteSuccess = 0;
        let fileCompleteSkipped = 0;
        let fileCompleteError = 0;

        const enqueue = (payload: unknown) => {
          // Silently skip if controller is already closed (happens when client disconnects)
          if (isClosed) {
            return;
          }
          try {
            const text = `data: ${JSON.stringify(payload)}\n\n`;
            const encoded = encoder.encode(text);
            if (firstByteAtMs === null) {
              firstByteAtMs = Date.now() - startTime;
            }
            eventsEmitted += 1;
            bytesEnqueued += encoded.byteLength;
            controller.enqueue(encoded);
          } catch {
            // Mark as closed if enqueue fails
            isClosed = true;
            abortController.abort(new Error("Stream enqueue failed"));
          }
        };

        enqueue({ type: "status", message: "starting" });

        try {
          await runSimpleAnthropicReviewStream({
            prIdentifier,
            githubToken: normalizedGithubToken,
            modelConfig,
            tooltipLanguage,
            signal: combinedSignal,
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
                  if (event.status === "success") {
                    fileCompleteSuccess += 1;
                  } else if (event.status === "skipped") {
                    fileCompleteSkipped += 1;
                  } else if (event.status === "error") {
                    fileCompleteError += 1;
                  }
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
        } finally {
          request.signal.removeEventListener("abort", onRequestAbort);

          const durationMs = Date.now() - startTime;
          console.info("[simple-review][metrics]", {
            requestId,
            vercelId,
            durationMs,
            firstByteAtMs,
            clientAbortAtMs,
            requestAborted: request.signal.aborted,
            localAborted: abortController.signal.aborted,
            hardTimeoutMs,
            hardTimeoutTriggered:
              combinedSignal.aborted &&
              !abortController.signal.aborted &&
              !request.signal.aborted,
            eventsEmitted,
            bytesEnqueued,
            fileCompleteSuccess,
            fileCompleteSkipped,
            fileCompleteError,
            prIdentifier,
            repo: repoFullNameStr,
            pullNumber: prNumber,
            modelQueryValue,
            tooltipLanguage,
          });
        }
      },
      cancel(reason) {
        abortController.abort(
          reason instanceof Error ? reason : new Error("Stream canceled")
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "x-cmux-request-id": requestId,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("[simple-review][api] Unexpected failure", {
      message,
      error,
    });
    const durationMs = Date.now() - startTime;
    console.info("[simple-review][metrics]", {
      requestId,
      vercelId,
      durationMs,
      requestAborted: request.signal.aborted,
      error: message,
    });
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "x-cmux-request-id": requestId } },
    );
  }
}
