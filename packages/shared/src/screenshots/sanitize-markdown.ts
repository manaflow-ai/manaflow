/**
 * Security utilities for sanitizing user-controlled content in markdown output.
 *
 * These utilities prevent:
 * 1. Markdown injection - breaking markdown structure to inject arbitrary links/images
 * 2. Data exfiltration via external URLs - preventing user content from appearing in URLs
 * 3. Email/URL auto-linking that could leak sensitive data
 *
 * @see https://owasp.org/www-community/attacks/Content_Spoofing
 */

/**
 * Characters that have special meaning in markdown and could be used for injection attacks.
 * These must be escaped when appearing in user-controlled content.
 */
const MARKDOWN_SPECIAL_CHARS: Record<string, string> = {
  "\\": "\\\\", // Escape character itself - must be first!
  "[": "\\[", // Link text start
  "]": "\\]", // Link text end
  "(": "\\(", // URL start
  ")": "\\)", // URL end
  "!": "\\!", // Image prefix
  "*": "\\*", // Bold/italic
  "_": "\\_", // Bold/italic underscore
  "`": "\\`", // Code
  "#": "\\#", // Headers
  ">": "\\>", // Blockquotes
  "<": "\\<", // HTML tags
  "|": "\\|", // Tables
  "~": "\\~", // Strikethrough
  "\n": " ", // Newlines could create new markdown elements
  "\r": " ", // Carriage returns
};

/**
 * Characters that must be escaped in filenames.
 * More restrictive than full markdown - only escape characters that could break image syntax.
 */
const FILENAME_SPECIAL_CHARS: Record<string, string> = {
  "\\": "\\\\",
  "[": "\\[",
  "]": "\\]",
  "(": "\\(",
  ")": "\\)",
  "!": "\\!",
  "\n": " ",
  "\r": " ",
};

/**
 * Escapes markdown special characters in user-controlled text.
 * This prevents markdown injection attacks where user content could
 * break the markdown structure and inject arbitrary links or images.
 *
 * @example
 * // Prevents link injection
 * escapeMarkdown("x](https://evil.com)[y")
 * // Returns: "x\\]\\(https://evil.com\\)\\[y"
 *
 * @example
 * // Prevents image injection
 * escapeMarkdown("![malicious](https://evil.com/track)")
 * // Returns: "\\!\\[malicious\\]\\(https://evil.com/track\\)"
 */
export function escapeMarkdown(text: string): string {
  if (!text) return "";

  let result = text;
  for (const [char, escaped] of Object.entries(MARKDOWN_SPECIAL_CHARS)) {
    result = result.replaceAll(char, escaped);
  }

  return result;
}

/**
 * Escapes only characters that could break markdown image/link syntax.
 * Used for filenames where we want to preserve formatting like underscores.
 */
function escapeFilenameForMarkdown(text: string): string {
  if (!text) return "";

  let result = text;
  for (const [char, escaped] of Object.entries(FILENAME_SPECIAL_CHARS)) {
    result = result.replaceAll(char, escaped);
  }

  return result;
}

/**
 * Sanitizes text to prevent data exfiltration via auto-linked content.
 *
 * This function:
 * 1. Obfuscates email addresses to prevent auto-linking (done BEFORE escaping)
 * 2. Removes or neutralizes URLs to prevent external requests (done BEFORE escaping)
 * 3. Escapes markdown special characters
 *
 * @example
 * sanitizeForMarkdown("Contact austin@manaflow.com for help")
 * // Returns: "Contact austin (at) manaflow (dot) com for help"
 *
 * @example
 * sanitizeForMarkdown("Visit https://evil.com/track?data=secret")
 * // Returns: "Visit [URL removed]"
 */
export function sanitizeForMarkdown(text: string): string {
  if (!text) return "";

  let result = text;

  // First, sanitize dangerous content BEFORE escaping markdown
  // This ensures we don't accidentally escape the sanitization markers

  // Remove URLs entirely - they shouldn't appear in descriptions
  result = result.replace(
    /(?:https?|ftp|file|data|javascript|mailto|tel|ssh|git):[^\s)\]]+/gi,
    "[URL removed]"
  );

  // Remove protocol-relative URLs
  result = result.replace(/\/\/[^\s)\]]+/g, "[URL removed]");

  // Obfuscate email addresses to prevent auto-linking
  // Use parentheses which won't be auto-linked by GitHub
  result = result.replace(
    /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\.([a-zA-Z]{2,})/g,
    "$1 (at) $2 (dot) $3"
  );

  // Now escape markdown characters to prevent injection
  result = escapeMarkdown(result);

  return result;
}

/**
 * Validates and sanitizes a storage URL.
 *
 * Only allows URLs from trusted Convex storage domains.
 * Rejects any URL that could be used for data exfiltration or XSS.
 *
 * @returns The validated URL or null if invalid
 */
export function validateStorageUrl(url: string): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    // Only allow HTTPS
    if (parsed.protocol !== "https:") {
      console.warn("[sanitize-markdown] Rejecting non-HTTPS storage URL", {
        url,
        protocol: parsed.protocol,
      });
      return null;
    }

    // Only allow Convex storage domains
    const allowedDomains = [
      ".convex.cloud", // Production Convex storage
      ".convex.site", // Convex sites
    ];

    const isAllowed = allowedDomains.some((domain) =>
      parsed.hostname.endsWith(domain)
    );

    if (!isAllowed) {
      console.warn("[sanitize-markdown] Rejecting storage URL from untrusted domain", {
        url,
        hostname: parsed.hostname,
      });
      return null;
    }

    // Reject URLs with suspicious path patterns
    const suspiciousPatterns = [
      /javascript:/i,
      /data:/i,
      /<script/i,
      /on\w+=/i, // onclick=, onerror=, etc.
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url)) {
        console.warn("[sanitize-markdown] Rejecting storage URL with suspicious pattern", {
          url,
          pattern: pattern.source,
        });
        return null;
      }
    }

    return url;
  } catch {
    console.warn("[sanitize-markdown] Rejecting invalid storage URL", { url });
    return null;
  }
}

/**
 * Sanitizes a screenshot description for safe inclusion in markdown.
 *
 * @param description - User-provided screenshot description
 * @param maxLength - Maximum length (default: 500 characters)
 * @returns Sanitized description safe for markdown
 */
export function sanitizeDescription(
  description: string | undefined | null,
  maxLength = 500
): string {
  if (!description) return "";

  // Truncate to prevent abuse via extremely long strings
  const truncated =
    description.length > maxLength
      ? description.slice(0, maxLength) + "..."
      : description;

  return sanitizeForMarkdown(truncated);
}

/**
 * Sanitizes a filename for safe inclusion in markdown alt text.
 *
 * @param fileName - User-provided filename
 * @param maxLength - Maximum length (default: 100 characters)
 * @returns Sanitized filename safe for markdown
 */
export function sanitizeFileName(
  fileName: string | undefined | null,
  maxLength = 100
): string {
  if (!fileName) return "screenshot";

  // Truncate to prevent abuse
  const truncated =
    fileName.length > maxLength ? fileName.slice(0, maxLength) + "..." : fileName;

  return escapeFilenameForMarkdown(truncated);
}
