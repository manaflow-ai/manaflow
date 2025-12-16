import { stackServerAppJs } from "@/lib/utils/stack";

export async function getAccessTokenFromRequest(
  req: Request
): Promise<string | null> {
  // First, try to get user from Stack Auth's token store (cookies)
  try {
    const user = await stackServerAppJs.getUser({ tokenStore: req });
    if (user) {
      const { accessToken } = await user.getAuthJson();
      if (accessToken) return accessToken;
    }
  } catch (_e) {
    // Fall through to try Bearer token
  }

  // Fallback: Check for Bearer token in Authorization header (for CLI clients)
  // We validate the token by passing it to the Stack Auth SDK, which
  // performs cryptographic signature verification.
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7); // Remove "Bearer " prefix

    try {
      // Validate token by having Stack Auth SDK verify it
      const user = await stackServerAppJs.getUser({
        tokenStore: { accessToken: token, refreshToken: token },
      });
      if (user) {
        return token;
      }
    } catch (_e) {
      // Token validation failed
    }
  }

  return null;
}

/**
 * Get Stack Auth user from request, supporting both cookie-based (web) and
 * Bearer token (CLI) authentication.
 *
 * For CLI clients, we pass the access token directly to the Stack Auth SDK
 * which performs cryptographic signature verification.
 */
export async function getUserFromRequest(req: Request) {
  // First, try cookie-based auth (standard web flow)
  try {
    const user = await stackServerAppJs.getUser({ tokenStore: req });
    if (user) {
      return user;
    }
  } catch (_e) {
    // Fall through to try Bearer token
  }

  // Fallback: Check for Bearer token in Authorization header (for CLI clients)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7); // Remove "Bearer " prefix

    try {
      // Pass the token to Stack Auth SDK for cryptographic verification
      const user = await stackServerAppJs.getUser({
        tokenStore: { accessToken: token, refreshToken: token },
      });
      if (user) {
        return user;
      }
    } catch (_e) {
      // Bearer token auth failed
    }
  }

  return null;
}
