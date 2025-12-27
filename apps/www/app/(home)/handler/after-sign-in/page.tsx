import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/utils/www-env";
import { OpenCmuxClient } from "./OpenCmuxClient";
import { CheckSessionStorageRedirect } from "./CheckSessionStorageRedirect";

export const dynamic = "force-dynamic";

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

function buildCmuxHref(baseHref: string | null, stackRefreshToken: string | undefined, stackAccessToken: string | undefined): string | null {
  if (!stackRefreshToken || !stackAccessToken) {
    return baseHref;
  }

  const pairedHref = baseHref ?? `${CMUX_SCHEME}auth-callback`;

  try {
    const url = new URL(pairedHref);
    url.searchParams.set("stack_refresh", stackRefreshToken);
    url.searchParams.set("stack_access", stackAccessToken);
    return url.toString();
  } catch {
    return `${CMUX_SCHEME}auth-callback?stack_refresh=${encodeURIComponent(stackRefreshToken)}&stack_access=${encodeURIComponent(stackAccessToken)}`;
  }
}

export default async function AfterSignInPage({ searchParams: searchParamsPromise }: AfterSignInPageProps) {
  const stackCookies = await cookies();
  // Stack Auth uses __Host- prefix in production (HTTPS) for security
  const refreshCookieName = `stack-refresh-${env.NEXT_PUBLIC_STACK_PROJECT_ID}`;
  const stackRefreshToken =
    stackCookies.get(`__Host-${refreshCookieName}`)?.value ??
    stackCookies.get(refreshCookieName)?.value;
  const stackAccessToken =
    stackCookies.get("__Host-stack-access")?.value ??
    stackCookies.get("stack-access")?.value;

  const searchParams = await searchParamsPromise;
  const afterAuthReturnToRaw = getSingleValue(searchParams?.after_auth_return_to ?? undefined);

  console.log("[After Sign In] Processing redirect:", {
    afterAuthReturnTo: afterAuthReturnToRaw,
    hasRefreshToken: !!stackRefreshToken,
    hasAccessToken: !!stackAccessToken,
  });

  // If no return URL in query params, check sessionStorage first (for OAuth popup flow),
  // then fall back to Electron deep link (default for desktop users)
  if (!afterAuthReturnToRaw) {
    // Return a client component that checks sessionStorage, with electron deeplink as fallback
    const electronFallbackHref = buildCmuxHref(null, stackRefreshToken, stackAccessToken);
    return <CheckSessionStorageRedirect fallbackPath="/" electronFallbackHref={electronFallbackHref} />;
  }

  // Handle Electron deep link redirects
  if (afterAuthReturnToRaw?.startsWith(CMUX_SCHEME)) {
    console.log("[After Sign In] Opening Electron app with deep link");
    const cmuxHref = buildCmuxHref(afterAuthReturnToRaw, stackRefreshToken, stackAccessToken);
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
  const fallbackHref = buildCmuxHref(null, stackRefreshToken, stackAccessToken);
  if (fallbackHref) {
    return <OpenCmuxClient href={fallbackHref} />;
  }

  // Final fallback: redirect to home
  redirect("/");
}
