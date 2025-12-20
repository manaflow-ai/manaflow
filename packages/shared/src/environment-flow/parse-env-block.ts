/**
 * Parse an env file block (like .env file content) into key-value pairs
 * Handles various formats:
 * - KEY=value
 * - export KEY=value
 * - set KEY=value
 * - KEY="quoted value"
 * - KEY='quoted value'
 * - Comments starting with # or //
 */
export function parseEnvBlock(
  text: string
): Array<{ name: string; value: string }> {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const results: Array<{ name: string; value: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("//")
    ) {
      continue;
    }

    // Remove export or set prefix
    const cleanLine = trimmed.replace(/^export\s+/, "").replace(/^set\s+/, "");
    const eqIdx = cleanLine.indexOf("=");

    if (eqIdx === -1) continue;

    const key = cleanLine.slice(0, eqIdx).trim();
    let value = cleanLine.slice(eqIdx + 1).trim();

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only add if key is valid (no spaces)
    if (key && !/\s/.test(key)) {
      results.push({ name: key, value });
    }
  }

  return results;
}

/**
 * Detect if text looks like env file content
 * Used to trigger paste parsing
 */
export function looksLikeEnvContent(text: string): boolean {
  if (!text) return false;
  // Has newlines or has = followed by content
  return /\n/.test(text) || /(=|:)\s*\S/.test(text);
}
