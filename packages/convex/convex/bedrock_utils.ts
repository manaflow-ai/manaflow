/**
 * AWS Bedrock helper utilities for the Anthropic API proxy.
 *
 * This module contains:
 * - Model name mapping (Anthropic API → Bedrock model IDs)
 * - Bedrock streaming format conversion (AWS event stream → SSE)
 * - Base64 decode for Convex runtime (no atob/Buffer)
 * - Prompt caching utilities for supported Claude models
 */

/**
 * AWS Bedrock configuration.
 * Goes directly to Bedrock (not through Cloudflare AI Gateway).
 */
export const BEDROCK_AWS_REGION = "us-east-1";
export const BEDROCK_BASE_URL = `https://bedrock-runtime.${BEDROCK_AWS_REGION}.amazonaws.com`;

/**
 * Model name mapping from Anthropic API model IDs to AWS Bedrock model IDs.
 */
export const MODEL_MAP: Record<string, string> = {
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

// ============================================================================
// Prompt Caching for AWS Bedrock
// ============================================================================

/**
 * Minimum token thresholds per checkpoint for prompt caching.
 * Models not in this map do not support prompt caching.
 */
const CACHE_MIN_TOKENS: Record<string, number> = {
  // Opus 4.5
  "claude-opus-4-5-20251101": 4096,
  "claude-opus-4-5": 4096,
  "claude-4-5-opus": 4096,
  "global.anthropic.claude-opus-4-5-20251101-v1:0": 4096,
  // Sonnet 4.5
  "claude-sonnet-4-5-20250929": 1024,
  "claude-sonnet-4-5": 1024,
  "claude-4-5-sonnet": 1024,
  "global.anthropic.claude-sonnet-4-5-20250929-v1:0": 1024,
  // Sonnet 3.7
  "claude-3-7-sonnet-20250219": 1024,
  "claude-3-7-sonnet": 1024,
  "us.anthropic.claude-3-7-sonnet-20250219-v1:0": 1024,
  // Haiku 3.5
  "claude-3-5-haiku-20241022": 2048,
  "claude-3-5-haiku": 2048,
  "us.anthropic.claude-3-5-haiku-20241022-v1:0": 2048,
};

/** Maximum number of cache checkpoints allowed per request */
const MAX_CACHE_CHECKPOINTS = 4;

type ContentBlock = { type: string; text?: string; cache_control?: { type: string } };
type SystemBlock = string | ContentBlock[];
type Message = { role: string; content: string | ContentBlock[] };

/** Anthropic API request body shape for cache injection */
type AnthropicRequestBody = {
  system?: SystemBlock;
  messages?: Message[];
  tools?: Record<string, unknown>[];
  [key: string]: unknown;
};

/**
 * Check if a model supports prompt caching on Bedrock.
 */
export function supportsCaching(modelId: string): boolean {
  return modelId in CACHE_MIN_TOKENS;
}

/**
 * Rough token estimation (chars / 4).
 * This is a conservative estimate - actual tokens may be fewer.
 */
function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Get total text length from a content block array.
 */
function getContentLength(content: string | ContentBlock[]): number {
  if (typeof content === "string") {
    return content.length;
  }
  return content.reduce((sum, block) => {
    if (block.type === "text" && block.text) {
      return sum + block.text.length;
    }
    return sum;
  }, 0);
}

/**
 * Inject cache_control markers into a request body for Bedrock prompt caching.
 *
 * Strategy:
 * 1. Add cache point at end of system prompt (if large enough)
 * 2. Add cache point at end of tools array (if present and large enough)
 * 3. Add cache points to large user messages (up to remaining checkpoint limit)
 *
 * For InvokeModel API, we use: cache_control: { type: "ephemeral" }
 *
 * @param body - The Anthropic API request body
 * @param modelId - The model ID (Anthropic or Bedrock format)
 * @returns Modified body with cache_control markers added
 */
export function injectCacheControl(
  body: AnthropicRequestBody,
  modelId: string
): AnthropicRequestBody {
  const minTokens = CACHE_MIN_TOKENS[modelId];
  if (!minTokens) {
    // Model doesn't support caching
    return body;
  }

  let checkpointsUsed = 0;
  const result: AnthropicRequestBody = { ...body };

  // 1. Cache the system prompt
  if (result.system && checkpointsUsed < MAX_CACHE_CHECKPOINTS) {
    const system = result.system;

    if (typeof system === "string") {
      // Convert string system to array format with cache_control
      if (estimateTokens(system.length) >= minTokens) {
        result.system = [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ];
        checkpointsUsed++;
      }
    } else if (Array.isArray(system) && system.length > 0) {
      // Add cache_control to the last block
      const totalChars = system.reduce((sum, block) => {
        if (block.type === "text" && block.text) {
          return sum + block.text.length;
        }
        return sum;
      }, 0);

      if (estimateTokens(totalChars) >= minTokens) {
        const newSystem = [...system];
        const lastBlock = { ...newSystem[newSystem.length - 1] };
        lastBlock.cache_control = { type: "ephemeral" };
        newSystem[newSystem.length - 1] = lastBlock;
        result.system = newSystem;
        checkpointsUsed++;
      }
    }
  }

  // 2. Cache the tools array
  if (result.tools && Array.isArray(result.tools) && result.tools.length > 0 && checkpointsUsed < MAX_CACHE_CHECKPOINTS) {
    // Tools are typically large - estimate based on JSON serialization
    const toolsJson = JSON.stringify(result.tools);
    if (estimateTokens(toolsJson.length) >= minTokens) {
      const newTools = [...result.tools];
      const lastTool = { ...newTools[newTools.length - 1] };
      lastTool.cache_control = { type: "ephemeral" };
      newTools[newTools.length - 1] = lastTool;
      result.tools = newTools;
      checkpointsUsed++;
    }
  }

  // 3. Cache large user messages (prioritize earlier messages for context reuse)
  if (result.messages && Array.isArray(result.messages) && checkpointsUsed < MAX_CACHE_CHECKPOINTS) {
    const messages = result.messages;
    const newMessages = [...messages];
    let modified = false;

    // Find user messages that are large enough to cache
    for (let i = 0; i < newMessages.length && checkpointsUsed < MAX_CACHE_CHECKPOINTS; i++) {
      const msg = newMessages[i];
      if (msg.role !== "user") continue;

      const contentLength = getContentLength(msg.content);
      if (estimateTokens(contentLength) < minTokens) {
        continue;
      }

      // Clone and add cache_control
      const newMsg = { ...msg };
      if (typeof newMsg.content === "string") {
        newMsg.content = [
          {
            type: "text",
            text: newMsg.content,
            cache_control: { type: "ephemeral" },
          },
        ];
      } else if (Array.isArray(newMsg.content) && newMsg.content.length > 0) {
        const newContent = [...newMsg.content];
        const lastBlock = { ...newContent[newContent.length - 1] };
        lastBlock.cache_control = { type: "ephemeral" };
        newContent[newContent.length - 1] = lastBlock;
        newMsg.content = newContent;
      }

      newMessages[i] = newMsg;
      checkpointsUsed++;
      modified = true;
    }

    if (modified) {
      result.messages = newMessages;
    }
  }

  if (checkpointsUsed > 0) {
    console.log(`[bedrock-utils] Injected ${checkpointsUsed} cache checkpoint(s) for model ${modelId}`);
  }

  return result;
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
      // Return as SSE format
      return `data: ${decodedBytes}\n\n`;
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
