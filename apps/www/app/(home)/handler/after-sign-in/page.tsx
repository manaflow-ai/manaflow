import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { RequestCookie } from "next/dist/compiled/@edge-runtime/cookies";

import { env } from "@/lib/utils/www-env";
import { stackServerApp } from "@/lib/utils/stack";
import { OpenCmuxClient } from "./OpenCmuxClient";
import { CheckSessionStorageRedirect } from "./CheckSessionStorageRedirect";

export const dynamic = "force-dynamic";

/**
 * Find a Stack Auth cookie by checking multiple naming patterns.
 * Stack Auth uses different cookie naming conventions:
 * - Local HTTP: `stack-refresh-{projectId}` / `stack-access`
 * - Production HTTPS: `__Host-stack-refresh-{projectId}` / `__Host-stack-access`
 * - Production Secure: `__Secure-stack-refresh-{projectId}` / `__Secure-stack-access`
 * - With branch: `__Host-stack-refresh-{projectId}--default` / `__Host-stack-access--default`
 */
function findStackCookie(
  cookieStore: { getAll: () => RequestCookie[] },
  baseName: string
): string | undefined {
  const allCookies = cookieStore.getAll();

  // Priority order: most specific first
  // 1. __Host- prefixed with branch suffix (--default, --main, etc.)
  // 2. __Host- prefixed without suffix
  // 3. __Secure- prefixed with branch suffix
  // 4. __Secure- prefixed without suffix
  // 5. Plain name with branch suffix
  // 6. Plain name

  // First, try to find __Host- prefixed cookies (production HTTPS)
  const hostPrefixedWithBranch = allCookies.find(
    (c) => c.name.startsWith(`__Host-${baseName}--`) && c.value
  );
  if (hostPrefixedWithBranch) {
    return hostPrefixedWithBranch.value;
  }

  const hostPrefixed = allCookies.find(
    (c) => c.name === `__Host-${baseName}` && c.value
  );
  if (hostPrefixed) {
    return hostPrefixed.value;
  }

  const securePrefixedWithBranch = allCookies.find(
    (c) => c.name.startsWith(`__Secure-${baseName}--`) && c.value
  );
  if (securePrefixedWithBranch) {
    return securePrefixedWithBranch.value;
  }

  const securePrefixed = allCookies.find(
    (c) => c.name === `__Secure-${baseName}` && c.value
  );
  if (securePrefixed) {
    return securePrefixed.value;
  }

  // Then try plain name with branch suffix
  const plainWithBranch = allCookies.find(
    (c) => c.name.startsWith(`${baseName}--`) && c.value
  );
  if (plainWithBranch) {
    return plainWithBranch.value;
  }

  // Finally, try plain name
  const plain = allCookies.find((c) => c.name === baseName && c.value);
  if (plain) {
    return plain.value;
  }

  return undefined;
}

type ParsedStackAccessCookie = {
  refreshToken?: string;
  accessToken?: string;
};

type ParsedStackRefreshCookie = {
  refreshToken?: string;
};

function normalizeCookieValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (!value.includes("%")) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch (error) {
    console.error("[After Sign In] Failed to decode cookie value", error);
    return value;
  }
}

