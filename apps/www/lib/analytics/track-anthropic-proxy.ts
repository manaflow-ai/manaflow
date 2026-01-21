import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";

// Source identifies which product/feature is making the API call
export type AnthropicProxySource = "cmux" | "preview-new";

type AnthropicProxyEvent = {
  // Core identifiers
  teamId: string;
  userId: string;
  userEmail?: string;
  taskRunId: string;

  // Source/product identifier
  source: AnthropicProxySource;

  // Request metadata
  model: string;
  stream: boolean;
  isOAuthToken: boolean;

  // Response metadata
  responseStatus: number;
  latencyMs: number;

  // Token usage (only available for non-streaming responses)
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;

  // Error info (if applicable)
  errorType?: string;
};

// Map source to span name for PostHog AI analytics
function getSpanName(source: AnthropicProxySource): string {
  switch (source) {
    case "cmux":
      return "claude-code-cmux";
    case "preview-new":
      return "claude-code-preview-new";
  }
}

export async function trackAnthropicProxyRequest(
  event: AnthropicProxyEvent
): Promise<void> {
  // Use PostHog's $ai_generation event for LLM analytics
  // See: https://posthog.com/docs/ai-engineering/observability
  await captureServerPosthogEvent({
    distinctId: event.userId,
    event: "$ai_generation",
    properties: {
      // PostHog AI properties
      $ai_model: event.model,
      $ai_provider: "anthropic",
      $ai_input_tokens: event.inputTokens,
      $ai_output_tokens: event.outputTokens,
      $ai_latency: event.latencyMs / 1000, // PostHog expects seconds
      $ai_http_status: event.responseStatus,
      $ai_is_error: event.responseStatus >= 400,
      $ai_error: event.errorType,
      $ai_stream: event.stream,
      $ai_trace_id: event.taskRunId,
      $ai_span_name: getSpanName(event.source),
      $ai_cache_read_input_tokens: event.cacheReadInputTokens,
      $ai_cache_creation_input_tokens: event.cacheCreationInputTokens,

      // Custom cmux properties
      cmux_source: event.source,
      cmux_team_id: event.teamId,
      cmux_task_run_id: event.taskRunId,
      cmux_is_oauth_token: event.isOAuthToken,

      // Associate user properties with this distinctId
      $set: {
        team_id: event.teamId,
        ...(event.userEmail && { email: event.userEmail }),
      },
    },
  });
}
