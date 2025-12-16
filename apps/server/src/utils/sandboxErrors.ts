/**
 * Extract a descriptive error message from a failed sandbox start response.
 * This avoids leaking sensitive information while providing useful context.
 */
export function extractSandboxStartError(startRes: {
  error?: unknown;
  response?: Response;
}): string {
  const baseMessage = "Failed to start sandbox";

  // Try to get error info from the response
  const status = startRes.response?.status;
  const statusText = startRes.response?.statusText;

  // Check for specific HTTP status codes
  if (status === 401) {
    return `${baseMessage}: authentication failed`;
  }
  if (status === 403) {
    return `${baseMessage}: access denied`;
  }
  if (status === 429) {
    return `${baseMessage}: rate limited`;
  }
  if (status === 503 || status === 502 || status === 504) {
    return `${baseMessage}: sandbox provider unavailable (${status})`;
  }

  // Try to extract error message from the error field
  if (startRes.error) {
    const error = startRes.error;
    if (typeof error === "string" && error.length > 0 && error.length < 200) {
      return `${baseMessage}: ${error}`;
    }
  }

  // Include status info if available
  if (status && status >= 400) {
    const statusInfo = statusText ? `${status} ${statusText}` : `HTTP ${status}`;
    return `${baseMessage}: ${statusInfo}`;
  }

  return baseMessage;
}
