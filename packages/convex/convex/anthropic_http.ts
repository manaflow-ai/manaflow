import { httpAction } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import { env } from "../_shared/convex-env";

/**
 * Cloudflare AI Gateway configuration.
 */
const CLOUDFLARE_ACCOUNT_ID = "0c1675e0def6de1ab3a50a4e17dc5656";
const CLOUDFLARE_GATEWAY_ID = "cmux-ai-proxy";

const hardCodedApiKey = "sk_placeholder_cmux_anthropic_api_key";

/**
 * AWS Bedrock configuration.
 * Goes directly to Bedrock (not through Cloudflare AI Gateway).
 */
const BEDROCK_AWS_REGION = "us-east-1";
const BEDROCK_BASE_URL = `https://bedrock-runtime.${BEDROCK_AWS_REGION}.amazonaws.com`;

export const CLOUDFLARE_ANTHROPIC_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-ai-proxy/anthropic";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Check if the key is a valid Anthropic API key format.
 * Anthropic keys start with "sk-ant-" (regular) or "sk-ant-oat" (OAuth).
 */
function isAnthropicApiKey(key: string | null): boolean {
  return key !== null && key.startsWith("sk-ant-");
}

/**
 * Check if user provided their own valid Anthropic API key (not the placeholder).
 */
function hasUserApiKey(key: string | null): boolean {
  return key !== null && key !== hardCodedApiKey && isAnthropicApiKey(key);
}

/**
 * Model name mapping from Anthropic API model IDs to AWS Bedrock model IDs.
 */
const MODEL_MAP: Record<string, string> = {
  // Sonnet 4.5 variants
  "claude-sonnet-4-5-20250929": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "claude-sonnet-4-5": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "claude-4-5-sonnet": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  // Opus 4.5 variants
  "claude-opus-4-5-20251101": "global.anthropic.claude-opus-4-5-20251101-v1:0",
  "claude-opus-4-5": "global.anthropic.claude-opus-4-5-20251101-v1:0",
  "claude-4-5-opus": "global.anthropic.claude-opus-4-5-20251101-v1:0",
  // Haiku 4.5 variants
  "claude-haiku-4-5-20251001": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-haiku-4-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-4-5-haiku": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  // Sonnet 4 variants
  "claude-sonnet-4-20250514": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-sonnet-4": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-4-sonnet": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  // Opus 4 variants
  "claude-opus-4-20250514": "us.anthropic.claude-opus-4-20250514-v1:0",
  "claude-opus-4": "us.anthropic.claude-opus-4-20250514-v1:0",
  "claude-4-opus": "us.anthropic.claude-opus-4-20250514-v1:0",
  // Sonnet 3.7 variants
  "claude-3-7-sonnet-20250219": "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
  "claude-3-7-sonnet": "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
  // Sonnet 3.5 variants (v2)
  "claude-3-5-sonnet-20241022": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  "claude-3-5-sonnet-v2": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  // Sonnet 3.5 variants (v1)
  "claude-3-5-sonnet-20240620": "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
  "claude-3-5-sonnet": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  // Haiku 3.5 variants
  "claude-3-5-haiku-20241022": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
  "claude-3-5-haiku": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
  // Haiku 3 variants
  "claude-3-haiku-20240307": "us.anthropic.claude-3-haiku-20240307-v1:0",
  "claude-3-haiku": "us.anthropic.claude-3-haiku-20240307-v1:0",
};

/**
 * Convert Anthropic API model ID to AWS Bedrock model ID.
 */
function toBedrockModelId(anthropicModelId: string): string {
  // Check if we have a direct mapping
  if (MODEL_MAP[anthropicModelId]) {
    return MODEL_MAP[anthropicModelId];
  }

  // If the model already looks like a Bedrock model ID, pass it through
  if (
    anthropicModelId.includes(".anthropic.") ||
    anthropicModelId.startsWith("anthropic.")
  ) {
    return anthropicModelId;
  }

  // Default fallback - pass through (will likely fail)
  console.warn(`[anthropic-proxy] Unknown model: ${anthropicModelId}`);
  return anthropicModelId;
}

const TEMPORARY_DISABLE_AUTH = true;

/**
 * HTTP action to proxy Anthropic API requests.
 * Routes to:
 * 1. Anthropic direct (via Cloudflare) - when user provides their own API key
 * 2. AWS Bedrock (via Cloudflare) - when using platform credits (placeholder key)
 */
