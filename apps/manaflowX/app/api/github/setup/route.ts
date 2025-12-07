import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "@/convex/_generated/api";
import { base64urlFromBytes, base64urlToBytes } from "@/convex/_shared/encoding";
import { hmacSha256 } from "@/convex/_shared/crypto";
import {
  fetchInstallationAccountInfo,
  fetchAllInstallationRepositories,
} from "@/convex/_shared/githubApp";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationIdStr = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;

  if (!installationIdStr) {
    return new NextResponse("Missing installation_id", { status: 400 });
  }

  const installationId = Number(installationIdStr);
  if (!Number.isFinite(installationId)) {
    return new NextResponse("Invalid installation_id", { status: 400 });
  }

  // If state is missing, redirect to home
  if (!state) {
    return NextResponse.redirect(new URL("/", baseUrl));
  }

  const installStateSecret = process.env.INSTALL_STATE_SECRET;
  if (!installStateSecret) {
    return new NextResponse("Setup not configured", { status: 501 });
  }

  // Parse token: v2.<payload>.<sig>
  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== "v2") {
    return NextResponse.redirect(new URL("/", baseUrl));
  }

  const payloadBytes = base64urlToBytes(parts[1] ?? "");
  const payloadStr = new TextDecoder().decode(payloadBytes);
  const expectedSigB64 = parts[2] ?? "";
  const sigBuf = await hmacSha256(installStateSecret, payloadStr);
  const actualSigB64 = base64urlFromBytes(new Uint8Array(sigBuf));

  if (actualSigB64 !== expectedSigB64) {
    return NextResponse.redirect(new URL("/", baseUrl));
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
    return NextResponse.redirect(new URL("/", baseUrl));
  }

  const now = Date.now();
  if (payload.exp < now) {
    // Expired state - consume and redirect
    await convex.mutation(internal.github_app.consumeInstallState, {
      nonce: payload.nonce,
      expire: true,
    });
    return NextResponse.redirect(new URL("/", baseUrl));
  }

  // Ensure nonce exists and is pending
  const row = await convex.query(internal.github_app.getInstallStateByNonce, {
    nonce: payload.nonce,
  });

  if (!row || row.status !== "pending") {
    return NextResponse.redirect(new URL("/", baseUrl));
  }

  // Mark as used
  await convex.mutation(internal.github_app.consumeInstallState, {
    nonce: payload.nonce,
  });

  // Fetch installation account info
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    console.error("[github_setup] Missing GitHub App credentials");
    return NextResponse.redirect(new URL(payload.returnUrl || "/", baseUrl));
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
  const connectionId = await convex.mutation(
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
        await convex.mutation(internal.github.syncReposForInstallation, {
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

  // Redirect back to the app
  const returnUrl = payload.returnUrl || "/";
  return NextResponse.redirect(new URL(returnUrl, baseUrl));
}
