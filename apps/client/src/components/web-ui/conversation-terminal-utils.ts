export function toConversationPtyBaseUrl(sandboxUrl: string): string | null {
  try {
    return new URL("/api/pty/", sandboxUrl).toString();
  } catch {
    return null;
  }
}
