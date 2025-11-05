import { stackServerAppJs } from "@/lib/utils/stack";

export async function getAccessTokenFromRequest(
  req: Request
): Promise<string | null> {
  try {
    const user = await stackServerAppJs.getUser({ tokenStore: req });
    if (user) {
      const { accessToken } = await user.getAuthJson();
      if (accessToken) return accessToken;
    }
  } catch (error) {
    console.error("[auth] Failed to resolve access token from request", error);
    return null;
  }

  return null;
}