export const anthropicProxy = httpAction(async (_ctx, req) => {
  // Try to extract token payload for tracking
  const workerAuth = await getWorkerAuth(req, {
    loggerPrefix: "[anthropic-proxy]",
  });

  if (!TEMPORARY_DISABLE_AUTH && !workerAuth) {
    console.error("[anthropic-proxy] Auth error: Missing or invalid token");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const xApiKey = req.headers.get("x-api-key");
    const useUserApiKey = hasUserApiKey(xApiKey);
    const body = await req.json();
    const requestedModel = body.model;

    if (useUserApiKey) {
      // Pass through all original headers like WWW does
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        // Skip hop-by-hop headers and internal headers
        if (
          !["host", "x-cmux-token", "content-length"].includes(key.toLowerCase())
        ) {
          headers[key] = value;
        }
      });

      const response = await fetch(
        `${CLOUDFLARE_ANTHROPIC_BASE_URL}/v1/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }
      );

      // If auth fails, fall back to Bedrock
      if (response.status === 401) {
        const errorData = await response.json();
        console.log(
          "[anthropic-proxy] Invalid API key, falling back to AWS Bedrock",
          {
            model: requestedModel,
            error: errorData,
          }
        );
        // Continue to Bedrock path below
      } else {
        return handleResponse(response, body.stream);
      }
    }

    // AWS Bedrock path: either placeholder key or fallback from invalid user key
    {
      const bedrockToken = env.AWS_BEARER_TOKEN_BEDROCK;
      if (!bedrockToken) {
        console.error(
          "[anthropic-proxy] AWS_BEARER_TOKEN_BEDROCK environment variable is not set"
        );
        return jsonResponse(
          { error: "Bedrock proxy not configured" },
          503
        );
      }

      const bedrockModelId = toBedrockModelId(requestedModel);
      const streamSuffix = body.stream ? "-with-response-stream" : "";
      const bedrockUrl = `${BEDROCK_BASE_URL}/model/${bedrockModelId}/invoke${streamSuffix}`;

      // Build the Bedrock request body
      // Bedrock uses the same format as Anthropic API but with anthropic_version
      // Remove model (it's in URL) and stream (determined by endpoint suffix)
      const { model: _model, stream: _stream, ...bodyWithoutModelAndStream } = body;
      const bedrockBody = {
        ...bodyWithoutModelAndStream,
        anthropic_version: "bedrock-2023-05-31",
      };

      const response = await fetch(bedrockUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bedrockToken}`,
        },
        body: JSON.stringify(bedrockBody),
      });

      // Pass isBedrock=true to convert streaming format
      return handleResponse(response, body.stream, true);
    }
  } catch (error) {
    console.error("[anthropic-proxy] Error:", error);
    return jsonResponse({ error: "Failed to proxy request" }, 500);
  }
});

/**
 * Handle API response for both streaming and non-streaming.
 * For Bedrock streaming, converts AWS event stream format to Anthropic SSE format.
 */
async function handleResponse(
  response: Response,
  isStreaming: boolean,
  isBedrock = false
): Promise<Response> {
  if (isStreaming && response.ok) {
    const stream = response.body;
    if (!stream) {
      return jsonResponse({ error: "No response body" }, 500);
    }

    // Bedrock uses AWS event stream binary format, need to convert to SSE
    if (isBedrock) {
      const transformedStream = convertBedrockStreamToSSE(stream);
      return new Response(transformedStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-Bedrock (Anthropic direct) - pass through as-is
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const data = await response.json();

  if (!response.ok) {
    console.error("[anthropic-proxy] API error:", data);
    return jsonResponse(data, response.status);
  }

  return jsonResponse(data);
}

/**
 * Convert Bedrock's AWS event stream format to Anthropic's SSE format.
 *
 * Bedrock returns binary event stream with structure:
 * - 4 bytes: total length (big-endian)
 * - 4 bytes: headers length (big-endian)
 * - 4 bytes: prelude CRC
 * - headers (key-value pairs)
 * - payload (JSON with "bytes" field containing base64-encoded Anthropic event)
 * - 4 bytes: message CRC
 *
 * We convert this to SSE format: `data: {anthropic_event_json}\n\n`
 */
function convertBedrockStreamToSSE(
  bedrockStream: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let buffer = new Uint8Array(0);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = bedrockStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          // Append to buffer
          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;

          // Process complete messages from buffer
          while (buffer.length >= 12) {
            // Need at least prelude (12 bytes)
            const view = new DataView(buffer.buffer, buffer.byteOffset);
            const totalLength = view.getUint32(0, false); // big-endian

            if (buffer.length < totalLength) {
              // Not enough data for complete message
              break;
            }

            // Extract the message
            const messageBytes = buffer.slice(0, totalLength);
            buffer = buffer.slice(totalLength);

            // Parse the event and convert to SSE
            const sseEvent = parseBedrockEventToSSE(messageBytes);
            if (sseEvent) {
              controller.enqueue(encoder.encode(sseEvent));
            }
          }
        }
        controller.close();
      } catch (error) {
        console.error("[anthropic-proxy] Stream conversion error:", error);
        controller.error(error);
      }
    },
  });
}

/**
 * Base64 decode that works in Convex runtime (no atob/Buffer).
 */
function base64Decode(base64: string): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const len = base64.length;
  let bufferLength = (len * 3) / 4;
  if (base64[len - 1] === "=") bufferLength--;
  if (base64[len - 2] === "=") bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;

  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
  }

  return new TextDecoder().decode(bytes);
}

/**
 * Parse a single Bedrock event message and convert to SSE format.
 */
