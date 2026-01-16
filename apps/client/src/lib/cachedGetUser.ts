import type { StackClientApp } from "@stackframe/react";
import { decodeJwt } from "jose";

type User = Awaited<ReturnType<StackClientApp["getUser"]>>;
declare global {
  interface Window {
    cachedUser: User | null;
    userPromise: Promise<User | null> | null;
  }
}

/**
 * Fetches a fresh user from Stack Auth, bypassing the cache.
 * This triggers Stack Auth's internal token refresh mechanism.
 */
async function fetchFreshUser(
  stackClientApp: StackClientApp
): Promise<User | null> {
  try {
    // stackClientApp.getUser() will automatically refresh tokens if needed
    // via Stack Auth's internal refresh mechanism
    const user = await stackClientApp.getUser();

    if (!user) {
      window.cachedUser = null;
      return null;
    }

    const tokens = await user.currentSession.getTokens();

    if (!tokens.accessToken) {
      window.cachedUser = null;
      return null;
    }
    window.cachedUser = user;
    return user;
  } catch (error) {
    console.error("Error fetching fresh user:", error);
    window.cachedUser = null;
    return null;
  } finally {
    // Always clear the promise to allow future fetches
    window.userPromise = null;
  }
}

export async function cachedGetUser(
  stackClientApp: StackClientApp
): Promise<User | null> {
  // If we have a cached user, check if it's still valid
  if (window.cachedUser) {
    try {
      const tokens = await window.cachedUser.currentSession.getTokens();
      if (!tokens.accessToken) {
        // No access token - need to fetch fresh user
        window.cachedUser = null;
        window.userPromise = null;
        return fetchFreshUser(stackClientApp);
      }
      const jwt = decodeJwt(tokens.accessToken);
      // Add a 30-second buffer before expiration to proactively refresh
      const bufferSeconds = 30;
      if (jwt.exp && jwt.exp < Date.now() / 1000 + bufferSeconds) {
        // Token is expired or about to expire - fetch fresh user which triggers refresh
        window.cachedUser = null;
        window.userPromise = null;
        return fetchFreshUser(stackClientApp);
      }
      return window.cachedUser;
    } catch (error) {
      console.warn("Error checking cached user validity:", error);
      window.cachedUser = null;
      window.userPromise = null;
      // Try to fetch fresh user on error
      return fetchFreshUser(stackClientApp);
    }
  }

  if (window.userPromise) {
    return window.userPromise;
  }

  window.userPromise = (async () => {
    try {
      const user = await stackClientApp.getUser();

      if (!user) {
        window.cachedUser = null;
        window.userPromise = null;
        return null;
      }

      const tokens = await user.currentSession.getTokens();

      if (!tokens.accessToken) {
        window.cachedUser = null;
        window.userPromise = null;
        return null;
      }
      window.cachedUser = user;
      window.userPromise = null;
      return user;
    } catch (error) {
      console.error("Error fetching user:", error);
      window.cachedUser = null;
      window.userPromise = null;
      return null;
    } finally {
      window.userPromise = null;
    }
  })();

  return window.userPromise;
}
