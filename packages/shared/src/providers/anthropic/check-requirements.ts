import type { ProviderRequirementsContext } from "../../agentConfig";

export async function checkClaudeRequirements(
  context?: ProviderRequirementsContext
): Promise<string[]> {
  const missing: string[] = [];

  // Check if API keys are provided in settings (from context)
  // Either CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY works, otherwise Bedrock can serve fallback
  const hasOAuthToken =
    context?.apiKeys?.CLAUDE_CODE_OAUTH_TOKEN &&
    context.apiKeys.CLAUDE_CODE_OAUTH_TOKEN.trim() !== "";
  const hasApiKeyInSettings =
    context?.apiKeys?.ANTHROPIC_API_KEY &&
    context.apiKeys.ANTHROPIC_API_KEY.trim() !== "";
  const hasBedrockToken = Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()
  );

  // If user has provided credentials via settings, skip local checks
  if (hasOAuthToken || hasApiKeyInSettings || hasBedrockToken) {
    return missing;
  }

  missing.push("Claude OAuth Token or Anthropic API Key");

  return missing;
}
