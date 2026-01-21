/**
 * AWS Bedrock helper utilities for the Anthropic API proxy.
 *
 * This module contains:
 * - Model name mapping (Anthropic API → Bedrock model IDs)
 * - Bedrock streaming format conversion (AWS event stream → SSE)
 * - Base64 decode for Convex runtime (no atob/Buffer)
 */

/**
 * AWS Bedrock configuration.
 * Goes directly to Bedrock (not through Cloudflare AI Gateway).
 */
export const BEDROCK_AWS_REGION = "us-east-1";
export const BEDROCK_BASE_URL = `https://bedrock-runtime.${BEDROCK_AWS_REGION}.amazonaws.com`;

/**
 * Bedrock inference profile prefix.
 * - "us" = US cross-region inference (routes within US regions)
 * - "global" = Global cross-region inference (routes across all regions)
 *
 * US cross-region is preferred because:
 * - Lower latency for US-based requests
 * - Separate quota pool from global
 * - Generally more available capacity
 *
 * Can be changed to "global" if US quotas are exhausted.
 */
export const BEDROCK_INFERENCE_PROFILE: "us" | "global" = "us";

/**
 * Base model definitions without inference profile prefix.
 * The prefix (us/global) is applied dynamically based on BEDROCK_INFERENCE_PROFILE.
 */
const BASE_MODELS = {
  // Claude 4.5 models
  "sonnet-4-5": "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "opus-4-5": "anthropic.claude-opus-4-5-20251101-v1:0",
  "haiku-4-5": "anthropic.claude-haiku-4-5-20251001-v1:0",
  // Claude 4 models
  "sonnet-4": "anthropic.claude-sonnet-4-20250514-v1:0",
  "opus-4": "anthropic.claude-opus-4-20250514-v1:0",
  // Claude 3.7 models
  "sonnet-3-7": "anthropic.claude-3-7-sonnet-20250219-v1:0",
  // Claude 3.5 models
  "sonnet-3-5-v2": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "sonnet-3-5-v1": "anthropic.claude-3-5-sonnet-20240620-v1:0",
  "haiku-3-5": "anthropic.claude-3-5-haiku-20241022-v1:0",
  // Claude 3 models
  "haiku-3": "anthropic.claude-3-haiku-20240307-v1:0",
} as const;

/**
 * Get the full Bedrock model ID with the configured inference profile prefix.
 */
function withPrefix(baseModel: string): string {
  return `${BEDROCK_INFERENCE_PROFILE}.${baseModel}`;
}

/**
 * Model name mapping from Anthropic API model IDs to AWS Bedrock model IDs.
 * Uses the configured BEDROCK_INFERENCE_PROFILE prefix.
 */
