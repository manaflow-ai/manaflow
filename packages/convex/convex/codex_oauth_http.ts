import { Effect } from "effect";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { HttpClientService, LiveServices } from "./effect/services";
import { httpError, jsonResponse, runHttpEffect } from "./effect/http";
import { withObservability } from "./effect/observability";

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
const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string().optional(),
  expires_in: z.number(),
  token_type: z.string(),
});

export const codexOAuthRefreshEffect = (
  ctx: Pick<ActionCtx, "runMutation">,
  req: Request
) =>
  Effect.gen(function* () {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
      return yield* Effect.fail(
        httpError(400, {
          error: "invalid_request",
          error_description: "Content-Type must be application/x-www-form-urlencoded",
        })
      );
    }

    const body = yield* Effect.tryPromise({
      try: () => req.text(),
      catch: (error) => {
        console.error("[codex-oauth] Failed to read request body:", error);
        return httpError(400, {
          error: "invalid_request",
          error_description: "Invalid request body",
        });
      },
    });

    const params = new URLSearchParams(body);
    const grantType = params.get("grant_type");
    const proxyToken = params.get("refresh_token");
    const clientId = params.get("client_id");
    const scope = params.get("scope");

    yield* Effect.annotateCurrentSpan({
      grantType: grantType ?? "missing",
      hasProxyToken: Boolean(proxyToken),
      clientId: clientId ?? "default",
    });

    console.log("[codex-oauth] Received refresh request", {
      grantType,
      hasProxyToken: !!proxyToken,
      clientId,
    });

    if (grantType !== "refresh_token") {
      return yield* Effect.fail(
        httpError(400, {
          error: "unsupported_grant_type",
          error_description: "Only refresh_token grant is supported",
        })
      );
    }

    if (!proxyToken) {
      return yield* Effect.fail(
        httpError(400, {
          error: "invalid_request",
          error_description: "refresh_token is required",
        })
      );
    }

    const tokens = yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.codexTokens.getByProxyToken, {
          proxyToken,
        }),
      catch: (error) => {
        console.error("[codex-oauth] Failed to load tokens:", error);
        return httpError(500, {
          error: "server_error",
          error_description: "Failed to load tokens",
        });
      },
    });

    if (!tokens) {
      console.error("[codex-oauth] No tokens found for proxy token");
      return yield* Effect.fail(
        httpError(401, {
          error: "invalid_grant",
          error_description: "Invalid or expired refresh token",
        })
      );
    }

    yield* Effect.succeed(undefined).pipe(
      Effect.annotateLogs({
        userId: tokens.userId,
        teamId: tokens.teamId,
      })
    );

    console.log("[codex-oauth] Found tokens for user", {
      userId: tokens.userId,
      teamId: tokens.teamId,
      hasRefreshToken: !!tokens.refreshToken,
    });

    const httpClient = yield* HttpClientService;

    const openaiResponse = yield* httpClient.fetch(OPENAI_TOKEN_URL, {
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
      const errorData = yield* Effect.tryPromise({
        try: () => openaiResponse.json(),
        catch: (error) => {
          console.error("[codex-oauth] Failed to parse error response:", error);
          return {
            error: "server_error",
            error_description: "Failed to parse error response",
          };
        },
      });
      console.error("[codex-oauth] OpenAI refresh failed", errorData);
      return jsonResponse(errorData, openaiResponse.status);
    }

    const parsedTokens = yield* Effect.tryPromise({
      try: () =>
        openaiResponse
          .json()
          .then((data) => tokenResponseSchema.parse(data)),
      catch: (error) => {
        console.error("[codex-oauth] Invalid token response:", error);
        return httpError(500, {
          error: "server_error",
          error_description: "Invalid token response",
        });
      },
    });

    console.log("[codex-oauth] Got new tokens from OpenAI", {
      hasAccessToken: !!parsedTokens.access_token,
      hasNewRefreshToken: !!parsedTokens.refresh_token,
      expiresIn: parsedTokens.expires_in,
    });

    yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.codexTokens.updateAfterRefresh, {
          userId: tokens.userId,
          teamId: tokens.teamId,
          accessToken: parsedTokens.access_token,
          refreshToken: parsedTokens.refresh_token,
          expiresIn: parsedTokens.expires_in,
        }),
      catch: (error) => {
        console.error("[codex-oauth] Failed to update tokens:", error);
        return httpError(500, {
          error: "server_error",
          error_description: "Failed to persist refreshed tokens",
        });
      },
    });

    console.log("[codex-oauth] Updated tokens in Convex");

    return jsonResponse({
      access_token: parsedTokens.access_token,
      refresh_token: proxyToken,
      id_token: parsedTokens.id_token,
      expires_in: parsedTokens.expires_in,
      token_type: parsedTokens.token_type,
    });
  }).pipe(
    withObservability("codex.oauth.refresh", {
      endpoint: "codex.oauth.refresh",
      method: req.method,
    })
  );

export const codexOAuthRefresh = httpAction(async (ctx, req) => {
  return runHttpEffect(
    codexOAuthRefreshEffect(ctx, req).pipe(Effect.provide(LiveServices))
  );
});
