import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * HTTP endpoint for Codex CLI token refresh proxy.
 *
 * The Codex CLI can be configured with CODEX_REFRESH_TOKEN_URL_OVERRIDE to
 * point to this endpoint. Instead of storing the real refresh token on client
 * devices, the CLI stores a proxy token (cmux_<userId>_<teamId>).
 *
 * This endpoint:
 * 1. Receives the proxy token
 * 2. Looks up the real refresh token from Convex
 * 3. Calls OpenAI to refresh
 * 4. Stores the new refresh token (they rotate!)
 * 5. Returns the access token with the same proxy token
 */
export const codexOAuthRefresh = httpAction(async (ctx, req) => {
  // Parse form body (application/x-www-form-urlencoded)
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Content-Type must be application/x-www-form-urlencoded" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await req.text();
  const params = new URLSearchParams(body);

  const grantType = params.get("grant_type");
  const proxyToken = params.get("refresh_token");
  const clientId = params.get("client_id");
  const scope = params.get("scope");

  console.log("[codex-oauth] Received refresh request", {
    grantType,
    hasProxyToken: !!proxyToken,
    clientId,
  });

  // Validate request
  if (grantType !== "refresh_token") {
    return new Response(
      JSON.stringify({ error: "unsupported_grant_type", error_description: "Only refresh_token grant is supported" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!proxyToken) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "refresh_token is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Look up real tokens from Convex using proxy token
  const tokens = await ctx.runMutation(internal.codexTokens.getByProxyToken, {
    proxyToken,
  });

  if (!tokens) {
    console.error("[codex-oauth] No tokens found for proxy token");
    return new Response(
      JSON.stringify({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("[codex-oauth] Found tokens for user", {
    userId: tokens.userId,
    teamId: tokens.teamId,
    hasRefreshToken: !!tokens.refreshToken,
  });

  // Call OpenAI to refresh
  try {
    const openaiResponse = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: clientId ?? OPENAI_CLIENT_ID,
        ...(scope ? { scope } : {}),
      }).toString(),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json();
      console.error("[codex-oauth] OpenAI refresh failed", errorData);
      return new Response(
        JSON.stringify(errorData),
        { status: openaiResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const newTokens = await openaiResponse.json() as {
      access_token: string;
      refresh_token: string;
      id_token?: string;
      expires_in: number;
      token_type: string;
    };

    console.log("[codex-oauth] Got new tokens from OpenAI", {
      hasAccessToken: !!newTokens.access_token,
      hasNewRefreshToken: !!newTokens.refresh_token,
      expiresIn: newTokens.expires_in,
    });

    // Update tokens in Convex (refresh tokens rotate!)
    await ctx.runMutation(internal.codexTokens.updateAfterRefresh, {
      userId: tokens.userId,
      teamId: tokens.teamId,
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token,
      expiresIn: newTokens.expires_in,
    });

    console.log("[codex-oauth] Updated tokens in Convex");

    // Return response with proxy token (not the real refresh token)
    return new Response(
      JSON.stringify({
        access_token: newTokens.access_token,
        refresh_token: proxyToken, // Return the same proxy token
        id_token: newTokens.id_token,
        expires_in: newTokens.expires_in,
        token_type: newTokens.token_type,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[codex-oauth] Error refreshing tokens:", error);
    return new Response(
      JSON.stringify({ error: "server_error", error_description: "Failed to refresh tokens" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