export const MODEL_MAP: Record<string, string> = {
  // Sonnet 4.5 variants
  "claude-sonnet-4-5-20250929": withPrefix(BASE_MODELS["sonnet-4-5"]),
  "claude-sonnet-4-5": withPrefix(BASE_MODELS["sonnet-4-5"]),
  "claude-4-5-sonnet": withPrefix(BASE_MODELS["sonnet-4-5"]),
  // Opus 4.5 variants
  "claude-opus-4-5-20251101": withPrefix(BASE_MODELS["opus-4-5"]),
  "claude-opus-4-5": withPrefix(BASE_MODELS["opus-4-5"]),
  "claude-4-5-opus": withPrefix(BASE_MODELS["opus-4-5"]),
  // Haiku 4.5 variants
  "claude-haiku-4-5-20251001": withPrefix(BASE_MODELS["haiku-4-5"]),
  "claude-haiku-4-5": withPrefix(BASE_MODELS["haiku-4-5"]),
  "claude-4-5-haiku": withPrefix(BASE_MODELS["haiku-4-5"]),
  // Sonnet 4 variants
  "claude-sonnet-4-20250514": withPrefix(BASE_MODELS["sonnet-4"]),
  "claude-sonnet-4": withPrefix(BASE_MODELS["sonnet-4"]),
  "claude-4-sonnet": withPrefix(BASE_MODELS["sonnet-4"]),
  // Opus 4 variants
  "claude-opus-4-20250514": withPrefix(BASE_MODELS["opus-4"]),
  "claude-opus-4": withPrefix(BASE_MODELS["opus-4"]),
  "claude-4-opus": withPrefix(BASE_MODELS["opus-4"]),
  // Sonnet 3.7 variants
  "claude-3-7-sonnet-20250219": withPrefix(BASE_MODELS["sonnet-3-7"]),
  "claude-3-7-sonnet": withPrefix(BASE_MODELS["sonnet-3-7"]),
  // Sonnet 3.5 variants (v2)
  "claude-3-5-sonnet-20241022": withPrefix(BASE_MODELS["sonnet-3-5-v2"]),
  "claude-3-5-sonnet-v2": withPrefix(BASE_MODELS["sonnet-3-5-v2"]),
  // Sonnet 3.5 variants (v1)
  "claude-3-5-sonnet-20240620": withPrefix(BASE_MODELS["sonnet-3-5-v1"]),
  "claude-3-5-sonnet": withPrefix(BASE_MODELS["sonnet-3-5-v2"]),
  // Haiku 3.5 variants
  "claude-3-5-haiku-20241022": withPrefix(BASE_MODELS["haiku-3-5"]),
  "claude-3-5-haiku": withPrefix(BASE_MODELS["haiku-3-5"]),
  // Haiku 3 variants
  "claude-3-haiku-20240307": withPrefix(BASE_MODELS["haiku-3"]),
  "claude-3-haiku": withPrefix(BASE_MODELS["haiku-3"]),
};

/**
 * Convert Anthropic API model ID to AWS Bedrock model ID.
 */
export function toBedrockModelId(anthropicModelId: string): string {
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
  console.warn(`[bedrock-utils] Unknown model: ${anthropicModelId}`);
  return anthropicModelId;
}

/**
 * Base64 decode that works in Convex runtime (no atob/Buffer).
 */
