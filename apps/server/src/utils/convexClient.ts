import { convexClientCache } from "@cmux/shared/node/convex-cache";
import { ConvexHttpClient } from "convex/browser";
import { getAuthToken } from "./requestContext";
import { env } from "./server-env";

/**
 * A function that returns the current auth token.
 * Used for long-running operations that need to get the latest token.
 */
export type AuthTokenGetter = () => string | undefined;

// Return a Convex client bound to the current auth context
export function getConvex() {
  const auth = getAuthToken();
  if (!auth) {
    throw new Error("No auth token found");
  }

  // Try to get from cache first
  const cachedClient = convexClientCache.get(auth, env.NEXT_PUBLIC_CONVEX_URL);
  if (cachedClient) {
    return cachedClient;
  }

  // Create new client and cache it
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  client.setAuth(auth);
  convexClientCache.set(auth, env.NEXT_PUBLIC_CONVEX_URL, client);
  return client;
}

/**
 * Return a Convex client using a token getter function.
 * This allows long-running operations to get the latest token
 * even after the original AsyncLocalStorage context token has expired.
 *
 * The getter is called on each invocation to ensure the latest token is used.
 */
export function getConvexWithTokenGetter(getToken: AuthTokenGetter) {
  const auth = getToken();
  if (!auth) {
    throw new Error("No auth token found");
  }

  // Try to get from cache first
  const cachedClient = convexClientCache.get(auth, env.NEXT_PUBLIC_CONVEX_URL);
  if (cachedClient) {
    return cachedClient;
  }

  // Create new client and cache it
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  client.setAuth(auth);
  convexClientCache.set(auth, env.NEXT_PUBLIC_CONVEX_URL, client);
  return client;
}

export type { ConvexHttpClient };
