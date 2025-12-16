import { isLocalHostname } from "./is-local-host";

export function normalizeOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin?.trim();
  if (!trimmed) return rawOrigin;

  // Try parsing as-is first
  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    // If parsing fails, try adding https:// prefix
    try {
      url = new URL(`https://${trimmed}`);
    } catch (error) {
      console.warn(
        `[normalizeOrigin] Unable to parse origin: ${rawOrigin}`,
        error instanceof Error ? error.message : error
      );
      return trimmed;
    }
  }

  const isLocal = isLocalHostname(url.hostname);
  if (url.protocol === "http:" && !isLocal) {
    url.protocol = "https:";
  }
  return url.origin;
}
