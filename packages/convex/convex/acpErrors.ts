const MAX_ERROR_LENGTH = 220;

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function redactSecrets(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
      "[redacted-token]"
    )
    .replace(
      /(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^,\s]+/gi,
      "$1=[redacted]"
    );
}

function extractJsonDetail(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    if ("error" in parsed && typeof parsed.error === "string") {
      return parsed.error;
    }
    if ("message" in parsed && typeof parsed.message === "string") {
      return parsed.message;
    }
    return null;
  } catch (error) {
    console.error("[acp] Failed to parse error JSON:", error);
    return null;
  }
}

function safeDetail(detail: string): string | null {
  const normalized = normalizeMessage(detail);
  if (!normalized) {
    return null;
  }
  if (normalized.length > 140) {
    return null;
  }
  return redactSecrets(normalized);
}

export function buildSandboxErrorMessage(
  error: unknown,
  fallback: string
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (!raw) {
    return fallback;
  }

  const normalized = normalizeMessage(raw);
  const match = normalized.match(
    /^(Sandbox (?:configure|init|prompt|RPC) failed):\s*(\d{3})\s*-\s*(.*)$/i
  );

  if (match) {
    const prefix = match[1];
    const statusCode = match[2];
    const detail =
      extractJsonDetail(match[3] ?? "") ?? safeDetail(match[3] ?? "");
    if (detail) {
      return redactSecrets(`${prefix} (status ${statusCode}). ${detail}`);
    }
    return redactSecrets(`${prefix} (status ${statusCode}).`);
  }

  const trimmed = redactSecrets(normalized);
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > MAX_ERROR_LENGTH
    ? `${trimmed.slice(0, MAX_ERROR_LENGTH)}…`
    : trimmed;
}
