import { isLocalHostname } from "./is-local-host";

const HIERARCHICAL_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const SCHEME_PREFIX_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const NON_SLASH_SCHEMES = new Set([
  "about",
  "blob",
  "data",
  "file",
  "intent",
  "mailto",
  "sms",
  "tel",
]);

function inferProtocol(hostCandidate: string): "http" | "https" {
  try {
    const url = new URL(`http://${hostCandidate}`);
    return isLocalHostname(url.hostname) ? "http" : "https";
  } catch {
    return "https";
  }
}

export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return trimmed;
  }

  if (HIERARCHICAL_SCHEME_REGEX.test(trimmed)) {
    return trimmed;
  }

  const schemeMatch = trimmed.match(SCHEME_PREFIX_REGEX);
  if (schemeMatch) {
    const scheme = schemeMatch[1]?.toLowerCase();
    const remainder = trimmed.slice(schemeMatch[0].length);
    if (remainder.startsWith("//")) {
      return trimmed;
    }
    if (scheme && NON_SLASH_SCHEMES.has(scheme)) {
      return trimmed;
    }
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  const protocol = inferProtocol(trimmed);
  return `${protocol}://${trimmed}`;
}
