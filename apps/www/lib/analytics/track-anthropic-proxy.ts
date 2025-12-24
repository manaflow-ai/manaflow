import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";

type AnthropicProxyEvent = {
  // Core identifiers
  teamId: string;
  userId: string;
  taskRunId: string;

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

export async function trackAnthropicProxyRequest(
  event: AnthropicProxyEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId,
    event: "anthropic_proxy_request",
    properties: {
      team_id: event.teamId,
      task_run_id: event.taskRunId,
      model: event.model,
      stream: event.stream,
      is_oauth_token: event.isOAuthToken,
      response_status: event.responseStatus,
      latency_ms: event.latencyMs,
      input_tokens: event.inputTokens,
      output_tokens: event.outputTokens,
      cache_creation_input_tokens: event.cacheCreationInputTokens,
      cache_read_input_tokens: event.cacheReadInputTokens,
      error_type: event.errorType,
    },
  });
}