function parseBedrockEventToSSE(messageBytes: Uint8Array): string | null {
  try {
    const view = new DataView(
      messageBytes.buffer,
      messageBytes.byteOffset,
      messageBytes.byteLength
    );

    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);
    // Skip prelude CRC at offset 8-11

    // Headers start at offset 12
    const headersEnd = 12 + headersLength;
    // Payload is between headers end and message CRC (last 4 bytes)
    const payloadStart = headersEnd;
    const payloadEnd = totalLength - 4;

    if (payloadEnd <= payloadStart) {
      return null;
    }

    const payloadBytes = messageBytes.slice(payloadStart, payloadEnd);
    const payloadText = new TextDecoder().decode(payloadBytes);

    // Parse the JSON payload
    const payload = JSON.parse(payloadText);

    // The payload has a "bytes" field with base64-encoded Anthropic event
    if (payload.bytes) {
      const decodedBytes = base64Decode(payload.bytes);
      // Return as SSE format
      return `data: ${decodedBytes}\n\n`;
    }

    return null;
  } catch (error) {
    console.error("[anthropic-proxy] Error parsing Bedrock event:", error);
    return null;
  }
}

/**
 * Proxy count_tokens to Anthropic directly.
 */
export const anthropicCountTokens = httpAction(async (_ctx, req) => {
  try {
    const body = await req.json();
    const response = await fetch(
      `${CLOUDFLARE_ANTHROPIC_BASE_URL}/v1/messages/count_tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json();
    return jsonResponse(data, response.status);
  } catch (error) {
    console.error("[anthropic-proxy] count_tokens error:", error);
    return jsonResponse({ input_tokens: 0 });
  }
});

/**
 * Stub handler for event logging - just accept and ignore.
 */
export const anthropicEventLogging = httpAction(async () => {
  return jsonResponse({ success: true });
});

// =============================================================================
// DEPRECATED: Vertex AI proxy (kept for reference, instantly fails)
// =============================================================================

/**
 * Google Cloud project configuration (DEPRECATED).
 */
const GCP_PROJECT_ID = "manaflow-420907";
const GCP_REGION = "us-east5";

/**
 * Cloudflare AI Gateway base URL for Google Vertex AI (DEPRECATED).
 */
const CLOUDFLARE_VERTEX_BASE_URL = `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/google-vertex-ai/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/publishers/anthropic/models`;

/**
 * Convert Anthropic API model ID to Vertex AI model ID format (DEPRECATED).
 * Anthropic uses: claude-haiku-4-5-20251001
 * Vertex AI uses: claude-haiku-4-5@20251001
 * The pattern is to replace the last dash before the 8-digit date with @
 */
function toVertexModelId(anthropicModelId: string): string {
  // Match model name ending with -YYYYMMDD (8 digit date)
  const match = anthropicModelId.match(/^(.+)-(\d{8})$/);
  if (match) {
    return `${match[1]}@${match[2]}`;
  }
  // If no date suffix, return as-is (Vertex will likely fail, but let's pass it through)
  return anthropicModelId;
}

/**
 * Handle private key - convert literal \n if present, otherwise use as-is (DEPRECATED).
 */
function formatPrivateKey(key: string): string {
  if (key.includes("\\n")) {
    return key.replace(/\\n/g, "\n");
  }
  return key;
}

/**
 * Build the service account JSON for Cloudflare AI Gateway authentication (DEPRECATED).
 * Cloudflare handles token generation internally when given the service account JSON.
 */
function buildServiceAccountJson(): string {
  const privateKey = env.VERTEX_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("VERTEX_PRIVATE_KEY environment variable is not set");
  }

  const serviceAccount = {
    type: "service_account",
    project_id: GCP_PROJECT_ID,
    private_key_id: "aff18cf6b6f38c0827cba7cb8bd143269560e435",
    private_key: formatPrivateKey(privateKey),
    client_email: "vertex-express@manaflow-420907.iam.gserviceaccount.com",
    client_id: "113976467144405037333",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url:
      "https://www.googleapis.com/robot/v1/metadata/x509/vertex-express%40manaflow-420907.iam.gserviceaccount.com",
    universe_domain: "googleapis.com",
    region: GCP_REGION,
  };

  return JSON.stringify(serviceAccount);
}

/**
 * DEPRECATED: Vertex AI proxy endpoint.
 * This endpoint is deprecated and will always return 503.
 * Kept for code reference only.
 */
export const anthropicProxyVertex = httpAction(async (_ctx, _req) => {
  return jsonResponse(
    {
      error: "Vertex AI proxy is deprecated. Please use the main /api/anthropic/v1/messages endpoint which now uses AWS Bedrock.",
      deprecated: true,
    },
    503
  );
});

// Keep these functions exported for potential future use or testing
export const _deprecated = {
  toVertexModelId,
  formatPrivateKey,
  buildServiceAccountJson,
  CLOUDFLARE_VERTEX_BASE_URL,
  GCP_PROJECT_ID,
  GCP_REGION,
};
