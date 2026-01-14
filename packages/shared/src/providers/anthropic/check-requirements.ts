import type { ProviderRequirementsContext } from "../../agentConfig";

export async function checkClaudeRequirements(
  _context?: ProviderRequirementsContext
): Promise<string[]> {
  // Claude agents are always available in local mode:
  // - Users can provide their own OAuth token or API key when running Claude Code
  // - The platform has a proxy fallback for authentication
  // This matches web mode behavior where Claude agents are always available
  // due to Vertex AI fallback.
  return [];
}