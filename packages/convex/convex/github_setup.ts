import { env } from "../_shared/convex-env";
import {
  base64urlFromBytes,
  base64urlToBytes,
  bytesToHex,
} from "../_shared/encoding";
import { hmacSha256, safeEqualHex } from "../_shared/crypto";
import {
  fetchInstallationAccountInfo,
  streamInstallationRepositories,
} from "../_shared/githubApp";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

export const githubSetup = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const installationIdStr = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");
  const base = env.BASE_APP_URL.replace(/\/$/, "");
  const toCmuxDeepLink = (team?: string | null) =>
    `cmux://github-connect-complete${team ? `?team=${encodeURIComponent(team)}` : ""}`;

  if (!installationIdStr) {
    return new Response("missing params", { status: 400 });
  }
  const installationId = Number(installationIdStr);
  if (!Number.isFinite(installationId)) {
    return new Response("invalid installation_id", { status: 400 });
  }

  // If state is missing (e.g. user used "Configure" from GitHub settings),
  // try to resolve the target team from an existing connection and redirect.
  if (!state) {
    const existing = await ctx.runQuery(
      internal.github_app.getProviderConnectionByInstallationId,
      { installationId }
    );
    if (existing && existing.teamId) {
      const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
        teamId: existing.teamId,
      });
      const teamPath = team?.slug ?? existing.teamId;
      // Prefer deep-linking back to the app to finish the flow
      return Response.redirect(toCmuxDeepLink(teamPath), 302);
    }
    // Fallback: send user to team picker if we can't resolve a team
    return Response.redirect(`${base}/team-picker`, 302);
  }

  if (!env.INSTALL_STATE_SECRET) {
    return new Response("setup not configured", { status: 501 });
  }

  // Parse token: v1.<payload>.<sig>
  const parts = state.split(".");
  if (parts.length !== 3) {
    // Fallback to deep link if state is malformed
    return Response.redirect(toCmuxDeepLink(), 302);
  }
  let payloadStr = "";
  const version = parts[0];

  if (version === "v2") {
    const payloadBytes = base64urlToBytes(parts[1] ?? "");
    payloadStr = new TextDecoder().decode(payloadBytes);
    const expectedSigB64 = parts[2] ?? "";
    const sigBuf = await hmacSha256(env.INSTALL_STATE_SECRET, payloadStr);
    const actualSigB64 = base64urlFromBytes(sigBuf);
    if (actualSigB64 !== expectedSigB64) {
      return Response.redirect(toCmuxDeepLink(), 302);
    }
  } else if (version === "v1") {
    payloadStr = decodeURIComponent(parts[1] ?? "");
    const expectedSigHex = parts[2] ?? "";
    const sigBuf = await hmacSha256(env.INSTALL_STATE_SECRET, payloadStr);
    const actualSigHex = bytesToHex(sigBuf);
    if (!safeEqualHex(actualSigHex, expectedSigHex)) {
      return Response.redirect(toCmuxDeepLink(), 302);
    }
  } else {
    return Response.redirect(toCmuxDeepLink(), 302);
  }

  type Payload = {
    ver: 1;
    teamId: string;
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
    return Response.redirect(toCmuxDeepLink(), 302);
  }

  const now = Date.now();
  if (payload.exp < now) {
    await ctx.runMutation(internal.github_app.consumeInstallState, {
      nonce: payload.nonce,
      expire: true,
    });
    // Expired state: still bring user back to the app to retry
    return Response.redirect(toCmuxDeepLink(), 302);
  }

  // Ensure nonce exists and is pending
  const row = await ctx.runQuery(internal.github_app.getInstallStateByNonce, {
    nonce: payload.nonce,
  });
  if (!row || row.status !== "pending") {
    // State already consumed or unknown. Bring the user back to the app,
    // where we can surface any missing connection.
    return Response.redirect(toCmuxDeepLink(), 302);
  }

  // Mark used
  await ctx.runMutation(internal.github_app.consumeInstallState, {
    nonce: payload.nonce,
  });

  // Map installation -> team (create or patch connection)
  const accountInfo = await fetchInstallationAccountInfo(installationId);
  if (accountInfo) {
    console.log(
      `[github_setup] Installation ${installationId} account=${accountInfo.accountLogin} type=${accountInfo.accountType ?? "unknown"}`
    );
  } else {
    console.warn(
      `[github_setup] No account metadata fetched for installation ${installationId}`
    );
  }
  const connectionId = await ctx.runMutation(
    internal.github_app.upsertProviderConnectionFromInstallation,
    {
      installationId,
      teamId: payload.teamId,
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

  if (connectionId) {
    try {
      const alreadySynced = await ctx.runQuery(
        internal.github.hasReposForTeamUser,
        {
          teamId: payload.teamId,
          userId: payload.userId,
        }
      );

      let insertedTotal = 0;
      let updatedTotal = 0;

      await streamInstallationRepositories(
        installationId,
        async (repos, pageIndex) => {
          try {
            const result = await ctx.runMutation(
              internal.github.syncReposForInstallation,
              {
                teamId: payload.teamId,
                userId: payload.userId,
                connectionId,
                repos,
              }
            );
            insertedTotal += result.inserted;
            updatedTotal += result.updated;
          } catch (error) {
            console.error(
              `[github_setup] Failed to sync installation repositories during setup for installation ${installationId}`,
              {
                pageIndex,
                repoCount: repos.length,
                error,
              }
            );
          }
        },
        { awaitAll: true }
      );

      if (insertedTotal > 0 || updatedTotal > 0) {
        console.log(
          `[github_setup] Initial repository sync completed for installation ${installationId} (inserted=${insertedTotal}, updated=${updatedTotal}, alreadySynced=${alreadySynced})`
        );
      } else {
        console.log(
          `[github_setup] Initial repository sync skipped for installation ${installationId} (no repos returned, alreadySynced=${alreadySynced})`
        );
      }
    } catch (error) {
      console.error(
        `[github_setup] Failed to perform initial repository sync for installation ${installationId}`,
        error
      );
    }
  }

  // Check if there's a returnUrl in the payload (web flow)
  if (payload.returnUrl) {
    console.log("[github_setup] Redirecting to web return URL:", payload.returnUrl);
    return Response.redirect(payload.returnUrl, 302);
  }

  // Otherwise, use Electron deep link (Electron flow)
  const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
    teamId: payload.teamId,
  });
  const teamPath = team?.slug ?? payload.teamId;
  console.log("[github_setup] No return URL, using deep link for team:", teamPath);
  return Response.redirect(toCmuxDeepLink(teamPath), 302);
});
