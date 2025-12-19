import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runLocalDiffReviewStream } from "@/lib/services/code-review/run-simple-anthropic-review";
import {
  parseModelConfigFromUrlSearchParams,
  parseTooltipLanguageFromUrlSearchParams,
} from "@/lib/services/code-review/model-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Schema for incoming local diff request
const LocalDiffFileSchema = z.object({
  filePath: z.string().min(1),
  diffText: z.string(),
});

const LocalDiffRequestSchema = z.object({
  files: z.array(LocalDiffFileSchema).min(1),
  repoName: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const modelConfig = parseModelConfigFromUrlSearchParams(searchParams);
    const tooltipLanguage = parseTooltipLanguageFromUrlSearchParams(searchParams);

    // Parse JSON body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Validate body schema
    const parseResult = LocalDiffRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { files, repoName } = parseResult.data;

    console.info("[local-review][api] Request received", {
      fileCount: files.length,
      repoName: repoName ?? "local",
      tooltipLanguage,
    });

    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let isClosed = false;

        const enqueue = (payload: unknown) => {
          if (isClosed) {
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
          } catch {
            isClosed = true;
          }
        };

        enqueue({ type: "status", message: "starting" });

        try {
          await runLocalDiffReviewStream({
            files,
            repoName,
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

          const isAbortError = message.includes("Stream aborted") || message.includes("aborted");

          if (isAbortError) {
            console.info("[local-review][api] Stream aborted by client");
          } else {
            console.error("[local-review][api] Stream failed", {
              repoName: repoName ?? "local",
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
    console.error("[local-review][api] Unexpected failure", {
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