export function base64Decode(base64: string): string {
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
 * Parse AWS event stream headers.
 * Headers format: [name-length (1 byte)][name][type (1 byte)][value-length (2 bytes)][value]
 * Type 7 = string
 */
function parseEventStreamHeaders(
  headerBytes: Uint8Array
): Record<string, string> {
  const headers: Record<string, string> = {};
  let offset = 0;

  while (offset < headerBytes.length) {
    // Name length (1 byte)
    const nameLength = headerBytes[offset];
    offset += 1;

    // Name
    const name = new TextDecoder().decode(
      headerBytes.slice(offset, offset + nameLength)
    );
    offset += nameLength;

    // Type (1 byte) - we only handle type 7 (string)
    const type = headerBytes[offset];
    offset += 1;

    if (type === 7) {
      // String type: 2-byte length + value
      const valueLength =
        (headerBytes[offset] << 8) | headerBytes[offset + 1];
      offset += 2;
      const value = new TextDecoder().decode(
        headerBytes.slice(offset, offset + valueLength)
      );
      offset += valueLength;
      headers[name] = value;
    } else {
      // Skip unknown types - this is a simplification
      // In practice, Bedrock mainly uses string headers
      break;
    }
  }

  return headers;
}

/**
 * Transform Bedrock tool IDs from `toolu_bdrk_*` format to Anthropic `tooluse_*` format.
 * This is needed because Claude Agent SDK 0.2.8+ only accepts Anthropic-native tool IDs.
 *
 * Transforms only IDs within "id" or "tool_use_id" JSON fields to prevent
 * accidental mutation of user content containing similar patterns.
 *
 * - "id": "toolu_bdrk_01ABC..." → "id": "tooluse_ABC..."
 * - "tool_use_id": "toolu_bdrk_01ABC..." → "tool_use_id": "tooluse_ABC..."
 */
function transformBedrockToolIds(jsonString: string): string {
  // Quick check - if no Bedrock tool IDs, return as-is
  if (!jsonString.includes("toolu_bdrk_")) {
    return jsonString;
  }

  // Transform toolu_bdrk_* IDs to tooluse_* format, but ONLY within JSON id fields
  // This prevents accidental mutation of user content containing similar patterns
  // The regex matches: "id": "toolu_bdrk_01..." or "tool_use_id": "toolu_bdrk_01..."
  // Bedrock format: toolu_bdrk_01 + 22 alphanumeric chars
  // Anthropic format: tooluse_ + 22 alphanumeric chars
  return jsonString.replace(
    /("(?:id|tool_use_id)"\s*:\s*")toolu_bdrk_01([A-Za-z0-9]{22})(")/g,
    (_, prefix, uniquePart, suffix) => `${prefix}tooluse_${uniquePart}${suffix}`
  );
}

/**
 * Parse a single Bedrock event message and convert to SSE format.
 *
 * Bedrock event format:
 * - 4 bytes: total length (big-endian)
 * - 4 bytes: headers length (big-endian)
 * - 4 bytes: prelude CRC
 * - headers (key-value pairs)
 * - payload (JSON with "bytes" field containing base64-encoded Anthropic event)
 * - 4 bytes: message CRC
 *
 * For exception events, headers contain `:exception-type` and `:message-type` = "exception".
 * We convert these to Anthropic-compatible error events.
 */
export function parseBedrockEventToSSE(messageBytes: Uint8Array): string | null {
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

    // Parse headers to detect exception events
    const headerBytes = messageBytes.slice(12, headersEnd);
    const headers = parseEventStreamHeaders(headerBytes);

    if (payloadEnd <= payloadStart) {
      return null;
    }

    const payloadBytes = messageBytes.slice(payloadStart, payloadEnd);
    const payloadText = new TextDecoder().decode(payloadBytes);

    // Check if this is an exception event
    if (headers[":message-type"] === "exception" || headers[":exception-type"]) {
      const exceptionType = headers[":exception-type"] || "UnknownException";
      console.error("[bedrock-utils] Bedrock exception:", exceptionType, payloadText);

      // Convert to Anthropic-compatible error event
      const errorEvent = {
        type: "error",
        error: {
          type: "api_error",
          message: `Bedrock error: ${exceptionType} - ${payloadText}`,
        },
      };
      return `data: ${JSON.stringify(errorEvent)}\n\n`;
    }

    // Parse the JSON payload
    const payload = JSON.parse(payloadText);

    // The payload has a "bytes" field with base64-encoded Anthropic event
    if (payload.bytes) {
      const decodedBytes = base64Decode(payload.bytes);
      // Transform Bedrock tool IDs to Anthropic format
      // SDK 0.2.8+ requires tooluse_* format, not toolu_bdrk_*
      const transformedBytes = transformBedrockToolIds(decodedBytes);

      // Extract event type from the decoded JSON for proper SSE format
      // Anthropic SSE format requires both "event: <type>" and "data: <json>" lines
      try {
        const eventData = JSON.parse(transformedBytes);
        // Validate eventType is a string to prevent invalid SSE event lines
        const eventType =
          typeof eventData.type === "string" ? eventData.type : "message";
        return `event: ${eventType}\ndata: ${transformedBytes}\n\n`;
      } catch (error) {
        // Log parsing errors for debugging (repo rule: never suppress errors)
        console.error("[bedrock-utils] Error parsing event JSON:", error);
        // Fall back to data-only SSE format
        return `data: ${transformedBytes}\n\n`;
      }
    }

    // Log unexpected payload format for debugging
    console.warn("[bedrock-utils] Unexpected payload format:", payloadText);
    return null;
  } catch (error) {
    console.error("[bedrock-utils] Error parsing Bedrock event:", error);
    return null;
  }
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
export function convertBedrockStreamToSSE(
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
        console.error("[bedrock-utils] Stream conversion error:", error);
        controller.error(error);
      }
    },
  });
}
