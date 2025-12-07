import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { base64urlFromBytes, base64urlToBytes } from "./_shared/encoding";
import { hmacSha256 } from "./_shared/crypto";
import {
  fetchInstallationAccountInfo,
  fetchAllInstallationRepositories,
} from "./_shared/githubApp";
import {
  exchangeTwitterCode,
  fetchTwitterUser,
} from "./_shared/twitterApi";

const http = httpRouter();

/**
 * Stack Auth webhook endpoint
 * Configure this URL in Stack Auth dashboard: https://your-convex-url.convex.site/stack-auth-webhook
 *
 * For production, you should verify the webhook signature using Svix.
 * See: https://docs.svix.com/receiving/verifying-payloads/how
 */
http.route({
  path: "/stack-auth-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { type, data } = body as {
        type: string;
        data: {
          id: string;
          display_name?: string | null;
          primary_email?: string | null;
          primary_email_verified?: boolean;
          profile_image_url?: string | null;
          selected_team?: {
            id: string;
            display_name?: string;
            profile_image_url?: string | null;
          } | null;
          has_password?: boolean;
          signed_up_at_millis?: number;
          last_active_at_millis?: number;
          client_metadata?: unknown;
          client_read_only_metadata?: unknown;
          server_metadata?: unknown;
        };
      };

      if (type === "user.created" || type === "user.updated") {
        await ctx.runMutation(internal.users.upsertFromWebhook, {
          userId: data.id,
          primaryEmail: data.primary_email ?? undefined,
          primaryEmailVerified: data.primary_email_verified,
          displayName: data.display_name ?? undefined,
          profileImageUrl: data.profile_image_url ?? undefined,
          selectedTeamId: data.selected_team?.id,
          selectedTeamDisplayName: data.selected_team?.display_name,
          selectedTeamProfileImageUrl:
            data.selected_team?.profile_image_url ?? undefined,
          hasPassword: data.has_password,
          signedUpAtMillis: data.signed_up_at_millis,
          lastActiveAtMillis: data.last_active_at_millis,
          clientMetadata: data.client_metadata,
          clientReadOnlyMetadata: data.client_read_only_metadata,
          serverMetadata: data.server_metadata,
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (type === "user.deleted") {
        await ctx.runMutation(internal.users.deleteFromWebhook, {
          userId: data.id,
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Unknown event type - acknowledge but don't process
      return new Response(
        JSON.stringify({ success: true, message: "Event type not handled" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("Stack Auth webhook error:", error);
      return new Response(
        JSON.stringify({ success: false, error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

/**
 * GitHub App post-installation setup endpoint
 * This is the "Post installation" setup URL configured in GitHub App settings.
 * URL: https://your-convex-url.convex.site/github_setup
 */
http.route({
  path: "/github_setup",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const installationIdStr = url.searchParams.get("installation_id");
    const state = url.searchParams.get("state");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://localhost:3000";

    // Helper to close popup and notify opener window
    const popupResponse = (
      success: boolean,
      returnUrl?: string
    ): Response => {
      const targetUrl = new URL(returnUrl || "/", baseUrl).toString();
      const html = `<!DOCTYPE html>
<html>
<head><title>GitHub App Setup</title></head>
<body>
<script>
(function() {
  var success = ${success};
  var returnUrl = ${JSON.stringify(targetUrl)};

  if (window.opener) {
    // Notify the opener window
    window.opener.postMessage({ type: 'github-app-installed', success: success }, ${JSON.stringify(baseUrl)});
    window.close();
  } else {
    // Fallback if no opener (direct navigation)
    window.location.href = returnUrl;
  }
})();
</script>
<noscript><a href="${targetUrl}">Click here to continue</a></noscript>
</body>
</html>`;
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };

    // Helper for redirects (fallback for non-popup flows)
    const redirect = (path: string) =>
      new Response(null, {
        status: 302,
        headers: { Location: new URL(path, baseUrl).toString() },
      });

    if (!installationIdStr) {
      return new Response("Missing installation_id", { status: 400 });
    }

    const installationId = Number(installationIdStr);
    if (!Number.isFinite(installationId)) {
      return new Response("Invalid installation_id", { status: 400 });
    }

    // If state is missing, redirect to home
    if (!state) {
      return redirect("/");
    }

    const installStateSecret = process.env.INSTALL_STATE_SECRET;
    if (!installStateSecret) {
      return new Response("Setup not configured", { status: 501 });
    }

    // Parse token: v2.<payload>.<sig>
    const parts = state.split(".");
    if (parts.length !== 3 || parts[0] !== "v2") {
      return redirect("/");
    }

    const payloadBytes = base64urlToBytes(parts[1] ?? "");
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const expectedSigB64 = parts[2] ?? "";
    const sigBuf = await hmacSha256(installStateSecret, payloadStr);
    const actualSigB64 = base64urlFromBytes(new Uint8Array(sigBuf));

    if (actualSigB64 !== expectedSigB64) {
      return redirect("/");
    }

    type Payload = {
      ver: 1;
      userId: string;
      iat: number;
      exp: number;
      nonce: string;
      returnUrl?: string;
    };

    let payload: Payload;
    try {
      payload = JSON.parse(payloadStr) as Payload;
    } catch {
      return redirect("/");
    }

    const now = Date.now();
    if (payload.exp < now) {
      // Expired state - consume and redirect
      await ctx.runMutation(internal.github_app.consumeInstallState, {
        nonce: payload.nonce,
        expire: true,
      });
      return redirect("/");
    }

    // Ensure nonce exists and is pending
    const row = await ctx.runQuery(internal.github_app.getInstallStateByNonce, {
      nonce: payload.nonce,
    });

    if (!row || row.status !== "pending") {
      return redirect("/");
    }

    // Mark as used
    await ctx.runMutation(internal.github_app.consumeInstallState, {
      nonce: payload.nonce,
    });

    // Fetch installation account info
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      console.error("[github_setup] Missing GitHub App credentials");
      return redirect(payload.returnUrl || "/");
    }

    const accountInfo = await fetchInstallationAccountInfo(
      installationId,
      appId,
      privateKey
    );

    if (accountInfo) {
      console.log(
        `[github_setup] Installation ${installationId} account=${accountInfo.accountLogin} type=${accountInfo.accountType ?? "unknown"}`
      );
    } else {
      console.warn(
        `[github_setup] No account metadata fetched for installation ${installationId}`
      );
    }

    // Create/update provider connection
    const connectionId = await ctx.runMutation(
      internal.github_app.upsertProviderConnectionFromInstallation,
      {
        installationId,
        userId: payload.userId,
        connectedByUserId: payload.userId,
        isActive: true,
        ...(accountInfo?.accountLogin
          ? { accountLogin: accountInfo.accountLogin }
          : {}),
        ...(accountInfo?.accountId !== undefined
          ? { accountId: accountInfo.accountId }
          : {}),
        ...(accountInfo?.accountType
          ? { accountType: accountInfo.accountType }
          : {}),
      }
    );

    // Sync repositories
    if (connectionId) {
      try {
        const repos = await fetchAllInstallationRepositories(
          installationId,
          appId,
          privateKey
        );

        if (repos.length > 0) {
          await ctx.runMutation(internal.github.syncReposForInstallation, {
            userId: payload.userId,
            connectionId,
            repos,
          });
          console.log(
            `[github_setup] Synced ${repos.length} repositories for installation ${installationId}`
          );
        }
      } catch (error) {
        console.error(
          `[github_setup] Failed to sync repositories for installation ${installationId}`,
          error
        );
      }
    }

    // Notify opener window and close popup (or redirect if not in popup)
    return popupResponse(true, payload.returnUrl);
  }),
});

/**
 * Twitter OAuth 2.0 callback endpoint
 * This handles the redirect after user authorizes on Twitter.
 * URL: https://your-convex-url.convex.site/twitter_callback
 * Reference: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 */
http.route({
  path: "/twitter_callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://localhost:3000";

    // Helper to close popup and notify opener window
    const popupResponse = (
      success: boolean,
      returnUrl?: string,
      errorMessage?: string
    ): Response => {
      const targetUrl = new URL(returnUrl || "/", baseUrl).toString();
      const html = `<!DOCTYPE html>
<html>
<head><title>Twitter OAuth</title></head>
<body>
<script>
(function() {
  var success = ${success};
  var returnUrl = ${JSON.stringify(targetUrl)};
  var errorMessage = ${JSON.stringify(errorMessage || null)};

  if (window.opener) {
    window.opener.postMessage({ type: 'twitter-oauth-complete', success: success, error: errorMessage }, ${JSON.stringify(baseUrl)});
    window.close();
  } else {
    window.location.href = returnUrl;
  }
})();
</script>
<noscript><a href="${targetUrl}">Click here to continue</a></noscript>
</body>
</html>`;
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };

    // Handle error from Twitter
    if (error) {
      console.error("[twitter_callback] OAuth error:", error);
      return popupResponse(false, undefined, error);
    }

    if (!code || !state) {
      return popupResponse(false, undefined, "Missing code or state");
    }

    // Validate and consume state
    const stateRow = await ctx.runQuery(internal.twitter.getTwitterOAuthStateByState, {
      state,
    });

    if (!stateRow || stateRow.status !== "pending") {
      console.error("[twitter_callback] Invalid or already used state");
      return popupResponse(false, undefined, "Invalid state");
    }

    const now = Date.now();
    if (stateRow.exp < now) {
      await ctx.runMutation(internal.twitter.consumeTwitterOAuthState, {
        state,
        expire: true,
      });
      return popupResponse(false, undefined, "State expired");
    }

    // Mark state as used and get code verifier
    const consumeResult = await ctx.runMutation(internal.twitter.consumeTwitterOAuthState, {
      state,
    });

    if (!consumeResult.ok) {
      return popupResponse(false, undefined, "Failed to consume state");
    }

    const { codeVerifier, userId, returnUrl } = consumeResult;

    // Get Twitter credentials from environment
    const clientId = process.env.X_API_KEY;
    const clientSecret = process.env.X_API_KEY_SECRET;
    const redirectUri = `${process.env.CONVEX_SITE_URL || ""}/twitter_callback`;

    if (!clientId || !clientSecret) {
      console.error("[twitter_callback] Missing Twitter API credentials");
      return popupResponse(false, returnUrl, "Server configuration error");
    }

    // Exchange code for tokens
    const tokenResult = await exchangeTwitterCode({
      code,
      codeVerifier: codeVerifier!,
      clientId,
      clientSecret,
      redirectUri,
    });

    if (!tokenResult.success) {
      console.error("[twitter_callback] Token exchange failed:", tokenResult.error);
      return popupResponse(false, returnUrl, "Failed to get access token");
    }

    // Fetch user info
    const userResult = await fetchTwitterUser(tokenResult.accessToken);

    if (!userResult.success) {
      console.error("[twitter_callback] Failed to fetch user:", userResult.error);
      return popupResponse(false, returnUrl, "Failed to fetch user info");
    }

    // Save connection to database
    await ctx.runMutation(internal.twitter.upsertTwitterConnection, {
      userId: userId!,
      twitterUserId: userResult.user.id,
      twitterUsername: userResult.user.username,
      twitterName: userResult.user.name,
      twitterProfileImageUrl: userResult.user.profile_image_url,
      twitterAccessToken: tokenResult.accessToken,
      twitterRefreshToken: tokenResult.refreshToken,
      twitterTokenExpiresAt: tokenResult.expiresAt,
    });

    console.log(
      `[twitter_callback] Successfully connected Twitter @${userResult.user.username} for user ${userId}`
    );

    return popupResponse(true, returnUrl);
  }),
});

export default http;