function parseStackAccessCookie(value: string | undefined): ParsedStackAccessCookie {
  const normalized = normalizeCookieValue(value);
  if (!normalized) {
    return {};
  }

  if (!normalized.startsWith("[")) {
    return { accessToken: normalized };
  }

  try {
    const parsed: unknown = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      const [refreshToken, accessToken] = parsed;
      if (typeof refreshToken === "string" && typeof accessToken === "string") {
        return { refreshToken, accessToken };
      }
    }
  } catch (error) {
    console.error("[After Sign In] Failed to parse stack-access cookie", error);
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStackRefreshCookie(value: string | undefined): ParsedStackRefreshCookie {
  const normalized = normalizeCookieValue(value);
  if (!normalized) {
    return {};
  }

  if (!normalized.startsWith("{")) {
    return { refreshToken: normalized };
  }

  try {
    const parsed: unknown = JSON.parse(normalized);
    if (isRecord(parsed)) {
      const refreshTokenValue = parsed.refresh_token;
      if (typeof refreshTokenValue === "string") {
        return { refreshToken: refreshTokenValue };
      }
    }
  } catch (error) {
    console.error("[After Sign In] Failed to parse stack-refresh cookie", error);
  }

  return {};
}

type AfterSignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CMUX_SCHEME = "cmux://";

function getSingleValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function isRelativePath(target: string): boolean {
  if (!target) {
    return false;
  }
  if (target.startsWith("//")) {
    return false;
  }
  return target.startsWith("/");
}

/**
 * Check if a URL is safe to redirect to.
 * Only allows relative paths (starting with /).
 * Returns the path if safe, null otherwise.
 */
function getSafeRedirectPath(target: string): string | null {
  if (!target) {
    return null;
  }

  // Only allow relative paths for security
  if (isRelativePath(target)) {
    return target;
  }

  // Reject absolute URLs
  return null;
}

function buildCmuxHref(baseHref: string | null, stackRefreshToken: string | undefined, stackAccessCookie: string | undefined): string | null {
  if (!stackRefreshToken || !stackAccessCookie) {
    return baseHref;
  }

  const pairedHref = baseHref ?? `${CMUX_SCHEME}auth-callback`;

  try {
    const url = new URL(pairedHref);
    url.searchParams.set("stack_refresh", stackRefreshToken);
    url.searchParams.set("stack_access", stackAccessCookie);
    return url.toString();
  } catch {
    return `${CMUX_SCHEME}auth-callback?stack_refresh=${encodeURIComponent(stackRefreshToken)}&stack_access=${encodeURIComponent(stackAccessCookie)}`;
  }
}

export default async function AfterSignInPage({ searchParams: searchParamsPromise }: AfterSignInPageProps) {
  const stackCookies = await cookies();

  // Find Stack Auth cookies using flexible matching for different environments
  // Stack Auth uses different naming conventions:
  // - Local: stack-refresh-{projectId}, stack-access
  // - Production HTTPS: __Host-stack-refresh-{projectId}--default, __Host-stack-access--default
  const refreshCookieBaseName = `stack-refresh-${env.NEXT_PUBLIC_STACK_PROJECT_ID}`;
  const stackRefreshCookieValue = findStackCookie(stackCookies, refreshCookieBaseName);
  const stackAccessCookieValue = findStackCookie(stackCookies, "stack-access");
  const parsedAccessCookie = parseStackAccessCookie(stackAccessCookieValue);
  const parsedRefreshCookie = parseStackRefreshCookie(stackRefreshCookieValue);

  // Start with tokens from cookies as fallback
  let stackRefreshToken = parsedAccessCookie.refreshToken ?? parsedRefreshCookie.refreshToken;
  let stackAccessCookie = normalizeCookieValue(stackAccessCookieValue);
  let accessToken = parsedAccessCookie.accessToken;

  // ALWAYS create a fresh session and get new tokens for Electron deeplinks.
  // This is critical because:
  // 1. When a user is already logged in on cmux.dev and initiates sign-in from Electron,
  //    the existing session's refresh token may have been rotated/invalidated
  // 2. getAuthJson() returns the current session's tokens which may be stale
  // 3. Creating a new session via createSession() generates fresh, valid tokens
  // Without this, Electron would receive stale tokens causing "REFRESH_TOKEN_NOT_FOUND_OR_INVALID" errors.
  try {
    const user = await stackServerApp.getUser({ or: "return-null" });
    if (user) {
      // Create a fresh session with new tokens (30 day expiry for Electron)
      // This ensures we always get valid tokens, even if the current session is stale
      const freshSession = await user.createSession({ expiresInMillis: 30 * 24 * 60 * 60 * 1000 });
      const freshTokens = await freshSession.getTokens();

      if (freshTokens.refreshToken) {
        stackRefreshToken = freshTokens.refreshToken;
        console.log("[After Sign In] Got fresh refresh token from new session");
      }
      if (freshTokens.accessToken) {
        accessToken = freshTokens.accessToken;
        console.log("[After Sign In] Got fresh access token from new session");
      }
    }
  } catch (error) {
    console.error("[After Sign In] Failed to create fresh session", error);
    // Fall back to cookie-based tokens (already set above)
  }

  // ALWAYS reconstruct the access cookie JSON to ensure the refresh token matches
  // Stack Auth SDK validates: refreshTokenCookie === accessCookieJSON[0]
  // If we pass mismatched tokens (e.g., from different cookie sources), auth fails with 401
  if (stackRefreshToken && accessToken) {
    stackAccessCookie = JSON.stringify([stackRefreshToken, accessToken]);
  }

  // Debug logging for production troubleshooting
  if (!stackRefreshToken || !stackAccessCookie) {
    const allCookieNames = stackCookies.getAll().map((c) => c.name);
    console.log("[After Sign In] Cookie search debug:", {
      refreshCookieBaseName,
      allCookieNames,
      foundRefresh: !!stackRefreshToken,
      foundAccess: !!stackAccessCookie,
    });
  }

  const searchParams = await searchParamsPromise;
  const afterAuthReturnToRaw = getSingleValue(searchParams?.after_auth_return_to ?? undefined);

  console.log("[After Sign In] Processing redirect:", {
    afterAuthReturnTo: afterAuthReturnToRaw,
    hasRefreshToken: !!stackRefreshToken,
    hasAccessToken: !!stackAccessCookie,
  });

  // If no return URL in query params, check sessionStorage first (for OAuth popup flow),
  // then fall back to Electron deep link (default for desktop users)
  if (!afterAuthReturnToRaw) {
    // Return a client component that checks sessionStorage, with electron deeplink as fallback
    const electronFallbackHref = buildCmuxHref(null, stackRefreshToken, stackAccessCookie);
    return <CheckSessionStorageRedirect fallbackPath="/" electronFallbackHref={electronFallbackHref} />;
  }

  // Handle Electron deep link redirects
  if (afterAuthReturnToRaw?.startsWith(CMUX_SCHEME)) {
    console.log("[After Sign In] Opening Electron app with deep link");
    const cmuxHref = buildCmuxHref(afterAuthReturnToRaw, stackRefreshToken, stackAccessCookie);
    if (cmuxHref) {
      return <OpenCmuxClient href={cmuxHref} />;
    }
  }

  // Handle web redirects (relative paths only)
  if (afterAuthReturnToRaw) {
    const safePath = getSafeRedirectPath(afterAuthReturnToRaw);
    if (safePath) {
      console.log("[After Sign In] Redirecting to web path:", safePath);
      redirect(safePath);
    } else {
      console.warn("[After Sign In] Unsafe redirect URL blocked:", afterAuthReturnToRaw);
    }
  }

  // Fallback: try to open Electron app
  console.log("[After Sign In] No return path, using fallback");
  const fallbackHref = buildCmuxHref(null, stackRefreshToken, stackAccessCookie);
  if (fallbackHref) {
    return <OpenCmuxClient href={fallbackHref} />;
  }

  // Final fallback: redirect to home
  redirect("/");
}
